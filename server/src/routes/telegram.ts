import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, agents } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "node:crypto";

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

const TELEGRAM_API = "https://api.telegram.org/bot";

// In-memory store for company lookup by bot token hash (for webhook routing)
const botCompanyMap = new Map<string, string>();

async function getTelegramToken(db: Db, companyId: string): Promise<string | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bot_token")))
    .then((rows) => rows[0]);
  if (!secret?.description) return null;
  try { return decrypt(secret.description); } catch { return null; }
}

export function telegramRoutes(db: Db) {
  const router = Router();

  // POST /telegram/connect - Save bot token and set webhook
  router.post("/telegram/connect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, token } = req.body as { companyId: string; token: string };
    if (!companyId || !token) { res.status(400).json({ error: "companyId e token richiesti" }); return; }

    // Verify token with Telegram
    try {
      const r = await fetch(TELEGRAM_API + token + "/getMe");
      if (!r.ok) { res.status(400).json({ error: "Token non valido. Controlla il token da BotFather." }); return; }
      const botInfo = await r.json() as { result?: { username?: string; first_name?: string } };

      // Save encrypted token
      const encrypted = encrypt(token);
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bot_token")))
        .then((rows) => rows[0]);

      if (existing) {
        await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "telegram_bot_token", provider: "encrypted", description: encrypted });
      }

      // Save bot info
      const infoEncrypted = encrypt(JSON.stringify({ username: botInfo.result?.username, name: botInfo.result?.first_name }));
      const existingInfo = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bot_info")))
        .then((rows) => rows[0]);
      if (existingInfo) {
        await db.update(companySecrets).set({ description: infoEncrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existingInfo.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "telegram_bot_info", provider: "encrypted", description: infoEncrypted });
      }

      // Set webhook
      const webhookUrl = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/api/telegram/webhook/" + companyId;
      await fetch(TELEGRAM_API + token + "/setWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl }),
      });

      // Create telegram_messages table if not exists
      await db.execute(sql`CREATE TABLE IF NOT EXISTS telegram_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        chat_id BIGINT NOT NULL,
        from_name TEXT,
        from_username TEXT,
        message_text TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
        telegram_message_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS telegram_messages_company_idx ON telegram_messages(company_id, created_at DESC)`);

      res.json({ connected: true, username: botInfo.result?.username, name: botInfo.result?.first_name });
    } catch (err) {
      console.error("Telegram connect error:", err);
      res.status(500).json({ error: "Errore connessione Telegram" });
    }
  });

  // GET /telegram/status?companyId=xxx
  router.get("/telegram/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ connected: false }); return; }

    const token = await getTelegramToken(db, companyId);
    if (!token) { res.json({ connected: false }); return; }

    // Get bot info
    const infoSecret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bot_info")))
      .then((rows) => rows[0]);
    let botInfo = { username: "", name: "" };
    if (infoSecret?.description) {
      try { botInfo = JSON.parse(decrypt(infoSecret.description)); } catch {}
    }

    res.json({ connected: true, username: botInfo.username, name: botInfo.name });
  });

  // POST /telegram/disconnect?companyId=xxx
  router.post("/telegram/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    if (!companyId) { res.json({ disconnected: true }); return; }

    // Remove webhook
    const token = await getTelegramToken(db, companyId);
    if (token) {
      await fetch(TELEGRAM_API + token + "/deleteWebhook").catch(() => {});
    }

    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bot_token")));
    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bot_info")));
    res.json({ disconnected: true });
  });

  // POST /telegram/settings - Save auto-reply setting
  router.post("/telegram/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, autoReply } = req.body as { companyId: string; autoReply: boolean };
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }
    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_settings")))
      .then((rows) => rows[0]);
    const settings = JSON.stringify({ autoReply });
    if (existing) {
      await db.update(companySecrets).set({ description: settings, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
    } else {
      await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "telegram_settings", provider: "plain", description: settings });
    }
    res.json({ ok: true });
  });

  // GET /telegram/settings?companyId=xxx
  router.get("/telegram/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ autoReply: false }); return; }
    const row = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_settings")))
      .then((rows) => rows[0]);
    if (!row?.description) { res.json({ autoReply: false }); return; }
    try { res.json(JSON.parse(row.description)); } catch { res.json({ autoReply: false }); }
  });

  // POST /telegram/webhook/:companyId - Receive messages from Telegram
  router.post("/telegram/webhook/:companyId", async (req, res) => {
    const companyId = req.params.companyId;
    const update = req.body;

    if (update?.message?.text) {
      const msg = update.message;
      try {
        await db.execute(sql`INSERT INTO telegram_messages (company_id, chat_id, from_name, from_username, message_text, direction, telegram_message_id) VALUES (${companyId}, ${msg.chat.id}, ${msg.from?.first_name || ""}, ${msg.from?.username || ""}, ${msg.text}, 'incoming', ${msg.message_id})`);
      } catch (err) {
        console.error("Telegram webhook save error:", err);
      }
    }

    // Auto-reply if enabled
    if (update?.message?.text) {
      try {
        const settingsRow = await db.select().from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_settings")))
          .then((rows) => rows[0]);
        const settings = settingsRow?.description ? JSON.parse(settingsRow.description) : {};
        
        if (settings.autoReply) {
          const token = await getTelegramToken(db, companyId);
          const apiKeySecret = await db.select().from(companySecrets)
            .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
            .then((rows) => rows[0]);
          
          if (token && apiKeySecret?.description) {
            const claudeKey = decrypt(apiKeySecret.description);
            const msg = update.message;
            
            const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({
                model: "claude-haiku-4-20250414",
                max_tokens: 512,
                system: "Sei un assistente di customer service. Rispondi in italiano, in modo breve e cordiale. Max 2-3 frasi.",
                messages: [{ role: "user", content: msg.text }],
              }),
            });
            
            if (claudeRes.ok) {
              const data = await claudeRes.json() as { content?: Array<{ text?: string }> };
              const reply = data.content?.map((c: any) => c.text).join("") || "";
              
              if (reply) {
                await fetch(TELEGRAM_API + token + "/sendMessage", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: msg.chat.id, text: reply }),
                });
                
                await db.execute(sql`INSERT INTO telegram_messages (company_id, chat_id, from_name, message_text, direction, telegram_message_id) VALUES (${companyId}, ${msg.chat.id}, 'Bot', ${reply}, 'outgoing', 0)`);
              }
            }
          }
        }
      } catch (err) {
        console.error("Telegram auto-reply error:", err);
      }
    }

    res.json({ ok: true });
  });

  // GET /telegram/messages?companyId=xxx&limit=50
  router.get("/telegram/messages", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    if (!companyId) { res.json({ messages: [] }); return; }

    try {
      const rows = await db.execute(sql`
        SELECT id, chat_id, from_name, from_username, message_text, direction, created_at 
        FROM telegram_messages 
        WHERE company_id = ${companyId} 
        ORDER BY created_at DESC 
        LIMIT ${limit}
      `);
      res.json({ messages: rows || [] });
    } catch { res.json({ messages: [] }); }
  });

  // POST /telegram/send - Send message to a chat
  router.post("/telegram/send", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, chatId, text } = req.body as { companyId: string; chatId: number; text: string };
    if (!companyId || !chatId || !text) { res.status(400).json({ error: "Parametri mancanti" }); return; }

    const token = await getTelegramToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Bot Telegram non connesso" }); return; }

    try {
      const r = await fetch(TELEGRAM_API + token + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!r.ok) { res.status(502).json({ error: "Errore invio messaggio" }); return; }
      const data = await r.json() as { result?: { message_id?: number } };

      // Save outgoing message
      await db.execute(sql`INSERT INTO telegram_messages (company_id, chat_id, from_name, message_text, direction, telegram_message_id) VALUES (${companyId}, ${chatId}, 'Bot', ${text}, 'outgoing', ${data.result?.message_id || 0})`);

      res.json({ sent: true });
    } catch (err) {
      console.error("Telegram send error:", err);
      res.status(500).json({ error: "Errore invio" });
    }
  });

  // POST /telegram/generate-reply - AI reply to a message
  router.post("/telegram/generate-reply", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, messageText, fromName } = req.body as { companyId: string; messageText: string; fromName: string };
    if (!companyId || !messageText) { res.status(400).json({ error: "Parametri mancanti" }); return; }

    // Get Claude API key
    const apiKeySecret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
      .then((rows) => rows[0]);
    if (!apiKeySecret?.description) { res.status(400).json({ error: "API key Claude non configurata" }); return; }
    let claudeKey: string;
    try { claudeKey = decrypt(apiKeySecret.description); } catch { res.status(500).json({ error: "Errore decrypt" }); return; }

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: "Sei un assistente di customer service professionale. Rispondi in italiano, in modo conciso e cordiale. Non inventare informazioni.",
          messages: [{ role: "user", content: `Messaggio da ${fromName}: "${messageText}"\n\nGenera una risposta professionale e concisa.` }],
        }),
      });
      if (!r.ok) { res.status(502).json({ error: "Errore AI" }); return; }
      const data = await r.json() as { content?: Array<{ text?: string }> };
      const reply = data.content?.map((c) => c.text).join("") || "";
      res.json({ reply });
    } catch { res.status(500).json({ error: "Errore generazione risposta" }); }
  });

  return router;
}
