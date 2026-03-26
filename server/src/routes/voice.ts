import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";

export function voiceRoutes(db: Db) {
  const router = Router();

  // POST /voice/save-key — Save OpenAI API key
  router.post("/voice/save-key", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, apiKey } = req.body as { companyId: string; apiKey: string };
    if (!companyId || !apiKey) { res.status(400).json({ error: "companyId e apiKey richiesti" }); return; }

    // Verify key with a simple models call
    try {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: "Bearer " + apiKey },
      });
      if (!r.ok) { res.status(400).json({ error: "API key OpenAI non valida" }); return; }
    } catch { res.status(400).json({ error: "Errore verifica API key" }); return; }

    const encrypted = encrypt(apiKey);
    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openai_api_key")))
      .then((rows) => rows[0]);

    if (existing) {
      await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
    } else {
      await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "openai_api_key", provider: "encrypted", description: encrypted });
    }

    await upsertConnectorAccount(db, companyId, "voice", "default", "Vocali AI");
    res.json({ saved: true });
  });

  // GET /voice/status?companyId=xxx
  router.get("/voice/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ enabled: false }); return; }
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openai_api_key")))
      .then((rows) => rows[0]);
    res.json({ enabled: !!secret?.description });
  });

  // DELETE /voice/key?companyId=xxx
  router.delete("/voice/key", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ deleted: true }); return; }
    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openai_api_key")));
    await removeConnectorAccount(db, companyId, "voice", "default");
    res.json({ deleted: true });
  });

  // POST /voice/transcribe — Transcribe audio URL
  router.post("/voice/transcribe", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, audioUrl } = req.body as { companyId: string; audioUrl: string };
    if (!companyId || !audioUrl) { res.status(400).json({ error: "companyId e audioUrl richiesti" }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openai_api_key")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.status(400).json({ error: "API key OpenAI non configurata" }); return; }

    try {
      const openaiKey = decrypt(secret.description);

      // Download audio
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) { res.status(502).json({ error: "Errore download audio" }); return; }
      const audioBuffer = await audioRes.arrayBuffer();

      // Send to Whisper
      const formData = new FormData();
      formData.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "audio.ogg");
      formData.append("model", "whisper-1");
      formData.append("language", "it");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: "Bearer " + openaiKey },
        body: formData,
      });

      if (!whisperRes.ok) {
        const err = await whisperRes.text();
        console.error("Whisper error:", err);
        res.status(502).json({ error: "Errore trascrizione" });
        return;
      }

      const data = await whisperRes.json() as { text?: string };
      res.json({ text: data.text || "" });
    } catch (err) {
      console.error("Transcribe error:", err);
      res.status(500).json({ error: "Errore trascrizione" });
    }
  });

  return router;
}
