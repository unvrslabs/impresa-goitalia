import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, customConnectors } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";

const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "2e8f0fe5-8ebc-4626-8722-59374d6427cf";
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || "4456c10d-9837-4ee2-9b79-38b15b901ae3";
const BASE_URL = process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu";
const REDIRECT_URI = BASE_URL + "/api/oauth/hubspot/callback";

const SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "oauth",
].join(" ");

// HubSpot CRM actions template (same as in custom-connectors.ts)
const HUBSPOT_ACTIONS = [
  { name: "lista_contatti", label: "Lista Contatti", description: "Recupera i contatti dal CRM", method: "GET", path: "/crm/v3/objects/contacts", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati (default 10, max 100)" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: email,firstname,lastname,phone)" },
    { name: "after", type: "string", required: false, in: "query", description: "Cursore paginazione" },
  ], body_template: null },
  { name: "cerca_contatto", label: "Cerca Contatto", description: "Cerca un contatto per email, nome o telefono", method: "POST", path: "/crm/v3/objects/contacts/search", params: [
    { name: "email", type: "string", required: false, in: "body", description: "Email da cercare" },
    { name: "nome", type: "string", required: false, in: "body", description: "Nome da cercare" },
  ], body_template: null },
  { name: "crea_contatto", label: "Crea Contatto", description: "Crea un nuovo contatto nel CRM", method: "POST", path: "/crm/v3/objects/contacts", params: [
    { name: "email", type: "string", required: true, in: "body", description: "Email del contatto" },
    { name: "firstname", type: "string", required: false, in: "body", description: "Nome" },
    { name: "lastname", type: "string", required: false, in: "body", description: "Cognome" },
    { name: "phone", type: "string", required: false, in: "body", description: "Telefono" },
    { name: "company", type: "string", required: false, in: "body", description: "Azienda" },
  ], body_template: null },
  { name: "lista_deal", label: "Lista Deal", description: "Recupera le opportunità/deal dal CRM", method: "GET", path: "/crm/v3/objects/deals", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: dealname,amount,dealstage,closedate)" },
  ], body_template: null },
  { name: "crea_deal", label: "Crea Deal", description: "Crea una nuova opportunità/deal", method: "POST", path: "/crm/v3/objects/deals", params: [
    { name: "dealname", type: "string", required: true, in: "body", description: "Nome del deal" },
    { name: "amount", type: "string", required: false, in: "body", description: "Importo" },
    { name: "dealstage", type: "string", required: false, in: "body", description: "Fase" },
    { name: "closedate", type: "string", required: false, in: "body", description: "Data chiusura (YYYY-MM-DD)" },
  ], body_template: null },
  { name: "lista_aziende", label: "Lista Aziende", description: "Recupera le aziende dal CRM", method: "GET", path: "/crm/v3/objects/companies", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: name,domain,industry,city,phone)" },
  ], body_template: null },
  { name: "crea_azienda", label: "Crea Azienda", description: "Crea una nuova azienda nel CRM", method: "POST", path: "/crm/v3/objects/companies", params: [
    { name: "name", type: "string", required: true, in: "body", description: "Nome azienda" },
    { name: "domain", type: "string", required: false, in: "body", description: "Dominio web" },
    { name: "industry", type: "string", required: false, in: "body", description: "Settore" },
    { name: "city", type: "string", required: false, in: "body", description: "Città" },
    { name: "phone", type: "string", required: false, in: "body", description: "Telefono" },
  ], body_template: null },
  { name: "lista_note", label: "Lista Note", description: "Recupera le note/attività", method: "GET", path: "/crm/v3/objects/notes", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: hs_note_body,hs_timestamp)" },
  ], body_template: null },
];

// Temporary state store for OAuth flow
const oauthStates = new Map<string, { companyId: string; userId: string; expiresAt: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of oauthStates) { if (v.expiresAt < now) oauthStates.delete(k); } }, 300000);

