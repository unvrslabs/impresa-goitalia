import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";

const PEC_PROVIDERS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }> = {
  aruba: { imapHost: "imaps.pec.aruba.it", imapPort: 993, smtpHost: "smtps.pec.aruba.it", smtpPort: 465 },
  poste: { imapHost: "mail.postecertifica.it", imapPort: 993, smtpHost: "mail.postecertifica.it", smtpPort: 465 },
  legalmail: { imapHost: "mbox.cert.legalmail.it", imapPort: 993, smtpHost: "sendm.cert.legalmail.it", smtpPort: 465 },
};

export interface PecCreds {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  provider: string;
}

export async function getPecCreds(db: Db, companyId: string): Promise<PecCreds | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "pec_credentials")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try { return JSON.parse(decrypt(secret.description)) as PecCreds; } catch { return null; }
}

function createImapClient(creds: PecCreds) {
  return new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

function parseDaticert(xmlStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tipo = xmlStr.match(/tipo="([^"]+)"/)?.[1];
  const errore = xmlStr.match(/errore="([^"]+)"/)?.[1];
  const mittente = xmlStr.match(/<mittente>([^<]+)<\/mittente>/)?.[1];
  const oggetto = xmlStr.match(/<oggetto>([^<]+)<\/oggetto>/)?.[1];
  const identificativo = xmlStr.match(/<identificativo>([^<]+)<\/identificativo>/)?.[1];
  const gestore = xmlStr.match(/<gestore-emittente>([^<]+)<\/gestore-emittente>/)?.[1];
  if (tipo) result.tipo = tipo;
  if (errore) result.errore = errore;
  if (mittente) result.mittente = mittente;
  if (oggetto) result.oggetto = oggetto;
  if (identificativo) result.identificativo = identificativo;
  if (gestore) result.gestore = gestore;
  return result;
}

export interface PecMessage {
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
  pecTipo?: string;
  pecErrore?: string;
}

export async function listPecMessages(db: Db, companyId: string, folder = "INBOX", limit = 20): Promise<PecMessage[]> {
  const creds = await getPecCreds(db, companyId);
  if (!creds) throw new Error("PEC non connessa");
  const client = createImapClient(creds);
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen(folder);
    if (mailbox.exists === 0) return [];
    const messages: PecMessage[] = [];
    const range = mailbox.exists > limit ? `${mailbox.exists - limit + 1}:*` : "1:*";
    for await (const msg of client.fetch(range, { uid: true, envelope: true, flags: true })) {
      messages.push({
        uid: msg.uid,
        subject: msg.envelope?.subject ?? "(nessun oggetto)",
        from: (msg.envelope?.from?.[0] as any)?.address ?? "",
        date: msg.envelope?.date?.toISOString() ?? "",
        seen: msg.flags?.has("\\Seen") ?? false,
      });
    }
    return messages.reverse();
  } finally {
    await client.logout();
  }
}

export async function readPecMessage(db: Db, companyId: string, uid: number): Promise<{ subject: string; from: string; to: string; date: string; body: string; daticert?: Record<string, string> }> {
  const creds = await getPecCreds(db, companyId);
  if (!creds) throw new Error("PEC non connessa");
  const client = createImapClient(creds);
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    let resultMsg: { subject: string; from: string; to: string; date: string; body: string; daticert?: Record<string, string> } | null = null;
    for await (const msg of client.fetch(String(uid), { uid: true, source: true }, { uid: true })) {
      const parsed = await simpleParser(msg.source as Buffer);
      let daticert: Record<string, string> | undefined;
      for (const att of parsed.attachments) {
        if (att.filename?.toLowerCase() === "daticert.xml") {
          daticert = parseDaticert(att.content.toString("utf8"));
        }
      }
      resultMsg = {
        subject: parsed.subject ?? "",
        from: parsed.from?.text ?? "",
        to: (parsed.to as any)?.text ?? "",
        date: parsed.date?.toISOString() ?? "",
        body: parsed.text ?? (typeof parsed.html === "string" ? parsed.html : "") ?? "",
        daticert,
      };
    }
    // Mark as read
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    if (!resultMsg) throw new Error("Messaggio non trovato");
    return resultMsg;
  } finally {
    await client.logout();
  }
}

