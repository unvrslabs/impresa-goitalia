import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";
import crypto from "node:crypto";

interface OpenApiCreds {
  apiKey: string;
  tokens: Record<string, string>; // service -> token (e.g. "company" -> "abc123")
  email?: string;
}

const SERVICE_DOMAINS: Record<string, string> = {
  company: "company.openapi.com",
  risk: "risk.openapi.com",
  cap: "cap.openapi.it",
  sdi: "sdi.openapi.it",
  invoice: "invoice.openapi.com",
};

async function getCreds(db: Db, companyId: string): Promise<OpenApiCreds | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openapi_it_creds")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try { return JSON.parse(decrypt(secret.description)); } catch { return null; }
}

function getToken(creds: OpenApiCreds, service: string): string | null {
  return creds.tokens[service] || null;
}

export function openapiItRoutes(db: Db) {
  const router = Router();

  // POST /openapi-it/save — Save API key + tokens
  router.post("/openapi-it/save", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, apiKey, tokens, email } = req.body as { companyId: string; apiKey: string; tokens: Record<string, string>; email?: string };
    if (!companyId || !apiKey) { res.status(400).json({ error: "companyId e apiKey obbligatori" }); return; }
    if (!tokens || Object.keys(tokens).length === 0) { res.status(400).json({ error: "Inserisci almeno un token" }); return; }

    // Verify each token against its service endpoint
    const testUrls: Record<string, string> = {
      company: "https://company.openapi.com/IT-legalforms",
      risk: "https://risk.openapi.com/IT-creditscore-start/01879020517",
      cap: "https://cap.openapi.it/regioni",
      sdi: "https://sdi.openapi.it/invoices_stats",
      visure: "https://visurecamerali.openapi.it/impresa?cf_piva_id=01879020517",
      pec: "https://pec.openapi.it/pec",
    };
    for (const [service, token] of Object.entries(tokens)) {
      const testUrl = testUrls[service];
      if (!testUrl) continue;
      try {
        const testRes = await fetch(testUrl, { headers: { Authorization: "Bearer " + token } });
        if (testRes.status === 401 || testRes.status === 403) {
          res.status(400).json({ error: `Token ${service} non valido o scaduto` }); return;
        }
      } catch { /* skip on network error */ }
    }

    // If apiKey is "_existing_", merge new tokens with existing ones
    let finalCreds: OpenApiCreds;
    if (apiKey === "_existing_") {
      const existing = await getCreds(db, companyId);
      if (!existing) { res.status(400).json({ error: "Nessuna connessione esistente" }); return; }
      finalCreds = { ...existing, tokens: { ...existing.tokens, ...tokens } };
    } else {
      finalCreds = { apiKey, tokens, email };
    }
    const creds = finalCreds;
    const encrypted = encrypt(JSON.stringify(creds));

    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openapi_it_creds")))
      .then((r) => r[0]);

    if (existing) {
      await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
    } else {
      await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "openapi_it_creds", provider: "encrypted", description: encrypted });
    }

    await upsertConnectorAccount(db, companyId, "openapi", "default", creds.email || "OpenAPI.it");
    res.json({ connected: true, services: Object.keys(creds.tokens) });
  });

  // GET /openapi-it/status
  router.get("/openapi-it/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ connected: false }); return; }
    const creds = await getCreds(db, companyId);
    if (!creds) { res.json({ connected: false }); return; }
    res.json({ connected: true, services: Object.keys(creds.tokens) });
  });

  // POST /openapi-it/disconnect
  router.post("/openapi-it/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openapi_it_creds")));
    await removeConnectorAccount(db, companyId, "openapi", "default");
    res.json({ disconnected: true });
  });

  // GET /openapi-it/company/:query — Lookup by P.IVA or CF
  router.get("/openapi-it/company/:query", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const level = (req.query.level as string) || "start";
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "company");
    if (!token) { res.status(400).json({ error: "Token Company non configurato" }); return; }

    try {
      const r = await fetch(`https://company.openapi.com/IT-${level}/${encodeURIComponent(req.params.query)}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error("OpenAPI company error:", err);
      res.status(502).json({ error: "Errore comunicazione OpenAPI.it" });
    }
  });

  // GET /openapi-it/company-search?q=...
  router.get("/openapi-it/company-search", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const q = req.query.q as string;
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "company");
    if (!token) { res.status(400).json({ error: "Token Company non configurato" }); return; }

    try {
      const r = await fetch(`https://company.openapi.com/IT-name?denomination=${encodeURIComponent(q)}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error("OpenAPI search error:", err);
      res.status(502).json({ error: "Errore ricerca" });
    }
  });

  // GET /openapi-it/sdi-code/:query
  router.get("/openapi-it/sdi-code/:query", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "company");
    if (!token) { res.status(400).json({ error: "Token Company non configurato" }); return; }

    try {
      const r = await fetch(`https://company.openapi.com/IT-sdicode/${encodeURIComponent(req.params.query)}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error("OpenAPI sdi-code error:", err);
      res.status(502).json({ error: "Errore codice SDI" });
    }
  });

  // GET /openapi-it/risk/:query
  router.get("/openapi-it/risk/:query", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const level = (req.query.level as string) || "start";
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "risk");
    if (!token) { res.status(400).json({ error: "Token Risk non configurato" }); return; }

    try {
      const r = await fetch(`https://risk.openapi.com/IT-creditscore-${level}/${encodeURIComponent(req.params.query)}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error("OpenAPI risk error:", err);
      res.status(502).json({ error: "Errore risk" });
    }
  });

  // GET /openapi-it/cap/:cap
  router.get("/openapi-it/cap/:cap", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "cap");
    if (!token) { res.status(400).json({ error: "Token CAP non configurato" }); return; }

    try {
      const r = await fetch(`https://cap.openapi.it/cap/${encodeURIComponent(req.params.cap)}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error("OpenAPI cap error:", err);
      res.status(502).json({ error: "Errore CAP" });
    }
  });

  // GET /openapi-it/credit
  router.get("/openapi-it/credit", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }

    try {
      const basic = Buffer.from((creds.email || "") + ":" + creds.apiKey).toString("base64");
      const r = await fetch("https://oauth.openapi.it/credit", {
        headers: { Authorization: "Basic " + basic },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error("OpenAPI credit error:", err);
      res.status(502).json({ error: "Errore credito" });
    }
  });

  // POST /openapi-it/visura — Request a visura camerale
  router.post("/openapi-it/visura", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, cfPiva, tipo } = req.body as { companyId: string; cfPiva: string; tipo?: string };
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "visure");
    if (!token) { res.status(400).json({ error: "Token Visure non configurato" }); return; }
    const endpoint = tipo || "ordinaria-societa-capitale";
    try {
      const r = await fetch(`https://visurecamerali.openapi.it/${endpoint}`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ cf_piva_id: cfPiva }),
      });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error("OpenAPI visura error:", err);
      res.status(502).json({ error: "Errore richiesta visura" });
    }
  });

  // GET /openapi-it/visura/:id — Check visura status
  router.get("/openapi-it/visura/:id", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const tipo = (req.query.tipo as string) || "ordinaria-societa-capitale";
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "visure");
    if (!token) { res.status(400).json({ error: "Token Visure non configurato" }); return; }
    try {
      const r = await fetch(`https://visurecamerali.openapi.it/${tipo}?id=${req.params.id}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error("OpenAPI visura status error:", err);
      res.status(502).json({ error: "Errore stato visura" });
    }
  });

  // GET /openapi-it/visura/:id/download — Download visura PDF
  router.get("/openapi-it/visura/:id/download", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const tipo = (req.query.tipo as string) || "ordinaria-societa-capitale";
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "visure");
    if (!token) { res.status(400).json({ error: "Token Visure non configurato" }); return; }
    try {
      const r = await fetch(`https://visurecamerali.openapi.it/${tipo}/allegati?id=${req.params.id}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error("OpenAPI visura download error:", err);
      res.status(502).json({ error: "Errore download visura" });
    }
  });
  // POST /openapi-it/remove-service — Remove a single service token
  router.post("/openapi-it/remove-service", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, service } = req.body as { companyId: string; service: string };
    if (!companyId || !service) { res.status(400).json({ error: "companyId e service obbligatori" }); return; }
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "Non connesso" }); return; }
    delete creds.tokens[service];
    if (Object.keys(creds.tokens).length === 0) {
      await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openapi_it_creds")));
      res.json({ disconnected: true });
    } else {
      const encrypted = encrypt(JSON.stringify(creds));
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openapi_it_creds")))
        .then((r) => r[0]);
      if (existing) await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      res.json({ services: Object.keys(creds.tokens) });
    }
  });
  // GET /openapi-it/searches — List saved searches
  router.get("/openapi-it/searches", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const searchType = req.query.type as string;
    if (!companyId) { res.json({ searches: [] }); return; }
    try {
      let result;
      if (searchType) {
        result = await db.execute(sql`SELECT id, search_type, query, result_name, result_data, created_at FROM openapi_searches WHERE company_id = ${companyId} AND search_type = ${searchType} ORDER BY created_at DESC LIMIT 50`);
      } else {
        result = await db.execute(sql`SELECT id, search_type, query, result_name, result_data, created_at FROM openapi_searches WHERE company_id = ${companyId} ORDER BY created_at DESC LIMIT 50`);
      }
      res.json({ searches: (result as any).rows || result });
    } catch (err) {
      console.error("OpenAPI searches error:", err);
      res.json({ searches: [] });
    }
  });

  // POST /openapi-it/searches — Save a search result
  router.post("/openapi-it/searches", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, searchType, query: q, resultName, resultData } = req.body;
    if (!companyId || !searchType || !q) { res.status(400).json({ error: "Dati mancanti" }); return; }
    try {
      const dataStr = JSON.stringify(resultData || {});
      await db.execute(sql`INSERT INTO openapi_searches (company_id, search_type, query, result_name, result_data) VALUES (${companyId}, ${searchType}, ${q}, ${resultName || ""}, ${dataStr}::jsonb)`);
      res.json({ saved: true });
    } catch (err) {
      console.error("OpenAPI save search error:", err);
      res.status(500).json({ error: "Errore salvataggio" });
    }
  });

  // DELETE /openapi-it/searches/:id — Delete a saved search
  router.delete("/openapi-it/searches/:id", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    try {
      await db.execute(sql`DELETE FROM openapi_searches WHERE id = ${req.params.id} AND company_id = ${companyId}`);
      res.json({ deleted: true });
    } catch { res.status(500).json({ error: "Errore" }); }
  });

  // GET /openapi-it/pec/verify-domain/:domain — Verify PEC domain
  router.get("/openapi-it/pec/verify-domain/:domain", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "pec");
    if (!token) { res.status(400).json({ error: "Token PEC non configurato" }); return; }
    try {
      const r = await fetch(`https://pec.openapi.it/domini_pec/${encodeURIComponent(req.params.domain)}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) { res.status(502).json({ error: "Errore verifica dominio PEC" }); }
  });

  // GET /openapi-it/pec/verify/:pec — Verify PEC availability
  router.get("/openapi-it/pec/verify/:pec", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "pec");
    if (!token) { res.status(400).json({ error: "Token PEC non configurato" }); return; }
    try {
      const r = await fetch(`https://pec.openapi.it/verifica_pec/${encodeURIComponent(req.params.pec)}`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) { res.status(502).json({ error: "Errore verifica PEC" }); }
  });

  // GET /openapi-it/pec/list — List PEC mailboxes
  router.get("/openapi-it/pec/list", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "pec");
    if (!token) { res.status(400).json({ error: "Token PEC non configurato" }); return; }
    try {
      const r = await fetch("https://pec.openapi.it/pec", {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      res.json(data);
    } catch (err) { res.status(502).json({ error: "Errore lista PEC" }); }
  });

  // POST /openapi-it/pec/create — Register new PEC
  router.post("/openapi-it/pec/create", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, ...pecData } = req.body;
    const creds = await getCreds(db, companyId);
    if (!creds) { res.status(400).json({ error: "OpenAPI.it non connesso" }); return; }
    const token = getToken(creds, "pec");
    if (!token) { res.status(400).json({ error: "Token PEC non configurato" }); return; }
    try {
      const r = await fetch("https://pec.openapi.it/pec", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(pecData),
      });
      const data = await r.json();
      res.json(data);
    } catch (err) { res.status(502).json({ error: "Errore creazione PEC" }); }
  });

  return router;
}