export function hubspotOAuthRoutes(db: Db) {
  const router = Router();

  // GET /oauth/hubspot/status?companyId=
  router.get("/oauth/hubspot/status", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ connected: false }); return; }

    const connector = await db.select({ id: customConnectors.id })
      .from(customConnectors)
      .where(and(eq(customConnectors.companyId, companyId), eq(customConnectors.slug, "hubspot")))
      .then(r => r[0]);

    res.json({ connected: !!connector });
  });

  // GET /oauth/hubspot/connect?companyId= — Start OAuth flow
  router.get("/oauth/hubspot/connect", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    if (!HUBSPOT_CLIENT_ID) {
      res.status(500).json({ error: "HubSpot OAuth non configurato" });
      return;
    }

    const state = crypto.randomBytes(32).toString("hex");
    oauthStates.set(state, { companyId, userId: actor.userId, expiresAt: Date.now() + 600000 });

    const authUrl = new URL("https://app.hubspot.com/oauth/authorize");
    authUrl.searchParams.set("client_id", HUBSPOT_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("state", state);

    res.redirect(authUrl.toString());
  });

  // GET /oauth/hubspot/callback — Handle OAuth callback
  router.get("/oauth/hubspot/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      res.redirect("/plugins?error=hubspot_oauth_denied");
      return;
    }

    if (!code || !state) {
      res.redirect("/plugins?error=hubspot_oauth_invalid");
      return;
    }

    const stateData = oauthStates.get(state);
    oauthStates.delete(state);

    if (!stateData || stateData.expiresAt < Date.now()) {
      res.redirect("/plugins?error=hubspot_oauth_expired");
      return;
    }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch("https://api.hubapi.com/oauth/v1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: HUBSPOT_CLIENT_ID,
          client_secret: HUBSPOT_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          code,
        }),
      });

      if (!tokenRes.ok) {
        console.error("[hubspot-oauth] Token exchange failed:", await tokenRes.text());
        res.redirect("/plugins?error=hubspot_oauth_token_failed");
        return;
      }

      const tokens = await tokenRes.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      // Get HubSpot account info
      const infoRes = await fetch("https://api.hubapi.com/oauth/v1/access-tokens/" + tokens.access_token);
      const info = await infoRes.json() as { hub_domain?: string; hub_id?: number; user?: string };
      const hubName = info.hub_domain || info.user || `HubSpot ${info.hub_id || ""}`;

      // Check if already connected
      const existing = await db.select().from(customConnectors)
        .where(and(eq(customConnectors.companyId, stateData.companyId), eq(customConnectors.slug, "hubspot")))
        .then(r => r[0]);

      let connectorId: string;

      if (existing) {
        // Update existing connector's token
        connectorId = existing.id;
        await db.update(companySecrets)
          .set({ description: encrypt(JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + tokens.expires_in * 1000 })), updatedAt: new Date() })
          .where(and(eq(companySecrets.companyId, stateData.companyId), eq(companySecrets.name, `custom_api_${existing.id}`)));
      } else {
        // Create connector + secret
        const [row] = await db.insert(customConnectors).values({
          companyId: stateData.companyId,
          name: "HubSpot CRM",
          slug: "hubspot",
          baseUrl: "https://api.hubapi.com",
          authType: "bearer",
          authHeader: "Authorization",
          authPrefix: "Bearer",
          description: `HubSpot CRM (${hubName}) — contatti, deal, aziende, note`,
          actions: HUBSPOT_ACTIONS,
        }).returning();

        connectorId = row.id;

        await db.insert(companySecrets).values({
          id: crypto.randomUUID(),
          companyId: stateData.companyId,
          name: `custom_api_${row.id}`,
          provider: "encrypted",
          description: encrypt(JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + tokens.expires_in * 1000,
          })),
        });

        await upsertConnectorAccount(db, stateData.companyId, "custom_hubspot", row.id, "HubSpot CRM");
      }

      console.info("[hubspot-oauth] Connected:", hubName, "for company:", stateData.companyId);
      res.redirect("/plugins?hubspot_connected=true");
    } catch (err) {
      console.error("[hubspot-oauth] Callback error:", err);
      res.redirect("/plugins?error=hubspot_oauth_error");
    }
  });

  // POST /oauth/hubspot/disconnect
  router.post("/oauth/hubspot/disconnect", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId } = req.body;
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.companyId, companyId), eq(customConnectors.slug, "hubspot")))
      .then(r => r[0]);

    if (connector) {
      await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, `custom_api_${connector.id}`)));
      await removeConnectorAccount(db, companyId, "custom_hubspot");
      await db.delete(customConnectors).where(eq(customConnectors.id, connector.id));
    }

    res.json({ disconnected: true });
  });

  return router;
}
