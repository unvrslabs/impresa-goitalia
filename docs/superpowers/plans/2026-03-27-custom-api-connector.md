# Custom API Connector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere alle PMI di collegare qualsiasi servizio REST esterno (CRM, gestionale, magazzino) tramite connettore custom con azioni configurabili e tool Claude dinamici.

**Architecture:** Nuova tabella `custom_connectors` con azioni JSON. Il CEO configura via chat con tool dedicati. Le azioni diventano tool Claude dinamici per gli agenti. Credenziali in `company_secrets`, registrazione in `connector_accounts` esistente.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL jsonb, Express, React

---

## File Structure

| File | Responsabilità |
|------|---------------|
| `packages/db/src/schema/custom_connectors.ts` | CREATE — Schema tabella Drizzle |
| `packages/db/src/schema/index.ts` | MODIFY — Export nuovo schema |
| `server/src/routes/custom-connectors.ts` | CREATE — REST API CRUD per UI |
| `server/src/routes/chat.ts` | MODIFY — Tool CEO + dispatcher custom + CONNECTOR_GUIDES + contesto dinamico |
| `server/src/app.ts` | MODIFY — Registrare route |
| `ui/src/pages/PluginManager.tsx` | MODIFY — Sezione API Custom |
| Migration SQL | CREATE — DDL tabella |

---

### Task 1: Schema DB + Migration

**Files:**
- Create: `packages/db/src/schema/custom_connectors.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Creare lo schema Drizzle**

```typescript
// packages/db/src/schema/custom_connectors.ts
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const customConnectors = pgTable(
  "custom_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    baseUrl: text("base_url").notNull(),
    authType: text("auth_type").notNull().default("bearer"),
    authHeader: text("auth_header").default("Authorization"),
    authPrefix: text("auth_prefix").default("Bearer"),
    description: text("description"),
    actions: jsonb("actions").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySlugUq: uniqueIndex("custom_connectors_company_slug_key").on(table.companyId, table.slug),
    companyIdx: index("idx_custom_connectors_company").on(table.companyId),
  }),
);
```

- [ ] **Step 2: Aggiungere export in schema/index.ts**

Aggiungere alla fine di `packages/db/src/schema/index.ts`:

```typescript
export { customConnectors } from "./custom_connectors.js";
```

- [ ] **Step 3: Creare la migration SQL**

Eseguire sulla VPS:

```sql
CREATE TABLE IF NOT EXISTS custom_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'bearer',
  auth_header TEXT DEFAULT 'Authorization',
  auth_prefix TEXT DEFAULT 'Bearer',
  description TEXT,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_connectors_company_slug_key ON custom_connectors(company_id, slug);
CREATE INDEX IF NOT EXISTS idx_custom_connectors_company ON custom_connectors(company_id);
```

- [ ] **Step 4: Build e verifica compilazione**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/server && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/custom_connectors.ts packages/db/src/schema/index.ts
git commit -m "feat: schema custom_connectors per connettori API custom"
```

---

### Task 2: REST API per UI (CRUD connettori custom)

**Files:**
- Create: `server/src/routes/custom-connectors.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Creare il file route**

```typescript
// server/src/routes/custom-connectors.ts
import { Router } from "express";
import type { Db } from "@goitalia/db";
import { customConnectors, companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").substring(0, 30);
}

