import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, agents } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";

function getKeyHash(): Buffer {
  const key = process.env.GOITALIA_SECRET_KEY || process.env.BETTER_AUTH_SECRET || "goitalia-default-key-change-me";
  return crypto.createHash("sha256").update(key).digest();
}
function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(":");
  if (!ivHex || !encryptedHex) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", getKeyHash(), iv);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getKeyHash(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

async function getGmailToken(db: Db, companyId: string): Promise<{ access_token: string; email: string } | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
    .then((rows) => rows[0]);
  if (!secret?.description) return null;

  const tokenData = JSON.parse(decrypt(secret.description));
  
  // Refresh if expired
  if (tokenData.expires_at && tokenData.expires_at < Date.now() && tokenData.refresh_token) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const newTokens = await res.json() as { access_token: string; expires_in: number };
      tokenData.access_token = newTokens.access_token;
      tokenData.expires_at = Date.now() + newTokens.expires_in * 1000;
      // Save updated tokens
      const encrypted = encrypt(JSON.stringify(tokenData));
      await db.update(companySecrets)
        .set({ description: encrypted, updatedAt: new Date() })
        .where(eq(companySecrets.id, secret.id));
    }
  }

  return { access_token: tokenData.access_token, email: tokenData.email || "" };
}

interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  isUnread: boolean;
}

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function extractHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractBody(payload: any): string {
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    // Prefer text/plain, fallback to text/html
    const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      const html = decodeBase64Url(htmlPart.body.data);
      return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
    // Nested parts
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }
  return "";
}

