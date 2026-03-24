import { Router } from "express";
import multer from "multer";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import fs from "node:fs";
import path from "node:path";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Helper: get Google Drive token
async function getDriveToken(db: Db, companyId: string): Promise<{ access_token: string } | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_tokens")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try {
    const data = JSON.parse(decrypt(secret.description));
    const accounts = Array.isArray(data) ? data : [data];
    return accounts[0] || null;
  } catch { return null; }
}

export function projectsPmiRoutes(db: Db) {
  const router = Router();

  // Ensure projects table exists
  db.execute(sql`CREATE TABLE IF NOT EXISTS pmi_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    storage_type TEXT NOT NULL DEFAULT 'local',
    drive_folder_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).catch(() => {});

  db.execute(sql`CREATE TABLE IF NOT EXISTS pmi_project_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    company_id UUID NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT DEFAULT 0,
    storage_type TEXT NOT NULL DEFAULT 'local',
    storage_ref TEXT,
    drive_file_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).catch(() => {});

  // GET /pmi-projects?companyId=xxx - List projects
  router.get("/pmi-projects", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ projects: [] }); return; }
    try {
      const rows = await db.execute(sql`SELECT * FROM pmi_projects WHERE company_id = ${companyId} ORDER BY created_at DESC`);
      res.json({ projects: rows || [] });
    } catch { res.json({ projects: [] }); }
  });

  // POST /pmi-projects - Create project
  router.post("/pmi-projects", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, name, description } = req.body as { companyId: string; name: string; description?: string };
    if (!companyId || !name) { res.status(400).json({ error: "Nome progetto richiesto" }); return; }

    const driveToken = await getDriveToken(db, companyId);
    const storageType = driveToken ? "drive" : "local";
    let driveFolderId: string | null = null;

    // If Drive connected, create folder
    if (driveToken) {
      try {
        const r = await fetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: "Bearer " + driveToken.access_token, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "GoItalIA - " + name, mimeType: "application/vnd.google-apps.folder" }),
        });
        if (r.ok) {
          const folder = await r.json() as { id: string };
          driveFolderId = folder.id;
        }
      } catch (err) { console.error("[projects] Drive folder creation error:", err); }
    } else {
      // Create local folder
      const projectId = crypto.randomUUID();
      const dir = path.join(process.cwd(), "data/project-files", projectId);
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      const id = crypto.randomUUID();
      await db.execute(sql`INSERT INTO pmi_projects (id, company_id, name, description, storage_type, drive_folder_id) VALUES (${id}, ${companyId}, ${name}, ${description || null}, ${storageType}, ${driveFolderId})`);
      
      // If local and no drive, save the folder path
      if (storageType === "local") {
        const dir = path.join(process.cwd(), "data/project-files", id as string);
        fs.mkdirSync(dir, { recursive: true });
      }

      res.json({ project: { id, name, description, storageType, driveFolderId } });
    } catch (err) {
      console.error("[projects] create error:", err);
      res.status(500).json({ error: "Errore creazione progetto" });
    }
  });

  // DELETE /pmi-projects/:id
  router.delete("/pmi-projects/:id", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { id } = req.params;
    const companyId = req.query.companyId as string;
    try {
      await db.execute(sql`DELETE FROM pmi_project_files WHERE project_id = ${id}`);
      await db.execute(sql`DELETE FROM pmi_projects WHERE id = ${id} AND company_id = ${companyId}`);
      res.json({ deleted: true });
    } catch { res.status(500).json({ error: "Errore eliminazione" }); }
  });

  // GET /pmi-projects/:id/files - List files in project
  router.get("/pmi-projects/:id/files", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { id } = req.params;
    const companyId = req.query.companyId as string;

    try {
      // Get project
      const projects = await db.execute(sql`SELECT * FROM pmi_projects WHERE id = ${id} AND company_id = ${companyId}`);
      const project = (projects as any[])[0];
      if (!project) { res.status(404).json({ error: "Progetto non trovato" }); return; }

      if (project.storage_type === "drive" && project.drive_folder_id) {
        // Fetch from Google Drive
        const driveToken = await getDriveToken(db, companyId);
        if (driveToken) {
          const r = await fetch(`https://www.googleapis.com/drive/v3/files?q='${project.drive_folder_id}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,createdTime,webViewLink,iconLink)&orderBy=createdTime+desc`, {
            headers: { Authorization: "Bearer " + driveToken.access_token },
          });
          if (r.ok) {
            const data = await r.json() as { files?: any[] };
            res.json({ files: (data.files || []).map((f: any) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: parseInt(f.size || "0"), createdAt: f.createdTime, webViewLink: f.webViewLink, source: "drive" })) });
            return;
          }
        }
      }

      // Local files
      const rows = await db.execute(sql`SELECT * FROM pmi_project_files WHERE project_id = ${id} ORDER BY created_at DESC`);
      res.json({ files: (rows as any[]).map((f: any) => ({ id: f.id, name: f.name, mimeType: f.mime_type, size: f.size_bytes, createdAt: f.created_at, storageRef: f.storage_ref, source: "local" })) });
    } catch (err) {
      console.error("[projects] list files error:", err);
      res.json({ files: [] });
    }
  });

  // POST /pmi-projects/:id/upload - Upload file to project
  router.post("/pmi-projects/:id/upload", upload.single("file"), async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { id } = req.params;
    const companyId = req.body.companyId as string;
    const file = (req as any).file;
    if (!file) { res.status(400).json({ error: "File richiesto" }); return; }

    try {
      const projects = await db.execute(sql`SELECT * FROM pmi_projects WHERE id = ${id} AND company_id = ${companyId}`);
      const project = (projects as any[])[0];
      if (!project) { res.status(404).json({ error: "Progetto non trovato" }); return; }

      if (project.storage_type === "drive" && project.drive_folder_id) {
        // Upload to Google Drive
        const driveToken = await getDriveToken(db, companyId);
        if (driveToken) {
          const metadata = JSON.stringify({ name: file.originalname, parents: [project.drive_folder_id] });
          const boundary = "goitalia_upload_boundary";
          const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.mimetype}\r\n\r\n`;
          const ending = `\r\n--${boundary}--`;
          
          const bodyBuffer = Buffer.concat([Buffer.from(body), file.buffer, Buffer.from(ending)]);
          
          const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink", {
            method: "POST",
            headers: { Authorization: "Bearer " + driveToken.access_token, "Content-Type": `multipart/related; boundary=${boundary}` },
            body: bodyBuffer,
          });
          if (r.ok) {
            const driveFile = await r.json() as { id: string; name: string; size?: string; webViewLink?: string };
            // Save reference in DB
            const fileId = crypto.randomUUID();
            await db.execute(sql`INSERT INTO pmi_project_files (id, project_id, company_id, name, mime_type, size_bytes, storage_type, drive_file_id) VALUES (${fileId}, ${id}, ${companyId}, ${file.originalname}, ${file.mimetype}, ${String(file.size)}, 'drive', ${driveFile.id})`);
            res.json({ file: { id: fileId, name: file.originalname, size: file.size, source: "drive", driveFileId: driveFile.id } });
            return;
          }
        }
      }

      // Local storage
      const fileId = crypto.randomUUID();
      const dir = path.join(process.cwd(), "data/project-files", id as string);
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(file.originalname);
      const filename = fileId + ext;
      fs.writeFileSync(path.join(dir, filename), file.buffer);
      
      await db.execute(sql`INSERT INTO pmi_project_files (id, project_id, company_id, name, mime_type, size_bytes, storage_type, storage_ref) VALUES (${fileId}, ${id}, ${companyId}, ${file.originalname}, ${file.mimetype}, ${String(file.size)}, 'local', ${filename})`);
      res.json({ file: { id: fileId, name: file.originalname, size: file.size, source: "local" } });
    } catch (err) {
      console.error("[projects] upload error:", err);
      res.status(500).json({ error: "Errore upload" });
    }
  });

  // GET /pmi-projects/:projectId/files/:fileId/download - Download local file
  router.get("/pmi-projects/:projectId/files/:fileId/download", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { projectId, fileId } = req.params;
    try {
      const rows = await db.execute(sql`SELECT * FROM pmi_project_files WHERE id = ${fileId} AND project_id = ${projectId}`);
      const file = (rows as any[])[0];
      if (!file) { res.status(404).json({ error: "File non trovato" }); return; }
      if (file.storage_type === "local" && file.storage_ref) {
        const filePath = path.join(process.cwd(), "data/project-files", projectId, file.storage_ref);
        if (fs.existsSync(filePath)) {
          res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
          res.setHeader("Content-Disposition", `inline; filename="${file.name}"`);
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }
      res.status(404).json({ error: "File non trovato" });
    } catch { res.status(500).json({ error: "Errore download" }); }
  });

  return router;
}
