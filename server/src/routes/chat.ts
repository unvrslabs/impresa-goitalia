import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, agents, companyMemberships, companies, issues } from "@goitalia/db";
import { eq, and, inArray, desc, sql, asc } from "drizzle-orm";
import { decrypt as decryptSecret, decrypt, encrypt } from "../utils/crypto.js";
import { randomUUID } from "node:crypto";

// Tool definitions (same as adapter)
const TOOLS = [
  {
    name: "lista_agenti",
    description: "Elenca tutti gli agenti della company con il loro stato attuale.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "crea_task",
    description: "Crea un nuovo task e lo assegna a un agente.",
    input_schema: {
      type: "object" as const,
      properties: {
        titolo: { type: "string", description: "Titolo del task" },
        descrizione: { type: "string", description: "Descrizione dettagliata" },
        agente_id: { type: "string", description: "ID dell'agente" },
        priorita: { type: "string", enum: ["urgent", "high", "medium", "low"] },
      },
      required: ["titolo", "descrizione", "agente_id"],
    },
  },
  {
    name: "stato_task",
    description: "Controlla lo stato dei task attivi.",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "Filtra per agente (opzionale)" },
        stato: { type: "string", enum: ["todo", "in_progress", "done", "all"] },
      },
      required: [] as string[],
    },
  },
  {
    name: "commenta_task",
    description: "Aggiungi un commento a un task.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string", description: "ID del task" },
        commento: { type: "string", description: "Il commento" },
      },
      required: ["task_id", "commento"],
    },
  },
  {
    name: "elimina_agente",
    description: "Elimina un agente dalla company. Usa con cautela.",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "ID dell'agente da eliminare" },
      },
      required: ["agente_id"],
    },
  },
  {
    name: "crea_agente",
    description: "Crea un nuovo agente specializzato per la company.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome dell'agente (es: Il Promotore)" },
        titolo: { type: "string", description: "Ruolo dell'agente (es: Social Media Manager)" },
        competenze: { type: "string", description: "Descrizione delle competenze" },
        istruzioni: { type: "string", description: "Prompt di sistema / istruzioni operative" },
      },
      required: ["nome", "titolo", "competenze", "istruzioni"],
    },
  },

  {
    name: "lista_clienti",
    description: "Elenca i clienti dell'azienda registrati su Fatture in Cloud.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "cerca_cliente",
    description: "Cerca un cliente per nome o P.IVA su Fatture in Cloud.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Nome o P.IVA del cliente" },
      },
      required: ["query"],
    },
  },
  {
    name: "crea_cliente",
    description: "Crea un nuovo cliente su Fatture in Cloud.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome o ragione sociale" },
        partita_iva: { type: "string", description: "Partita IVA (opzionale)" },
        codice_fiscale: { type: "string", description: "Codice fiscale (opzionale)" },
        indirizzo: { type: "string", description: "Via e numero civico" },
        cap: { type: "string", description: "CAP" },
        citta: { type: "string", description: "Città" },
        provincia: { type: "string", description: "Provincia (sigla)" },
        email: { type: "string", description: "Email" },
        pec: { type: "string", description: "PEC (per fattura elettronica)" },
        codice_sdi: { type: "string", description: "Codice destinatario SDI (7 caratteri)" },
      },
      required: ["nome"],
    },
  },
  {
    name: "crea_fattura",
    description: "Crea una nuova fattura su Fatture in Cloud. Specifica il cliente, le righe e il metodo di pagamento.",
    input_schema: {
      type: "object" as const,
      properties: {
        cliente_id: { type: "number", description: "ID del cliente (usa lista_clienti per trovarlo)" },
        righe: {
          type: "array",
          description: "Righe della fattura",
          items: {
            type: "object",
            properties: {
              descrizione: { type: "string" },
              prezzo: { type: "number", description: "Prezzo unitario netto" },
              quantita: { type: "number", description: "Quantità (default 1)" },
              iva: { type: "number", description: "Aliquota IVA % (default 22)" },
            },
            required: ["descrizione", "prezzo"],
          },
        },
        fattura_elettronica: { type: "boolean", description: "Se inviare come fattura elettronica via SDI (default true)" },
        data: { type: "string", description: "Data fattura (YYYY-MM-DD, default oggi)" },
        note: { type: "string", description: "Note aggiuntive" },
      },
      required: ["cliente_id", "righe"],
    },
  },
  {
    name: "lista_fatture",
    description: "Elenca le fatture emesse. Può filtrare per stato.",
    input_schema: {
      type: "object" as const,
      properties: {
        tipo: { type: "string", enum: ["emesse", "ricevute"], description: "Tipo (default emesse)" },
        pagina: { type: "number", description: "Pagina (default 1)" },
      },
      required: [] as string[],
    },
  },
  {
    name: "invia_fattura_sdi",
    description: "Invia una fattura elettronica allo SDI (Sistema di Interscambio).",
    input_schema: {
      type: "object" as const,
      properties: {
        fattura_id: { type: "number", description: "ID della fattura da inviare" },
      },
      required: ["fattura_id"],
    },
  },
];


