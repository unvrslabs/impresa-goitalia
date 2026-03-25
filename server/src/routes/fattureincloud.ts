import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";

const FIC_API = "https://api-v2.fattureincloud.it";
function getFicClientId() { return process.env.FIC_CLIENT_ID || ""; }
function getFicClientSecret() { return process.env.FIC_CLIENT_SECRET || ""; }

const oauthStates = new Map<string, { companyId: string; userId: string; prefix: string; expiresAt: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of oauthStates) { if (v.expiresAt < now) oauthStates.delete(k); } }, 300000);

async function getFicToken(db: Db, companyId: string): Promise<{ access_token: string; refresh_token: string; fic_company_id: number; company_name?: string } | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "fattureincloud_tokens")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try {
    const data = JSON.parse(decrypt(secret.description));
    // Check if token needs refresh (24h)
    if (data.expiresAt && data.expiresAt < Date.now()) {
      // Refresh token
      const r = await fetch(FIC_API + "/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: getFicClientId(),
          client_secret: getFicClientSecret(),
          refresh_token: data.refresh_token,
        }),
      });
      if (r.ok) {
        const tokens = await r.json() as { access_token: string; refresh_token: string; expires_in: number };
        data.access_token = tokens.access_token;
        data.refresh_token = tokens.refresh_token;
        data.expiresAt = Date.now() + tokens.expires_in * 1000;
        // Save refreshed tokens
        const enc = encrypt(JSON.stringify(data));
        await db.update(companySecrets).set({ description: enc, updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
      }
    }
    return data;
  } catch { return null; }
}

