import { Router } from "express";
import multer from "multer";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import { encrypt, decrypt } from "../utils/crypto.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const FAL_QUEUE_URL = "https://queue.fal.run";

// All supported models
const MODELS: Record<string, { id: string; name: string; type: string; description: string }> = {
  "nano-banana-2": { id: "fal-ai/nano-banana-2", name: "Nano Banana 2", type: "text-to-image", description: "Genera immagini da testo (Gemini Flash)" },
  "nano-banana-2-edit": { id: "fal-ai/nano-banana-2/edit", name: "Nano Banana 2 Edit", type: "image-edit", description: "Modifica immagini con AI" },
  "veo31-text": { id: "fal-ai/veo3.1/fast", name: "Veo 3.1 Fast", type: "text-to-video", description: "Video da testo con audio (Google Veo)" },
  "veo31-img2vid": { id: "fal-ai/veo3.1/fast/image-to-video", name: "Veo 3.1 Image→Video", type: "image-to-video", description: "Anima immagine in video" },
  "veo31-extend": { id: "fal-ai/veo3.1/fast/extend-video", name: "Veo 3.1 Extend", type: "extend-video", description: "Estendi video di 7 secondi" },
  "veo31-frames": { id: "fal-ai/veo3.1/fast/first-last-frame-to-video", name: "Veo 3.1 Frame→Video", type: "frame-to-video", description: "Video da primo e ultimo frame" },
  "veo31-ref": { id: "fal-ai/veo3.1/reference-to-video", name: "Veo 3.1 Reference", type: "reference-to-video", description: "Video con soggetto di riferimento" },
  "kling-text": { id: "fal-ai/kling-video/v3/pro/text-to-video", name: "Kling v3 Pro", type: "text-to-video", description: "Video da testo (Kling 3.0 Pro, fino a 15s)" },
  "kling-img2vid": { id: "fal-ai/kling-video/v3/pro/image-to-video", name: "Kling v3 Image→Video", type: "image-to-video", description: "Video da immagine (Kling 3.0 Pro)" },
  "seedance-text": { id: "fal-ai/bytedance/seedance/v1.5/pro/text-to-video", name: "Seedance 1.5 Pro", type: "text-to-video", description: "Video da testo (ByteDance, fino a 12s)" },
  "seedance-img2vid": { id: "fal-ai/bytedance/seedance/v1.5/pro/image-to-video", name: "Seedance 1.5 Image→Video", type: "image-to-video", description: "Video da immagine (ByteDance)" },
};

async function getFalKey(db: Db, companyId: string): Promise<string | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "fal_api_key")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try { return decrypt(secret.description); } catch { return null; }
}