async function getFicTokenForChat(db: Db, companyId: string): Promise<{ access_token: string; fic_company_id: number } | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "fattureincloud_tokens")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try {
    const data = JSON.parse(decrypt(secret.description));
    // Refresh if expired
    if (data.expiresAt && data.expiresAt < Date.now() && data.refresh_token) {
      try {
        const r = await fetch("https://api-v2.fattureincloud.it/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: process.env.FIC_CLIENT_ID || "",
            client_secret: process.env.FIC_CLIENT_SECRET || "",
            refresh_token: data.refresh_token,
          }),
        });
        if (r.ok) {
          const tokens = await r.json() as any;
          data.access_token = tokens.access_token;
          data.refresh_token = tokens.refresh_token;
          data.expiresAt = Date.now() + (tokens.expires_in || 86400) * 1000;
          const enc = encrypt(JSON.stringify(data));
          await db.update(companySecrets).set({ description: enc, updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
        }
      } catch (e) { console.error("[chat] FIC refresh error:", e); }
    }
    return data;
  } catch (e) { console.error("[chat] FIC decrypt error:", e); return null; }
}

type ToolInput = Record<string, unknown>;

async function executeChatTool(
  toolName: string,
  toolInput: ToolInput,
  db: Db,
  companyId: string,
  agentId: string,
): Promise<string> {
  try {
    switch (toolName) {
      case "lista_agenti": {
        const rows = await db.select({
          id: agents.id,
          name: agents.name,
          title: agents.title,
          role: agents.role,
          status: agents.status,
        }).from(agents).where(eq(agents.companyId, companyId));
        return rows.map((a) =>
          `- ${a.name || "?"} (${a.title || a.role || "?"}) — stato: ${a.status || "?"} — id: ${a.id}`
        ).join("\n") || "Nessun agente trovato.";
      }

      case "crea_task": {
        const input = toolInput as { titolo: string; descrizione: string; agente_id: string; priorita?: string };
        const [company] = await db
          .update(companies)
          .set({ issueCounter: sql`${companies.issueCounter} + 1` })
          .where(eq(companies.id, companyId))
          .returning({ issueCounter: companies.issueCounter, issuePrefix: companies.issuePrefix });
        const identifier = `${company.issuePrefix}-${company.issueCounter}`;
        await db.insert(issues).values({
          id: randomUUID(),
          companyId,
          title: input.titolo,
          description: input.descrizione,
          assigneeAgentId: input.agente_id,
          priority: input.priorita || "medium",
          status: "todo",
          issueNumber: company.issueCounter,
          identifier,
          originKind: "manual",
        });
        return `Task creato: ${identifier} — ${input.titolo} (assegnato)`;
      }

      case "stato_task": {
        const input = toolInput as { agente_id?: string; stato?: string };
        const conditions = [eq(issues.companyId, companyId)];
        if (input.agente_id) conditions.push(eq(issues.assigneeAgentId, input.agente_id));
        if (input.stato && input.stato !== "all") {
          conditions.push(inArray(issues.status, [input.stato]));
        }
        const rows = await db.select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
        }).from(issues).where(and(...conditions)).orderBy(desc(issues.createdAt));
        if (!rows.length) return "Nessun task trovato.";
        return rows.slice(0, 20).map((i) => `- [${i.status}] ${i.identifier || ""}: ${i.title}`).join("\n");
      }

      case "commenta_task": {
        const input = toolInput as { task_id: string; commento: string };
        return `Nota registrata per task ${input.task_id}: ${input.commento}`;
      }

      case "elimina_agente": {
        const input = toolInput as { agente_id: string };
        if (input.agente_id === agentId) return "Non puoi eliminare te stesso (il Direttore AI).";
        const target = await db.select({ id: agents.id, name: agents.name }).from(agents)
          .where(and(eq(agents.id, input.agente_id), eq(agents.companyId, companyId)))
          .then((rows) => rows[0]);
        if (!target) return "Agente non trovato con id: " + input.agente_id;
        await db.delete(agents).where(eq(agents.id, input.agente_id));
        return `Agente eliminato: ${target.name} (${target.id})`;
      }

      case "crea_agente": {
        const input = toolInput as { nome: string; titolo: string; competenze: string; istruzioni: string };
        const [newAgent] = await db.insert(agents).values({
          id: randomUUID(),
          companyId,
          name: input.nome,
          title: input.titolo,
          role: input.titolo,
          capabilities: input.competenze,
          adapterType: "claude_api",
          adapterConfig: { promptTemplate: input.istruzioni },
          reportsTo: agentId,
          status: "idle",
        }).returning();
        return `Agente creato: ${input.nome} (${input.titolo}) \u2014 id: ${newAgent.id}`;
      }


      case "lista_clienti": {
        console.log("[chat-tool] lista_clienti for company:", companyId);
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso. Collega il servizio da Connettori.";
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/entities/clients?per_page=50&fieldset=basic`, {
          headers: { Authorization: "Bearer " + ficToken.access_token },
        });
        if (!r.ok) return "Errore nel recupero clienti: " + r.status;
        const data = await r.json() as any;
        const clients = data.data || [];
        if (clients.length === 0) return "Nessun cliente trovato. Usa crea_cliente per aggiungerne uno.";
        return clients.map((c: any) => `ID: ${c.id} | ${c.name}${c.vat_number ? " | P.IVA: " + c.vat_number : ""}`).join("\n");
      }

      case "cerca_cliente": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const query = toolInput.query as string;
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/entities/clients?per_page=20&fieldset=detailed`, {
          headers: { Authorization: "Bearer " + ficToken.access_token },
        });
        if (!r.ok) return "Errore ricerca: " + r.status;
        const data = await r.json() as any;
        const clients = (data.data || []).filter((c: any) => c.name?.toLowerCase().includes(query.toLowerCase()));
        if (clients.length === 0) return "Nessun cliente trovato con '" + query + "'.";
        return clients.map((c: any) => `ID: ${c.id} | ${c.name} | ${c.vat_number || ""} | ${c.address_city || ""}`).join("\n");
      }

      case "crea_cliente": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const body = { data: { name: toolInput.nome, vat_number: toolInput.partita_iva || "", tax_code: toolInput.codice_fiscale || "", address_street: toolInput.indirizzo || "", address_postal_code: toolInput.cap || "", address_city: toolInput.citta || "", address_province: toolInput.provincia || "", country: "Italia", email: toolInput.email || "", certified_email: toolInput.pec || "", ei_code: toolInput.codice_sdi || "0000000" } };
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/entities/clients`, {
          method: "POST", headers: { Authorization: "Bearer " + ficToken.access_token, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!r.ok) { const err = await r.text(); return "Errore creazione cliente: " + err.substring(0, 200); }
        const data = await r.json() as any;
        return "Cliente creato! ID: " + data.data?.id + " | Nome: " + data.data?.name;
      }

      case "crea_fattura": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const righe = (toolInput.righe as any[]) || [];
        const items = righe.map((r: any) => ({ name: r.descrizione, net_price: r.prezzo, qty: r.quantita || 1, vat: { id: 0, value: r.iva || 22, is_disabled: false } }));
        // Calculate gross amount
        let totalNet = 0;
        for (const item of items) { totalNet += (item.net_price || 0) * (item.qty || 1); }
        const vatRate = items[0]?.vat?.value || 22;
        const totalGross = Math.round((totalNet * (1 + vatRate / 100)) * 100) / 100;
        // Fetch client name (FIC requires entity.name)
        let clientName = "";
        try {
          const clientRes = await fetch("https://api-v2.fattureincloud.it/c/" + ficToken.fic_company_id + "/entities/clients/" + toolInput.cliente_id, {
            headers: { Authorization: "Bearer " + ficToken.access_token },
          });
          if (clientRes.ok) { const cd = await clientRes.json() as any; clientName = cd.data?.name || ""; }
        } catch {}
        const invoiceDate = (toolInput.data as string) || new Date().toISOString().split("T")[0];
        const body = { data: { type: "invoice", date: invoiceDate, entity: { id: toolInput.cliente_id, name: clientName }, items_list: items, e_invoice: toolInput.fattura_elettronica !== false, notes: toolInput.note || "", payments_list: [{ amount: totalGross, due_date: invoiceDate, status: "not_paid" }] } };
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/issued_documents`, {
          method: "POST", headers: { Authorization: "Bearer " + ficToken.access_token, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!r.ok) { const err = await r.text(); console.error("[chat-tool] crea_fattura error:", r.status, err.substring(0, 500)); return "Errore creazione fattura: " + err.substring(0, 300); }
        const data = await r.json() as any;
        const doc = data.data;
        return "Fattura creata! ID: " + doc?.id + " | Numero: " + doc?.number + " | Totale: " + doc?.amount_gross + " euro";
      }

      case "lista_fatture": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const tipo = (toolInput.tipo as string) || "emesse";
        const endpoint = tipo === "ricevute" ? `/c/${ficToken.fic_company_id}/received_documents?type=expense&per_page=10&sort=-date&fieldset=basic` : `/c/${ficToken.fic_company_id}/issued_documents?type=invoice&per_page=10&sort=-date&fieldset=basic`;
        const r = await fetch("https://api-v2.fattureincloud.it" + endpoint, { headers: { Authorization: "Bearer " + ficToken.access_token } });
        if (!r.ok) return "Errore recupero fatture: " + r.status;
        const data = await r.json() as any;
        const docs = data.data || [];
        if (docs.length === 0) return "Nessuna fattura trovata.";
        return docs.map((d: any) => `#${d.number || d.id} | ${d.date} | ${d.entity?.name || "?"} | ${d.amount_gross || 0} euro | ${d.status === "paid" ? "Pagata" : "Non pagata"}`).join("\n");
      }

      case "invia_fattura_sdi": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const docId = toolInput.fattura_id as number;
        const verify = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/issued_documents/${docId}/e_invoice/xml_verify`, { headers: { Authorization: "Bearer " + ficToken.access_token } });
        if (!verify.ok) return "Verifica XML fallita: " + (await verify.text()).substring(0, 200);
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/issued_documents/${docId}/e_invoice/send`, {
          method: "POST", headers: { Authorization: "Bearer " + ficToken.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }),
        });
        if (!r.ok) return "Errore invio SDI: " + (await r.text()).substring(0, 200);
        return "Fattura inviata allo SDI!";
      }

      default:
        return "Tool sconosciuto: " + toolName;
    }
  } catch (err) {
    return "Errore: " + (err instanceof Error ? err.message : String(err));
  }
}