export async function sendPecMessage(creds: PecCreds, to: string, subject: string, body: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: creds.smtpHost,
    port: creds.smtpPort,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    tls: { rejectUnauthorized: false },
  });
  await transporter.sendMail({ from: creds.email, to, subject, text: body });
}

export async function getUnreadCount(db: Db, companyId: string): Promise<number> {
  const creds = await getPecCreds(db, companyId);
  if (!creds) return 0;
  const client = createImapClient(creds);
  try {
    await client.connect();
    const status = await client.status("INBOX", { unseen: true });
    await client.logout();
    return status.unseen ?? 0;
  } catch {
    try { await client.logout(); } catch {}
    return 0;
  }
}

export function pecRoutes(db: Db) {
  const router = Router();

  // POST /pec/connect
  router.post("/pec/connect", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, email, password, provider, imapHost, imapPort, smtpHost, smtpPort } = req.body as {
      companyId: string; email: string; password: string; provider: string;
      imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number;
    };
    if (!companyId || !email || !password || !provider) { res.status(400).json({ error: "Campi obbligatori mancanti" }); return; }

    const preset = PEC_PROVIDERS[provider];
    const creds: PecCreds = {
      email, password, provider,
      imapHost: preset?.imapHost ?? imapHost ?? "",
      imapPort: preset?.imapPort ?? imapPort ?? 993,
      smtpHost: preset?.smtpHost ?? smtpHost ?? "",
      smtpPort: preset?.smtpPort ?? smtpPort ?? 465,
    };

    // Test IMAP connection
    const client = createImapClient(creds);
    try {
      await client.connect();
      await client.logout();
    } catch (err) {
      res.status(400).json({ error: "Connessione IMAP fallita. Verifica email, password e provider." });
      return;
    }

    const encrypted = encrypt(JSON.stringify(creds));
    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "pec_credentials")))
      .then((r) => r[0]);
    if (existing) {
      await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
    } else {
      await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "pec_credentials", provider: "encrypted", description: encrypted });
    }
    await upsertConnectorAccount(db, companyId, "pec", email, email);
    res.json({ connected: true, email });
  });

  // GET /pec/status?companyId=xxx
  router.get("/pec/status", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const creds = await getPecCreds(db, companyId);
    if (!creds) { res.json({ connected: false }); return; }
    res.json({ connected: true, email: creds.email, provider: creds.provider });
  });

  // POST /pec/disconnect
  router.post("/pec/disconnect", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = (req.body?.companyId || req.query.companyId) as string;
    const creds = await getPecCreds(db, companyId);
    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "pec_credentials")));
    await removeConnectorAccount(db, companyId, "pec", creds?.email);
    res.json({ disconnected: true });
  });

  // GET /pec/messages?companyId=xxx&folder=INBOX&limit=50
  router.get("/pec/messages", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const folder = (req.query.folder as string) || "INBOX";
    const limit = parseInt((req.query.limit as string) || "20", 10);
    try {
      const messages = await listPecMessages(db, companyId, folder, limit);
      res.json({ messages });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /pec/message/:uid?companyId=xxx
  router.get("/pec/message/:uid", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const uid = parseInt(req.params.uid, 10);
    try {
      const message = await readPecMessage(db, companyId, uid);
      res.json(message);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /pec/send
  router.post("/pec/send", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, to, subject, body } = req.body as { companyId: string; to: string; subject: string; body: string };
    const creds = await getPecCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "PEC non connessa" }); return; }
    try {
      await sendPecMessage(creds, to, subject, body);
      res.json({ sent: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /pec/reply
  router.post("/pec/reply", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, to, subject, body } = req.body as { companyId: string; to: string; subject: string; body: string };
    const creds = await getPecCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "PEC non connessa" }); return; }
    const replySubject = subject.startsWith("Re:") ? subject : "Re: " + subject;
    try {
      await sendPecMessage(creds, to, replySubject, body);
      res.json({ sent: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /pec/unread-count?companyId=xxx
  router.get("/pec/unread-count", async (req, res) => {
    const companyId = req.query.companyId as string;
    const count = await getUnreadCount(db, companyId);
    res.json({ count });
  });

  return router;
}
