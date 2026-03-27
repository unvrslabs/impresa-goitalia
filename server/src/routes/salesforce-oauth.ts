import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, customConnectors, agents, agentConnectorAccounts, connectorAccounts } from "@goitalia/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";

const SF_CLIENT_ID = process.env.SALESFORCE_CLIENT_ID || "";
const SF_CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET || "";
const BASE_URL = process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu";
const REDIRECT_URI = BASE_URL + "/api/oauth/salesforce/callback";

// Salesforce CRM actions
const SALESFORCE_ACTIONS = [
  // --- CONTATTI ---
  { name: "lista_contatti", label: "Lista Contatti", description: "Recupera i contatti da Salesforce", method: "GET", path: "/services/data/v62.0/query", enabled: true, category: "Contatti", params: [
    { name: "q", type: "string", required: true, in: "query", description: "Query SOQL (es: SELECT Id,FirstName,LastName,Email,Phone FROM Contact ORDER BY LastModifiedDate DESC LIMIT 100)" },
  ], body_template: null },
  { name: "cerca_contatto", label: "Cerca Contatto", description: "Cerca contatto per email o nome (SOQL WHERE)", method: "GET", path: "/services/data/v62.0/query", enabled: true, category: "Contatti", params: [
    { name: "q", type: "string", required: true, in: "query", description: "Query SOQL con WHERE (es: SELECT Id,FirstName,LastName,Email FROM Contact WHERE Email='mario@example.com')" },
  ], body_template: null },
  { name: "dettaglio_contatto", label: "Dettaglio Contatto", description: "Recupera tutti i dati di un contatto", method: "GET", path: "/services/data/v62.0/sobjects/Contact/{contactId}", enabled: true, category: "Contatti", params: [
    { name: "contactId", type: "string", required: true, in: "path", description: "ID del contatto Salesforce" },
  ], body_template: null },
  { name: "crea_contatto", label: "Crea Contatto", description: "Crea un nuovo contatto", method: "POST", path: "/services/data/v62.0/sobjects/Contact", enabled: true, category: "Contatti", params: [
    { name: "FirstName", type: "string", required: false, in: "body", description: "Nome" },
    { name: "LastName", type: "string", required: true, in: "body", description: "Cognome" },
    { name: "Email", type: "string", required: false, in: "body", description: "Email" },
    { name: "Phone", type: "string", required: false, in: "body", description: "Telefono" },
  ], body_template: null },
  { name: "aggiorna_contatto", label: "Aggiorna Contatto", description: "Modifica i dati di un contatto", method: "PATCH", path: "/services/data/v62.0/sobjects/Contact/{contactId}", enabled: true, category: "Contatti", params: [
    { name: "contactId", type: "string", required: true, in: "path", description: "ID del contatto" },
    { name: "FirstName", type: "string", required: false, in: "body", description: "Nome" },
    { name: "LastName", type: "string", required: false, in: "body", description: "Cognome" },
    { name: "Email", type: "string", required: false, in: "body", description: "Email" },
    { name: "Phone", type: "string", required: false, in: "body", description: "Telefono" },
  ], body_template: null },
  { name: "elimina_contatto", label: "Elimina Contatto", description: "Elimina un contatto", method: "DELETE", path: "/services/data/v62.0/sobjects/Contact/{contactId}", enabled: false, category: "Contatti", params: [
    { name: "contactId", type: "string", required: true, in: "path", description: "ID del contatto" },
  ], body_template: null },
  // --- OPPORTUNITÀ ---
  { name: "lista_opportunita", label: "Lista Opportunità", description: "Recupera le opportunità", method: "GET", path: "/services/data/v62.0/query", enabled: true, category: "Opportunità", params: [
    { name: "q", type: "string", required: true, in: "query", description: "Query SOQL (es: SELECT Id,Name,Amount,StageName,CloseDate FROM Opportunity ORDER BY CloseDate DESC LIMIT 100)" },
  ], body_template: null },
  { name: "crea_opportunita", label: "Crea Opportunità", description: "Crea una nuova opportunità", method: "POST", path: "/services/data/v62.0/sobjects/Opportunity", enabled: true, category: "Opportunità", params: [
    { name: "Name", type: "string", required: true, in: "body", description: "Nome opportunità" },
    { name: "Amount", type: "number", required: false, in: "body", description: "Importo" },
    { name: "StageName", type: "string", required: true, in: "body", description: "Fase (Prospecting, Qualification, Closed Won, Closed Lost)" },
    { name: "CloseDate", type: "string", required: true, in: "body", description: "Data chiusura (YYYY-MM-DD)" },
  ], body_template: null },
  { name: "aggiorna_opportunita", label: "Aggiorna Opportunità", description: "Modifica un'opportunità", method: "PATCH", path: "/services/data/v62.0/sobjects/Opportunity/{opportunityId}", enabled: true, category: "Opportunità", params: [
    { name: "opportunityId", type: "string", required: true, in: "path", description: "ID dell'opportunità" },
    { name: "Name", type: "string", required: false, in: "body", description: "Nome" },
    { name: "Amount", type: "number", required: false, in: "body", description: "Importo" },
    { name: "StageName", type: "string", required: false, in: "body", description: "Fase" },
  ], body_template: null },
  { name: "elimina_opportunita", label: "Elimina Opportunità", description: "Elimina un'opportunità", method: "DELETE", path: "/services/data/v62.0/sobjects/Opportunity/{opportunityId}", enabled: false, category: "Opportunità", params: [
    { name: "opportunityId", type: "string", required: true, in: "path", description: "ID dell'opportunità" },
  ], body_template: null },
  // --- ACCOUNT ---
  { name: "lista_account", label: "Lista Account", description: "Recupera gli account/aziende", method: "GET", path: "/services/data/v62.0/query", enabled: true, category: "Account", params: [
    { name: "q", type: "string", required: true, in: "query", description: "Query SOQL (es: SELECT Id,Name,Industry,Phone,Website FROM Account ORDER BY Name LIMIT 100)" },
  ], body_template: null },
  { name: "crea_account", label: "Crea Account", description: "Crea un nuovo account/azienda", method: "POST", path: "/services/data/v62.0/sobjects/Account", enabled: true, category: "Account", params: [
    { name: "Name", type: "string", required: true, in: "body", description: "Nome azienda" },
    { name: "Industry", type: "string", required: false, in: "body", description: "Settore" },
    { name: "Phone", type: "string", required: false, in: "body", description: "Telefono" },
    { name: "Website", type: "string", required: false, in: "body", description: "Sito web" },
  ], body_template: null },
  { name: "aggiorna_account", label: "Aggiorna Account", description: "Modifica un account", method: "PATCH", path: "/services/data/v62.0/sobjects/Account/{accountId}", enabled: true, category: "Account", params: [
    { name: "accountId", type: "string", required: true, in: "path", description: "ID dell'account" },
    { name: "Name", type: "string", required: false, in: "body", description: "Nome" },
    { name: "Phone", type: "string", required: false, in: "body", description: "Telefono" },
    { name: "Website", type: "string", required: false, in: "body", description: "Sito web" },
  ], body_template: null },
  // --- TASK ---
  { name: "lista_task", label: "Lista Task", description: "Recupera i task/attività", method: "GET", path: "/services/data/v62.0/query", enabled: true, category: "Task", params: [
    { name: "q", type: "string", required: true, in: "query", description: "Query SOQL (es: SELECT Id,Subject,Status,Priority,ActivityDate FROM Task ORDER BY ActivityDate DESC LIMIT 100)" },
  ], body_template: null },
  { name: "crea_task", label: "Crea Task", description: "Crea un nuovo task", method: "POST", path: "/services/data/v62.0/sobjects/Task", enabled: true, category: "Task", params: [
    { name: "Subject", type: "string", required: true, in: "body", description: "Oggetto" },
    { name: "Status", type: "string", required: false, in: "body", description: "Stato (Not Started, In Progress, Completed)" },
    { name: "Priority", type: "string", required: false, in: "body", description: "Priorità (High, Normal, Low)" },
    { name: "ActivityDate", type: "string", required: false, in: "body", description: "Data (YYYY-MM-DD)" },
    { name: "Description", type: "string", required: false, in: "body", description: "Descrizione" },
  ], body_template: null },
  // --- RICERCA ---
  { name: "ricerca_globale", label: "Ricerca Globale", description: "Cerca in tutti gli oggetti (SOSL)", method: "GET", path: "/services/data/v62.0/search", enabled: true, category: "Ricerca", params: [
    { name: "q", type: "string", required: true, in: "query", description: "Query SOSL (es: FIND {Mario} IN ALL FIELDS RETURNING Contact(Id,FirstName,LastName,Email))" },
  ], body_template: null },
];