export function customConnectorRoutes(db: Db) {
  const router = Router();

  function requireAuth(req: any, res: any, companyId: string | undefined): companyId is string {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return false; }
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return false; }
    return true;
  }

  // GET /custom-connectors?companyId=
  router.get("/custom-connectors", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!requireAuth(req, res, companyId)) return;
    const rows = await db.select().from(customConnectors)
      .where(eq(customConnectors.companyId, companyId));
    res.json(rows);
  });

  // POST /custom-connectors — create connector + save API key
  router.post("/custom-connectors", async (req, res) => {
    const { companyId, name, baseUrl, apiKey, authType, authHeader, authPrefix, description } = req.body;
    if (!requireAuth(req, res, companyId)) return;
    if (!name || !baseUrl) return res.status(400).json({ error: "name and baseUrl required" });

    // SSRF check
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== "https:") return res.status(400).json({ error: "Solo URL HTTPS consentiti" });
      const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "[::1]"];
      if (blocked.some(h => parsed.hostname === h) || parsed.hostname.startsWith("10.") || parsed.hostname.startsWith("192.168.") || parsed.hostname.startsWith("172.")) {
        return res.status(400).json({ error: "URL non consentito" });
      }
    } catch { return res.status(400).json({ error: "URL non valido" }); }

    // Check max 10 per company
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

      // Save API key in company_secrets
      if (apiKey) {
        await db.insert(companySecrets).values({
          id: crypto.randomUUID(),
          companyId,
          name: `custom_api_${row.id}`,
          provider: "encrypted",
          description: encrypt(apiKey),
        });
      }

      // Register in connector_accounts
      await upsertConnectorAccount(db, companyId, `custom_${slug}`, row.id, name);

      res.json(row);
    } catch (err: any) {
      if (err.code === "23505") return res.status(409).json({ error: "Connettore con questo nome esiste già" });
      throw err;
    }
  });

  // PUT /custom-connectors/:id — update connector
  router.put("/custom-connectors/:id", async (req, res) => {
    const { companyId, name, baseUrl, description, authType, authHeader, authPrefix } = req.body;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

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

    // Remove secret, connector_account, and the connector itself
    await db.delete(companySecrets).where(and(
      eq(companySecrets.companyId, companyId),
      eq(companySecrets.name, `custom_api_${connector.id}`),
    ));
    await removeConnectorAccount(db, companyId, `custom_${connector.slug}`);
    await db.delete(customConnectors).where(eq(customConnectors.id, connector.id));
    res.json({ deleted: true });
  });

  // POST /custom-connectors/:id/actions — add action
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
    if (actions.some((a: any) => a.name === name)) return res.status(409).json({ error: "Azione con questo nome esiste già" });

    const actionSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    actions.push({
      name: actionSlug,
      label: label || name,
      description: description || "",
      method: method.toUpperCase(),
      path,
      params: params || [],
      body_template: body_template || null,
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

  // POST /custom-connectors/:id/test — test connectivity
  router.post("/custom-connectors/:id/test", async (req, res) => {
    const { companyId } = req.body;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    // Get API key
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
```

- [ ] **Step 2: Registrare in app.ts**

Aggiungere import in cima a `server/src/app.ts` (dopo riga 38):

```typescript
import { customConnectorRoutes } from "./routes/custom-connectors.js";
```

Aggiungere registrazione (cercare dove sono gli altri `api.use` prima di riga 545):

```typescript
api.use(customConnectorRoutes(db));
```

- [ ] **Step 3: Build e verifica**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/server && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/custom-connectors.ts server/src/app.ts
git commit -m "feat: REST API CRUD connettori custom + registrazione route"
```

---

### Task 3: Tool CEO + Dispatcher Custom in chat.ts

**Files:**
- Modify: `server/src/routes/chat.ts`

Questo è il task più grosso. Si divide in 4 sotto-step: tool definitions, CEO_TOOLS set, tool dispatcher, contesto dinamico.

- [ ] **Step 1: Aggiungere tool definitions nell'array TOOLS**

Aggiungere alla fine dell'array `TOOLS` (prima della `];` di chiusura, circa riga 652):

```typescript
  // Custom API Connectors
  {
    name: "crea_connettore_custom",
    description: "Crea un connettore per collegare un servizio esterno con API REST (CRM, gestionale, ecc.). Chiedi al cliente: nome servizio, URL API, API key.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome del servizio (es: Il Mio CRM)" },
        base_url: { type: "string", description: "URL base delle API (es: https://api.miocrm.com)" },
        api_key: { type: "string", description: "API key o token di accesso" },
        descrizione: { type: "string", description: "Breve descrizione di cosa fa il servizio" },
        auth_type: { type: "string", enum: ["bearer", "header", "none"], description: "Tipo autenticazione (default: bearer)" },
      },
      required: ["nome", "base_url", "api_key"],
    },
  },
  {
    name: "aggiungi_azione_custom",
    description: "Aggiunge un'azione a un connettore custom. Ogni azione diventa un tool disponibile per l'agente.",
    input_schema: {
      type: "object" as const,
      properties: {
        connector_id: { type: "string", description: "ID del connettore custom" },
        nome: { type: "string", description: "Nome azione snake_case (es: lista_clienti)" },
        label: { type: "string", description: "Nome leggibile (es: Lista Clienti)" },
        descrizione: { type: "string", description: "Cosa fa l'azione" },
        metodo: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "Metodo HTTP" },
        path: { type: "string", description: "Path relativo (es: /api/clients)" },
        parametri: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["string", "number", "boolean"] },
              required: { type: "boolean" },
              in: { type: "string", enum: ["query", "path", "body"] },
              description: { type: "string" },
            },
          },
          description: "Parametri accettati dall'azione",
        },
      },
      required: ["connector_id", "nome", "metodo", "path"],
    },
  },
  {
    name: "lista_connettori_custom",
    description: "Mostra i connettori API custom collegati dall'azienda con le loro azioni disponibili.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "rimuovi_connettore_custom",
    description: "Rimuove un connettore API custom e tutte le sue azioni.",
    input_schema: {
      type: "object" as const,
      properties: {
        connector_id: { type: "string", description: "ID del connettore da rimuovere" },
      },
      required: ["connector_id"],
    },
  },
  {
    name: "testa_connettore_custom",
    description: "Testa la connettività di un connettore custom verificando che l'URL base risponda.",
    input_schema: {
      type: "object" as const,
      properties: {
        connector_id: { type: "string", description: "ID del connettore da testare" },
      },
      required: ["connector_id"],
    },
  },
```

- [ ] **Step 2: Aggiungere al TOOL_CONNECTOR (tutti null — CEO-only)**

Dopo l'ultimo entry di TOOL_CONNECTOR (riga ~715):

```typescript
  // Custom API Connectors (CEO orchestration tools)
  crea_connettore_custom: null,
  aggiungi_azione_custom: null,
  lista_connettori_custom: null,
  rimuovi_connettore_custom: null,
  testa_connettore_custom: null,
```

- [ ] **Step 3: Aggiungere al CEO_TOOLS set**

Nell'array CEO_TOOLS, prima della `]);` di chiusura:

```typescript
  // Custom API Connectors
  "crea_connettore_custom",
  "aggiungi_azione_custom",
  "lista_connettori_custom",
  "rimuovi_connettore_custom",
  "testa_connettore_custom",
```

- [ ] **Step 4: Aggiungere import customConnectors**

In cima al file, nella riga import da `@goitalia/db`, aggiungere `customConnectors`:

```typescript
import { companySecrets, agents, companyMemberships, companies, issues, connectorAccounts, agentConnectorAccounts, routines, routineTriggers, routineRuns, companyProfiles, companyProducts, customConnectors } from "@goitalia/db";
```

- [ ] **Step 5: Implementare i case nel tool dispatcher (executeChatTool)**

Aggiungere i case dentro il `switch (toolName)` in `executeChatTool`, prima del `default:`:

```typescript
      case "crea_connettore_custom": {
        const input = toolInput as { nome: string; base_url: string; api_key: string; descrizione?: string; auth_type?: string };
        if (!input.nome || !input.base_url || !input.api_key) return "Errore: nome, base_url e api_key obbligatori.";

        // SSRF check
        try {
          const parsed = new URL(input.base_url);
          if (parsed.protocol !== "https:") return "Errore: solo URL HTTPS consentiti.";
          const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "[::1]"];
          if (blocked.some(h => parsed.hostname === h) || parsed.hostname.startsWith("10.") || parsed.hostname.startsWith("192.168.") || parsed.hostname.startsWith("172.")) {
            return "Errore: URL non consentito (rete privata).";
          }
        } catch { return "Errore: URL non valido."; }

        const slug = input.nome.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").substring(0, 30);

        // Check max 10
        const existingCount = await db.select({ id: customConnectors.id }).from(customConnectors)
          .where(eq(customConnectors.companyId, companyId));
        if (existingCount.length >= 10) return "Errore: massimo 10 connettori custom per azienda.";

        try {
          const [row] = await db.insert(customConnectors).values({
            companyId, name: input.nome, slug, baseUrl: input.base_url,
            authType: input.auth_type || "bearer",
            description: input.descrizione || null,
            actions: [],
          }).returning();

          // Save API key
          await db.insert(companySecrets).values({
            id: randomUUID(), companyId,
            name: `custom_api_${row.id}`,
            provider: "encrypted",
            description: encrypt(input.api_key),
          });

          // Register connector_account
          const { upsertConnectorAccount } = await import("../utils/connector-sync.js");
          await upsertConnectorAccount(db, companyId, `custom_${slug}`, row.id, input.nome);

          return `Connettore "${input.nome}" creato (id: ${row.id}). Ora dimmi quali operazioni vuoi fare con questo servizio — per ognuna uso aggiungi_azione_custom.`;
        } catch (err: any) {
          if (err.code === "23505") return "Errore: connettore con questo nome esiste già.";
          return "Errore creazione connettore: " + (err.message || "").substring(0, 100);
        }
      }

      case "aggiungi_azione_custom": {
        const input = toolInput as { connector_id: string; nome: string; label?: string; descrizione?: string; metodo: string; path: string; parametri?: any[] };
        if (!input.connector_id || !input.nome || !input.metodo || !input.path) return "Errore: connector_id, nome, metodo e path obbligatori.";

        const connector = await db.select().from(customConnectors)
          .where(and(eq(customConnectors.id, input.connector_id), eq(customConnectors.companyId, companyId)))
          .then(r => r[0]);
        if (!connector) return "Errore: connettore non trovato.";

        const actions = (connector.actions as any[]) || [];
        if (actions.length >= 20) return "Errore: massimo 20 azioni per connettore.";
        const actionSlug = input.nome.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        if (actions.some((a: any) => a.name === actionSlug)) return "Errore: azione con questo nome esiste già.";

        actions.push({
          name: actionSlug,
          label: input.label || input.nome,
          description: input.descrizione || "",
          method: input.metodo.toUpperCase(),
          path: input.path,
          params: input.parametri || [],
          body_template: null,
        });

        await db.update(customConnectors).set({ actions, updatedAt: new Date() })
          .where(eq(customConnectors.id, connector.id));

        return `Azione "${input.label || input.nome}" aggiunta al connettore "${connector.name}". Tool: custom_${connector.slug}_${actionSlug}. Vuoi aggiungere altre azioni?`;
      }

      case "lista_connettori_custom": {
        const connectors = await db.select().from(customConnectors)
          .where(eq(customConnectors.companyId, companyId));
        if (connectors.length === 0) return "Nessun connettore custom configurato.";
        return connectors.map(c => {
          const actions = (c.actions as any[]) || [];
          const actionList = actions.map((a: any) => `  - ${a.label || a.name} (${a.method} ${a.path})`).join("\n");
          return `📡 ${c.name} (${c.baseUrl}) — id: ${c.id}\nAzioni:\n${actionList || "  Nessuna azione configurata"}`;
        }).join("\n\n");
      }

      case "rimuovi_connettore_custom": {
        const connectorId = toolInput.connector_id as string;
        if (!connectorId) return "Errore: connector_id obbligatorio.";

        const connector = await db.select().from(customConnectors)
          .where(and(eq(customConnectors.id, connectorId), eq(customConnectors.companyId, companyId)))
          .then(r => r[0]);
        if (!connector) return "Errore: connettore non trovato.";

        await db.delete(companySecrets).where(and(
          eq(companySecrets.companyId, companyId),
          eq(companySecrets.name, `custom_api_${connector.id}`),
        ));
        const { removeConnectorAccount } = await import("../utils/connector-sync.js");
        await removeConnectorAccount(db, companyId, `custom_${connector.slug}`);
        await db.delete(customConnectors).where(eq(customConnectors.id, connector.id));

        return `Connettore "${connector.name}" rimosso.`;
      }

      case "testa_connettore_custom": {
        const connectorId = toolInput.connector_id as string;
        if (!connectorId) return "Errore: connector_id obbligatorio.";

        const connector = await db.select().from(customConnectors)
          .where(and(eq(customConnectors.id, connectorId), eq(customConnectors.companyId, companyId)))
          .then(r => r[0]);
        if (!connector) return "Errore: connettore non trovato.";

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
          return r.ok
            ? `Test OK — ${connector.name} risponde (status ${r.status}).`
            : `Test FALLITO — ${connector.name} risponde con errore ${r.status}.`;
        } catch (err) {
          return `Test FALLITO — impossibile contattare ${connector.baseUrl}: ${(err as Error).message}`;
        }
      }
```

- [ ] **Step 6: Aggiungere il dispatcher per tool custom dinamici**

All'inizio del `switch(toolName)` in `executeChatTool`, prima del primo `case`, aggiungere:

```typescript
      // Dynamic custom connector tools (custom_{slug}_{action})
      if (toolName.startsWith("custom_")) {
        const parts = toolName.split("_");
        // Find the connector slug and action name: custom_{slug}_{actionName}
        // slug and action can have underscores, so we need to match against DB
        const allCustom = await db.select().from(customConnectors)
          .where(eq(customConnectors.companyId, companyId));

        for (const connector of allCustom) {
          const prefix = `custom_${connector.slug}_`;
          if (!toolName.startsWith(prefix)) continue;
          const actionName = toolName.substring(prefix.length);
          const actions = (connector.actions as any[]) || [];
          const action = actions.find((a: any) => a.name === actionName);
          if (!action) continue;

          // Get API key
          const secret = await db.select().from(companySecrets)
            .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, `custom_api_${connector.id}`)))
            .then(r => r[0]);

          // Build URL
          let url = connector.baseUrl.replace(/\/$/, "") + action.path;
          const queryParams = new URLSearchParams();
          const bodyObj: Record<string, unknown> = {};

          for (const param of (action.params || [])) {
            const value = toolInput[param.name];
            if (value === undefined || value === null) continue;
            if (param.in === "path") {
              url = url.replace(`{${param.name}}`, encodeURIComponent(String(value)));
            } else if (param.in === "query" || (param.in !== "body" && action.method === "GET")) {
              queryParams.set(param.name, String(value));
            } else {
              bodyObj[param.name] = value;
            }
          }

          const qs = queryParams.toString();
          if (qs) url += (url.includes("?") ? "&" : "?") + qs;

          // Build headers
          const headers: Record<string, string> = {};
          if (secret?.description && connector.authType !== "none") {
            const apiKey = decrypt(secret.description);
            headers[connector.authHeader || "Authorization"] = `${connector.authPrefix || "Bearer"} ${apiKey}`.trim();
          }
          if (["POST", "PUT", "PATCH"].includes(action.method)) {
            headers["Content-Type"] = "application/json";
          }

          try {
            const fetchOpts: RequestInit = { method: action.method, headers, signal: AbortSignal.timeout(30000) };
            if (["POST", "PUT", "PATCH"].includes(action.method) && Object.keys(bodyObj).length > 0) {
              fetchOpts.body = JSON.stringify(action.body_template ? { ...action.body_template, ...bodyObj } : bodyObj);
            }
            const r = await fetch(url, fetchOpts);
            const text = await r.text();
            if (!r.ok) return `Errore ${connector.name} (${r.status}): ${text.substring(0, 500)}`;
            // Try to parse as JSON for pretty output
            try { return JSON.stringify(JSON.parse(text), null, 2).substring(0, 3000); } catch {}
            return text.substring(0, 3000);
          } catch (err) {
            return `Errore chiamata ${connector.name}: ${(err as Error).message}`;
          }
        }
        return "Errore: connettore o azione custom non trovata.";
      }
```

Nota: questo blocco va **prima** del `switch (toolName) {` — trasformarlo in un if/else o metterlo come primo check nella funzione. Il modo più semplice: metterlo subito dopo il `try {` e prima del `switch`:

- [ ] **Step 7: Generare tool dinamici in filterToolsForAgent e nella route /chat**

Creare una funzione helper per generare tool definitions dai connettori custom:

```typescript
async function getCustomToolsForCompany(db: Db, companyId: string): Promise<typeof TOOLS> {
  const connectors = await db.select().from(customConnectors)
    .where(eq(customConnectors.companyId, companyId));

  const tools: typeof TOOLS = [];
  for (const connector of connectors) {
    const actions = (connector.actions as any[]) || [];
    for (const action of actions) {
      const properties: Record<string, any> = {};
      const required: string[] = [];
      for (const param of (action.params || [])) {
        properties[param.name] = { type: param.type || "string", description: param.description || param.name };
        if (param.required) required.push(param.name);
      }
      tools.push({
        name: `custom_${connector.slug}_${action.name}`,
        description: `[${connector.name}] ${action.description || action.label || action.name}`,
        input_schema: { type: "object" as const, properties, required },
      });
    }
  }
  return tools;
}
```

Nella route POST /chat, dopo aver caricato i tool statici con `filterToolsForAgent`, appendere i tool custom:

```typescript
// After: tools: filterToolsForAgent(agentRole, agentConnectors),
// Load custom tools and append
const customTools = await getCustomToolsForCompany(db, companyId);
const allTools = [...filterToolsForAgent(agentRole, agentConnectors), ...customTools];
// Use allTools instead of filterToolsForAgent result
```

- [ ] **Step 8: Aggiungere CONNECTOR_GUIDES per custom**

Nell'array CONNECTOR_GUIDES, aggiungere:

```typescript
  {
    key: "custom",
    label: "API Custom",
    capabilities: "Collegamento a qualsiasi servizio esterno con API REST (CRM, gestionale, magazzino, e-commerce)",
    questions: [
      "Che servizio vuoi collegare? (CRM, gestionale, magazzino, ecc.)",
      "Hai l'URL delle API e una API key o token di accesso?",
      "Che operazioni vuoi fare con questo servizio? (es: cercare clienti, creare ordini, vedere fatture)",
    ],
    suggestions: [
      "Posso collegare qualsiasi servizio con API REST — basta l'URL e una API key",
      "Dopo aver collegato il servizio, creiamo le azioni specifiche che ti servono",
    ],
  },
```

- [ ] **Step 9: Aggiungere sezione nel CEO prompt per connettori custom**

Nel `CEO_PROMPT_BASE`, dopo la sezione "ORCHESTRAZIONE — Delegazione Obbligatoria" e prima di "ATTIVITÀ PROGRAMMATE", aggiungere:

```
## CONNETTORI CUSTOM — API Esterne
Se il cliente dice di avere un CRM, gestionale, magazzino, o qualsiasi servizio con API:
1. Chiedi: "Come si chiama il servizio?"
2. Chiedi: "Qual è l'URL delle API?" (es: https://api.miocrm.com)
3. Chiedi: "Hai una API key o token di accesso?"
4. Usa crea_connettore_custom per registrarlo
5. Chiedi: "Cosa vuoi poterci fare?" (es: cercare clienti, creare ordini, vedere fatture)
6. Per ogni operazione usa aggiungi_azione_custom con metodo HTTP e path appropriati
7. Testa con testa_connettore_custom
8. Crea un agente dedicato con crea_agente e connettore custom
Non serve che il cliente conosca i dettagli tecnici — chiedigli cosa vuole fare e deduci metodo/path.
```

- [ ] **Step 10: Aggiungere contesto dinamico per connettori custom**

Nel blocco "STATO ATTUALE DELL'IMPRESA" (dopo i connettori attivi), aggiungere:

```typescript
        // Custom connectors
        const customConns = await db.select().from(customConnectors)
          .where(eq(customConnectors.companyId, companyId));
        if (customConns.length > 0) {
          dynamicContext += "\nConnettori API custom:\n";
          for (const c of customConns) {
            const actions = (c.actions as any[]) || [];
            const actionNames = actions.map((a: any) => a.label || a.name).join(", ");
            dynamicContext += `- ${c.name} (${c.baseUrl}) — azioni: ${actionNames || "nessuna"}\n`;
          }
        }
```

- [ ] **Step 11: Aggiungere label progresso per tool custom**

Nel `TOOL_PROGRESS_LABELS`, aggiungere un pattern. Siccome i tool custom sono dinamici, aggiungere una label di fallback nella funzione onProgress in `executeAgentTask`:

Nell'`executeAgentTask`, aggiornare il blocco onProgress:

```typescript
      if (onProgress) {
        const label = toolName.startsWith("custom_")
          ? `Chiamando API esterna...`
          : (TOOL_PROGRESS_LABELS[toolName] || `Eseguendo ${toolName}...`);
        onProgress(`${agent.name}: ${label}`, toolName);
      }
```

- [ ] **Step 12: Build e verifica**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/server && npm run build
```

- [ ] **Step 13: Commit**

```bash
git add server/src/routes/chat.ts
git commit -m "feat: tool CEO connettori custom + dispatcher dinamico + contesto CEO"
```

---

### Task 4: UI PluginManager — Sezione API Custom

**Files:**
- Modify: `ui/src/pages/PluginManager.tsx`

- [ ] **Step 1: Aggiungere sezione API Custom nel PluginManager**

Trovare la fine delle sezioni connettori esistenti nel file. Aggiungere una nuova sezione card "API Custom" con:

- Lista connettori custom (fetch da GET /custom-connectors?companyId=)
- Per ognuno: nome, URL, azioni con metodo+path
- Form "Aggiungi connettore": nome, URL, API key
- Per ogni connettore: form "Aggiungi azione": nome, metodo (select), path, descrizione
- Bottoni elimina connettore / elimina azione
- Messaggio: "Puoi anche configurare tutto dalla Chat col CEO"

Il codice specifico dipende dalla struttura esatta di PluginManager.tsx — seguire il pattern delle altre card (Stripe, Fal, ecc.) per stile e struttura.

- [ ] **Step 2: Build UI**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/ui && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/pages/PluginManager.tsx
git commit -m "feat: UI sezione API Custom nel PluginManager"
```

---

### Task 5: Migration DB su VPS + Deploy + Test

**Files:**
- Nessuna modifica — solo operazioni deployment

- [ ] **Step 1: Push tutto**

```bash
cd /Users/emanuelemaccari/impresa-goitalia && git push
```

- [ ] **Step 2: Eseguire migration su VPS**

```bash
ssh root@89.167.3.74 "PGPASSWORD=goitalia psql -h localhost -p 5435 -U goitalia -d goitalia_impresa" <<'SQL'
CREATE TABLE IF NOT EXISTS custom_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'bearer',
  auth_header TEXT DEFAULT 'Authorization',
  auth_prefix TEXT DEFAULT 'Bearer',
  description TEXT,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_connectors_company_slug_key ON custom_connectors(company_id, slug);
CREATE INDEX IF NOT EXISTS idx_custom_connectors_company ON custom_connectors(company_id);
SQL
```

- [ ] **Step 3: Deploy server + UI**

```bash
ssh root@89.167.3.74 "cd /var/www/impresa-goitalia && git pull && cd server && npm run build && cd ../ui && npm run build && pm2 restart goitalia-impresa"
```

- [ ] **Step 4: Test end-to-end**

Nella chat CEO, testare:
1. "Ho un CRM che si chiama TestCRM con API su https://jsonplaceholder.typicode.com"
2. Il CEO deve chiedere API key → dare una qualsiasi
3. Il CEO deve creare il connettore con `crea_connettore_custom`
4. "Voglio poter vedere i post" → CEO deve aggiungere azione GET /posts
5. "Testa il connettore" → CEO deve usare `testa_connettore_custom`
6. CEO deve creare un agente e delegare

- [ ] **Step 5: Tag versione**

```bash
git tag v3-custom-api-connector && git push --tags
```