export function gmailRoutes(db: Db) {
  const router = Router();

  // GET /gmail/messages?companyId=xxx&maxResults=20 - List emails
  router.get("/gmail/messages", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    const companyId = req.query.companyId as string;
    const maxResults = parseInt(req.query.maxResults as string) || 20;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const token = await getGmailToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso. Vai su Plugin per collegare il tuo account." }); return; }

    try {
      // Get message list
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`,
        { headers: { Authorization: "Bearer " + token.access_token } }
      );
      if (!listRes.ok) {
        const err = await listRes.text();
        console.error("Gmail list error:", listRes.status, err);
        res.status(502).json({ error: "Errore lettura email" });
        return;
      }
      const listData = await listRes.json() as { messages?: Array<{ id: string; threadId: string }> };
      if (!listData.messages?.length) { res.json({ messages: [], email: token.email }); return; }

      // Get message details (batch, max 10 for speed)
      const messageIds = listData.messages.slice(0, 10);
      const messages: GmailMessage[] = [];

      for (const msg of messageIds) {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: "Bearer " + token.access_token } }
        );
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json() as any;
        const headers = msgData.payload?.headers || [];

        messages.push({
          id: msgData.id,
          threadId: msgData.threadId,
          from: extractHeader(headers, "From"),
          to: extractHeader(headers, "To"),
          subject: extractHeader(headers, "Subject"),
          snippet: msgData.snippet || "",
          body: extractBody(msgData.payload).slice(0, 2000),
          date: extractHeader(headers, "Date"),
          isUnread: (msgData.labelIds || []).includes("UNREAD"),
        });
      }

      res.json({ messages, email: token.email });
    } catch (err) {
      console.error("Gmail error:", err);
      res.status(500).json({ error: "Errore nel recupero email" });
    }
  });

  // GET /gmail/message/:id?companyId=xxx - Get single email
  router.get("/gmail/message/:id", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    const companyId = req.query.companyId as string;
    const messageId = req.params.id;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const token = await getGmailToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }

    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        { headers: { Authorization: "Bearer " + token.access_token } }
      );
      if (!msgRes.ok) { res.status(502).json({ error: "Errore lettura email" }); return; }
      const msgData = await msgRes.json() as any;
      const headers = msgData.payload?.headers || [];

      res.json({
        id: msgData.id,
        threadId: msgData.threadId,
        from: extractHeader(headers, "From"),
        to: extractHeader(headers, "To"),
        subject: extractHeader(headers, "Subject"),
        snippet: msgData.snippet || "",
        body: extractBody(msgData.payload),
        date: extractHeader(headers, "Date"),
        isUnread: (msgData.labelIds || []).includes("UNREAD"),
      });
    } catch (err) {
      console.error("Gmail message error:", err);
      res.status(500).json({ error: "Errore lettura email" });
    }
  });

  // POST /gmail/generate-reply - Generate AI reply
  router.post("/gmail/generate-reply", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    const { companyId, messageId, agentId } = req.body as { companyId: string; messageId: string; agentId?: string };
    if (!companyId || !messageId) { res.status(400).json({ error: "companyId e messageId richiesti" }); return; }

    // Get email content
    const token = await getGmailToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }

    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: "Bearer " + token.access_token } }
    );
    if (!msgRes.ok) { res.status(502).json({ error: "Errore lettura email" }); return; }
    const msgData = await msgRes.json() as any;
    const headers = msgData.payload?.headers || [];
    const from = extractHeader(headers, "From");
    const subject = extractHeader(headers, "Subject");
    const body = extractBody(msgData.payload).slice(0, 3000);

    // Get Claude API key
    const apiKeySecret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
      .then((rows) => rows[0]);
    if (!apiKeySecret?.description) { res.status(400).json({ error: "API key Claude non configurata" }); return; }

    let claudeApiKey: string;
    try { claudeApiKey = decrypt(apiKeySecret.description); } catch { res.status(500).json({ error: "Errore decrypt API key" }); return; }

    // Get agent instructions if provided
    let agentPrompt = "";
    if (agentId) {
      const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((rows) => rows[0]);
      if (agent) {
        const config = (agent.adapterConfig as Record<string, unknown>) || {};
        agentPrompt = (config.promptTemplate as string) || "";
      }
    }

    const systemPrompt = agentPrompt || `Sei un assistente email professionale. Scrivi risposte in italiano, professionali e concise. Non inventare informazioni che non hai.`;

    const userMessage = `Genera una risposta professionale a questa email.

DA: ${from}
OGGETTO: ${subject}

CONTENUTO:
${body}

Scrivi SOLO il testo della risposta, senza oggetto, senza "Gentile..." se non necessario. La risposta deve essere naturale e professionale.`;

    try {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        console.error("Claude error:", claudeRes.status, errText);
        res.status(502).json({ error: "Errore generazione risposta AI" });
        return;
      }

      const data = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
      const replyText = data.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") || "";

      res.json({ reply: replyText, originalSubject: subject, originalFrom: from });
    } catch (err) {
      console.error("Generate reply error:", err);
      res.status(500).json({ error: "Errore generazione risposta" });
    }
  });

  // POST /gmail/send - Send email (after approval)
  router.post("/gmail/send", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    const { companyId, to, subject, body, threadId, inReplyTo } = req.body as {
      companyId: string; to: string; subject: string; body: string; threadId?: string; inReplyTo?: string;
    };
    if (!companyId || !to || !subject || !body) {
      res.status(400).json({ error: "companyId, to, subject e body richiesti" });
      return;
    }

    const token = await getGmailToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }

    // Build RFC 2822 email
    const headers = [
      `To: ${to}`,
      `Subject: ${subject.startsWith("Re:") ? subject : "Re: " + subject}`,
      `Content-Type: text/plain; charset=utf-8`,
    ];
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (threadId) headers.push(`References: ${inReplyTo || ""}`);

    const raw = Buffer.from(headers.join("\r\n") + "\r\n\r\n" + body).toString("base64url");

    try {
      const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw, threadId }),
      });

      if (!sendRes.ok) {
        const err = await sendRes.text();
        console.error("Gmail send error:", sendRes.status, err);
        res.status(502).json({ error: "Errore invio email" });
        return;
      }

      const sent = await sendRes.json() as { id: string };
      res.json({ sent: true, messageId: sent.id });
    } catch (err) {
      console.error("Send email error:", err);
      res.status(500).json({ error: "Errore invio email" });
    }
  });

  return router;
}
