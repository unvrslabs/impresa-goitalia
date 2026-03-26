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
    name: "esegui_task_agente",
    description: "Delega un compito a un agente specifico. L'agente lo eseguirà usando i suoi tool e connettori, poi ti restituirà il risultato. Usa lista_agenti per trovare l'agente giusto.",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "ID dell'agente a cui delegare il compito" },
        istruzioni: { type: "string", description: "Istruzioni dettagliate su cosa deve fare l'agente" },
      },
      required: ["agente_id", "istruzioni"],
    },
  },
  {
    name: "salva_info_azienda",
    description: "Salva o aggiorna le informazioni dell'azienda del cliente in memoria (ragione sociale, P.IVA, CF, indirizzo, settore, PEC, telefono, email, sito web, ecc.)",
    input_schema: {
      type: "object" as const,
      properties: {
        ragione_sociale: { type: "string", description: "Ragione sociale / nome azienda" },
        partita_iva: { type: "string", description: "Partita IVA" },
        codice_fiscale: { type: "string", description: "Codice Fiscale" },
        indirizzo: { type: "string", description: "Indirizzo sede legale" },
        citta: { type: "string", description: "Città" },
        cap: { type: "string", description: "CAP" },
        provincia: { type: "string", description: "Provincia (sigla)" },
        settore: { type: "string", description: "Settore / attività principale" },
        pec: { type: "string", description: "Indirizzo PEC" },
        telefono: { type: "string", description: "Telefono" },
        email: { type: "string", description: "Email di contatto" },
        codice_sdi: { type: "string", description: "Codice destinatario SDI" },
        sito_web: { type: "string", description: "Sito web" },
        note: { type: "string", description: "Note aggiuntive sull'azienda" },
      },
      required: [],
    },
  },
  {
    name: "salva_nota",
    description: "Salva una nota o informazione importante da ricordare per il futuro. Usa questo quando il cliente dice 'ricorda che...', quando apprendi qualcosa di rilevante, o per salvare preferenze e decisioni.",
    input_schema: {
      type: "object" as const,
      properties: {
        contenuto: { type: "string", description: "Il contenuto della nota da salvare" },
        categoria: { type: "string", description: "Categoria opzionale (preferenze, decisioni, contatti, altro)" },
      },
      required: ["contenuto"],
    },
  },
  {
    name: "leggi_memoria",
    description: "Leggi tutte le informazioni salvate in memoria sull'azienda del cliente: dati aziendali, note, preferenze.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
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

  // OpenAPI.it tools
  {
    name: "cerca_azienda_piva",
    description: "Cerca informazioni su un'azienda italiana tramite P.IVA o Codice Fiscale usando OpenAPI.it. Restituisce denominazione, indirizzo, PEC, stato attività, codice ATECO, ecc.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Partita IVA o Codice Fiscale dell'azienda" },
        livello: { type: "string", enum: ["start", "advanced", "full"], description: "Livello di dettaglio: start (base), advanced (dettagliato), full (completo)" },
      },
      required: ["query"],
    },
  },
  {
    name: "cerca_azienda_nome",
    description: "Cerca aziende italiane per denominazione/nome usando OpenAPI.it.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome o denominazione dell'azienda da cercare" },
      },
      required: ["nome"],
    },
  },
  {
    name: "credit_score",
    description: "Ottieni il credit score e la valutazione di rischio di un'azienda tramite P.IVA usando OpenAPI.it Risk.",
    input_schema: {
      type: "object" as const,
      properties: {
        piva: { type: "string", description: "Partita IVA dell'azienda" },
        livello: { type: "string", enum: ["start", "advanced", "top"], description: "start: score base, advanced: rating A1-C3 + severity, top: completo con storico e limite credito" },
      },
      required: ["piva"],
    },
  },
  {
    name: "codice_sdi",
    description: "Recupera il codice destinatario SDI di un'azienda tramite P.IVA per la fatturazione elettronica.",
    input_schema: {
      type: "object" as const,
      properties: {
        piva: { type: "string", description: "Partita IVA dell'azienda" },
      },
      required: ["piva"],
    },
  },
  {
    name: "cerca_cap",
    description: "Cerca informazioni su un CAP italiano: comune, provincia, regione, prefisso telefonico.",
    input_schema: {
      type: "object" as const,
      properties: {
        cap: { type: "string", description: "Codice di Avviamento Postale (es: 00100)" },
      },
      required: ["cap"],
    },
  },
];

