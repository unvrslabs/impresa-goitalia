import { Router } from "express";
import multer from "multer";
import type { Db } from "@goitalia/db";
import { whatsappContacts, whatsappContactFiles, companySecrets } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import { decrypt } from "../utils/crypto.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

const SUPPORTED_TEXT_TYPES = new Set(["text/plain", "text/csv", "application/json", "text/html", "text/markdown"]);

function extractTextFromBuffer(buffer: Buffer, mimeType: string, filename: string): string | null {
  if (SUPPORTED_TEXT_TYPES.has(mimeType) || filename.endsWith(".txt") || filename.endsWith(".csv") || filename.endsWith(".md")) {
    return buffer.toString("utf-8").substring(0, 100000);
  }
  if (mimeType === "application/zip" || filename.endsWith(".zip")) {
    try {
      const zip = buffer;
      const texts: string[] = [];
      let offset = 0;
      while (offset < zip.length - 30) {
        if (zip[offset] === 0x50 && zip[offset + 1] === 0x4b && zip[offset + 2] === 0x03 && zip[offset + 3] === 0x04) {
          const compression = zip.readUInt16LE(offset + 8);
          const compressedSize = zip.readUInt32LE(offset + 18);
          const filenameLen = zip.readUInt16LE(offset + 26);
          const extraLen = zip.readUInt16LE(offset + 28);
          const entryFilename = zip.subarray(offset + 30, offset + 30 + filenameLen).toString("utf-8");
          const dataOffset = offset + 30 + filenameLen + extraLen;
          if (compression === 0 && (entryFilename.endsWith(".txt") || entryFilename.endsWith(".csv"))) {
            const content = zip.subarray(dataOffset, dataOffset + compressedSize).toString("utf-8");
            texts.push(`=== ${entryFilename} ===\n${content.substring(0, 50000)}`);
          }
          offset = dataOffset + compressedSize;
        } else {
          offset++;
        }
      }
      if (texts.length > 0) return texts.join("\n\n").substring(0, 100000);
      return "ZIP contenente file non testuali.";
    } catch {
      return null;
    }
  }
  return null;
}

async function getGoogleToken(db: Db, companyId: string): Promise<string | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try {
    const decrypted = JSON.parse(decrypt(secret.description));
    const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
    const tokenData = accounts[0];
    if (!tokenData) return null;
    if (tokenData.expires_at && tokenData.expires_at < Date.now() && tokenData.refresh_token) {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "", client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "", refresh_token: tokenData.refresh_token, grant_type: "refresh_token" }),
      });
      if (res.ok) {
        const t = await res.json() as { access_token: string; expires_in: number };
        tokenData.access_token = t.access_token;
        tokenData.expires_at = Date.now() + t.expires_in * 1000;
        accounts[0] = tokenData;
        await db.update(companySecrets).set({ description: (await import("../utils/crypto.js")).encrypt(JSON.stringify(accounts)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
      }
    }
    return tokenData.access_token || null;
  } catch { return null; }
}

async function fetchDriveFileContent(token: string, fileId: string): Promise<{ name: string; content: string } | null> {
  const metaR = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!metaR.ok) return null;
  const meta = await metaR.json() as { name: string; mimeType: string };
  let content = "";
  if (meta.mimeType === "application/vnd.google-apps.document") {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: { Authorization: "Bearer " + token } });
    if (r.ok) content = await r.text();
  } else if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, { headers: { Authorization: "Bearer " + token } });
    if (r.ok) content = await r.text();
  } else if (meta.mimeType.startsWith("text/")) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: "Bearer " + token } });
    if (r.ok) content = await r.text();
  }
  return { name: meta.name, content: content.substring(0, 100000) };
}

