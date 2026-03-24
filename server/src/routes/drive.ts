import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";

async function getToken(db: Db, companyId: string, accountIndex = 0): Promise<string | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
    .then((rows) => rows[0]);
  if (!secret?.description) return null;
  const decrypted = JSON.parse(decrypt(secret.description));
  const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
  const tokenData = accounts[accountIndex] || accounts[0];
  if (!tokenData) return null;
  if (tokenData.expires_at && tokenData.expires_at < Date.now() && tokenData.refresh_token) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: tokenData.refresh_token, grant_type: "refresh_token" }),
    });
    if (res.ok) {
      const t = await res.json() as { access_token: string; expires_in: number };
      tokenData.access_token = t.access_token;
      tokenData.expires_at = Date.now() + t.expires_in * 1000;
      accounts[accountIndex || 0] = tokenData;
      await db.update(companySecrets).set({ description: encrypt(JSON.stringify(accounts)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
    }
  }
  return tokenData.access_token;
}

const MIME_ICONS: Record<string, string> = {
  "application/vnd.google-apps.document": "doc",
  "application/vnd.google-apps.spreadsheet": "sheet",
  "application/vnd.google-apps.presentation": "slide",
  "application/vnd.google-apps.folder": "folder",
  "application/pdf": "pdf",
  "image/": "image",
};

function getFileType(mimeType: string): string {
  for (const [key, val] of Object.entries(MIME_ICONS)) {
    if (mimeType.startsWith(key)) return val;
  }
  return "file";
}

export function driveRoutes(db: Db) {
  const router = Router();

  // GET /drive/files?companyId=xxx&folderId=root&q=search
  router.get("/drive/files", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const accountIdx = parseInt(req.query.account as string) || 0;
    const token = await getToken(db, companyId, accountIdx);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }
    const folderId = (req.query.folderId as string) || "root";
    const search = req.query.q as string || "";
    const pageToken = req.query.pageToken as string || "";

    let q = "";
    if (search) {
      q = `name contains '${search.replace(/'/g, "\\'")}'`;
    } else {
      q = `'${folderId}' in parents`;
    }
    q += " and trashed = false";

    try {
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink,thumbnailLink)&orderBy=folder,name&pageSize=50${pageToken ? "&pageToken=" + pageToken : ""}`;
      const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) { res.status(502).json({ error: "Errore lettura Drive" }); return; }
      const data = await r.json() as { files?: any[]; nextPageToken?: string };

      const files = (data.files || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        type: getFileType(f.mimeType),
        modifiedTime: f.modifiedTime,
        size: f.size ? parseInt(f.size) : null,
        webViewLink: f.webViewLink || "",
        isFolder: f.mimeType === "application/vnd.google-apps.folder",
      }));

      res.json({ files, nextPageToken: data.nextPageToken || null });
    } catch (err) {
      console.error("Drive error:", err);
      res.status(500).json({ error: "Errore Drive" });
    }
  });


  // GET /drive/accounts?companyId=xxx
  router.get("/drive/accounts", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ accounts: [] }); return; }
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ accounts: [] }); return; }
    try {
      const decrypted = JSON.parse(decrypt(secret.description));
      const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
      res.json({ accounts: accounts.map((a: any, i: number) => ({ index: i, email: a.email || "Account " + (i + 1) })) });
    } catch { res.json({ accounts: [] }); }
  });

  return router;
}