// Map each tool to the connector key it requires. null = always available.
const TOOL_CONNECTOR: Record<string, string | null> = {
  lista_agenti: null,
  crea_task: null,
  stato_task: null,
  commenta_task: null,
  elimina_agente: null,
  crea_agente: null,
  esegui_task_agente: null,
  salva_info_azienda: null,
  salva_nota: null,
  leggi_memoria: null,
  // Fatture in Cloud
  lista_clienti: "fic",
  cerca_cliente: "fic",
  crea_cliente: "fic",
  crea_fattura: "fic",
  lista_fatture: "fic",
  invia_fattura_sdi: "fic",
  // OpenAPI.it
  cerca_azienda_piva: "oai_company",
  cerca_azienda_nome: "oai_company",
  codice_sdi: "oai_company",
  credit_score: "oai_risk",
  cerca_cap: "oai_cap",
};


const CEO_SYSTEM_PROMPT = `Sei il CEO, il direttore operativo AI dell'azienda del cliente sulla piattaforma GoItalIA.

## IL TUO RUOLO
Sei il punto di riferimento principale per il cliente (PMI). Coordini tutto: agenti, connettori, task, analisi.
Il cliente parla SOLO con te. Tu decidi cosa fare, a chi delegare, e rispondi sempre in prima persona.

## REGOLE FONDAMENTALI
- Rispondi SEMPRE in italiano, in modo professionale ma amichevole
- Sii conciso e operativo: fai le cose, non descrivere cosa faresti
- Usa i tool per eseguire le richieste, non limitarti a parlare
- Se non hai le info necessarie, chiedi al cliente
- Se un task richiede un connettore non attivo, suggerisci di attivarlo da Connettori nel menu

## ONBOARDING NUOVO CLIENTE
Quando un nuovo cliente arriva (nessuna info aziendale in memoria):
1. Presentati: "Ciao! Sono il CEO della tua azienda AI su GoItalIA."
2. Chiedi le informazioni aziendali essenziali:
   - Ragione sociale
   - Partita IVA
   - Codice Fiscale
   - Indirizzo sede
   - Settore/attività
   - PEC
   - Telefono
   - Email di contatto
   - Sito web (se c'è)
3. Salva TUTTO in memoria con salva_info_azienda
4. DOPO IL RIEPILOGO: mostra i dati ricevuti, elenca quelli mancanti (se ce ne sono), poi scrivi ESATTAMENTE: "Perfetto! Premi il bottone qui sotto per andare ai Connettori e collegare i tuoi servizi (Google, WhatsApp, Telegram, ecc.). Dopo aver collegato i connettori potrai creare i tuoi agenti AI specializzati."
5. NON proporre agenti da creare. NON elencare agenti possibili. NON parlare di agenti. Il cliente deve PRIMA collegare i connettori. Rispondi SOLO con il riepilogo dati + invito ad andare su Connettori.

## GESTIONE AGENTI
- Usa lista_agenti per vedere chi c'è
- Usa crea_agente per creare nuovi agenti specializzati
- Usa esegui_task_agente per delegare compiti agli agenti che hanno i connettori giusti
- Ogni agente ha i suoi connettori: delega solo a chi ha gli strumenti per farlo
- NON fare tu il lavoro se c'è un agente specializzato — delega!

## GESTIONE CONNETTORI
Connettori disponibili sulla piattaforma:
- **Google Workspace**: Gmail, Calendar, Drive, Sheets, Docs
- **Telegram**: bot per customer service, auto-reply
- **WhatsApp**: messaggi, vocali, auto-reply via WaSender
- **Instagram + Facebook**: post, engagement, analytics via Meta
- **LinkedIn**: profilo, post, publishing
- **Fal.ai**: genera immagini (Nano Banana 2) e video (Veo 3.1, Kling v3, Seedance 1.5)
- **Fatture in Cloud**: clienti, fatture, SDI, fatturazione elettronica
- **OpenAPI.it**: dati aziendali, visure camerali, risk score, codice SDI, CAP, PEC

## TOOL DISPONIBILI

### Gestione interna (sempre disponibili)
- lista_agenti: vedi tutti gli agenti e il loro stato
- crea_task: crea un task e assegnalo a un agente
- stato_task: controlla lo stato dei lavori
- commenta_task: aggiungi istruzioni a un task
- crea_agente: crea un nuovo agente specializzato
- elimina_agente: elimina un agente (MAI eliminare il CEO)
- esegui_task_agente: delega un compito a un agente specifico

### Memoria (sempre disponibili)
- salva_info_azienda: salva/aggiorna le informazioni dell'azienda del cliente
- salva_nota: salva una nota o informazione da ricordare
- leggi_memoria: leggi tutte le info salvate sull'azienda

### Fatture in Cloud (se connesso)
- lista_clienti, cerca_cliente, crea_cliente
- crea_fattura, lista_fatture, invia_fattura_sdi

### OpenAPI.it (se connesso)
- cerca_azienda_piva: info azienda da P.IVA o CF
- cerca_azienda_nome: cerca aziende per nome
- credit_score: rating di rischio aziendale
- codice_sdi: codice destinatario SDI
- cerca_cap: info su codice postale

## MEMORIA
Hai accesso alla memoria dell'azienda. Usala SEMPRE:
- Prima di rispondere, controlla se hai già le info in memoria
- Quando il cliente ti dà info importanti, salvale subito
- Se il cliente dice "ricorda che...", usa salva_nota immediatamente
- Le info aziendali vanno in salva_info_azienda (strutturate)
- Tutto il resto va in salva_nota (note libere)

## STILE DI COMUNICAZIONE
- Professionale ma umano, mai robotico
- Usa "noi" quando parli dell'azienda del cliente
- Se fai un'operazione, conferma cosa hai fatto
- Se deleghi a un agente, dì "Ho chiesto a [nome agente] di..."
- Se qualcosa va storto, spiega il problema e proponi una soluzione`;

