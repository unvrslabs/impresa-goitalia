import express, { Router, type Request as ExpressRequest } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "@goitalia/db";
import { companySecrets, agents, connectorAccounts as caTableImport, companyProfiles } from "@goitalia/db";
import type { DeploymentExposure, DeploymentMode } from "@goitalia/shared";
import type { StorageService } from "./storage/types.js";
import { httpLogger, errorHandler } from "./middleware/index.js";
import { actorMiddleware } from "./middleware/auth.js";
import { boardMutationGuard } from "./middleware/board-mutation-guard.js";
import { privateHostnameGuard, resolvePrivateHostnameAllowSet } from "./middleware/private-hostname-guard.js";
import { healthRoutes } from "./routes/health.js";
import { companyRoutes } from "./routes/companies.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { chatRoutes, getCeoPromptBase } from "./routes/chat.js";
import { googleOAuthRoutes } from "./routes/google-oauth.js";
import { gmailRoutes } from "./routes/gmail.js";
import { calendarRoutes } from "./routes/calendar.js";
import { driveRoutes } from "./routes/drive.js";
import { telegramRoutes, telegramWebhookRouter as telegramWebhookRouterFn } from "./routes/telegram.js";
import { fattureincloudRoutes } from "./routes/fattureincloud.js";
import { falAiRoutes } from "./routes/fal-ai.js";
import { sql, eq, and, ne } from "drizzle-orm";
import { openapiItRoutes } from "./routes/openapi-it.js";
import { projectsPmiRoutes } from "./routes/projects-pmi.js";
import { whatsappRoutes, whatsappWebhookRouter } from "./routes/whatsapp.js";
import { voiceRoutes } from "./routes/voice.js";
import { metaRoutes } from "./routes/meta.js";
import { linkedinRoutes } from "./routes/linkedin.js";
import { pecRoutes } from "./routes/pec.js";
import { billingRoutes, billingWebhookRouter } from "./routes/billing.js";
import { stripeConnectorRoutes } from "./routes/stripe-connector.js";
import { projectFilesRoutes } from "./routes/project-files.js";
import { whatsappContactsRoutes } from "./routes/whatsapp-contacts.js";
import { socialRoutes } from "./routes/social.js";
import { a2aRoutes } from "./routes/a2a.js";
import { companyProductRoutes } from "./routes/company-products.js";
import { connectorAccountRoutes } from "./routes/connector-accounts.js";
import { companySkillRoutes } from "./routes/company-skills.js";
import { agentRoutes } from "./routes/agents.js";
import { projectRoutes } from "./routes/projects.js";
import { issueRoutes } from "./routes/issues.js";
import { routineRoutes } from "./routes/routines.js";
import { executionWorkspaceRoutes } from "./routes/execution-workspaces.js";
import { goalRoutes } from "./routes/goals.js";
import { approvalRoutes } from "./routes/approvals.js";
import { secretRoutes } from "./routes/secrets.js";
import { costRoutes } from "./routes/costs.js";
import { activityRoutes } from "./routes/activity.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { sidebarBadgeRoutes } from "./routes/sidebar-badges.js";
import { instanceSettingsRoutes } from "./routes/instance-settings.js";
import { llmRoutes } from "./routes/llms.js";
import { assetRoutes } from "./routes/assets.js";
import { accessRoutes } from "./routes/access.js";
import { pluginRoutes } from "./routes/plugins.js";
import { pluginUiStaticRoutes } from "./routes/plugin-ui-static.js";
import { applyUiBranding } from "./ui-branding.js";
import { logger } from "./middleware/logger.js";
import { DEFAULT_LOCAL_PLUGIN_DIR, pluginLoader } from "./services/plugin-loader.js";
import { createPluginWorkerManager } from "./services/plugin-worker-manager.js";
import { createPluginJobScheduler } from "./services/plugin-job-scheduler.js";
import { pluginJobStore } from "./services/plugin-job-store.js";
import { createPluginToolDispatcher } from "./services/plugin-tool-dispatcher.js";
import { pluginLifecycleManager } from "./services/plugin-lifecycle.js";
import { createPluginJobCoordinator } from "./services/plugin-job-coordinator.js";
import { buildHostServices, flushPluginLogBuffer } from "./services/plugin-host-services.js";
import { createPluginEventBus } from "./services/plugin-event-bus.js";
import { setPluginEventBus } from "./services/activity-log.js";
import { createPluginDevWatcher } from "./services/plugin-dev-watcher.js";
import { createPluginHostServiceCleanup } from "./services/plugin-host-service-cleanup.js";
import { pluginRegistryService } from "./services/plugin-registry.js";
import { createHostClientHandlers } from "@goitalia/plugin-sdk";
import type { BetterAuthSessionResult } from "./auth/better-auth.js";

