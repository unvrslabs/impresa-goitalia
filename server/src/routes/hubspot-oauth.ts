import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, customConnectors, agents, agentConnectorAccounts, connectorAccounts } from "@goitalia/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";

const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "";
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || "";
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
// All HubSpot CRM actions — each has "enabled: true" by default, PMI can toggle per-agent
const HUBSPOT_ACTIONS = [
  // --- CONTATTI ---
  { name: "lista_contatti", label: "Lista Contatti", description: "Recupera i contatti dal CRM", method: "GET", path: "/crm/v3/objects/contacts", enabled: true, category: "Contatti", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati (default 10, max 100)" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: email,firstname,lastname,phone,company)" },
    { name: "after", type: "string", required: false, in: "query", description: "Cursore paginazione" },
  ], body_template: null },
  { name: "cerca_contatto", label: "Cerca Contatto", description: "Cerca un contatto per email, nome o telefono", method: "POST", path: "/crm/v3/objects/contacts/search", enabled: true, category: "Contatti", params: [
    { name: "email", type: "string", required: false, in: "body", description: "Email da cercare" },
    { name: "nome", type: "string", required: false, in: "body", description: "Nome da cercare" },
  ], body_template: null },
  { name: "dettaglio_contatto", label: "Dettaglio Contatto", description: "Recupera tutti i dati di un contatto specifico", method: "GET", path: "/crm/v3/objects/contacts/{contactId}", enabled: true, category: "Contatti", params: [
    { name: "contactId", type: "string", required: true, in: "path", description: "ID del contatto" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà da includere" },
  ], body_template: null },
  { name: "crea_contatto", label: "Crea Contatto", description: "Crea un nuovo contatto nel CRM", method: "POST", path: "/crm/v3/objects/contacts", enabled: true, category: "Contatti", params: [
    { name: "email", type: "string", required: true, in: "body", description: "Email del contatto" },
    { name: "firstname", type: "string", required: false, in: "body", description: "Nome" },
    { name: "lastname", type: "string", required: false, in: "body", description: "Cognome" },
    { name: "phone", type: "string", required: false, in: "body", description: "Telefono" },
    { name: "company", type: "string", required: false, in: "body", description: "Azienda" },
  ], body_template: null },
  { name: "aggiorna_contatto", label: "Aggiorna Contatto", description: "Modifica i dati di un contatto esistente", method: "PATCH", path: "/crm/v3/objects/contacts/{contactId}", enabled: true, category: "Contatti", params: [
    { name: "contactId", type: "string", required: true, in: "path", description: "ID del contatto" },
    { name: "email", type: "string", required: false, in: "body", description: "Email" },
    { name: "firstname", type: "string", required: false, in: "body", description: "Nome" },
    { name: "lastname", type: "string", required: false, in: "body", description: "Cognome" },
    { name: "phone", type: "string", required: false, in: "body", description: "Telefono" },
  ], body_template: null },
  { name: "elimina_contatto", label: "Elimina Contatto", description: "Elimina un contatto dal CRM", method: "DELETE", path: "/crm/v3/objects/contacts/{contactId}", enabled: false, category: "Contatti", params: [
    { name: "contactId", type: "string", required: true, in: "path", description: "ID del contatto" },
  ], body_template: null },
  // --- DEAL / OPPORTUNITÀ ---
  { name: "lista_deal", label: "Lista Deal", description: "Recupera le opportunità/deal", method: "GET", path: "/crm/v3/objects/deals", enabled: true, category: "Deal", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: dealname,amount,dealstage,closedate,pipeline)" },
  ], body_template: null },
  { name: "dettaglio_deal", label: "Dettaglio Deal", description: "Recupera i dati di un deal specifico", method: "GET", path: "/crm/v3/objects/deals/{dealId}", enabled: true, category: "Deal", params: [
    { name: "dealId", type: "string", required: true, in: "path", description: "ID del deal" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà da includere" },
  ], body_template: null },
  { name: "crea_deal", label: "Crea Deal", description: "Crea una nuova opportunità/deal", method: "POST", path: "/crm/v3/objects/deals", enabled: true, category: "Deal", params: [
    { name: "dealname", type: "string", required: true, in: "body", description: "Nome del deal" },
    { name: "amount", type: "string", required: false, in: "body", description: "Importo" },
    { name: "dealstage", type: "string", required: false, in: "body", description: "Fase (appointmentscheduled, qualifiedtobuy, closedwon, closedlost)" },
    { name: "closedate", type: "string", required: false, in: "body", description: "Data chiusura (YYYY-MM-DD)" },
    { name: "pipeline", type: "string", required: false, in: "body", description: "Pipeline (default se omesso)" },
  ], body_template: null },
  { name: "aggiorna_deal", label: "Aggiorna Deal", description: "Modifica un deal esistente (fase, importo, ecc.)", method: "PATCH", path: "/crm/v3/objects/deals/{dealId}", enabled: true, category: "Deal", params: [
    { name: "dealId", type: "string", required: true, in: "path", description: "ID del deal" },
    { name: "dealname", type: "string", required: false, in: "body", description: "Nome" },
    { name: "amount", type: "string", required: false, in: "body", description: "Importo" },
    { name: "dealstage", type: "string", required: false, in: "body", description: "Fase" },
    { name: "closedate", type: "string", required: false, in: "body", description: "Data chiusura" },
  ], body_template: null },
  { name: "elimina_deal", label: "Elimina Deal", description: "Elimina un deal", method: "DELETE", path: "/crm/v3/objects/deals/{dealId}", enabled: false, category: "Deal", params: [
    { name: "dealId", type: "string", required: true, in: "path", description: "ID del deal" },
  ], body_template: null },
  { name: "lista_pipeline", label: "Lista Pipeline", description: "Recupera le pipeline e le fasi dei deal", method: "GET", path: "/crm/v3/pipelines/deals", enabled: true, category: "Deal", params: [], body_template: null },
  // --- AZIENDE ---
  { name: "lista_aziende", label: "Lista Aziende", description: "Recupera le aziende dal CRM", method: "GET", path: "/crm/v3/objects/companies", enabled: true, category: "Aziende", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: name,domain,industry,city,phone)" },
  ], body_template: null },
  { name: "crea_azienda", label: "Crea Azienda", description: "Crea una nuova azienda", method: "POST", path: "/crm/v3/objects/companies", enabled: true, category: "Aziende", params: [
    { name: "name", type: "string", required: true, in: "body", description: "Nome azienda" },
    { name: "domain", type: "string", required: false, in: "body", description: "Dominio web" },
    { name: "industry", type: "string", required: false, in: "body", description: "Settore" },
    { name: "city", type: "string", required: false, in: "body", description: "Città" },
    { name: "phone", type: "string", required: false, in: "body", description: "Telefono" },
  ], body_template: null },
  { name: "aggiorna_azienda", label: "Aggiorna Azienda", description: "Modifica i dati di un'azienda", method: "PATCH", path: "/crm/v3/objects/companies/{companyId}", enabled: true, category: "Aziende", params: [
    { name: "companyId", type: "string", required: true, in: "path", description: "ID dell'azienda" },
    { name: "name", type: "string", required: false, in: "body", description: "Nome" },
    { name: "domain", type: "string", required: false, in: "body", description: "Dominio" },
    { name: "phone", type: "string", required: false, in: "body", description: "Telefono" },
  ], body_template: null },
  // --- ATTIVITÀ ---
  { name: "lista_task", label: "Lista Task", description: "Recupera i task/attività", method: "GET", path: "/crm/v3/objects/tasks", enabled: true, category: "Attività", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: hs_task_subject,hs_task_status,hs_task_priority)" },
  ], body_template: null },
  { name: "crea_task", label: "Crea Task", description: "Crea un nuovo task/attività", method: "POST", path: "/crm/v3/objects/tasks", enabled: true, category: "Attività", params: [
    { name: "hs_task_subject", type: "string", required: true, in: "body", description: "Oggetto del task" },
    { name: "hs_task_status", type: "string", required: false, in: "body", description: "Stato (NOT_STARTED, IN_PROGRESS, COMPLETED)" },
    { name: "hs_task_priority", type: "string", required: false, in: "body", description: "Priorità (HIGH, MEDIUM, LOW)" },
    { name: "hs_timestamp", type: "string", required: false, in: "body", description: "Data scadenza (ISO)" },
  ], body_template: null },
  { name: "lista_note", label: "Lista Note", description: "Recupera le note", method: "GET", path: "/crm/v3/objects/notes", enabled: true, category: "Attività", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
    { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: hs_note_body,hs_timestamp)" },
  ], body_template: null },
  { name: "crea_nota", label: "Crea Nota", description: "Crea una nota associata a un contatto/deal", method: "POST", path: "/crm/v3/objects/notes", enabled: true, category: "Attività", params: [
    { name: "hs_note_body", type: "string", required: true, in: "body", description: "Contenuto della nota" },
    { name: "hs_timestamp", type: "string", required: false, in: "body", description: "Data (ISO)" },
  ], body_template: null },
  // --- TEAM ---
  { name: "lista_owner", label: "Lista Utenti Team", description: "Recupera gli utenti/owner del CRM", method: "GET", path: "/crm/v3/owners", enabled: true, category: "Team", params: [
    { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
  ], body_template: null },
  // --- ASSOCIAZIONI ---
  { name: "associa_contatto_deal", label: "Associa Contatto a Deal", description: "Collega un contatto a un deal", method: "PUT", path: "/crm/v3/objects/contacts/{contactId}/associations/deals/{dealId}/3", enabled: true, category: "Associazioni", params: [
    { name: "contactId", type: "string", required: true, in: "path", description: "ID del contatto" },
    { name: "dealId", type: "string", required: true, in: "path", description: "ID del deal" },
  ], body_template: null },
  { name: "associa_contatto_azienda", label: "Associa Contatto a Azienda", description: "Collega un contatto a un'azienda", method: "PUT", path: "/crm/v3/objects/contacts/{contactId}/associations/companies/{companyHubId}/1", enabled: true, category: "Associazioni", params: [
    { name: "contactId", type: "string", required: true, in: "path", description: "ID del contatto" },
    { name: "companyHubId", type: "string", required: true, in: "path", description: "ID dell'azienda HubSpot" },
  ], body_template: null },
  // --- RICERCA GLOBALE ---
  { name: "ricerca_globale", label: "Ricerca Globale", description: "Cerca contatti, deal o aziende per testo libero", method: "POST", path: "/crm/v3/objects/contacts/search", enabled: true, category: "Ricerca", params: [
    { name: "query", type: "string", required: true, in: "body", description: "Testo da cercare" },
  ], body_template: null },
];