function extractDriveFileId(url: string): string | null {
  const patterns = [/\/d\/([a-zA-Z0-9_-]{10,})/, /[?&]id=([a-zA-Z0-9_-]{10,})/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/** Normalize WhatsApp JID to international phone format */
export function normalizePhoneNumber(jid: string): string {
  return "+" + jid.replace(/@s\.whatsapp\.net$/, "").replace(/@c\.us$/, "").replace(/@g\.us$/, "").replace(/^\+/, "");
}

export function whatsappContactsRoutes(db: Db) {
  const router = Router();

  // GET /whatsapp-contacts?agentId=xxx
  router.get("/whatsapp-contacts", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const agentId = req.query.agentId as string;
    if (!agentId) { res.status(400).json({ error: "agentId richiesto" }); return; }

    const contacts = await db.select().from(whatsappContacts)
      .where(eq(whatsappContacts.agentId, agentId));

    // For each contact, get file count
    const result = await Promise.all(contacts.map(async (c) => {
      const files = await db.select({ id: whatsappContactFiles.id, name: whatsappContactFiles.name, type: whatsappContactFiles.type, driveUrl: whatsappContactFiles.driveUrl, createdAt: whatsappContactFiles.createdAt })
        .from(whatsappContactFiles).where(eq(whatsappContactFiles.contactId, c.id));
      return { ...c, files };
    }));

    res.json({ contacts: result });
  });

  // POST /whatsapp-contacts — create contact
  router.post("/whatsapp-contacts", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, agentId, phoneNumber, name, notes, customInstructions, autoMode } = req.body;
    if (!companyId || !agentId || !phoneNumber) { res.status(400).json({ error: "companyId, agentId, phoneNumber richiesti" }); return; }

    try {
      const normalized = normalizePhoneNumber(phoneNumber);
      const [contact] = await db.insert(whatsappContacts).values({
        companyId, agentId, phoneNumber: normalized,
        name: name || null, notes: notes || null,
        customInstructions: customInstructions || null,
        autoMode: autoMode || "inherit",
      }).returning();
      res.json({ contact });
    } catch (err: any) {
      if (err?.code === "23505") { res.status(409).json({ error: "Contatto già esistente per questo numero" }); return; }
      console.error("[whatsapp-contacts] create error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PUT /whatsapp-contacts/:id — update contact
  router.put("/whatsapp-contacts/:id", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { name, notes, customInstructions, autoMode } = req.body;

    const [updated] = await db.update(whatsappContacts).set({
      name: name ?? undefined,
      notes: notes ?? undefined,
      customInstructions: customInstructions ?? undefined,
      autoMode: autoMode ?? undefined,
      updatedAt: new Date(),
    }).where(eq(whatsappContacts.id, req.params.id as string)).returning();

    if (!updated) { res.status(404).json({ error: "Contatto non trovato" }); return; }
    res.json({ contact: updated });
  });

  // DELETE /whatsapp-contacts/:id — delete contact + cascade files
  router.delete("/whatsapp-contacts/:id", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    await db.delete(whatsappContacts).where(eq(whatsappContacts.id, req.params.id as string));
    res.json({ deleted: true });
  });

  // POST /whatsapp-contacts/:id/files/upload — file upload
  router.post("/whatsapp-contacts/:id/files/upload", upload.single("file"), async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId } = req.body;
    if (!companyId || !req.file) { res.status(400).json({ error: "Dati mancanti" }); return; }

    try {
      const file = req.file;
      const contentText = extractTextFromBuffer(file.buffer, file.mimetype, file.originalname);

      const [inserted] = await db.insert(whatsappContactFiles).values({
        contactId: req.params.id as string, companyId,
        name: file.originalname, type: "upload",
        mimeType: file.mimetype, sizeBytes: file.size,
        contentText: contentText || null,
      }).returning();

      // Detect WhatsApp chat export and auto-generate agent instructions
      const isWaChatExport = contentText && isWhatsAppChatExport(contentText);
      if (isWaChatExport) {
        generateAgentPromptFromChat(db, req.params.id as string, companyId, contentText).catch(err =>
          console.error("[wa-contacts] auto-prompt generation error:", err)
        );
      }

      res.json({ file: { ...inserted, hasContent: !!contentText }, isWaChatExport });
    } catch (err) {
      console.error("[whatsapp-contacts] file upload error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /whatsapp-contacts/:id/files/drive-link — Google Drive link
  router.post("/whatsapp-contacts/:id/files/drive-link", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, driveUrl } = req.body;
    if (!companyId || !driveUrl) { res.status(400).json({ error: "Dati mancanti" }); return; }

    const fileId = extractDriveFileId(driveUrl);
    let name = "File Google Drive";
    let contentText: string | null = null;

    if (fileId) {
      const token = await getGoogleToken(db, companyId);
      if (token) {
        const result = await fetchDriveFileContent(token, fileId);
        if (result) { name = result.name; contentText = result.content; }
      }
    }

    const [inserted] = await db.insert(whatsappContactFiles).values({
      contactId: req.params.id as string, companyId, name, type: "drive_link",
      driveUrl, driveFileId: fileId || null, contentText,
    }).returning();

    res.json({ file: { ...inserted, hasContent: !!contentText } });
  });

  // GET /whatsapp-contacts/:id/messages — storico messaggi per contatto
  router.get("/whatsapp-contacts/:id/messages", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const limit = parseInt(req.query.limit as string) || 50;

    // Get contact to find phone number
    const contact = await db.select().from(whatsappContacts)
      .where(eq(whatsappContacts.id, req.params.id as string)).then(r => r[0]);
    if (!contact) { res.status(404).json({ error: "Contatto non trovato" }); return; }

    // First find remote_jid from an incoming message with this phone number
    const cleanPhone = contact.phoneNumber.replace(/^\+/, "");
    const jidRow = await db.execute(sql`
      SELECT remote_jid FROM whatsapp_messages
      WHERE company_id = ${contact.companyId}
        AND direction = 'incoming'
        AND (from_name LIKE ${"%" + cleanPhone + "%"} OR remote_jid LIKE ${"%" + cleanPhone + "%"})
      ORDER BY created_at DESC LIMIT 1
    `) as any[];

    if (!jidRow || jidRow.length === 0) {
      res.json({ messages: [] }); return;
    }

    // Get ALL messages (incoming + outgoing) for that remote_jid
    const remoteJid = jidRow[0].remote_jid;
    const rows = await db.execute(sql`
      SELECT message_text, direction, from_name, message_type, media_url, created_at
      FROM whatsapp_messages
      WHERE company_id = ${contact.companyId}
        AND remote_jid = ${remoteJid}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as any[];

    res.json({ messages: (rows || []).reverse() });
  });

  // DELETE /whatsapp-contacts/:id/files/:fileId — delete file
  router.delete("/whatsapp-contacts/:id/files/:fileId", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    await db.delete(whatsappContactFiles).where(eq(whatsappContactFiles.id, req.params.fileId as string));
    res.json({ deleted: true });
  });

  return router;
}

/** Detect if text content is a WhatsApp chat export */
function isWhatsAppChatExport(text: string): boolean {
  // WA chat exports have lines like: "01/01/2024, 12:00 - Name: message" or "[01/01/2024, 12:00:00] Name: message"
  const waPatterns = [
    /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/m,  // DD/MM/YYYY, HH:MM
    /^\[\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/m, // [DD/MM/YYYY, HH:MM]
    /^\d{1,2}-\d{1,2}-\d{2,4}\s+\d{1,2}:\d{2}/m,       // DD-MM-YYYY HH:MM
  ];
  const lines = text.split("\n").slice(0, 20);
  let matchCount = 0;
  for (const line of lines) {
    if (waPatterns.some(p => p.test(line.trim()))) matchCount++;
  }
  return matchCount >= 3; // At least 3 lines match WA format
}

/** Auto-generate agent prompt/instructions from a WhatsApp chat export */
async function generateAgentPromptFromChat(db: Db, contactId: string, companyId: string, chatText: string) {
  // Get Claude API key for this company
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
    .then(r => r[0]);
  if (!secret?.description) return;

  const claudeKey = decrypt(secret.description);

  // Get contact info for context
  const contact = await db.select().from(whatsappContacts)
    .where(eq(whatsappContacts.id, contactId)).then(r => r[0]);

  // Truncate chat to fit in context
  const truncatedChat = chatText.substring(0, 80000);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: `Sei un esperto di AI agent design. Analizza questa chat WhatsApp esportata e genera un file di istruzioni per un agente AI che deve impersonare il titolare dell'azienda nelle conversazioni con questo contatto.

Il file deve essere in formato Markdown e contenere:
1. **Profilo del contatto**: chi è, che relazione ha col titolare, lingua preferita
2. **Stile di comunicazione**: come parla il titolare con questa persona (formale/informale, emoji, abbreviazioni, lingua)
3. **Argomenti ricorrenti**: di cosa parlano di solito
4. **Regole specifiche**: cose da fare/non fare basate sulla conversazione
5. **Tono e personalità**: come l'agente deve comportarsi con questo contatto
6. **Frasi tipiche**: espressioni caratteristiche del titolare da replicare

Scrivi le istruzioni in modo che un AI agent possa replicare fedelmente lo stile del titolare con questo contatto specifico. Sii conciso ma completo.`,
      messages: [{
        role: "user",
        content: `Contatto: ${contact?.name || "Sconosciuto"} (${contact?.phoneNumber || ""})\n\nChat esportata:\n\n${truncatedChat}`,
      }],
    }),
  });

  if (!res.ok) {
    console.error("[wa-contacts] Claude prompt generation failed:", res.status);
    return;
  }

  const data = await res.json() as { content?: Array<{ text?: string }> };
  const promptText = data.content?.find(b => b.text)?.text;
  if (!promptText) return;

  // Save as a new contact file
  const contactName = contact?.name || "contatto";
  await db.insert(whatsappContactFiles).values({
    contactId,
    companyId,
    name: `istruzioni_agente_${contactName.toLowerCase().replace(/\s+/g, "_")}.md`,
    type: "upload",
    mimeType: "text/markdown",
    sizeBytes: Buffer.byteLength(promptText, "utf-8"),
    contentText: promptText,
  });

  // Also update customInstructions on the contact if empty
  if (!contact?.customInstructions) {
    // Extract a short summary from the prompt for the inline field
    const shortRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Riassumi in 1-2 frasi brevi le regole chiave per l'agente basandoti su queste istruzioni:\n\n${promptText.substring(0, 2000)}`,
        }],
      }),
    });
    if (shortRes.ok) {
      const shortData = await shortRes.json() as { content?: Array<{ text?: string }> };
      const shortText = shortData.content?.find(b => b.text)?.text;
      if (shortText) {
        await db.update(whatsappContacts).set({
          customInstructions: shortText,
          updatedAt: new Date(),
        }).where(eq(whatsappContacts.id, contactId));
      }
    }
  }

  console.log(`[wa-contacts] Auto-generated agent prompt for contact ${contactId}`);
}

