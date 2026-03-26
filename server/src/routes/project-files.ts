import { Router } from "express";
import multer from "multer";
import type { Db } from "@goitalia/db";
import { projectFiles, companySecrets, projects } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { decrypt, encrypt } from "../utils/crypto.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

const SUPPORTED_TEXT_TYPES = new Set(["text/plain", "text/csv", "application/json", "text/html", "text/markdown"]);

async function extractTextFromBuffer(buffer: Buffer, mimeType: string, filename: string): Promise<string | null> {
  // Plain text files
  if (SUPPORTED_TEXT_TYPES.has(mimeType) || filename.endsWith(".txt") || filename.endsWith(".csv") || filename.endsWith(".md")) {
    return buffer.toString("utf-8").substring(0, 100000);
  }
  // ZIP files: try to extract first .txt file (WhatsApp export pattern)
  if (mimeType === "application/zip" || filename.endsWith(".zip")) {
    try {
      // Simple ZIP parsing: find the first .txt file in the archive
      const zip = buffer;
      // Find local file header signatures (PK\x03\x04)
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
      return "ZIP contenente file non testuali. Estrai il file TXT e ricaricalo.";
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
        await db.update(companySecrets).set({ description: encrypt(JSON.stringify(accounts)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
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
  // https://drive.google.com/file/d/FILE_ID/view
  // https://docs.google.com/document/d/FILE_ID/edit
  // https://drive.google.com/open?id=FILE_ID
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function projectFilesRoutes(db: Db) {
  const router = Router();

  // GET /project-files?projectId=xxx
  router.get("/project-files", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const projectId = req.query.projectId as string;
    if (!projectId) { res.status(400).json({ error: "projectId richiesto" }); return; }

    const files = await db.select({
      id: projectFiles.id, name: projectFiles.name, type: projectFiles.type,
      mimeType: projectFiles.mimeType, sizeBytes: projectFiles.sizeBytes,
      driveUrl: projectFiles.driveUrl, createdAt: projectFiles.createdAt,
      hasContent: projectFiles.contentText,
    }).from(projectFiles).where(eq(projectFiles.projectId, projectId));

    res.json({ files: files.map((f) => ({ ...f, hasContent: !!f.hasContent })) });
  });

  // POST /project-files/upload — multipart file upload
  router.post("/project-files/upload", upload.single("file"), async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { projectId, companyId } = req.body as { projectId: string; companyId: string };
    if (!projectId || !companyId || !req.file) { res.status(400).json({ error: "Dati mancanti" }); return; }

    try {
      const file = req.file;
      const contentText = await extractTextFromBuffer(file.buffer, file.mimetype, file.originalname);

      const [inserted] = await db.insert(projectFiles).values({
        projectId, companyId,
        name: file.originalname,
        type: "upload",
        mimeType: file.mimetype,
        sizeBytes: file.size,
        contentText: contentText || null,
      }).returning();

      res.json({ file: { ...inserted, hasContent: !!contentText } });
    } catch (err) {
      console.error("[project-files] upload error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /project-files/drive-link — save Google Drive link + fetch content
  router.post("/project-files/drive-link", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { projectId, companyId, driveUrl } = req.body as { projectId: string; companyId: string; driveUrl: string };
    if (!projectId || !companyId || !driveUrl) { res.status(400).json({ error: "Dati mancanti" }); return; }

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

    const [inserted] = await db.insert(projectFiles).values({
      projectId, companyId, name, type: "drive_link",
      driveUrl, driveFileId: fileId || null, contentText,
    }).returning();

    res.json({ file: { ...inserted, hasContent: !!contentText } });
  });

  // DELETE /project-files/:id
  router.delete("/project-files/:id", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    await db.delete(projectFiles).where(eq(projectFiles.id, req.params.id));
    res.json({ deleted: true });
  });

  return router;
}

// Helper for CEO tool
export async function getProjectFilesContent(db: Db, projectId: string): Promise<string> {
  const files = await db.select({ name: projectFiles.name, contentText: projectFiles.contentText, type: projectFiles.type })
    .from(projectFiles).where(eq(projectFiles.projectId, projectId));
  if (!files.length) return "Nessun file allegato al progetto.";
  return files.map((f) => {
    if (!f.contentText) return `📎 ${f.name} [nessun contenuto testuale disponibile]`;
    return `📄 ${f.name}\n${f.contentText.substring(0, 5000)}`;
  }).join("\n\n---\n\n");
}
