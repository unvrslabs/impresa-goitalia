import { Router } from "express";
import multer from "multer";
import type { Db } from "@goitalia/db";
import { companySecrets, agents, connectorAccounts, agentConnectorAccounts } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";
import { getContactContext, normalizePhoneNumber } from "./whatsapp-contacts.js";

const WASENDER_API = "https://www.wasenderapi.com/api";
function getWasenderPat() { return process.env.WASENDER_PAT || ""; }

export function whatsappRoutes(db: Db) {
  const router = Router();

  // POST /whatsapp/connect — Create or reconnect session + get QR
  router.post("/whatsapp/connect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, phoneNumber, name } = req.body as { companyId: string; phoneNumber: string; name?: string };
    if (!companyId || !phoneNumber) { res.status(400).json({ error: "companyId e phoneNumber richiesti" }); return; }

    try {
      const webhookUrl = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/wa-hook/" + companyId;

      // Check if session already exists in DB
      const existingSecret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
        .then((rows) => rows[0]);

      let sessions: any[] = [];
      if (existingSecret?.description) {
        try { const dec = JSON.parse(decrypt(existingSecret.description)); sessions = Array.isArray(dec) ? dec : [dec]; } catch {}
      }

      // Find existing session for this phone number
      const existingSession = sessions.find((s: any) => s.phoneNumber === phoneNumber);

      if (existingSession?.sessionId) {
        // Session exists — try to reconnect it
        console.log("[wa] Reconnecting existing session, PAT length:", getWasenderPat().length, "sessionId:", existingSession.sessionId);
        const connectRes = await fetch(WASENDER_API + "/whatsapp-sessions/" + existingSession.sessionId + "/connect", {
          method: "POST",
          headers: { Authorization: "Bearer " + getWasenderPat() },
        });
        if (connectRes.ok) {
          const connectData = await connectRes.json() as { data?: { status: string; qrCode?: string } };
          if (connectData.data?.status === "connected") {
            res.json({ connected: true, sessionId: existingSession.sessionId });
          } else {
            res.json({
              connected: false,
              sessionId: existingSession.sessionId,
              qrCode: connectData.data?.qrCode || null,
              status: connectData.data?.status || "need_scan",
            });
          }
          return;
        }
        // If reconnect failed, session might be deleted on WaSender — create new one
        console.log("[wa] Reconnect failed, creating new session");
      }

      // Create new session on WaSender
      const r = await fetch(WASENDER_API + "/whatsapp-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getWasenderPat() },
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
      const newSession = {
        sessionId: sessionData.id,
        apiKey: sessionData.api_key,
        webhookSecret: sessionData.webhook_secret,
        phoneNumber,
      };

      const idx = sessions.findIndex((s: any) => s.phoneNumber === phoneNumber);
      if (idx >= 0) { sessions[idx] = newSession; } else { sessions.push(newSession); }
      const encSessions = encrypt(JSON.stringify(sessions));

      if (existingSecret) {
        await db.update(companySecrets).set({ description: encSessions, updatedAt: new Date() }).where(eq(companySecrets.id, existingSecret.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "whatsapp_sessions", provider: "encrypted", description: encSessions });
      }

      // Sync connector_accounts
      await upsertConnectorAccount(db, companyId, "whatsapp", phoneNumber, name);

      // Connect new session to get QR
      const connectRes = await fetch(WASENDER_API + "/whatsapp-sessions/" + sessionData.id + "/connect", {
        method: "POST",
        headers: { Authorization: "Bearer " + getWasenderPat() },
      });
      const connectData = await connectRes.json() as { data?: { status: string; qrCode?: string } };

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
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ qrCode: null }); return; }

    try {
      const data = JSON.parse(decrypt(secret.description));
      const r = await fetch(WASENDER_API + "/whatsapp-sessions/" + data.sessionId + "/qrcode", {
        headers: { Authorization: "Bearer " + getWasenderPat() },
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
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ connected: false, numbers: [] }); return; }

    try {
      const dec = JSON.parse(decrypt(secret.description));
      const sessions = Array.isArray(dec) ? dec : [dec];
      const numbers = sessions.map((s: any) => ({ phoneNumber: s.phoneNumber, sessionId: s.sessionId }));
      // Check first session status
      if (sessions.length > 0) {
        const r = await fetch(WASENDER_API + "/status", { headers: { Authorization: "Bearer " + sessions[0].apiKey } });
        const status = await r.json() as { status?: string };
        res.json({ connected: status.status === "connected", status: status.status, numbers });
      } else {
        res.json({ connected: false, numbers: [] });
      }
    } catch { res.json({ connected: false, numbers: [] }); }
  });

  // POST /whatsapp/disconnect?companyId=xxx
  router.post("/whatsapp/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    if (!companyId) { res.json({ disconnected: true }); return; }

    const phoneToRemove = req.query.phone as string || req.body?.phone || "";
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);

    if (secret?.description) {
      try {
        const dec = JSON.parse(decrypt(secret.description));
        const sessions = Array.isArray(dec) ? dec : [dec];
        const toRemove = phoneToRemove ? sessions.find((s: any) => s.phoneNumber === phoneToRemove) : sessions[0];
        if (toRemove) {
          await fetch(WASENDER_API + "/whatsapp-sessions/" + toRemove.sessionId + "/disconnect", { method: "POST", headers: { Authorization: "Bearer " + getWasenderPat() } }).catch(() => {});
          await fetch(WASENDER_API + "/whatsapp-sessions/" + toRemove.sessionId, { method: "DELETE", headers: { Authorization: "Bearer " + getWasenderPat() } }).catch(() => {});
        }
        const filtered = phoneToRemove ? sessions.filter((s: any) => s.phoneNumber !== phoneToRemove) : [];
        if (filtered.length > 0) {
          await db.update(companySecrets).set({ description: encrypt(JSON.stringify(filtered)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
        } else {
          await db.delete(companySecrets).where(eq(companySecrets.id, secret.id));
        }
        // Sync connector_accounts
        if (phoneToRemove) {
          await removeConnectorAccount(db, companyId, "whatsapp", phoneToRemove);
        } else {
          await removeConnectorAccount(db, companyId, "whatsapp");
        }
      } catch {}
    }
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
    const { companyId, to, text, remoteJid } = req.body as { companyId: string; to?: string; text: string; remoteJid?: string };
    const recipient = (to || remoteJid || "").replace("@s.whatsapp.net", "").replace("@g.us", "");
    if (!companyId || !recipient || !text) { res.status(400).json({ error: "Parametri mancanti" }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.status(400).json({ error: "WhatsApp non connesso" }); return; }

    try {
      const dec = JSON.parse(decrypt(secret.description));
      const sessions = Array.isArray(dec) ? dec : [dec];
      const data = sessions[0];
      if (!data) { res.status(400).json({ error: "Nessuna sessione WhatsApp" }); return; }
      const r = await fetch(WASENDER_API + "/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + data.apiKey },
        body: JSON.stringify({ to: recipient, text }),
      });
      if (!r.ok) { res.status(502).json({ error: "Errore invio" }); return; }
      try {
        await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${to}, ${"Bot"}, ${text}, ${"outgoing"})`);
      } catch {}
      res.json({ sent: true });
    } catch { res.status(500).json({ error: "Errore invio" }); }
  });

  // POST /whatsapp/send-media - Send image/file via WhatsApp
  const waUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
  router.post("/whatsapp/send-media", waUpload.single("file"), async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, remoteJid, caption } = req.body as { companyId: string; remoteJid?: string; caption?: string };
    const file = (req as any).file;
    if (!companyId || !remoteJid || !file) { res.status(400).json({ error: "Parametri mancanti" }); return; }
    const recipient = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.status(400).json({ error: "WhatsApp non connesso" }); return; }

    try {
      const dec = JSON.parse(decrypt(secret.description));
      const sessions = Array.isArray(dec) ? dec : [dec];
      const data = sessions[0];
      if (!data) { res.status(400).json({ error: "Nessuna sessione" }); return; }

      // WaSender send-media API
      const formData = new FormData();
      formData.append("to", recipient);
      formData.append("media", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
      if (caption) formData.append("caption", caption);

      const r = await fetch(WASENDER_API + "/send-media", {
        method: "POST",
        headers: { Authorization: "Bearer " + data.apiKey },
        body: formData,
      });
      if (!r.ok) { const err = await r.text(); console.error("WA send-media error:", err); res.status(502).json({ error: "Errore invio media" }); return; }
      try {
        const msgText = caption ? "[Allegato] " + caption : "[Allegato: " + file.originalname + "]";
        await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${remoteJid}, Bot, ${msgText}, outgoing)`);
      } catch {}
      res.json({ sent: true });
    } catch (err) { console.error("WA send-media:", err); res.status(500).json({ error: "Errore invio" }); }
  });

  // GET /whatsapp/unread-count?companyId=xxx
  router.get("/whatsapp/unread-count", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ count: 0 }); return; }
    try {
      // Count unread: messages where no per-chat read marker exists after the message, falling back to global marker
      const rows = await db.execute(sql`
        SELECT COUNT(*) as count FROM whatsapp_messages wm
        WHERE wm.company_id = ${companyId} AND wm.direction = 'incoming'
        AND wm.created_at > COALESCE(
          (SELECT last_read_at FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp' AND chat_id = wm.remote_jid),
          (SELECT last_read_at FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp' AND chat_id IS NULL),
          '2000-01-01'
        )`);
      const count = (rows as any[])[0]?.count || 0;
      res.json({ count: parseInt(String(count)) });
    } catch { res.json({ count: 0 }); }
  });

  // POST /whatsapp/mark-read
  router.post("/whatsapp/mark-read", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, chatId } = req.body as { companyId: string; chatId?: string };
    if (!companyId) { res.json({ ok: true }); return; }
    try {
      if (chatId) {
        // Per-chat mark-read
        await db.execute(sql`DELETE FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp' AND chat_id = ${chatId}`);
        await db.execute(sql`INSERT INTO read_markers (company_id, user_id, channel, chat_id, last_read_at) VALUES (${companyId}, ${actor.userId}, 'whatsapp', ${chatId}, now())`);
      } else {
        // Global mark-read (page open)
        await db.execute(sql`DELETE FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp'`);
        await db.execute(sql`INSERT INTO read_markers (company_id, user_id, channel, last_read_at) VALUES (${companyId}, ${actor.userId}, 'whatsapp', now())`);
      }
    } catch {}
    res.json({ ok: true });
  });

  // POST /whatsapp/generate-reply
  router.post("/whatsapp/generate-reply", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, messageText, fromName, remoteJid, mediaUrl, messageType } = req.body as { companyId: string; messageText: string; fromName: string; remoteJid?: string; mediaUrl?: string; messageType?: string };
    if (!companyId || (!messageText && !mediaUrl)) { res.status(400).json({ error: "Parametri mancanti" }); return; }

    const apiKeySecret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
      .then((rows) => rows[0]);
    if (!apiKeySecret?.description) { res.status(400).json({ error: "API key Claude non configurata" }); return; }
    let claudeKey: string;
    try { claudeKey = decrypt(apiKeySecret.description); } catch { res.status(500).json({ error: "Errore decrypt" }); return; }

    // Get conversation history
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (remoteJid) {
      try {
        const rows = await db.execute(sql`SELECT message_text, direction FROM whatsapp_messages WHERE company_id = ${companyId} AND remote_jid = ${remoteJid} ORDER BY created_at ASC LIMIT 20`);
        history = (rows as any[]).map((r: any) => ({
          role: r.direction === "incoming" ? "user" as const : "assistant" as const,
          content: r.message_text,
        }));
      } catch {}
    }
    if (history.length === 0) {
      history = [{ role: "user", content: messageText }];
    }

    try {
      // If last message has an image, add it to the request with vision
      let finalMessages: any = history;
      if (mediaUrl && messageType === "image") {
        try {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const localPath = mediaUrl.replace("/api/wa-media/", "");
          const filePath = path.join(process.cwd(), "data/wa-media", localPath);
          if (fs.existsSync(filePath)) {
            const imgBuffer = fs.readFileSync(filePath);
            const base64 = imgBuffer.toString("base64");
            const mediaType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
            // Replace last message with image + text
            finalMessages = [...history.slice(0, -1), {
              role: "user" as const,
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: messageText || "L'utente ha inviato questa immagine. Descrivi cosa vedi e rispondi in modo appropriato." },
              ],
            }];
          }
        } catch (err) { console.error("[wa] image read error:", err); }
      }

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: "Sei un assistente di customer service professionale. Rispondi in italiano, in modo conciso e cordiale. Se ti viene mostrata un\'immagine, descrivila e rispondi in modo contestuale.",
          messages: finalMessages,
        }),
      });
      if (!r.ok) { res.status(502).json({ error: "Errore AI" }); return; }
      const data = await r.json() as { content?: Array<{ text?: string }> };
      const reply = data.content?.map((c) => c.text).join("") || "";
      res.json({ reply });
    } catch { res.status(500).json({ error: "Errore generazione risposta" }); }
  });

  // POST /whatsapp/settings
  router.post("/whatsapp/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, autoReply, phoneNumber } = req.body as { companyId: string; autoReply: boolean; phoneNumber?: string };
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }
    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_settings")))
      .then((rows) => rows[0]);
    let settings: Record<string, any> = {};
    if (existing?.description) { try { settings = JSON.parse(existing.description); } catch {} }
    if (!settings.numbers) settings.numbers = {};
    if (phoneNumber) { settings.numbers[phoneNumber] = { autoReply }; }
    const json = JSON.stringify(settings);
    if (existing) {
      await db.update(companySecrets).set({ description: json, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
    } else {
      await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "whatsapp_settings", provider: "plain", description: json });
    }
    res.json({ ok: true });
  });

  // GET /whatsapp/settings?companyId=xxx
  router.get("/whatsapp/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ numbers: {} }); return; }
    const row = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_settings")))
      .then((rows) => rows[0]);
    if (!row?.description) { res.json({ numbers: {} }); return; }
    try { res.json(JSON.parse(row.description)); } catch { res.json({ numbers: {} }); }
  });


  // POST /whatsapp/delete-chat
  router.post("/whatsapp/delete-chat", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, remoteJid } = req.body as { companyId: string; remoteJid: string };
    if (!companyId || !remoteJid) { res.status(400).json({ error: "Parametri mancanti" }); return; }
    try {
      await db.execute(sql`DELETE FROM whatsapp_messages WHERE company_id = ${companyId} AND remote_jid = ${remoteJid}`);
      res.json({ deleted: true });
    } catch { res.status(500).json({ error: "Errore" }); }
  });
  return router;
}