export function fattureincloudRoutes(db: Db) {
  const router = Router();

  // GET /fic/status?companyId=xxx
  router.get("/fic/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const token = await getFicToken(db, companyId);
    res.json({ connected: !!token, companyName: token?.company_name });
  });

  // POST /fic/save-token - Save token directly (no OAuth)
  router.post("/fic/save-token", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, accessToken } = req.body as { companyId: string; accessToken: string };
    if (!companyId || !accessToken) { res.status(400).json({ error: "Token richiesto" }); return; }

    // Test token - get companies
    try {
      const r = await fetch("https://api-v2.fattureincloud.it/user/companies", {
        headers: { Authorization: "Bearer " + accessToken },
      });
      if (!r.ok) { res.status(400).json({ error: "Token non valido" }); return; }
      const data = await r.json() as any;
      const companies = data.data?.companies || [];
      const ficCompany = companies[0];
      if (!ficCompany) { res.status(400).json({ error: "Nessuna azienda trovata" }); return; }

      const ficData = {
        access_token: accessToken,
        refresh_token: "",
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year for manual tokens
        fic_company_id: ficCompany.id,
        company_name: ficCompany.name,
      };

      const encrypted = encrypt(JSON.stringify(ficData));
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "fattureincloud_tokens")))
        .then((rows) => rows[0]);
      if (existing) {
        await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "fattureincloud_tokens", provider: "encrypted", description: encrypted });
      }
      res.json({ connected: true, companyName: ficCompany.name });
    } catch { res.status(400).json({ error: "Errore verifica token" }); }
  });

  // GET /fic/connect?companyId=xxx&prefix=xxx - Start OAuth
  router.get("/oauth/fattureincloud/connect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const prefix = (req.query.prefix as string) || "";
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const state = crypto.randomBytes(32).toString("hex");
    oauthStates.set(state, { companyId, userId: actor.userId, prefix, expiresAt: Date.now() + 600000 });

    const scopes = "situation:r entity.clients:a entity.suppliers:a products:a issued_documents.invoices:a issued_documents.quotes:a issued_documents.credit_notes:a issued_documents.receipts:a issued_documents.delivery_notes:a received_documents:a cashbook:a taxes:r settings:r";
    const redirectUri = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/api/oauth/fattureincloud/callback";

    const authUrl = FIC_API + "/oauth/authorize?" + new URLSearchParams({
      prompt: "login",
      response_type: "code",
      client_id: getFicClientId(),
      redirect_uri: redirectUri,
      scope: scopes,
      state,
    }).toString();

    res.redirect(authUrl);
  });

  // GET /oauth/fattureincloud/callback - OAuth callback
  router.get("/oauth/fattureincloud/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    if (oauthError) { res.redirect("/?error=fic_denied"); return; }
    if (!code || !state) { res.redirect("/?error=fic_invalid"); return; }

    const stateData = oauthStates.get(state);
    oauthStates.delete(state);
    if (!stateData || stateData.expiresAt < Date.now()) { res.redirect("/?error=fic_expired"); return; }

    const redirectUri = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/api/oauth/fattureincloud/callback";

    try {
      // Exchange code for tokens
      const tokenRes = await fetch(FIC_API + "/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: getFicClientId(),
          client_secret: getFicClientSecret(),
          redirect_uri: redirectUri,
          code,
        }),
      });
      if (!tokenRes.ok) { res.redirect("/?error=fic_token_failed"); return; }
      const tokens = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number };

      // Get user companies
      const companiesRes = await fetch(FIC_API + "/user/companies", {
        headers: { Authorization: "Bearer " + tokens.access_token },
      });
      let ficCompanyId = 0;
      let companyName = "";
      if (companiesRes.ok) {
        const companiesData = await companiesRes.json() as { data?: { companies?: Array<{ id: number; name: string; type: string }> } };
        const companies = companiesData.data?.companies || [];
        if (companies.length > 0) {
          ficCompanyId = companies[0].id;
          companyName = companies[0].name;
        }
      }

      const ficData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        fic_company_id: ficCompanyId,
        company_name: companyName,
      };

      const encrypted = encrypt(JSON.stringify(ficData));
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, stateData.companyId), eq(companySecrets.name, "fattureincloud_tokens")))
        .then((rows) => rows[0]);

      if (existing) {
        await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId: stateData.companyId, name: "fattureincloud_tokens", provider: "encrypted", description: encrypted });
      }

      const prefix = stateData.prefix || "";
      res.redirect(prefix ? "/" + prefix + "/plugins?fic_connected=true" : "/?fic_connected=true");
    } catch (err) {
      console.error("FIC OAuth error:", err);
      res.redirect("/?error=fic_error");
    }
  });

  // POST /fic/disconnect
  router.post("/fic/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.body?.companyId || req.query.companyId;
    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "fattureincloud_tokens")));
    res.json({ disconnected: true });
  });

  // === Proxy API Endpoints ===

  // GET /fic/invoices?companyId=xxx&type=invoice&page=1
  router.get("/fic/invoices", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const type = (req.query.type as string) || "invoice";
    const page = (req.query.page as string) || "1";
    const token = await getFicToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Fatture in Cloud non connesso" }); return; }
    try {
      const r = await fetch(`${FIC_API}/c/${token.fic_company_id}/issued_documents?type=${type}&per_page=20&page=${page}&sort=-date&fieldset=detailed`, {
        headers: { Authorization: "Bearer " + token.access_token },
      });
      const data = await r.json();
      res.json(data);
    } catch { res.status(500).json({ error: "Errore" }); }
  });

  // GET /fic/received?companyId=xxx&page=1
  router.get("/fic/received", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const page = (req.query.page as string) || "1";
    const token = await getFicToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Non connesso" }); return; }
    try {
      const r = await fetch(`${FIC_API}/c/${token.fic_company_id}/received_documents?type=expense&per_page=20&page=${page}&sort=-date&fieldset=detailed`, {
        headers: { Authorization: "Bearer " + token.access_token },
      });
      res.json(await r.json());
    } catch { res.status(500).json({ error: "Errore" }); }
  });

  // GET /fic/clients?companyId=xxx
  router.get("/fic/clients", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const token = await getFicToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Non connesso" }); return; }
    try {
      const r = await fetch(`${FIC_API}/c/${token.fic_company_id}/entities/clients?per_page=100&fieldset=detailed`, {
        headers: { Authorization: "Bearer " + token.access_token },
      });
      res.json(await r.json());
    } catch { res.status(500).json({ error: "Errore" }); }
  });

  // POST /fic/invoices - Create invoice
  router.post("/fic/invoices", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, ...invoiceData } = req.body;
    const token = await getFicToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Non connesso" }); return; }
    try {
      const r = await fetch(`${FIC_API}/c/${token.fic_company_id}/issued_documents`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ data: invoiceData }),
      });
      const data = await r.json();
      if (!r.ok) { res.status(r.status).json(data); return; }
      res.json(data);
    } catch { res.status(500).json({ error: "Errore" }); }
  });

  // POST /fic/invoices/:id/send-sdi - Send e-invoice to SDI
  router.post("/fic/invoices/:id/send-sdi", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.body?.companyId;
    const docId = req.params.id;
    const token = await getFicToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Non connesso" }); return; }
    try {
      // Verify XML first
      const verify = await fetch(`${FIC_API}/c/${token.fic_company_id}/issued_documents/${docId}/e_invoice/xml_verify`, {
        headers: { Authorization: "Bearer " + token.access_token },
      });
      if (!verify.ok) {
        const verifyData = await verify.json();
        res.status(400).json({ error: "Verifica XML fallita", details: verifyData });
        return;
      }
      // Send
      const r = await fetch(`${FIC_API}/c/${token.fic_company_id}/issued_documents/${docId}/e_invoice/send`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ data: {} }),
      });
      const data = await r.json();
      res.json(data);
    } catch { res.status(500).json({ error: "Errore invio SDI" }); }
  });

  // GET /fic/situation?companyId=xxx - Dashboard data
  router.get("/fic/situation", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const token = await getFicToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Non connesso" }); return; }
    try {
      const r = await fetch(`${FIC_API}/c/${token.fic_company_id}/issued_documents?type=invoice&per_page=5&sort=-date&fieldset=basic`, {
        headers: { Authorization: "Bearer " + token.access_token },
      });
      const invoices = await r.json();
      const r2 = await fetch(`${FIC_API}/c/${token.fic_company_id}/received_documents?type=expense&per_page=5&sort=-date&fieldset=basic`, {
        headers: { Authorization: "Bearer " + token.access_token },
      });
      const received = await r2.json();
      res.json({ invoices: invoices.data, received: received.data });
    } catch { res.status(500).json({ error: "Errore" }); }
  });

  return router;
}