function filterToolsForAgent(agentRole: string, connectors: Record<string, boolean>): typeof TOOLS {
  // CEO/Direttore gets all tools
  if (agentRole === "ceo") return TOOLS;
  
  return TOOLS.filter((tool) => {
    const required = TOOL_CONNECTOR[tool.name];
    // Tool with no connector requirement = always available
    if (required === null || required === undefined) return true;
    // Check if connector is explicitly enabled (default is false for non-ceo)
    return connectors[required] === true;
  });
}




async function getOaiToken(db: Db, companyId: string, service: string): Promise<string | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openapi_it_creds")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try {
    const creds = JSON.parse(decrypt(secret.description));
    return creds.tokens?.[service] || null;
  } catch { return null; }
}
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


async function executeAgentTask(
  db: Db,
  companyId: string,
  targetAgentId: string,
  istruzioni: string,
  apiKey: string,
): Promise<string> {
  // 1. Load the target agent
  const agent = await db.select().from(agents)
    .where(eq(agents.id, targetAgentId))
    .then((rows) => rows[0]);
  
  if (!agent) return "Errore: agente non trovato con ID " + targetAgentId;

  const adapterConfig = agent.adapterConfig as Record<string, unknown> | null;
  const agentModel = (typeof adapterConfig?.model === "string" && adapterConfig.model) || "claude-haiku-4-5-20251001";
  const connectors = (adapterConfig?.connectors as Record<string, boolean>) || {};
  const promptTemplate = typeof adapterConfig?.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
  const capabilities = agent.capabilities ?? "";

  // 2. Build agent system prompt
  const systemPrompt = promptTemplate || `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.\nCompetenze: ${capabilities}\nEsegui il compito assegnato usando i tool a disposizione. Rispondi in italiano, in modo conciso e operativo.`;

  // 3. Get agent's tools based on connectors
  const agentTools = filterToolsForAgent(agent.role || "general", connectors);
  
  if (agentTools.length === 0) {
    return "Errore: l'agente " + agent.name + " non ha connettori attivi. Attiva i connettori dalla pagina dell'agente.";
  }

  // 4. Execute multi-turn tool loop (max 3 turns)
  const MAX_AGENT_TURNS = 3;
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: istruzioni },
  ];

  let finalResult = "";

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: agentModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: agentTools,
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("[agent-task] Claude error for", agent.name, ":", claudeRes.status, errText);
      return "Errore: l'agente " + agent.name + " non ha potuto completare il task (errore Claude API).";
    }

    const data = await claudeRes.json() as {
      content?: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
      stop_reason?: string;
    };

    const content = data.content || [];
    const textBlocks = content.filter((c) => c.type === "text");
    const toolUseBlocks = content.filter((c) => c.type === "tool_use");

    // Collect text
    for (const block of textBlocks) {
      if (block.text) finalResult += block.text;
    }

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0 || data.stop_reason === "end_turn") {
      break;
    }

    // Execute tool calls
    messages.push({ role: "assistant", content });

    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const toolUse of toolUseBlocks) {
      console.log("[agent-task]", agent.name, "calls tool:", toolUse.name);
      const result = await executeChatTool(
        toolUse.name || "",
        (toolUse.input || {}) as ToolInput,
        db,
        companyId,
        targetAgentId,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id || "",
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return finalResult || "Task completato ma nessuna risposta dall'agente.";
}

async function executeChatTool(
  toolName: string,
  toolInput: ToolInput,
  db: Db,
  companyId: string,
  agentId: string,
  apiKey?: string,
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
        const target = await db.select({ id: agents.id, name: agents.name, role: agents.role }).from(agents)
          .where(and(eq(agents.id, input.agente_id), eq(agents.companyId, companyId)))
          .then((rows) => rows[0]);
        if (!target) return "Agente non trovato con id: " + input.agente_id;
        if (target.role === "ceo") return "Il Direttore AI non può essere eliminato.";
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


      case "cerca_azienda_piva": {
        const token = await getOaiToken(db, companyId, "company");
        if (!token) return "OpenAPI.it Company non connesso. Vai su Connettori per collegarlo.";
        const query = toolInput.query as string;
        const livello = (toolInput.livello as string) || "start";
        const r = await fetch(`https://company.openapi.com/IT-${livello}/${encodeURIComponent(query)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore ricerca azienda: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 3000);
      }

      case "cerca_azienda_nome": {
        const token = await getOaiToken(db, companyId, "company");
        if (!token) return "OpenAPI.it Company non connesso. Vai su Connettori per collegarlo.";
        const nome = toolInput.nome as string;
        const r = await fetch(`https://company.openapi.com/IT-name?denomination=${encodeURIComponent(nome)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore ricerca: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 3000);
      }

      case "credit_score": {
        const token = await getOaiToken(db, companyId, "risk");
        if (!token) return "OpenAPI.it Risk non connesso. Vai su Connettori per collegarlo.";
        const piva = toolInput.piva as string;
        const livello = (toolInput.livello as string) || "start";
        const r = await fetch(`https://risk.openapi.com/IT-creditscore-${livello}/${encodeURIComponent(piva)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore credit score: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 3000);
      }

      case "codice_sdi": {
        const token = await getOaiToken(db, companyId, "company");
        if (!token) return "OpenAPI.it Company non connesso. Vai su Connettori per collegarlo.";
        const piva = toolInput.piva as string;
        const r = await fetch(`https://company.openapi.com/IT-sdicode/${encodeURIComponent(piva)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore codice SDI: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 1000);
      }

      case "cerca_cap": {
        const token = await getOaiToken(db, companyId, "cap");
        if (!token) return "OpenAPI.it CAP non connesso. Vai su Connettori per collegarlo.";
        const cap = toolInput.cap as string;
        const r = await fetch(`https://cap.openapi.it/cap?cap=${encodeURIComponent(cap)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore CAP: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 1000);
      }

      case "salva_info_azienda": {
        const fields = toolInput as Record<string, string>;
        // Load existing memory
        const existingMem = await db.execute(sql`SELECT company_info FROM ceo_memory WHERE company_id = ${companyId}`);
        const rows = (existingMem as any).rows || existingMem;
        const existing = rows[0]?.company_info || {};
        // Merge non-empty fields
        const updated: Record<string, string> = { ...existing };
        for (const [k, v] of Object.entries(fields)) {
          if (v && typeof v === "string" && v.trim()) updated[k] = v.trim();
        }
        if (rows.length > 0) {
          await db.execute(sql`UPDATE ceo_memory SET company_info = ${JSON.stringify(updated)}::jsonb, updated_at = NOW() WHERE company_id = ${companyId}`);
        } else {
          await db.execute(sql`INSERT INTO ceo_memory (company_id, company_info) VALUES (${companyId}, ${JSON.stringify(updated)}::jsonb)`);
        }
        const savedFields = Object.keys(fields).filter(k => fields[k]?.trim()).join(", ");
        return "Info azienda aggiornate: " + savedFields;
      }

      case "salva_nota": {
        const { contenuto, categoria } = toolInput as { contenuto: string; categoria?: string };
        if (!contenuto) return "Errore: contenuto della nota obbligatorio.";
        const nota = { contenuto, categoria: categoria || "generale", data: new Date().toISOString().split("T")[0] };
        const memRows = await db.execute(sql`SELECT notes FROM ceo_memory WHERE company_id = ${companyId}`);
        const mRows = (memRows as any).rows || memRows;
        if (mRows.length > 0) {
          const notes = Array.isArray(mRows[0].notes) ? mRows[0].notes : [];
          notes.push(nota);
          await db.execute(sql`UPDATE ceo_memory SET notes = ${JSON.stringify(notes)}::jsonb, updated_at = NOW() WHERE company_id = ${companyId}`);
        } else {
          await db.execute(sql`INSERT INTO ceo_memory (company_id, notes) VALUES (${companyId}, ${JSON.stringify([nota])}::jsonb)`);
        }
        return "Nota salvata: " + contenuto.substring(0, 100);
      }

      case "leggi_memoria": {
        const memResult = await db.execute(sql`SELECT company_info, notes, preferences FROM ceo_memory WHERE company_id = ${companyId}`);
        const memR = (memResult as any).rows || memResult;
        if (memR.length === 0) return "Nessuna informazione salvata in memoria per questa azienda.";
        const mem = memR[0];
        let output = "";
        if (mem.company_info && Object.keys(mem.company_info).length > 0) {
          output += "DATI AZIENDA:\n";
          for (const [k, v] of Object.entries(mem.company_info)) {
            output += "- " + k + ": " + v + "\n";
          }
        }
        if (mem.notes && Array.isArray(mem.notes) && mem.notes.length > 0) {
          output += "\nNOTE SALVATE:\n";
          for (const n of mem.notes) {
            output += "- [" + (n.categoria || "generale") + " " + (n.data || "") + "] " + n.contenuto + "\n";
          }
        }
        return output || "Memoria vuota.";
      }

      case "esegui_task_agente": {
        if (!apiKey) return "Errore: API key non disponibile per esecuzione agente.";
        const targetId = toolInput.agente_id as string;
        const instructions = toolInput.istruzioni as string;
        if (!targetId || !instructions) return "Errore: agente_id e istruzioni sono obbligatori.";
        console.log("[direttore] Delegating task to agent:", targetId, "->", instructions.substring(0, 100));
        const result = await executeAgentTask(db, companyId, targetId, instructions, apiKey);
        console.log("[direttore] Agent result:", result.substring(0, 200));
        return result;
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
      let agentModel = "claude-opus-4-6";
      let agentRole = "ceo";
      let agentConnectors: Record<string, boolean> = {};
      let resolvedAgentId = agentId || "";

      if (agentId) {
        const agent = await db.select().from(agents)
          .where(eq(agents.id, agentId))
          .then((rows) => rows[0]);

        if (agent) {
          resolvedAgentId = agent.id;
          const adapterConfig = agent.adapterConfig as Record<string, unknown> | null;
          agentRole = agent.role || "general";
          agentConnectors = (adapterConfig?.connectors as Record<string, boolean>) || {};
          const promptTemplate = typeof adapterConfig?.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
          if (typeof adapterConfig?.model === "string" && adapterConfig.model) { agentModel = adapterConfig.model; }
          const capabilities = agent.capabilities ?? "";

          // CEO gets the hardcoded prompt, other agents get their custom prompt
          if (agent.role === "ceo") {
            systemPrompt = CEO_SYSTEM_PROMPT;
          } else {
            systemPrompt = promptTemplate || `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.\n\nCompetenze: ${capabilities}\n\nEsegui il compito assegnato usando i tool a disposizione. Rispondi in italiano, in modo professionale e conciso.`;
          }
        }
      }

      // Load CEO memory
      let memoryContext = "";
      try {
        const memResult = await db.execute(sql`SELECT company_info, notes, preferences FROM ceo_memory WHERE company_id = ${companyId}`);
        const memRows = (memResult as any).rows || memResult;
        if (memRows.length > 0 && memRows[0]) {
          const mem = memRows[0];
          if (mem.company_info && Object.keys(mem.company_info).length > 0) {
            memoryContext += "\n\n--- MEMORIA AZIENDA ---\n";
            for (const [k, v] of Object.entries(mem.company_info)) {
              memoryContext += k + ": " + v + "\n";
            }
          }
          if (mem.notes && Array.isArray(mem.notes) && mem.notes.length > 0) {
            memoryContext += "\nNOTE SALVATE:\n";
            for (const n of (mem.notes as Array<{contenuto: string; categoria?: string; data?: string}>)) {
              memoryContext += "- [" + (n.categoria || "generale") + "] " + n.contenuto + "\n";
            }
          }
          memoryContext += "--- FINE MEMORIA ---";
        }
      } catch (e) { console.error("Memory load error:", e); }
      systemPrompt += memoryContext;

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
        const hasOpenApi = secretNames.includes("openapi_it_creds");

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
        if (hasOpenApi) dynamicContext += "- OpenAPI.it (Dati aziendali, Risk, CAP, SDI): connesso\n";
        if (!hasGoogle && !hasTelegram) dynamicContext += "- Nessun connettore attivo\n";

        dynamicContext += "\nConnettori disponibili ma non attivi:\n";
        if (!hasGoogle) dynamicContext += "- Google Workspace (vai su Connettori per collegare)\n";
        if (!hasTelegram) dynamicContext += "- Telegram Bot (vai su Connettori per collegare)\n";
        dynamicContext += "- Microsoft 365 (prossimamente)\n";

        if (!hasClaudeKey) dynamicContext += "\n⚠️ API key Claude NON configurata!\n";

        dynamicContext += "--- FINE STATO ---\n\nUsa queste informazioni per rispondere. NON creare agenti duplicati. Se l'utente chiede qualcosa che richiede un connettore non attivo, suggerisci di attivarlo da Connettori.";
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
            model: agentModel,
            max_tokens: 4096,
            system: systemPrompt,
            messages,
            tools: agentId ? filterToolsForAgent(agentRole || 'general', agentConnectors || {}) : TOOLS,
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
            apiKey,
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