export function whatsappWebhookRouter(db: Db) {
  const router = Router();

  router.post("/:companyId", async (req, res) => {
    const companyId = req.params.companyId;
    const event = req.body;
    // Webhook received
    res.json({ ok: true });

    if (event?.event === "messages.received" && event?.data?.messages) {
      const msg = event.data.messages;
      const remoteJid = msg.key?.remoteJid || "";
      const fromName = msg.pushName || msg.key?.cleanedSenderPn || "";
      let text = msg.messageBody || msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
      
      // Handle voice messages
      if (!text && (msg.message?.audioMessage || msg.messageType === "audio")) {
        try {
          const openaiSecret = await db.select().from(companySecrets)
            .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openai_api_key")))
            .then((r: any) => r[0]);
          
          if (!openaiSecret?.description) {
            // Voice not enabled - save placeholder
            text = "[Messaggio vocale - trascrizione non attiva]";
          } else {
            // Get audio URL via WaSender decrypt-media
            const waSecret = await db.select().from(companySecrets)
              .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
              .then((r: any) => r[0]);
            if (waSecret?.description) {
              const sessions = JSON.parse(decrypt(waSecret.description));
              const session = Array.isArray(sessions) ? sessions[0] : sessions;
              if (session?.apiKey) {
                const decryptRes = await fetch("https://www.wasenderapi.com/api/decrypt-media", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.apiKey },
                  body: JSON.stringify({ data: { messages: msg } }),
                });
                if (decryptRes.ok) {
                  const decData = await decryptRes.json() as any;
                  if (decData.data?.url) {
                    const audioRes = await fetch(decData.data.url);
                    const audioBuffer = await audioRes.arrayBuffer();
                    const openaiKey = decrypt(openaiSecret.description);
                    const formData = new FormData();
                    formData.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "voice.ogg");
                    formData.append("model", "whisper-1");
                    formData.append("language", "it");
                    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                      method: "POST", headers: { Authorization: "Bearer " + openaiKey }, body: formData,
                    });
                    if (whisperRes.ok) {
                      const result = await whisperRes.json() as { text?: string };
                      text = "🎤 " + (result.text || "[vocale non comprensibile]");
                    }
                  }
                }
              }
            }
            if (!text) text = "[Messaggio vocale - errore trascrizione]";
          }
        } catch (err) { console.error("[wa-webhook] voice error:", err); text = "[Messaggio vocale]"; }
      }
      
      // Handle image/video/document messages
      let messageType = "text";
      let mediaUrl = "";
      
      if (msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage || msg.messageType === "image" || msg.messageType === "video" || msg.messageType === "document") {
        messageType = msg.message?.imageMessage ? "image" : msg.message?.videoMessage ? "video" : "document";
        const caption = msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || "";
        if (caption) text = caption;
        
        // Download media via WaSender decrypt-media API and save locally
        try {
          const waSecret = await db.select().from(companySecrets)
            .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
            .then((r: any) => r[0]);
          if (waSecret?.description) {
            const sessions = JSON.parse(decrypt(waSecret.description));
            const session = Array.isArray(sessions) ? sessions[0] : sessions;
            if (session?.apiKey) {
              
              const decryptRes = await fetch("https://www.wasenderapi.com/api/decrypt-media", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.apiKey },
                body: JSON.stringify({ data: { messages: msg } }),
              });
              const decText = await decryptRes.text();
              
              if (decryptRes.ok || decryptRes.status === 200) {
                let decData: any = {};
                try { decData = JSON.parse(decText); } catch {}
                if (decData.publicUrl || decData.data?.url) {
                  // Download the file and save locally
                  const mediaRes = await fetch(decData.publicUrl || decData.data?.url);
                  if (mediaRes.ok) {
                    const buffer = Buffer.from(await mediaRes.arrayBuffer());
                    const ext = messageType === "image" ? ".jpg" : messageType === "video" ? ".mp4" : ".bin";
                    const filename = crypto.randomUUID() + ext;
                    const fs = await import("node:fs/promises");
                    await fs.writeFile("data/wa-media/" + filename, buffer);
                    mediaUrl = "/api/wa-media/" + filename;
                  }
                }
              }
            }
          }
        } catch (err) { console.error("[wa-webhook] media download error:", err); }
        
        
        if (!text) text = messageType === "image" ? "[Immagine]" : messageType === "video" ? "[Video]" : "[Documento]";
      }
      
      if (text) {
        try {
          await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction, message_type, media_url) VALUES (${companyId}, ${remoteJid}, ${fromName}, ${text}, ${"incoming"}, ${messageType}, ${mediaUrl || null})`);
        } catch (err) { console.error("[wa-webhook] save error:", err); }

        // Auto-reply via agent connector
        try {
          const agentLink = await db.select({ agentId: agentConnectorAccounts.agentId })
            .from(agentConnectorAccounts)
            .innerJoin(connectorAccounts, eq(agentConnectorAccounts.connectorAccountId, connectorAccounts.id))
            .where(and(
              eq(connectorAccounts.companyId, companyId),
              eq(connectorAccounts.connectorType, "whatsapp"),
            ))
            .then(r => r[0]);

          if (agentLink) {
            const agent = await db.select().from(agents).where(eq(agents.id, agentLink.agentId)).then(r => r[0]);
            if (agent) {
              const agentAutoReply = (agent.adapterConfig as any)?.autoReply === true;

              // Lookup rubrica contatto per override autoMode e contesto
              const contactInfo = await getContactContext(db, agent.id, remoteJid);

              // Determina se rispondere in automatico
              let shouldAutoReply = agentAutoReply;
              if (contactInfo) {
                if (contactInfo.autoMode === "auto") shouldAutoReply = true;
                else if (contactInfo.autoMode === "manual") shouldAutoReply = false;
                // "inherit" → segue il default dell'agente
              }

              if (shouldAutoReply) {
                const claudeSecret = await db.select().from(companySecrets)
                  .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
                  .then(r => r[0]);
                if (claudeSecret?.description) {
                  const claudeKey = decrypt(claudeSecret.description);
                  const adapterConfig = agent.adapterConfig as Record<string, unknown>;
                  let prompt = (adapterConfig?.promptTemplate as string) || `Sei ${agent.name}. Rispondi in italiano in modo conciso.`;

                  // Arricchisci il prompt con contesto del contatto dalla rubrica
                  if (contactInfo?.context) {
                    prompt += contactInfo.context;
                  }

                  // Get conversation history for context
                  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
                  try {
                    const rows = await db.execute(sql`SELECT message_text, direction FROM whatsapp_messages WHERE company_id = ${companyId} AND remote_jid = ${remoteJid} ORDER BY created_at ASC LIMIT 20`);
                    history = (rows as any[]).map((r: any) => ({
                      role: r.direction === "incoming" ? "user" as const : "assistant" as const,
                      content: r.message_text,
                    }));
                  } catch {}
                  if (history.length === 0) {
                    history = [{ role: "user", content: text }];
                  }

                  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
                    body: JSON.stringify({
                      model: (adapterConfig?.model as string) || "claude-haiku-4-5-20251001",
                      max_tokens: 1024,
                      system: prompt,
                      messages: history,
                    }),
                  });

                  if (claudeRes.ok) {
                    const data = await claudeRes.json() as { content?: Array<{ text?: string }> };
                    const reply = data.content?.find(b => b.text)?.text;
                    if (reply) {
                      // Send reply via WaSender API
                      const waSecret = await db.select().from(companySecrets)
                        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
                        .then(r => r[0]);
                      if (waSecret?.description) {
                        const sessions = JSON.parse(decrypt(waSecret.description));
                        const session = Array.isArray(sessions) ? sessions[0] : sessions;
                        if (session?.apiKey) {
                          await fetch(WASENDER_API + "/send-message", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.apiKey },
                            body: JSON.stringify({ to: remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", ""), text: reply }),
                          });
                          try {
                            await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${remoteJid}, ${agent.name || "Bot"}, ${reply}, ${"outgoing"})`);
                          } catch {}
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (autoReplyErr) { console.error("[wa-webhook] auto-reply error:", autoReplyErr); }
      }
    }
  });

  

  

  

  // POST /whatsapp/settings
  router.post("/whatsapp/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, autoReply, phoneNumber } = req.body as { companyId: string; autoReply: boolean; phoneNumber?: string };
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }
    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_settings")))
      .then((rows) => rows[0]);
    let settings: Record<string, any> = {};
    if (existing?.description) { try { settings = JSON.parse(existing.description); } catch {} }
    if (!settings.numbers) settings.numbers = {};
    if (phoneNumber) { settings.numbers[phoneNumber] = { autoReply }; }
    const json = JSON.stringify(settings);
    if (existing) {
      await db.update(companySecrets).set({ description: json, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
    } else {
      await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "whatsapp_settings", provider: "plain", description: json });
    }
    res.json({ ok: true });
  });

  // GET /whatsapp/settings?companyId=xxx
  router.get("/whatsapp/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ numbers: {} }); return; }
    const row = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_settings")))
      .then((rows) => rows[0]);
    if (!row?.description) { res.json({ numbers: {} }); return; }
    try { res.json(JSON.parse(row.description)); } catch { res.json({ numbers: {} }); }
  });

  return router;
}