// Temporary state store for OAuth flow
const oauthStates = new Map<string, { companyId: string; userId: string; prefix: string; expiresAt: number }>();
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
    const prefix = (req.query.prefix as string) || "";
    oauthStates.set(state, { companyId, userId: actor.userId, prefix, expiresAt: Date.now() + 600000 });

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
      const prefix = stateData.prefix;
      res.redirect(prefix ? "/" + prefix + "/plugins?hubspot_connected=true" : "/?hubspot_connected=true");
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
      // Terminate agents that use this connector
      const connAcct = await db.select({ id: connectorAccounts.id }).from(connectorAccounts)
        .where(and(eq(connectorAccounts.companyId, companyId), eq(connectorAccounts.connectorType, "custom_hubspot")))
        .then(r => r[0]);
      if (connAcct) {
        const linkedAgents = await db.select({ agentId: agentConnectorAccounts.agentId }).from(agentConnectorAccounts)
          .where(eq(agentConnectorAccounts.connectorAccountId, connAcct.id));
        if (linkedAgents.length > 0) {
          await db.update(agents).set({ status: "terminated" })
            .where(inArray(agents.id, linkedAgents.map(a => a.agentId)));
        }
      }

      await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, `custom_api_${connector.id}`)));
      await removeConnectorAccount(db, companyId, "custom_hubspot");
      await db.delete(customConnectors).where(eq(customConnectors.id, connector.id));
    }

    res.json({ disconnected: true });
  });

  return router;
}