export function falAiRoutes(db: Db) {
  const router = Router();

  // GET /fal/models - List available models
  router.get("/fal/models", (_req, res) => {
    res.json({ models: Object.entries(MODELS).map(([key, m]) => ({ key, ...m })) });
  });

  // GET /fal/status?companyId=xxx - Check if fal.ai is configured
  router.get("/fal/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const key = await getFalKey(db, companyId);
    res.json({ connected: !!key });
  });

  // POST /fal/save-key - Save fal.ai API key
  router.post("/fal/save-key", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, apiKey } = req.body as { companyId: string; apiKey: string };
    if (!companyId || !apiKey) { res.status(400).json({ error: "Parametri mancanti" }); return; }

    // Test key
    try {
      const r = await fetch("https://queue.fal.run/fal-ai/nano-banana-2", {
        method: "POST",
        headers: { Authorization: "Key " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "test", num_images: 1 }),
      });
      if (r.status === 401 || r.status === 403) { res.status(400).json({ error: "API key non valida" }); return; }
      // Cancel the test request if it was queued
      const data = await r.json() as { request_id?: string };
      if (data.request_id) {
        fetch("https://queue.fal.run/fal-ai/nano-banana-2/requests/" + data.request_id + "/cancel", {
          method: "PUT", headers: { Authorization: "Key " + apiKey },
        }).catch(() => {});
      }
    } catch { res.status(400).json({ error: "Errore verifica key" }); return; }

    const encrypted = encrypt(apiKey);
    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "fal_api_key")))
      .then((r) => r[0]);
    if (existing) {
      await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
    } else {
      await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "fal_api_key", provider: "encrypted", description: encrypted });
    }
    res.json({ connected: true });
  });

  // POST /fal/generate - Submit generation request
  router.post("/fal/generate", upload.single("image"), async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.body.companyId as string;
    const modelKey = req.body.model as string;
    const model = MODELS[modelKey];
    if (!model) { res.status(400).json({ error: "Modello non supportato" }); return; }

    const falKey = await getFalKey(db, companyId);
    if (!falKey) { res.status(400).json({ error: "fal.ai non configurato" }); return; }

    // Build request body from form data
    const body: Record<string, any> = {};
    const params = req.body;
    
    // Common params
    if (params.prompt) body.prompt = params.prompt;
    if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio;
    if (params.duration) body.duration = params.duration;
    if (params.resolution) body.resolution = params.resolution;
    if (params.negative_prompt) body.negative_prompt = params.negative_prompt;
    if (params.output_format) body.output_format = params.output_format;
    if (params.num_images) body.num_images = parseInt(params.num_images);
    if (params.seed) body.seed = parseInt(params.seed);
    if (params.safety_tolerance) body.safety_tolerance = params.safety_tolerance;
    if (params.generate_audio !== undefined) body.generate_audio = params.generate_audio === "true";
    if (params.camera_fixed !== undefined) body.camera_fixed = params.camera_fixed === "true";
    if (params.enable_web_search !== undefined) body.enable_web_search = params.enable_web_search === "true";
    if (params.cfg_scale) body.cfg_scale = parseFloat(params.cfg_scale);

    // Image/video URL params
    if (params.image_url) body.image_url = params.image_url;
    if (params.start_image_url) body.start_image_url = params.start_image_url;
    if (params.end_image_url) body.end_image_url = params.end_image_url;
    if (params.video_url) body.video_url = params.video_url;
    if (params.first_frame_url) body.first_frame_url = params.first_frame_url;
    if (params.last_frame_url) body.last_frame_url = params.last_frame_url;
    if (params.image_urls) {
      try { body.image_urls = JSON.parse(params.image_urls); } catch { body.image_urls = [params.image_urls]; }
    }

    // If file uploaded, upload to fal.ai CDN first
    const file = (req as any).file;
    if (file) {
      try {
        const uploadRes = await fetch("https://fal.run/fal-ai/file-upload", {
          method: "POST",
          headers: { Authorization: "Key " + falKey, "Content-Type": file.mimetype },
          body: file.buffer,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json() as { url?: string };
          if (uploadData.url) {
            // Auto-assign to the right field based on model type
            if (model.type === "image-edit") { body.image_urls = [uploadData.url]; }
            else if (model.type === "image-to-video") { body.image_url = body.image_url || uploadData.url; body.start_image_url = body.start_image_url || uploadData.url; }
            else if (model.type === "extend-video") { body.video_url = uploadData.url; }
            else if (model.type === "frame-to-video") { body.first_frame_url = body.first_frame_url || uploadData.url; }
            else if (model.type === "reference-to-video") { body.image_urls = body.image_urls || [uploadData.url]; }
          }
        }
      } catch (err) { console.error("[fal] upload error:", err); }
    }

    try {
      const r = await fetch(FAL_QUEUE_URL + "/" + model.id, {
        method: "POST",
        headers: { Authorization: "Key " + falKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json() as any;
      if (!r.ok) { res.status(r.status).json({ error: data.detail || data.message || "Errore fal.ai", raw: data }); return; }
      res.json({
        requestId: data.request_id,
        statusUrl: data.status_url,
        responseUrl: data.response_url,
        cancelUrl: data.cancel_url,
        modelId: model.id,
      });
    } catch (err) { res.status(500).json({ error: "Errore connessione fal.ai" }); }
  });

  // GET /fal/status/:requestId - Check generation status
  router.get("/fal/status/:modelKey/:requestId", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const { modelKey, requestId } = req.params;
    const model = MODELS[modelKey];
    if (!model) { res.status(400).json({ error: "Modello non supportato" }); return; }
    const falKey = await getFalKey(db, companyId);
    if (!falKey) { res.status(400).json({ error: "fal.ai non configurato" }); return; }

    try {
      const r = await fetch(FAL_QUEUE_URL + "/" + model.id + "/requests/" + requestId + "/status?logs=1", {
        headers: { Authorization: "Key " + falKey },
      });
      const data = await r.json();
      res.json(data);
    } catch { res.status(500).json({ error: "Errore" }); }
  });

  // GET /fal/result/:modelKey/:requestId - Get generation result
  router.get("/fal/result/:modelKey/:requestId", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const { modelKey, requestId } = req.params;
    const model = MODELS[modelKey];
    if (!model) { res.status(400).json({ error: "Modello non supportato" }); return; }
    const falKey = await getFalKey(db, companyId);
    if (!falKey) { res.status(400).json({ error: "fal.ai non configurato" }); return; }

    try {
      const r = await fetch(FAL_QUEUE_URL + "/" + model.id + "/requests/" + requestId, {
        headers: { Authorization: "Key " + falKey },
      });
      const data = await r.json();
      res.json(data);
    } catch { res.status(500).json({ error: "Errore" }); }
  });

  // DELETE /fal/key?companyId=xxx - Disconnect
  router.delete("/fal/key", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "fal_api_key")));
    res.json({ disconnected: true });
  });

  return router;
}