/** Helper: get contact context for agent prompt enrichment */
export async function getContactContext(db: Db, agentId: string, phoneNumber: string): Promise<{ context: string; autoMode: string } | null> {
  const normalized = normalizePhoneNumber(phoneNumber);
  const contact = await db.select().from(whatsappContacts)
    .where(and(eq(whatsappContacts.agentId, agentId), eq(whatsappContacts.phoneNumber, normalized)))
    .then(r => r[0]);

  if (!contact) return null;

  const files = await db.select({ name: whatsappContactFiles.name, contentText: whatsappContactFiles.contentText })
    .from(whatsappContactFiles).where(eq(whatsappContactFiles.contactId, contact.id));

  const parts: string[] = [];
  if (contact.name) parts.push(`Nome: ${contact.name}`);
  if (contact.notes) parts.push(`Note: ${contact.notes}`);
  if (contact.customInstructions) parts.push(`Istruzioni specifiche: ${contact.customInstructions}`);
  if (files.length > 0) {
    const fileTexts = files.map(f => {
      if (!f.contentText) return `- ${f.name} [nessun contenuto testuale]`;
      return `- ${f.name}:\n${f.contentText.substring(0, 5000)}`;
    }).join("\n");
    parts.push(`File allegati:\n${fileTexts}`);
  }

  return {
    context: parts.length > 0 ? `\n\n--- INFO CONTATTO MITTENTE ---\n${parts.join("\n")}` : "",
    autoMode: contact.autoMode,
  };
}
