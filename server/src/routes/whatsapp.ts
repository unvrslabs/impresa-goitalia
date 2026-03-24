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

      // Save as array (multi-number support)
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
        .then((rows) => rows[0]);

      let sessions: any[] = [];
      if (existing?.description) {
        try { const dec = JSON.parse(decrypt(existing.description)); sessions = Array.isArray(dec) ? dec : [dec]; } catch {}
      }
      const newSession = JSON.parse(decrypt(secretData));
      // Replace if same phone, otherwise append
      const idx = sessions.findIndex((s: any) => s.phoneNumber === phoneNumber);
      if (idx >= 0) { sessions[idx] = newSession; } else { sessions.push(newSession); }
      const encSessions = encrypt(JSON.stringify(sessions));

      if (existing) {
        await db.update(companySecrets).set({ description: encSessions, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "whatsapp_sessions", provider: "encrypted", description: encSessions });
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
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
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
          await fetch(WASENDER_API + "/whatsapp-sessions/" + toRemove.sessionId + "/disconnect", { method: "POST", headers: { Authorization: "Bearer " + WASENDER_PAT } }).catch(() => {});
          await fetch(WASENDER_API + "/whatsapp-sessions/" + toRemove.sessionId, { method: "DELETE", headers: { Authorization: "Bearer " + WASENDER_PAT } }).catch(() => {});
        }
        const filtered = phoneToRemove ? sessions.filter((s: any) => s.phoneNumber !== phoneToRemove) : [];
        if (filtered.length > 0) {
          await db.update(companySecrets).set({ description: encrypt(JSON.stringify(filtered)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
        } else {
          await db.delete(companySecrets).where(eq(companySecrets.id, secret.id));
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
    const { companyId, to, text } = req.body as { companyId: string; to: string; text: string };
    if (!companyId || !to || !text) { res.status(400).json({ error: "Parametri mancanti" }); return; }

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
        body: JSON.stringify({ to, text }),
      });
      if (!r.ok) { res.status(502).json({ error: "Errore invio" }); return; }
      try {
        await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${to}, ${"Bot"}, ${text}, ${"outgoing"})`);
      } catch {}
      res.json({ sent: true });
    } catch { res.status(500).json({ error: "Errore invio" }); }
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

// Webhook router (mounted before auth)
export function whatsappWebhookRouter(db: Db) {
  const router = Router();

  router.post("/:companyId", async (req, res) => {
    const companyId = req.params.companyId;
    const event = req.body;
    console.log("[wa-webhook]", companyId, event?.event, event?.data?.messages?.messageBody?.substring(0, 30));
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
                  body: JSON.stringify({ messageKeys: msg.key }),
                });
                if (decryptRes.ok) {
                  const decData = await decryptRes.json() as { data?: { url?: string } };
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
      
      if (text) {
        try {
          await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${remoteJid}, ${fromName}, ${text}, ${"incoming"})`);
        } catch (err) { console.error("[wa-webhook] save error:", err); }

        // Auto-reply
        try {
          const settingsRow = await db.select().from(companySecrets)
            .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_settings")))
            .then((r) => r[0]);
          const settings = settingsRow?.description ? JSON.parse(settingsRow.description) : {};
          
          // Check if any number has autoReply enabled
          let isAutoReply = false;
          if (settings.numbers) {
            for (const [, v] of Object.entries(settings.numbers)) {
              if ((v as any).autoReply) { isAutoReply = true; break; }
            }
          }
          
          if (isAutoReply) {
            const waSecret = await db.select().from(companySecrets)
              .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
              .then((r) => r[0]);
            const claudeSecret = await db.select().from(companySecrets)
              .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
              .then((r) => r[0]);
            
            if (waSecret?.description && claudeSecret?.description) {
              const sessions = JSON.parse(decrypt(waSecret.description));
              const session = Array.isArray(sessions) ? sessions[0] : sessions;
              const claudeKey = decrypt(claudeSecret.description);
              
              const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
                body: JSON.stringify({
                  model: "claude-sonnet-4-20250514",
                  max_tokens: 512,
                  system: "Sei un assistente di customer service. Rispondi in italiano, breve e cordiale. Max 2-3 frasi.",
                  messages: [{ role: "user", content: text }],
                }),
              });
              
              if (claudeRes.ok) {
                const data = await claudeRes.json() as { content?: Array<{ text?: string }> };
                const reply = (data.content || []).map((c: any) => c.text).join("") || "";
                if (reply && session?.apiKey) {
                  await fetch("https://www.wasenderapi.com/api/send-message", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.apiKey },
                    body: JSON.stringify({ to: remoteJid.replace("@s.whatsapp.net", ""), text: reply }),
                  });
                  try {
                    await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${remoteJid}, ${"Bot"}, ${reply}, ${"outgoing"})`);
                  } catch {}
                }
              }
            }
          }
        } catch (err) { console.error("[wa-webhook] auto-reply error:", err); }
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
