import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, agents } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "node:crypto";

const WASENDER_API = "https://www.wasenderapi.com/api";
const WASENDER_PAT = process.env.WASENDER_PAT || "";

function getKeyHash(): Buffer {
  const key = process.env.GOITALIA_SECRET_KEY || process.env.BETTER_AUTH_SECRET || "goitalia-default-key-change-me";
  return crypto.createHash("sha256").update(key).digest();
}
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-cbc", getKeyHash(), iv);
  let e = c.update(text, "utf8", "hex"); e += c.final("hex");
  return iv.toString("hex") + ":" + e;
}
function decrypt(text: string): string {
  const [ivHex, enc] = text.split(":");
  if (!ivHex || !enc) throw new Error("Invalid");
  const d = crypto.createDecipheriv("aes-256-cbc", getKeyHash(), Buffer.from(ivHex, "hex"));
  let r = d.update(enc, "hex", "utf8"); r += d.final("utf8");
  return r;
}

export function whatsappRoutes(db: Db) {
  const router = Router();

  // POST /whatsapp/connect — Create session + get QR
  router.post("/whatsapp/connect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, phoneNumber, name } = req.body as { companyId: string; phoneNumber: string; name?: string };
    if (!companyId || !phoneNumber) { res.status(400).json({ error: "companyId e phoneNumber richiesti" }); return; }

    try {
      const webhookUrl = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/wa-hook/" + companyId;

      // Create session on WaSender
      const r = await fetch(WASENDER_API + "/whatsapp-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + WASENDER_PAT },
        body: JSON.stringify({
          name: name || "GoItalIA-" + companyId.slice(0, 8),
          phone_number: phoneNumber,
          account_protection: true,
          log_messages: true,
          webhook_url: webhookUrl,
          webhook_enabled: true,
          webhook_events: ["messages.received", "session.status", "qrcode.updated"],
        }),
      });

      if (!r.ok) {
        const err = await r.text();
        console.error("WaSender create error:", r.status, err);
        res.status(502).json({ error: "Errore creazione sessione WhatsApp" });
        return;
      }

      const session = await r.json() as { data?: { id: number; api_key: string; webhook_secret: string } };
      const sessionData = session.data;
      if (!sessionData) { res.status(502).json({ error: "Risposta WaSender non valida" }); return; }

      // Save session info
      const secretData = encrypt(JSON.stringify({
        sessionId: sessionData.id,
        apiKey: sessionData.api_key,
        webhookSecret: sessionData.webhook_secret,
        phoneNumber,
      }));

      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_session")))
        .then((rows) => rows[0]);

      if (existing) {
        await db.update(companySecrets).set({ description: secretData, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "whatsapp_session", provider: "encrypted", description: secretData });
      }

      // Connect session to get QR
      const connectRes = await fetch(WASENDER_API + "/whatsapp-sessions/" + sessionData.id + "/connect", {
        method: "POST",
        headers: { Authorization: "Bearer " + WASENDER_PAT },
      });

      const connectData = await connectRes.json() as { data?: { status: string; qrCode?: string } };

      // Create whatsapp_messages table
      await db.execute(sql`CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        remote_jid TEXT NOT NULL,
        from_name TEXT,
        message_text TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
        message_type TEXT DEFAULT 'text',
        media_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS wa_messages_company_idx ON whatsapp_messages(company_id, created_at DESC)`);

      res.json({
        connected: false,
        sessionId: sessionData.id,
        qrCode: connectData.data?.qrCode || null,
        status: connectData.data?.status || "need_scan",
      });
    } catch (err) {
      console.error("WhatsApp connect error:", err);
      res.status(500).json({ error: "Errore connessione WhatsApp" });
    }
  });

  // GET /whatsapp/qr?companyId=xxx — Get fresh QR code
  router.get("/whatsapp/qr", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_session")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ qrCode: null }); return; }

    try {
      const data = JSON.parse(decrypt(secret.description));
      const r = await fetch(WASENDER_API + "/whatsapp-sessions/" + data.sessionId + "/qrcode", {
        headers: { Authorization: "Bearer " + WASENDER_PAT },
      });
      const qrData = await r.json() as { data?: { qrCode?: string } };
      res.json({ qrCode: qrData.data?.qrCode || null });
    } catch { res.json({ qrCode: null }); }
  });

  // GET /whatsapp/status?companyId=xxx
  router.get("/whatsapp/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ connected: false }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_session")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ connected: false }); return; }

    try {
      const data = JSON.parse(decrypt(secret.description));
      const r = await fetch(WASENDER_API + "/status", {
        headers: { Authorization: "Bearer " + data.apiKey },
      });
      const status = await r.json() as { status?: string };
      res.json({ connected: status.status === "connected", status: status.status, phoneNumber: data.phoneNumber });
    } catch { res.json({ connected: false }); }
  });

  // POST /whatsapp/disconnect?companyId=xxx
  router.post("/whatsapp/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    if (!companyId) { res.json({ disconnected: true }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_session")))
      .then((rows) => rows[0]);

    if (secret?.description) {
      try {
        const data = JSON.parse(decrypt(secret.description));
        await fetch(WASENDER_API + "/whatsapp-sessions/" + data.sessionId + "/disconnect", {
          method: "POST", headers: { Authorization: "Bearer " + WASENDER_PAT },
        }).catch(() => {});
        await fetch(WASENDER_API + "/whatsapp-sessions/" + data.sessionId, {
          method: "DELETE", headers: { Authorization: "Bearer " + WASENDER_PAT },
        }).catch(() => {});
      } catch {}
    }

    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_session")));
    res.json({ disconnected: true });
  });

  // GET /whatsapp/messages?companyId=xxx
  router.get("/whatsapp/messages", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ messages: [] }); return; }
    try {
      const rows = await db.execute(sql`SELECT id, remote_jid, from_name, message_text, direction, message_type, media_url, created_at FROM whatsapp_messages WHERE company_id = ${companyId} ORDER BY created_at DESC LIMIT 200`);
      res.json({ messages: rows || [] });
    } catch { res.json({ messages: [] }); }
  });

  // POST /whatsapp/send
  router.post("/whatsapp/send", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, to, text } = req.body as { companyId: string; to: string; text: string };
    if (!companyId || !to || !text) { res.status(400).json({ error: "Parametri mancanti" }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_session")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.status(400).json({ error: "WhatsApp non connesso" }); return; }

    try {
      const data = JSON.parse(decrypt(secret.description));
      const r = await fetch(WASENDER_API + "/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + data.apiKey },
        body: JSON.stringify({ to, text }),
      });
      if (!r.ok) { res.status(502).json({ error: "Errore invio" }); return; }
      try {
        await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${to}, ${"Bot"}, ${text}, ${"outgoing"})`);
      } catch {}
      res.json({ sent: true });
    } catch { res.status(500).json({ error: "Errore invio" }); }
  });

  return router;
}

// Webhook router (mounted before auth)
export function whatsappWebhookRouter(db: Db) {
  const router = Router();

  router.post("/whatsapp/:companyId", async (req, res) => {
    const companyId = req.params.companyId;
    const event = req.body;
    console.log("[wa-webhook]", companyId, event?.event, event?.data?.messages?.messageBody?.substring(0, 30));
    res.json({ ok: true });

    if (event?.event === "messages.received" && event?.data?.messages) {
      const msg = event.data.messages;
      const remoteJid = msg.key?.remoteJid || "";
      const fromName = msg.pushName || msg.key?.cleanedSenderPn || "";
      const text = msg.messageBody || msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
      
      if (text) {
        try {
          await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${remoteJid}, ${fromName}, ${text}, ${"incoming"})`);
        } catch (err) { console.error("[wa-webhook] save error:", err); }
      }
    }
  });

  return router;
}