type UiMode = "none" | "static" | "vite-dev";

export function resolveViteHmrPort(serverPort: number): number {
  if (serverPort <= 55_535) {
    return serverPort + 10_000;
  }
  return Math.max(1_024, serverPort - 10_000);
}

// Prevent unhandled promise rejections from crashing the server
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});

export async function createApp(
  db: Db,
  opts: {
    uiMode: UiMode;
    serverPort: number;
    storageService: StorageService;
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    allowedHostnames: string[];
    bindHost: string;
    authReady: boolean;
    companyDeletionEnabled: boolean;
    instanceId?: string;
    hostVersion?: string;
    localPluginDir?: string;
    betterAuthHandler?: express.RequestHandler;
    resolveSession?: (req: ExpressRequest) => Promise<BetterAuthSessionResult | null>;
  },
) {
  const app = express();

  
  // CORS configuration
  const allowedOrigins = [
    "https://impresa.goitalia.eu",
    "http://localhost:3100",
    "http://localhost:3102",
  ];
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With");
    }
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });

app.use(express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }));
  app.use(httpLogger);
  const privateHostnameGateEnabled =
    opts.deploymentMode === "authenticated" && opts.deploymentExposure === "private";
  const privateHostnameAllowSet = resolvePrivateHostnameAllowSet({
    allowedHostnames: opts.allowedHostnames,
    bindHost: opts.bindHost,
  });
  app.use(
    privateHostnameGuard({
      enabled: privateHostnameGateEnabled,
      allowedHostnames: opts.allowedHostnames,
      bindHost: opts.bindHost,
    }),
  );
  // Telegram webhooks on separate path (avoids all /api middleware)
  app.use("/tg-hook", telegramWebhookRouterFn(db));
  app.use("/wa-hook", whatsappWebhookRouter(db));
  // Stripe webhook (raw body needed — registered before JSON middleware would interfere)
  app.use("/api", billingWebhookRouter(db));

  // Serve WhatsApp and Telegram media files
  app.use("/api/tg-media", (await import("express")).default.static("data/tg-media", { maxAge: "1d" }));
  app.use("/api/wa-media", (await import("express")).default.static("data/wa-media", { maxAge: "1d" }));

  app.use(
    actorMiddleware(db, {
      deploymentMode: opts.deploymentMode,
      resolveSession: opts.resolveSession,
    }),
  );
  app.get("/api/auth/get-session", (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json({
      session: {
        id: `paperclip:${req.actor.source}:${req.actor.userId}`,
        userId: req.actor.userId,
      },
      user: {
        id: req.actor.userId,
        email: null,
        name: req.actor.source === "local_implicit" ? "Local Board" : null,
      },
    });
  });
  if (opts.betterAuthHandler) {
    app.all("/api/auth/*authPath", opts.betterAuthHandler);
  }
  app.use(llmRoutes(db));



  // Mount API routes
  const api = Router();
  api.use(boardMutationGuard());
  api.use(
    "/health",
    healthRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      companyDeletionEnabled: opts.companyDeletionEnabled,
    }),
  );
  api.use("/onboarding", onboardingRoutes(db, opts.serverPort));
  api.use(chatRoutes(db));
  api.get("/ceo-prompt-base", (_req, res) => { res.json({ prompt: getCeoPromptBase() }); });
  api.use(googleOAuthRoutes(db));
  api.use(gmailRoutes(db));
  api.use(calendarRoutes(db));
  api.use(driveRoutes(db));
  api.use(telegramRoutes(db));
  api.use(fattureincloudRoutes(db));
  api.use(falAiRoutes(db));
  api.use(connectorAccountRoutes(db));

  // Company profile (company_profiles table)
  // Mapping: DB camelCase field → UI snake_case key
  const profileFieldMap: Record<string, keyof typeof companyProfiles.$inferSelect> = {
    ragione_sociale: "ragioneSociale", partita_iva: "partitaIva", codice_fiscale: "codiceFiscale",
    forma_giuridica: "formaGiuridica", stato_attivita: "statoAttivita", data_inizio: "dataInizio",
    settore: "settore", indirizzo: "indirizzo", citta: "citta", cap: "cap",
    provincia: "provincia", regione: "regione", telefono: "telefono", email: "email",
    whatsapp: "whatsapp", pec: "pec", codice_sdi: "codiceSdi", sito_web: "sitoWeb",
    dipendenti: "dipendenti", fatturato: "fatturato", patrimonio_netto: "patrimonioNetto",
    capitale_sociale: "capitaleSociale", totale_attivo: "totaleAttivo",
    risk_score: "riskScore", rating: "rating", risk_severity: "riskSeverity",
    credit_limit: "creditLimit", soci: "soci", note: "note",
    orari_apertura: "orariApertura", giorno_chiusura: "giornoChiusura", note_orari: "noteOrari",
  };

  api.get("/company-profile", async (req, res) => {
    const actor = req.actor as any;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ profile: {} }); return; }
    try {
      const row = await db.select().from(companyProfiles)
        .where(eq(companyProfiles.companyId, companyId))
        .then((r) => r[0]);
      if (!row) { res.json({ profile: {} }); return; }
      // Convert camelCase DB fields → snake_case UI keys
      const profile: Record<string, string> = {};
      for (const [uiKey, dbField] of Object.entries(profileFieldMap)) {
        const val = (row as any)[dbField];
        if (val != null && val !== "") profile[uiKey] = String(val);
      }
      res.json({ profile });
    } catch { res.json({ profile: {} }); }
  });

  api.post("/company-profile", async (req, res) => {
    const actor = req.actor as any;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, profile } = req.body;
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    try {
      // Convert snake_case UI keys → camelCase DB fields
      const dbData: Record<string, unknown> = { updatedAt: new Date() };
      for (const [uiKey, dbField] of Object.entries(profileFieldMap)) {
        if (profile[uiKey] !== undefined) {
          dbData[dbField] = profile[uiKey] || null;
        }
      }
      const existing = await db.select({ id: companyProfiles.id }).from(companyProfiles)
        .where(eq(companyProfiles.companyId, companyId))
        .then((r) => r[0]);
      if (existing) {
        await db.update(companyProfiles).set(dbData).where(eq(companyProfiles.companyId, companyId));
      } else {
        await db.insert(companyProfiles).values({ companyId, ...dbData } as any);
      }
      res.json({ saved: true });
    } catch (err) {
      console.error("Profile save error:", err);
      res.status(500).json({ error: "Errore salvataggio" });
    }
  });

  api.use(openapiItRoutes(db));
  api.use(projectsPmiRoutes(db));
  api.use(whatsappRoutes(db));
  api.use(voiceRoutes(db));
  api.use(metaRoutes(db));
  api.use(linkedinRoutes(db));
  api.use(pecRoutes(db));
  api.use(stripeConnectorRoutes(db));
  api.use(projectFilesRoutes(db));
  api.use(whatsappContactsRoutes(db));
  api.use(billingRoutes(db));
  api.use(socialRoutes(db));
  api.use(a2aRoutes(db));
  api.use(companyProductRoutes(db));
  api.use("/companies", companyRoutes(db, opts.storageService));
  api.use(companySkillRoutes(db));
  api.use(agentRoutes(db));
  api.use(assetRoutes(db, opts.storageService));
  api.use(projectRoutes(db));
  api.use(issueRoutes(db, opts.storageService));
  api.use(routineRoutes(db));
  api.use(executionWorkspaceRoutes(db));
  api.use(goalRoutes(db));
  api.use(approvalRoutes(db));
  api.use(secretRoutes(db));
  api.use(costRoutes(db));
  api.use(activityRoutes(db));
  api.use(dashboardRoutes(db));
  api.use(sidebarBadgeRoutes(db));
  api.use(instanceSettingsRoutes(db));

  // --- Scheduled Activities: approve/reject/pending endpoints ---
  api.get("/routines/pending", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const { routineRuns: rr, routines: rt, agents: ag } = await import("@goitalia/db");
    const pending = await db.select({
      runId: rr.id,
      routineId: rr.routineId,
      routineTitle: rt.title,
      agentName: ag.name,
      result: rr.triggerPayload,
      triggeredAt: rr.triggeredAt,
    }).from(rr)
      .innerJoin(rt, eq(rr.routineId, rt.id))
      .leftJoin(ag, eq(rt.assigneeAgentId, ag.id))
      .where(and(eq(rr.companyId, companyId), eq(rr.status, "pending_approval")));
    res.json(pending);
  });

  api.post("/routines/:routineId/runs/:runId/approve", async (req, res) => {
    const { runId, routineId } = req.params;
    const { routineRuns: rr, routines: rt } = await import("@goitalia/db");
    const run = await db.select().from(rr)
      .where(and(eq(rr.id, runId), eq(rr.routineId, routineId)))
      .then(r => r[0]);
    if (!run) { res.status(404).json({ error: "Run non trovata" }); return; }
    if (run.status !== "pending_approval") { res.status(400).json({ error: "Non in attesa di approvazione" }); return; }

    // Mark as completed (the draft was already generated, approval means it's accepted)
    await db.update(rr).set({
      status: "completed",
      completedAt: new Date(),
    }).where(eq(rr.id, runId));
    res.json({ ok: true });
  });

  api.post("/routines/:routineId/runs/:runId/reject", async (req, res) => {
    const { runId } = req.params;
    const { routineRuns: rr } = await import("@goitalia/db");
    await db.update(rr).set({
      status: "failed",
      failureReason: "Rifiutata dall'utente",
      completedAt: new Date(),
    }).where(eq(rr.id, runId));
    res.json({ ok: true });
  });

  // One-shot migration: populate connector_accounts from company_secrets
  api.post("/migrate-connectors", async (req, res) => {
    const { decrypt: dec } = await import("./utils/crypto.js");
    const { upsertConnectorAccount } = await import("./utils/connector-sync.js");
    const { agentConnectorAccounts: acaTable } = await import("@goitalia/db");

    const allSecrets = await db.select().from(companySecrets);
    let created = 0;
    const errors: string[] = [];

    for (const secret of allSecrets) {
      if (!secret.description) continue;
      try {
        const raw = dec(secret.description);
        const cid = secret.companyId;

        if (secret.name === "google_oauth_tokens") {
          const arr = JSON.parse(raw);
          for (const a of (Array.isArray(arr) ? arr : [])) {
            if (a.email) { await upsertConnectorAccount(db, cid, "google", a.email, a.email); created++; }
          }
        } else if (secret.name === "telegram_bots") {
          const arr = JSON.parse(raw);
          for (const b of (Array.isArray(arr) ? arr : [])) {
            if (b.username) { await upsertConnectorAccount(db, cid, "telegram", b.username, b.name || b.username); created++; }
          }
        } else if (secret.name === "whatsapp_sessions") {
          const arr = JSON.parse(raw);
          for (const s of (Array.isArray(arr) ? arr : [])) {
            if (s.phoneNumber) { await upsertConnectorAccount(db, cid, "whatsapp", s.phoneNumber, s.phoneNumber); created++; }
          }
        } else if (secret.name === "meta_tokens") {
          const obj = JSON.parse(raw);
          for (const ig of (obj.instagram || [])) {
            if (ig.username) { await upsertConnectorAccount(db, cid, "meta_ig", ig.username, ig.username); created++; }
          }
          for (const fb of (obj.pages || [])) {
            if (fb.id) { await upsertConnectorAccount(db, cid, "meta_fb", String(fb.id), fb.name || String(fb.id)); created++; }
          }
        } else if (secret.name === "linkedin_tokens") {
          const arr = JSON.parse(raw);
          for (const a of (Array.isArray(arr) ? arr : [])) {
            if (a.email) { await upsertConnectorAccount(db, cid, "linkedin", a.email, a.name || a.email); created++; }
          }
        } else if (secret.name === "fal_api_key") {
          await upsertConnectorAccount(db, cid, "fal", "default", "Fal.ai"); created++;
        } else if (secret.name === "fattureincloud_tokens") {
          const obj = JSON.parse(raw);
          await upsertConnectorAccount(db, cid, "fic", obj.fic_company_id || "default", obj.company_name || "Fatture in Cloud"); created++;
        } else if (secret.name === "openapi_it_creds") {
          const obj = JSON.parse(raw);
          await upsertConnectorAccount(db, cid, "openapi", "default", obj.email || "OpenAPI.it"); created++;
        } else if (secret.name === "openai_api_key") {
          await upsertConnectorAccount(db, cid, "voice", "default", "Vocali AI"); created++;
        } else if (secret.name === "stripe_api_key") {
          await upsertConnectorAccount(db, cid, "stripe", "default", "Account Stripe"); created++;
        }
      } catch (e) {
        errors.push(`${secret.name}/${secret.companyId}: ${(e as Error).message}`);
      }
    }

    // Step 2: migrate agent_connector_accounts from adapterConfig.connectors
    let linked = 0;
    const allAgents = await db.select().from(agents).where(ne(agents.status, "terminated"));
    for (const agent of allAgents) {
      const config = agent.adapterConfig as Record<string, unknown> | null;
      const connectors = (config?.connectors as Record<string, boolean>) || {};
      for (const [key, val] of Object.entries(connectors)) {
        if (val !== true) continue;
        // Map key to connector_type + account_id
        let connType = "";
        let accountId = "";
        if (["gmail", "calendar", "drive", "sheets", "docs"].includes(key)) {
          connType = "google";
        } else if (key.startsWith("tg_")) {
          connType = "telegram"; accountId = key.slice(3);
        } else if (key === "whatsapp") {
          connType = "whatsapp";
        } else if (key.startsWith("ig_")) {
          connType = "meta_ig"; accountId = key.slice(3);
        } else if (key.startsWith("fb_")) {
          connType = "meta_fb"; accountId = key.slice(3);
        } else if (key === "meta") {
          connType = "meta_ig";
        } else if (key === "linkedin") {
          connType = "linkedin";
        } else if (key === "fal") {
          connType = "fal"; accountId = "default";
        } else if (key === "fic") {
          connType = "fic";
        } else if (["oai_company", "oai_risk", "oai_cap", "oai_sdi"].includes(key)) {
          connType = "openapi"; accountId = "default";
        } else if (key === "voice") {
          connType = "voice"; accountId = "default";
        }

        if (!connType) continue;

        // Find matching connector_account
        const conditions = [
          eq(caTableImport.companyId, agent.companyId),
          eq(caTableImport.connectorType, connType),
        ];
        if (accountId) conditions.push(eq(caTableImport.accountId, accountId));

        const ca = await db.select().from(caTableImport).where(and(...conditions)).then(r => r[0]);
        if (ca) {
          try {
            await db.insert(acaTable).values({ agentId: agent.id, connectorAccountId: ca.id }).onConflictDoNothing();
            linked++;
          } catch {}
        }
      }
    }

    res.json({ created, linked, errors });
  });

  const hostServicesDisposers = new Map<string, () => void>();
  const workerManager = createPluginWorkerManager();
  const pluginRegistry = pluginRegistryService(db);
  const eventBus = createPluginEventBus();
  setPluginEventBus(eventBus);
  const jobStore = pluginJobStore(db);
  const lifecycle = pluginLifecycleManager(db, { workerManager });
  const scheduler = createPluginJobScheduler({
    db,
    jobStore,
    workerManager,
  });
  const toolDispatcher = createPluginToolDispatcher({
    workerManager,
    lifecycleManager: lifecycle,
    db,
  });
  const jobCoordinator = createPluginJobCoordinator({
    db,
    lifecycle,
    scheduler,
    jobStore,
  });
  const hostServiceCleanup = createPluginHostServiceCleanup(lifecycle, hostServicesDisposers);
  const loader = pluginLoader(
    db,
    { localPluginDir: opts.localPluginDir ?? DEFAULT_LOCAL_PLUGIN_DIR },
    {
      workerManager,
      eventBus,
      jobScheduler: scheduler,
      jobStore,
      toolDispatcher,
      lifecycleManager: lifecycle,
      instanceInfo: {
        instanceId: opts.instanceId ?? "default",
        hostVersion: opts.hostVersion ?? "0.0.0",
      },
      buildHostHandlers: (pluginId, manifest) => {
        const notifyWorker = (method: string, params: unknown) => {
          const handle = workerManager.getWorker(pluginId);
          if (handle) handle.notify(method, params);
        };
        const services = buildHostServices(db, pluginId, manifest.id, eventBus, notifyWorker);
        hostServicesDisposers.set(pluginId, () => services.dispose());
        return createHostClientHandlers({
          pluginId,
          capabilities: manifest.capabilities,
          services,
        });
      },
    },
  );
  api.use(
    pluginRoutes(
      db,
      loader,
      { scheduler, jobStore },
      { workerManager },
      { toolDispatcher },
      { workerManager },
    ),
  );
  api.use(
    accessRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      bindHost: opts.bindHost,
      allowedHostnames: opts.allowedHostnames,
    }),
  );
  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });
  app.use(pluginUiStaticRoutes(db, {
    localPluginDir: opts.localPluginDir ?? DEFAULT_LOCAL_PLUGIN_DIR,
  }));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  if (opts.uiMode === "static") {
    // Try published location first (server/ui-dist/), then monorepo dev location (../../ui/dist)
    const candidates = [
      path.resolve(__dirname, "../ui-dist"),
      path.resolve(__dirname, "../../ui/dist"),
    ];
    const uiDist = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
    if (uiDist) {
      const indexHtml = applyUiBranding(fs.readFileSync(path.join(uiDist, "index.html"), "utf-8"));
      app.use(express.static(uiDist, { maxAge: "1h", setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      }}));
      app.get(/.*/, (_req, res) => {
        res.status(200).set("Content-Type", "text/html").set("Cache-Control", "no-cache, no-store, must-revalidate").end(indexHtml);
      });
    } else {
      console.warn("[paperclip] UI dist not found; running in API-only mode");
    }
  }

  if (opts.uiMode === "vite-dev") {
    const uiRoot = path.resolve(__dirname, "../../ui");
    const hmrPort = resolveViteHmrPort(opts.serverPort);
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: uiRoot,
      appType: "custom",
      server: {
        middlewareMode: true,
        hmr: {
          host: opts.bindHost,
          port: hmrPort,
          clientPort: hmrPort,
        },
        allowedHosts: privateHostnameGateEnabled ? Array.from(privateHostnameAllowSet) : undefined,
      },
    });

    app.use(vite.middlewares);
    app.get(/.*/, async (req, res, next) => {
      try {
        const templatePath = path.resolve(uiRoot, "index.html");
        const template = fs.readFileSync(templatePath, "utf-8");
        const html = applyUiBranding(await vite.transformIndexHtml(req.originalUrl, template));
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  app.use(errorHandler);

  jobCoordinator.start();
  scheduler.start();

  // Start routine scheduler for cron-based scheduled activities
  const { createRoutineScheduler } = await import("./services/routine-scheduler.js");
  const { createRoutineExecutor } = await import("./services/routine-executor.js");
  const routineExecutor = createRoutineExecutor(db);
  const routineScheduler = createRoutineScheduler(db, routineExecutor.executeRun);
  routineScheduler.start();
  void toolDispatcher.initialize().catch((err) => {
    logger.error({ err }, "Failed to initialize plugin tool dispatcher");
  });
  const devWatcher = opts.uiMode === "vite-dev"
    ? createPluginDevWatcher(
      lifecycle,
      async (pluginId) => (await pluginRegistry.getById(pluginId))?.packagePath ?? null,
    )
    : null;
  void loader.loadAll().then((result) => {
    if (!result) return;
    for (const loaded of result.results) {
      if (devWatcher && loaded.success && loaded.plugin.packagePath) {
        devWatcher.watch(loaded.plugin.id, loaded.plugin.packagePath);
      }
    }
  }).catch((err) => {
    logger.error({ err }, "Failed to load ready plugins on startup");
  });
  process.once("exit", () => {
    devWatcher?.close();
    hostServiceCleanup.disposeAll();
    hostServiceCleanup.teardown();
  });
  process.once("beforeExit", () => {
    void flushPluginLogBuffer();
  });

  return app;
}