export function chatRoutes(db: Db) {
  const router = Router();

  async function saveChatMessage(companyId: string, userId: string, role: string, msgContent: string) {
    try {
      await db.execute(
        sql`INSERT INTO chat_messages (company_id, user_id, role, content) VALUES (${companyId}, ${userId}, ${role}, ${msgContent})`
      );
    } catch (e) {
      console.error("Chat save error:", e);
    }
  }

  // GET /chat/history?companyId=xxx&limit=50 - Load chat history
  router.get("/chat/history", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    if (!companyId) { res.json({ messages: [] }); return; }
    try {
      const rows = await db.execute(sql`SELECT id, role, content, created_at FROM chat_messages WHERE company_id = ${companyId} AND user_id = ${actor.userId} ORDER BY created_at ASC LIMIT 50`);
      res.json({ messages: rows || [] });
    } catch (err) {
      console.error("Chat history error:", err);
      res.json({ messages: [] });
    }
  });

  // DELETE /chat/history?companyId=xxx - Clear chat history
  router.delete("/chat/history", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ cleared: true }); return; }
    await db.execute(sql`DELETE FROM chat_messages WHERE company_id = ${companyId} AND user_id = ${actor.userId}`);
    res.json({ cleared: true });
  });

  router.post("/chat", async (req, res) => {
    try {
      const actor = req.actor as { type?: string; userId?: string; companyIds?: string[] } | undefined;
      if (!actor || actor.type !== "board" || !actor.userId) {
        res.status(401).json({ error: "Autenticazione richiesta" });
        return;
      }

      const { companyId, agentId, message, history } = req.body as {
        companyId: string;
        agentId?: string;
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      };

      if (!companyId || !message) {
        res.status(400).json({ error: "companyId e message sono obbligatori" });
        return;
      }

      const membership = await db.select().from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, actor.userId)))
        .then((rows) => rows[0]);

      if (!membership) {
        res.status(403).json({ error: "Accesso non autorizzato" });
        return;
      }

      const secret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
        .then((rows) => rows[0]);

      if (!secret?.description) {
        res.status(400).json({ error: "API key Claude non configurata. Vai su Impostazioni per inserirla." });
        return;
      }

      let apiKey: string;
      try {
        apiKey = decryptSecret(secret.description);
        console.info("[chat] decrypt OK, key starts with:", apiKey.substring(0, 10));
      } catch (decErr) {
        console.error("[chat] decrypt FAILED:", decErr);
        console.error("[chat] BETTER_AUTH_SECRET set:", !!process.env.BETTER_AUTH_SECRET);
        console.error("[chat] secret.description starts:", secret.description.substring(0, 20));
        res.status(500).json({ error: "Errore decrittazione API key" });
        return;
      }

      let systemPrompt = "Sei un assistente AI di GoItalIA. Rispondi in italiano in modo professionale e conciso.";
      let resolvedAgentId = agentId || "";

      if (agentId) {
        const agent = await db.select().from(agents)
          .where(eq(agents.id, agentId))
          .then((rows) => rows[0]);

        if (agent) {
          resolvedAgentId = agent.id;
          const adapterConfig = agent.adapterConfig as Record<string, unknown> | null;
          const promptTemplate = typeof adapterConfig?.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
          const capabilities = agent.capabilities ?? "";

          systemPrompt = promptTemplate || `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.

Competenze: ${capabilities}

Hai a disposizione dei tool per gestire l'azienda:
- lista_agenti: per vedere gli agenti disponibili
- crea_task: per creare task e assegnarli agli agenti
- lista_clienti: per vedere i clienti su Fatture in Cloud
- cerca_cliente: per cercare un cliente per nome o P.IVA
- crea_cliente: per creare un nuovo cliente
- crea_fattura: per creare una fattura (specifica cliente, righe con descrizione/prezzo/quantità)
- lista_fatture: per vedere le fatture emesse o ricevute
- invia_fattura_sdi: per inviare una fattura elettronica allo SDI
- stato_task: per controllare lo stato dei lavori
- commenta_task: per aggiungere istruzioni ai task
- crea_agente: per creare nuovi agenti specializzati
- elimina_agente: per eliminare agenti

Rispondi sempre in italiano, in modo professionale e conciso.
Usa i tool per eseguire le richieste, non limitarti a descrivere cosa faresti.`;
        }
      }

      // Build dynamic context for Direttore
      let dynamicContext = "";
      try {
        // Get all agents
        const companyAgents = await db.select({
          id: agents.id,
          name: agents.name,
          title: agents.title,
          role: agents.role,
          status: agents.status,
        }).from(agents).where(eq(agents.companyId, companyId));

        // Get connector status
        const secrets = await db.select({ name: companySecrets.name }).from(companySecrets).where(eq(companySecrets.companyId, companyId));
        const secretNames = secrets.map((s) => s.name);
        const hasGoogle = secretNames.includes("google_oauth_tokens");
        const hasTelegram = secretNames.includes("telegram_bots");
        const hasClaudeKey = secretNames.includes("claude_api_key");

        dynamicContext = "\n\n--- STATO ATTUALE DELL'IMPRESA ---\n";
        
        if (companyAgents.length > 0) {
          dynamicContext += "Agenti:\n";
          for (const a of companyAgents) {
            dynamicContext += "- " + a.name + " (" + (a.title || a.role || "") + ") — id: " + a.id + " — stato: " + (a.status || "idle") + "\n";
          }
        } else {
          dynamicContext += "Nessun agente creato.\n";
        }

        dynamicContext += "\nConnettori attivi:\n";
        if (hasGoogle) dynamicContext += "- Google Workspace (Gmail, Calendar, Drive): connesso\n";
        if (hasTelegram) dynamicContext += "- Telegram Bot: connesso\n";
        if (!hasGoogle && !hasTelegram) dynamicContext += "- Nessun connettore attivo\n";

        dynamicContext += "\nConnettori disponibili ma non attivi:\n";
        if (!hasGoogle) dynamicContext += "- Google Workspace (vai su Plugin per collegare)\n";
        if (!hasTelegram) dynamicContext += "- Telegram Bot (vai su Plugin per collegare)\n";
        dynamicContext += "- Microsoft 365 (prossimamente)\n";

        if (!hasClaudeKey) dynamicContext += "\n⚠️ API key Claude NON configurata!\n";

        dynamicContext += "--- FINE STATO ---\n\nUsa queste informazioni per rispondere. NON creare agenti duplicati. Se l'utente chiede qualcosa che richiede un connettore non attivo, suggerisci di attivarlo da Plugin.";
      } catch (e) {
        console.error("Dynamic context error:", e);
      }

      systemPrompt += dynamicContext;

      // Build messages from history
      type ApiMessage = { role: "user" | "assistant"; content: unknown };
      const messages: ApiMessage[] = [];
      if (history && Array.isArray(history)) {
        for (const msg of history.slice(-20)) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      messages.push({ role: "user", content: message });

      // Save user message to DB
      if (actor.userId) {
        await saveChatMessage(companyId, actor.userId, "user", message);
      }

      // Multi-turn tool loop
      const MAX_TURNS = 8;
      let finalText = "";

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemPrompt,
            messages,
            tools: TOOLS,
          }),
        });

        if (!claudeRes.ok) {
          const errText = await claudeRes.text();
          console.error("Claude API error:", claudeRes.status, errText);
          res.write("data: " + JSON.stringify({ type: "content_block_delta", delta: { text: "Errore comunicazione Claude AI" } }) + "\n\n");
          break;
        }

        const data = await claudeRes.json() as {
          content?: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
          stop_reason?: string;
        };

        const content = data.content || [];
        const textBlocks = content.filter((c) => c.type === "text");
        const toolUseBlocks = content.filter((c) => c.type === "tool_use");

        // Stream text blocks
        for (const block of textBlocks) {
          if (block.text) {
            finalText += block.text;
            res.write("data: " + JSON.stringify({ type: "content_block_delta", delta: { text: block.text } }) + "\n\n");
          }
        }

        // If no tool calls, done
        if (!toolUseBlocks.length || data.stop_reason === "end_turn") {
          break;
        }

        // Stream tool activity
        for (const block of toolUseBlocks) {
          res.write("data: " + JSON.stringify({ type: "content_block_delta", delta: { text: "\n🔧 Esecuzione: " + block.name + "...\n" } }) + "\n\n");
        }

        // Add assistant message
        messages.push({ role: "assistant", content });

        // Execute tools
        const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
        for (const block of toolUseBlocks) {
          const result = await executeChatTool(
            block.name || "unknown",
            (block.input || {}) as ToolInput,
            db,
            companyId,
            resolvedAgentId,
          );
          toolResults.push({ type: "tool_result", tool_use_id: block.id || "", content: result });
          // tool result logged silently
        }

        messages.push({ role: "user", content: toolResults });
      }

      // Save assistant response to DB
      if (actor?.userId && finalText) {
        await saveChatMessage(companyId, actor.userId, "assistant", finalText);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Errore nella chat" });
      } else {
        res.write("data: " + JSON.stringify({ type: "content_block_delta", delta: { text: "Errore interno" } }) + "\n\n");
        res.end();
      }
    }
  });

  return router;
}
