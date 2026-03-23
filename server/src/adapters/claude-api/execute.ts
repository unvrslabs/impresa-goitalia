import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";

// Pricing per model (USD per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-haiku-4-20250414": { input: 0.25, output: 1.25 },
};
const DEFAULT_PRICING = { input: 3, output: 15 };

const MAX_TOOL_TURNS = 10;

// ---- Tool definitions for Anthropic API ----
const TOOLS = [
  {
    name: "lista_agenti",
    description: "Elenca tutti gli agenti della company con il loro stato attuale. Usa questo tool per sapere chi è disponibile e cosa fanno.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "crea_task",
    description: "Crea un nuovo task (issue) e lo assegna a un agente. Usa questo tool per delegare lavoro agli agenti specializzati.",
    input_schema: {
      type: "object" as const,
      properties: {
        titolo: { type: "string", description: "Titolo breve del task" },
        descrizione: { type: "string", description: "Descrizione dettagliata di cosa fare" },
        agente_id: { type: "string", description: "ID dell'agente a cui assegnare il task" },
        priorita: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "Priorità del task" },
      },
      required: ["titolo", "descrizione", "agente_id"],
    },
  },
  {
    name: "stato_task",
    description: "Controlla lo stato dei task attivi. Puoi filtrare per agente o vedere tutti i task.",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "Filtra per agente specifico (opzionale)" },
        stato: { type: "string", enum: ["todo", "in_progress", "done", "all"], description: "Filtra per stato (default: all)" },
      },
      required: [] as string[],
    },
  },
  {
    name: "commenta_task",
    description: "Aggiungi un commento o istruzione a un task esistente.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string", description: "ID del task" },
        commento: { type: "string", description: "Il commento da aggiungere" },
      },
      required: ["task_id", "commento"],
    },
  },
  {
    name: "crea_agente",
    description: "Crea un nuovo agente specializzato per la company.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome dell'agente (es: Il Ragioniere)" },
        titolo: { type: "string", description: "Ruolo dell'agente (es: Contabilità e Fatturazione)" },
        competenze: { type: "string", description: "Descrizione delle competenze" },
        istruzioni: { type: "string", description: "Prompt di sistema / istruzioni operative dettagliate" },
      },
      required: ["nome", "titolo", "competenze", "istruzioni"],
    },
  },
];

type ToolInput = Record<string, unknown>;
type Message = { role: "user" | "assistant"; content: unknown };
type ContentBlock = { type: string; id?: string; name?: string; input?: unknown; text?: string };

/**
 * Execute a tool call internally (no external HTTP — direct DB operations via ctx)
 */
