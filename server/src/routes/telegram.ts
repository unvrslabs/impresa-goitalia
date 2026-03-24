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

async function getTelegramToken(db: Db, companyId: string, botIndex = 0): Promise<string | null> {
  // Try new format first
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bots")))
    .then((rows) => rows[0]);
  if (secret?.description) {
    try {
      const bots = JSON.parse(decrypt(secret.description));
      const arr = Array.isArray(bots) ? bots : [bots];
      return arr[botIndex]?.token || arr[0]?.token || null;
    } catch { return null; }
  }
  // Fallback to old format
  const old = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bot_token")))
    .then((rows) => rows[0]);
  if (!old?.description) return null;
  try { return decrypt(old.description); } catch { return null; }
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

      const botData = {
        token,
        username: botInfo.result?.username || "",
        name: botInfo.result?.first_name || "",
      };

      // Load existing bots array
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bots")))
        .then((rows) => rows[0]);

      let bots: Array<typeof botData> = [];
      if (existing?.description) {
        try {
          const dec = JSON.parse(decrypt(existing.description));
          bots = Array.isArray(dec) ? dec : [dec];
        } catch {}
      }

      // Replace if same username, otherwise append
      const idx = bots.findIndex((b) => b.username === botData.username);
      if (idx >= 0) { bots[idx] = botData; } else { bots.push(botData); }

      const encrypted = encrypt(JSON.stringify(bots));
      if (existing) {
        await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "telegram_bots", provider: "encrypted", description: encrypted });
      }

      // Set webhook with bot index
      const botIndex = bots.findIndex((b) => b.username === botData.username);
      const webhookUrl = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/tg-hook/telegram/webhook/" + companyId + "/" + botIndex;
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

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bots")))
      .then((rows) => rows[0]);
    if (!secret?.description) {
      // Fallback to old format
      const oldToken = await getTelegramToken(db, companyId);
      if (!oldToken) { res.json({ connected: false }); return; }
      res.json({ connected: true, bots: [{ username: "", name: "Bot" }] });
      return;
    }
    try {
      const bots = JSON.parse(decrypt(secret.description));
      const botList = (Array.isArray(bots) ? bots : [bots]).map((b: any) => ({ username: b.username, name: b.name }));
      res.json({ connected: botList.length > 0, bots: botList });
    } catch { res.json({ connected: false }); }
  });

  // POST /telegram/disconnect?companyId=xxx
  router.post("/telegram/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    if (!companyId) { res.json({ disconnected: true }); return; }

    const botUsername = req.query.bot as string || req.body?.bot || "";
    
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bots")))
      .then((rows) => rows[0]);
    
    if (secret?.description) {
      try {
        const bots = JSON.parse(decrypt(secret.description));
        const arr = Array.isArray(bots) ? bots : [bots];
        const bot = arr.find((b: any) => b.username === botUsername);
        if (bot?.token) {
          await fetch(TELEGRAM_API + bot.token + "/deleteWebhook").catch(() => {});
        }
        const filtered = arr.filter((b: any) => b.username !== botUsername);
        if (filtered.length > 0) {
          await db.update(companySecrets).set({ description: encrypt(JSON.stringify(filtered)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
        } else {
          await db.delete(companySecrets).where(eq(companySecrets.id, secret.id));
        }
      } catch {}
    }
    
    res.json({ disconnected: true });
  });

  // POST /telegram/settings - Save auto-reply setting
  router.post("/telegram/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, autoReply, botUsername } = req.body as { companyId: string; autoReply: boolean; botUsername?: string };
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }
    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_settings")))
      .then((rows) => rows[0]);
    // Per-bot settings: { bots: { "username1": { autoReply: true }, "username2": { autoReply: false } } }
    let currentSettings: Record<string, any> = {};
    if (existing?.description) { try { currentSettings = JSON.parse(existing.description); } catch {} }
    // Migrate old format
    if (typeof currentSettings.autoReply === "boolean" && !currentSettings.bots) {
      currentSettings = { bots: {} };
    }
    if (!currentSettings.bots) currentSettings.bots = {};
    if (botUsername) {
      currentSettings.bots[botUsername] = { autoReply };
    } else {
      // Legacy: set for all
      currentSettings.autoReply = autoReply;
    }
    const settings = JSON.stringify(currentSettings);
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
    if (!row?.description) { res.json({ autoReply: false, bots: {} }); return; }
    try { res.json(JSON.parse(row.description)); } catch { res.json({ autoReply: false, bots: {} }); }
  });

  // GET /telegram/messages?companyId=xxx&limit=50
  router.get("/telegram/messages", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const botFilter = req.query.bot as string;
    if (!companyId) { res.json({ messages: [] }); return; }

    try {
      const rows = botFilter !== undefined && botFilter !== "-1"
        ? await db.execute(sql`
        SELECT id, chat_id, from_name, from_username, message_text, direction, created_at, bot_index 
        FROM telegram_messages 
        WHERE company_id = ${companyId} AND bot_index = ${botFilter}
        ORDER BY created_at DESC 
        LIMIT 200`)
        : await db.execute(sql`
        SELECT id, chat_id, from_name, from_username, message_text, direction, created_at, bot_index 
        FROM telegram_messages 
        WHERE company_id = ${companyId} 
        ORDER BY created_at DESC 
        LIMIT 200
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

  // GET /telegram/unread-count?companyId=xxx
  router.get("/telegram/unread-count", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ count: 0 }); return; }
    try {
      const rows = await db.execute(sql`
        SELECT COUNT(*) as count FROM telegram_messages tm
        WHERE tm.company_id = ${companyId} AND tm.direction = 'incoming'
        AND tm.created_at > COALESCE(
          (SELECT last_read_at FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'telegram' AND chat_id = CAST(tm.chat_id AS text)),
          (SELECT last_read_at FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'telegram' AND chat_id IS NULL),
          '2000-01-01'
        )`);
      const count = (rows as any[])[0]?.count || 0;
      res.json({ count: parseInt(String(count)) });
    } catch { res.json({ count: 0 }); }
  });

  // POST /telegram/mark-read
  router.post("/telegram/mark-read", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, chatId } = req.body as { companyId: string; chatId?: string };
    if (!companyId) { res.json({ ok: true }); return; }
    try {
      await db.execute(sql`INSERT INTO read_markers (company_id, user_id, channel, chat_id, last_read_at) VALUES (${companyId}, ${actor.userId}, 'telegram', ${chatId || null}, now()) ON CONFLICT (company_id, user_id, channel, chat_id) DO UPDATE SET last_read_at = now()`);
    } catch (e) {
      // Fallback: upsert without chat_id constraint
      try {
        await db.execute(sql`DELETE FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'telegram'`);
        await db.execute(sql`INSERT INTO read_markers (company_id, user_id, channel, last_read_at) VALUES (${companyId}, ${actor.userId}, 'telegram', now())`);
      } catch {}
    }
    res.json({ ok: true });
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

// Separate webhook router (mounted before auth middleware)
export function telegramWebhookRouter(db: Db) {
  const router = Router();
  
  router.post("/telegram/webhook/:companyId/:botIndex", async (req, res) => {
    const companyId = req.params.companyId;
    const update = req.body;
    console.log("[tg-wh] msg:", update?.message?.text, "from:", update?.message?.from?.first_name);
    res.json({ ok: true });
    // Process async after response
    // Handle voice/audio messages
    if (update?.message && !update?.message?.text && (update?.message?.audio || update?.message?.voice)) {
      const msg = update.message;
      const remoteJid = String(msg.chat.id);
      const fromName = msg.from?.first_name || "";
      
      // Check if voice transcription is enabled
      try {
        const openaiSecret = await db.select().from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openai_api_key")))
          .then((r) => r[0]);
        
        if (!openaiSecret?.description) {
          // Voice not enabled - reply with message
          const token = await getTelegramToken(db, companyId);
          if (token) {
            await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: msg.chat.id, text: "Mi dispiace, non posso ascoltare messaggi vocali. Per favore scrivi il tuo messaggio in testo." }),
            });
          }
          return;
        }
        
        // Get file from Telegram
        const token = await getTelegramToken(db, companyId);
        if (!token) return;
        const fileId = msg.voice?.file_id || msg.audio?.file_id;
        const fileRes = await fetch("https://api.telegram.org/bot" + token + "/getFile?file_id=" + fileId);
        const fileData = await fileRes.json() as { result?: { file_path?: string } };
        if (!fileData.result?.file_path) return;
        
        const audioUrl = "https://api.telegram.org/file/bot" + token + "/" + fileData.result.file_path;
        const audioRes = await fetch(audioUrl);
        const audioBuffer = await audioRes.arrayBuffer();
        
        // Transcribe with Whisper
        const openaiKey = decrypt(openaiSecret.description);
        const formData = new FormData();
        formData.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "voice.ogg");
        formData.append("model", "whisper-1");
        formData.append("language", "it");
        
        const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: "Bearer " + openaiKey },
          body: formData,
        });
        
        if (whisperRes.ok) {
          const result = await whisperRes.json() as { text?: string };
          const transcription = result.text || "[vocale non comprensibile]";
          console.log("[tg-wh] Transcribed voice:", transcription.substring(0, 50));
          
          // Save transcribed message
          try {
            await db.execute(sql`INSERT INTO telegram_messages (company_id, chat_id, from_name, from_username, message_text, direction, telegram_message_id, bot_index) VALUES (${companyId}, ${String(msg.chat.id)}, ${fromName}, ${msg.from?.username || ""}, ${"🎤 " + transcription}, ${"incoming"}, ${String(msg.message_id)}, ${String(parseInt((req.params as any).botIndex || "0") || 0)})`);
          } catch {}
          
          // Auto-reply if enabled (same logic as text)
          // ... handled below by the existing auto-reply code
        }
      } catch (err) { console.error("[tg-wh] voice error:", err); }
      return;
    }
    if (!update?.message?.text) return;
    const msg = update.message;
    // Save incoming
    try {
      const botIdx = parseInt((req.params as any).botIndex || '0') || 0;
      await db.execute(sql`INSERT INTO telegram_messages (company_id, chat_id, from_name, from_username, message_text, direction, telegram_message_id, bot_index) VALUES (${companyId}, ${String(msg.chat.id)}, ${msg.from?.first_name || ''}, ${msg.from?.username || ''}, ${msg.text}, 'incoming', ${String(msg.message_id)}, ${String(botIdx)})`);
    } catch (e) { console.error("[tg-wh] save err:", e); }
    // Auto-reply
    try {
      const sRow = await db.select().from(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_settings"))).then((r) => r[0]);
      const s = sRow?.description ? JSON.parse(sRow.description) : {};
      // Check per-bot or global autoReply
      let isAutoReply = false;
      if (s.bots) {
        // Get bot username for this webhook
        try {
          const botsSecret = await db.select().from(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "telegram_bots"))).then((r) => r[0]);
          if (botsSecret?.description) {
            const bots = JSON.parse(decrypt(botsSecret.description));
            const botArr = Array.isArray(bots) ? bots : [bots];
            const botIdx = parseInt((req.params as any).botIndex || "0") || 0;
            const botUser = botArr[botIdx]?.username || "";
            isAutoReply = s.bots[botUser]?.autoReply === true;
          }
        } catch {}
      } else {
        isAutoReply = s.autoReply === true;
      }
      console.log("[tg-wh] autoReply:", isAutoReply);
      if (!isAutoReply) return;
      const tok = await getTelegramToken(db, companyId);
      if (!tok) { console.log("[tg-wh] no token"); return; }
      const keyRow = await db.select().from(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key"))).then((r) => r[0]);
      let reply = "Grazie per il messaggio!";
      if (keyRow?.description) {
        const ck = decrypt(keyRow.description);
        console.log("[tg-wh] calling claude...");
        const cr = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": ck, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 512, system: "Sei un assistente. Rispondi in italiano, breve e cordiale.", messages: [{ role: "user", content: msg.text }] }),
        });
        console.log("[tg-wh] claude status:", cr.status);
        if (cr.ok) {
          const cd = await cr.json() as any;
          reply = (cd.content || []).map((c: any) => c.text).join("") || reply;
        } else { console.error("[tg-wh] claude err:", await cr.text()); }
      }
      console.log("[tg-wh] sending:", reply.substring(0, 50));
      const sr = await fetch("https://api.telegram.org/bot" + tok + "/sendMessage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, text: reply }),
      });
      console.log("[tg-wh] send status:", sr.status);
      try { await db.execute(sql`INSERT INTO telegram_messages (company_id, chat_id, from_name, message_text, direction, telegram_message_id) VALUES (${companyId}, ${String(msg.chat.id)}, ${"Bot"}, ${reply}, ${"outgoing"}, ${"0"})`); } catch {}
    } catch (e) { console.error("[tg-wh] auto-reply err:", e); }
  });
  router.post("/telegram/webhook/:companyId", async (req, res) => {
    const companyId = req.params.companyId;
    const update = req.body;
    console.log("[telegram-webhook-noidx] Received:", companyId, update?.message?.text);
    if (update?.message?.text) {
      const msg = update.message;
      try {
        await db.execute(sql`INSERT INTO telegram_messages (company_id, chat_id, from_name, from_username, message_text, direction, telegram_message_id) VALUES (${companyId}, ${msg.chat.id}, ${msg.from?.first_name || ''}, ${msg.from?.username || ''}, ${msg.text}, 'incoming', ${msg.message_id})`);
      } catch {}
    }
    res.json({ ok: true });
  });
  
  return router;
}
