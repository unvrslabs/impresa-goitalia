import { Router } from "express";
import type { Db } from "@goitalia/db";
import { customConnectors, companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";
import { randomUUID } from "node:crypto";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").substring(0, 30);
}

function requireAuth(req: any, res: any, companyId: string | undefined): companyId is string {
  const actor = req.actor as { type?: string; userId?: string } | undefined;
  if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return false; }
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return false; }
  return true;
}

function validateUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "Solo URL HTTPS consentiti";
    const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "[::1]"];
    if (blocked.some(h => parsed.hostname === h) || parsed.hostname.startsWith("10.") || parsed.hostname.startsWith("192.168.") || parsed.hostname.startsWith("172.")) {
      return "URL non consentito (rete privata)";
    }
    return null;
  } catch { return "URL non valido"; }
}

export function customConnectorRoutes(db: Db) {
  const router = Router();

  // GET /custom-connectors?companyId=
  router.get("/custom-connectors", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!requireAuth(req, res, companyId)) return;
    const rows = await db.select().from(customConnectors)
      .where(eq(customConnectors.companyId, companyId));
    res.json(rows);
  });

  // POST /custom-connectors
  router.post("/custom-connectors", async (req, res) => {
    const { companyId, name, baseUrl, apiKey, authType, authHeader, authPrefix, description } = req.body;
    if (!requireAuth(req, res, companyId)) return;
    if (!name || !baseUrl) return res.status(400).json({ error: "name and baseUrl required" });

    const urlError = validateUrl(baseUrl);
    if (urlError) return res.status(400).json({ error: urlError });

    const existing = await db.select({ id: customConnectors.id }).from(customConnectors)
      .where(eq(customConnectors.companyId, companyId));
    if (existing.length >= 10) return res.status(400).json({ error: "Massimo 10 connettori custom per azienda" });

    const slug = slugify(name);
    try {
      const [row] = await db.insert(customConnectors).values({
        companyId, name, slug, baseUrl,
        authType: authType || "bearer",
        authHeader: authHeader || "Authorization",
        authPrefix: authPrefix || "Bearer",
        description: description || null,
        actions: [],
      }).returning();

      if (apiKey) {
        await db.insert(companySecrets).values({
          id: randomUUID(), companyId,
          name: `custom_api_${row.id}`,
          provider: "encrypted",
          description: encrypt(apiKey),
        });
      }

      await upsertConnectorAccount(db, companyId, `custom_${slug}`, row.id, name);
      res.json(row);
    } catch (err: any) {
      if (err.code === "23505") return res.status(409).json({ error: "Connettore con questo nome esiste già" });
      console.error("[custom-connectors] create error:", err);
      res.status(500).json({ error: "Errore creazione connettore" });
    }
  });

  // PUT /custom-connectors/:id
  router.put("/custom-connectors/:id", async (req, res) => {
    const { companyId, name, baseUrl, description, authType, authHeader, authPrefix } = req.body;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    if (baseUrl) {
      const urlError = validateUrl(baseUrl);
      if (urlError) return res.status(400).json({ error: urlError });
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (baseUrl !== undefined) updates.baseUrl = baseUrl;
    if (description !== undefined) updates.description = description;
    if (authType !== undefined) updates.authType = authType;
    if (authHeader !== undefined) updates.authHeader = authHeader;
    if (authPrefix !== undefined) updates.authPrefix = authPrefix;

    const [updated] = await db.update(customConnectors).set(updates)
      .where(eq(customConnectors.id, req.params.id)).returning();
    res.json(updated);
  });

  // DELETE /custom-connectors/:id?companyId=
  router.delete("/custom-connectors/:id", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    await db.delete(companySecrets).where(and(
      eq(companySecrets.companyId, companyId),
      eq(companySecrets.name, `custom_api_${connector.id}`),
    ));
    await removeConnectorAccount(db, companyId, `custom_${connector.slug}`);
    await db.delete(customConnectors).where(eq(customConnectors.id, connector.id));
    res.json({ deleted: true });
  });

  // POST /custom-connectors/:id/actions
  router.post("/custom-connectors/:id/actions", async (req, res) => {
    const { companyId, name, label, description, method, path, params, body_template } = req.body;
    if (!requireAuth(req, res, companyId)) return;
    if (!name || !method || !path) return res.status(400).json({ error: "name, method, path required" });

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    const actions = (connector.actions as any[]) || [];
    if (actions.length >= 20) return res.status(400).json({ error: "Massimo 20 azioni per connettore" });

    const actionSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (actions.some((a: any) => a.name === actionSlug)) return res.status(409).json({ error: "Azione con questo nome esiste già" });

    actions.push({
      name: actionSlug, label: label || name, description: description || "",
      method: method.toUpperCase(), path,
      params: params || [], body_template: body_template || null,
    });

    const [updated] = await db.update(customConnectors)
      .set({ actions, updatedAt: new Date() })
      .where(eq(customConnectors.id, connector.id)).returning();
    res.json(updated);
  });

  // DELETE /custom-connectors/:id/actions/:actionName?companyId=
  router.delete("/custom-connectors/:id/actions/:actionName", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    const actions = ((connector.actions as any[]) || []).filter((a: any) => a.name !== req.params.actionName);
    const [updated] = await db.update(customConnectors)
      .set({ actions, updatedAt: new Date() })
      .where(eq(customConnectors.id, connector.id)).returning();
    res.json(updated);
  });

  // POST /custom-connectors/:id/test
  router.post("/custom-connectors/:id/test", async (req, res) => {
    const { companyId } = req.body;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, `custom_api_${connector.id}`)))
      .then(r => r[0]);

    try {
      const headers: Record<string, string> = {};
      if (secret?.description && connector.authType !== "none") {
        const apiKey = decrypt(secret.description);
        headers[connector.authHeader || "Authorization"] = `${connector.authPrefix || "Bearer"} ${apiKey}`.trim();
      }
      const r = await fetch(connector.baseUrl, { headers, signal: AbortSignal.timeout(10000) });
      res.json({ ok: r.ok, status: r.status });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message });
    }
  });

  return router;
}