async function executeTool(
  toolName: string,
  toolInput: ToolInput,
  ctx: AdapterExecutionContext,
): Promise<string> {
  const companyId = ctx.agent.companyId;
  const agentId = ctx.agent.id;
  const baseUrl = "http://127.0.0.1:" + (process.env.PORT || "3100");
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // Use internal API calls with agent auth header
  const internalFetch = async (path: string, opts?: RequestInit) => {
    const url = baseUrl + "/api" + path;
    const res = await fetch(url, {
      ...opts,
      headers: { ...headers, "x-paperclip-internal": "true", "x-paperclip-agent-id": agentId, "x-paperclip-company-id": companyId },
    });
    return res;
  };

  try {
    switch (toolName) {
      case "lista_agenti": {
        const res = await internalFetch("/companies/" + companyId + "/agents");
        if (!res.ok) return "Errore nel recupero agenti: " + res.status;
        const agentList = await res.json() as Array<Record<string, unknown>>;
        return agentList.map((a) =>
          "- " + (a.name || "?") + " (" + (a.title || a.role || "?") + ") — stato: " + (a.status || "?") + " — id: " + a.id
        ).join("\n") || "Nessun agente trovato.";
      }

      case "crea_task": {
        const input = toolInput as { titolo: string; descrizione: string; agente_id: string; priorita?: string };
        const res = await internalFetch("/companies/" + companyId + "/issues", {
          method: "POST",
          body: JSON.stringify({
            title: input.titolo,
            description: input.descrizione,
            assigneeAgentId: input.agente_id,
            priority: input.priorita || "medium",
            status: "todo",
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          return "Errore creazione task: " + res.status + " — " + errText;
        }
        const issue = await res.json() as Record<string, unknown>;
        return "Task creato: " + (issue.identifier || issue.id) + " — " + input.titolo + " (assegnato a agente " + input.agente_id + ")";
      }

      case "stato_task": {
        const input = toolInput as { agente_id?: string; stato?: string };
        let path = "/companies/" + companyId + "/issues";
        const params: string[] = [];
        if (input.stato && input.stato !== "all") params.push("status=" + input.stato);
        if (input.agente_id) params.push("assigneeAgentId=" + input.agente_id);
        if (params.length) path += "?" + params.join("&");
        const res = await internalFetch(path);
        if (!res.ok) return "Errore nel recupero task: " + res.status;
        const issueList = await res.json() as Array<Record<string, unknown>>;
        if (!issueList.length) return "Nessun task trovato.";
        return issueList.map((i) =>
          "- [" + (i.status || "?") + "] " + (i.identifier || "") + ": " + (i.title || "?")
        ).join("\n");
      }

      case "commenta_task": {
        const input = toolInput as { task_id: string; commento: string };
        const res = await internalFetch("/issues/" + input.task_id + "/comments", {
          method: "POST",
          body: JSON.stringify({ body: input.commento }),
        });
        if (!res.ok) return "Errore nell'aggiunta commento: " + res.status;
        return "Commento aggiunto al task " + input.task_id;
      }

      case "crea_agente": {
        const input = toolInput as { nome: string; titolo: string; competenze: string; istruzioni: string };
        const res = await internalFetch("/companies/" + companyId + "/agents", {
          method: "POST",
          body: JSON.stringify({
            name: input.nome,
            title: input.titolo,
            capabilities: input.competenze,
            adapterType: "claude_api",
            adapterConfig: { promptTemplate: input.istruzioni },
            reportsTo: agentId,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          return "Errore creazione agente: " + res.status + " — " + errText;
        }
        const newAgent = await res.json() as Record<string, unknown>;
        return "Agente creato: " + input.nome + " (" + input.titolo + ") — id: " + newAgent.id;
      }

      default:
        return "Tool sconosciuto: " + toolName;
    }
  } catch (err) {
    return "Errore esecuzione tool " + toolName + ": " + (err instanceof Error ? err.message : String(err));
  }
}

/**
 * claude_api adapter — calls the Anthropic Messages API with tool_use support.
 * Supports multi-turn conversations where Claude can use tools to orchestrate work.
 */
export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const startTime = Date.now();

  const apiKey = (ctx.context.claudeApiKey as string) || (ctx.config.apiKey as string);
  if (!apiKey) {
    await ctx.onLog("stderr", "Errore: API key Claude non configurata. Vai su Impostazioni per inserirla.\n");
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "Claude API key not configured",
      errorCode: "MISSING_API_KEY",
    };
  }

  const agentName = ctx.agent.name || "Agent";
  const agentObj = ctx.agent as unknown as Record<string, unknown>;
  const agentCapabilities = (agentObj.capabilities as string) || "";
  const agentTitle = (agentObj.title as string) || "";
  const model = (ctx.config.model as string) || "claude-sonnet-4-20250514";
  const promptTemplate = (ctx.config.promptTemplate as string) || "";

  const taskTitle = (ctx.context.taskTitle as string) || "";
  const taskDescription = (ctx.context.taskDescription as string) || "";
  const wakeReason = (ctx.context.wakeReason as string) || "heartbeat";
  const wakeComment = (ctx.context.wakeComment as string) || "";
  const companyName = (ctx.context.companyName as string) || "";

  const systemPrompt = promptTemplate || `Sei ${agentName}, un agente AI che lavora per l'azienda "${companyName}".

Il tuo ruolo: ${agentTitle}
Le tue competenze: ${agentCapabilities}

Hai a disposizione dei tool per gestire l'azienda:
- lista_agenti: per vedere gli agenti disponibili
- crea_task: per creare task e assegnarli agli agenti
- stato_task: per controllare lo stato dei lavori
- commenta_task: per aggiungere istruzioni ai task
- crea_agente: per creare nuovi agenti specializzati

Istruzioni:
- Rispondi SEMPRE in italiano
- Sii professionale, conciso e orientato all'azione
- Usa i tool per eseguire le richieste, non limitarti a descrivere cosa faresti
- Quando completi un'azione, riporta cosa hai fatto e il risultato
- Se hai bisogno di informazioni, usa i tool per ottenerle`;

  let userMessage = "";
  if (taskTitle) {
    userMessage = `Task assegnato: ${taskTitle}`;
    if (taskDescription) userMessage += `\n\nDescrizione: ${taskDescription}`;
  }
  if (wakeComment) userMessage += `\n\nCommento: ${wakeComment}`;
  if (!userMessage) {
    userMessage = `Motivo attivazione: ${wakeReason}. Controlla se ci sono task da completare e riporta il tuo stato.`;
  }

  await ctx.onLog("stdout", `[${agentName}] Elaborazione in corso con ${model}...\n`);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let actualModel = model;
  let finalText = "";

  const messages: Message[] = [{ role: "user", content: userMessage }];

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages,
          tools: TOOLS,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        const errBody = await response.text();
        await ctx.onLog("stderr", `Errore API Claude (${status}): ${errBody}\n`);
        return {
          exitCode: 1,
          signal: null,
          timedOut: false,
          errorMessage: `Claude API error: ${status}`,
          errorCode: "API_ERROR",
        };
      }

      const data = await response.json() as {
        content?: ContentBlock[];
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
        stop_reason?: string;
      };

      totalInputTokens += data.usage?.input_tokens || 0;
      totalOutputTokens += data.usage?.output_tokens || 0;
      if (data.model) actualModel = data.model;

      const content = data.content || [];
      const textBlocks = content.filter((c) => c.type === "text").map((c) => c.text || "");
      const toolUseBlocks = content.filter((c) => c.type === "tool_use");

      // Log any text output
      if (textBlocks.length) {
        const text = textBlocks.join("\n");
        finalText += text + "\n";
        await ctx.onLog("stdout", text + "\n");
      }

      // If no tool calls, we're done
      if (!toolUseBlocks.length || data.stop_reason === "end_turn") {
        break;
      }

      // Add assistant message to conversation
      messages.push({ role: "assistant", content });

      // Execute each tool call and build tool_result messages
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const toolBlock of toolUseBlocks) {
        const toolName = toolBlock.name || "unknown";
        const toolInput = (toolBlock.input || {}) as ToolInput;
        await ctx.onLog("stdout", `\n[Tool: ${toolName}]\n`);

        const result = await executeTool(toolName, toolInput, ctx);
        await ctx.onLog("stdout", result + "\n");

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id || "",
          content: result,
        });
      }

      // Add tool results as user message
      messages.push({ role: "user", content: toolResults });
    }

    const pricing = MODEL_PRICING[actualModel] || DEFAULT_PRICING;
    const totalCostUsd = (totalInputTokens / 1_000_000) * pricing.input + (totalOutputTokens / 1_000_000) * pricing.output;
    const elapsedMs = Date.now() - startTime;

    await ctx.onLog("stdout", `\n[Completato in ${(elapsedMs / 1000).toFixed(1)}s | ${totalInputTokens} in / ${totalOutputTokens} out | $${totalCostUsd.toFixed(4)}]\n`);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      provider: "anthropic",
      model: actualModel,
      costUsd: totalCostUsd,
      billingType: "api",
      summary: finalText.trim().slice(0, 500),
      resultJson: { responseText: finalText.trim(), inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.onLog("stderr", `Errore: ${message}\n`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: message,
      errorCode: "EXECUTION_ERROR",
    };
  }
}