// State store for OAuth
const oauthStates = new Map<string, { companyId: string; userId: string; prefix: string; expiresAt: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of oauthStates) { if (v.expiresAt < now) oauthStates.delete(k); } }, 300000);

export function salesforceOAuthRoutes(db: Db) {
  const router = Router();

  // GET /oauth/salesforce/status
  router.get("/oauth/salesforce/status", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ connected: false }); return; }
    const connector = await db.select({ id: customConnectors.id }).from(customConnectors)
      .where(and(eq(customConnectors.companyId, companyId), eq(customConnectors.slug, "salesforce")))
      .then(r => r[0]);
    res.json({ connected: !!connector });
  });

  // GET /oauth/salesforce/connect
  router.get("/oauth/salesforce/connect", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const state = crypto.randomBytes(32).toString("hex");
    const prefix = (req.query.prefix as string) || "";
    oauthStates.set(state, { companyId, userId: actor.userId, prefix, expiresAt: Date.now() + 600000 });

    const authUrl = new URL("https://login.salesforce.com/services/oauth2/authorize");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", SF_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("scope", "api refresh_token");

    res.redirect(authUrl.toString());
  });

  // GET /oauth/salesforce/callback
  router.get("/oauth/salesforce/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) { res.redirect("/plugins?error=salesforce_oauth_denied"); return; }
    if (!code || !state) { res.redirect("/plugins?error=salesforce_oauth_invalid"); return; }

    const stateData = oauthStates.get(state);
    oauthStates.delete(state);
    if (!stateData || stateData.expiresAt < Date.now()) { res.redirect("/plugins?error=salesforce_oauth_expired"); return; }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch("https://login.salesforce.com/services/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: SF_CLIENT_ID,
          client_secret: SF_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          code,
        }),
      });

      if (!tokenRes.ok) {
        console.error("[salesforce-oauth] Token exchange failed:", await tokenRes.text());
        res.redirect("/plugins?error=salesforce_oauth_token_failed");
        return;
      }

      const tokens = await tokenRes.json() as {
        access_token: string;
        refresh_token?: string;
        instance_url: string;
        id: string;
      };

      // instance_url is the base URL for API calls (e.g. https://mycompany.my.salesforce.com)
      const instanceUrl = tokens.instance_url;

      // Get user info
      const userRes = await fetch(tokens.id, { headers: { Authorization: "Bearer " + tokens.access_token } });
      const userInfo = await userRes.json() as { display_name?: string; username?: string; organization_id?: string };
      const sfName = userInfo.display_name || userInfo.username || "Salesforce";

      // Check existing
      const existing = await db.select().from(customConnectors)
        .where(and(eq(customConnectors.companyId, stateData.companyId), eq(customConnectors.slug, "salesforce")))
        .then(r => r[0]);

      if (existing) {
        // Update token + instance URL
        await db.update(customConnectors).set({ baseUrl: instanceUrl, updatedAt: new Date() })
          .where(eq(customConnectors.id, existing.id));
        await db.update(companySecrets)
          .set({ description: encrypt(JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, instance_url: instanceUrl })), updatedAt: new Date() })
          .where(and(eq(companySecrets.companyId, stateData.companyId), eq(companySecrets.name, `custom_api_${existing.id}`)));
      } else {
        const [row] = await db.insert(customConnectors).values({
          companyId: stateData.companyId,
          name: "Salesforce CRM",
          slug: "salesforce",
          baseUrl: instanceUrl,
          authType: "bearer", authHeader: "Authorization", authPrefix: "Bearer",
          description: `Salesforce CRM (${sfName}) — contatti, account, opportunità, task`,
          actions: SALESFORCE_ACTIONS,
        }).returning();

        await db.insert(companySecrets).values({
          id: crypto.randomUUID(),
          companyId: stateData.companyId,
          name: `custom_api_${row.id}`,
          provider: "encrypted",
          description: encrypt(JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            instance_url: instanceUrl,
          })),
        });

        await upsertConnectorAccount(db, stateData.companyId, "custom_salesforce", row.id, "Salesforce CRM");
      }

      console.info("[salesforce-oauth] Connected:", sfName, "instance:", instanceUrl);
      const prefix = stateData.prefix;
      res.redirect(prefix ? "/" + prefix + "/plugins?salesforce_connected=true" : "/?salesforce_connected=true");
    } catch (err) {
      console.error("[salesforce-oauth] Callback error:", err);
      res.redirect("/plugins?error=salesforce_oauth_error");
    }
  });

  // POST /oauth/salesforce/disconnect
  router.post("/oauth/salesforce/disconnect", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId } = req.body;
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.companyId, companyId), eq(customConnectors.slug, "salesforce")))
      .then(r => r[0]);

    if (connector) {
      // Terminate linked agents
      const connAcct = await db.select({ id: connectorAccounts.id }).from(connectorAccounts)
        .where(and(eq(connectorAccounts.companyId, companyId), eq(connectorAccounts.connectorType, "custom_salesforce")))
        .then(r => r[0]);
      if (connAcct) {
        const linked = await db.select({ agentId: agentConnectorAccounts.agentId }).from(agentConnectorAccounts)
          .where(eq(agentConnectorAccounts.connectorAccountId, connAcct.id));
        if (linked.length > 0) {
          await db.update(agents).set({ status: "terminated" })
            .where(inArray(agents.id, linked.map(a => a.agentId)));
        }
      }

      await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, `custom_api_${connector.id}`)));
      await removeConnectorAccount(db, companyId, "custom_salesforce");
      await db.delete(customConnectors).where(eq(customConnectors.id, connector.id));
    }

    res.json({ disconnected: true });
  });

  return router;
}
