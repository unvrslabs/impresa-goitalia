import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, agents, companyMemberships } from "@goitalia/db";
import { eq, and, inArray } from "drizzle-orm";
import { decryptSecret } from "./onboarding.js";
import { issues } from "@goitalia/db";

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
];

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
          capabilities: agents.capabilities,
        }).from(agents).where(eq(agents.companyId, companyId));
        return rows.map((a) =>
          "- " + (a.name || "?") + " (" + (a.title || a.role || "?") + ") — stato: " + (a.status || "?") + " — id: " + a.id
        ).join("\n") || "Nessun agente trovato.";
      }

      case "crea_task": {
        const input = toolInput as { titolo: string; descrizione: string; agente_id: string; priorita?: string };
        // Use internal API to create issue (triggers wakeup)
        const baseUrl = "http://127.0.0.1:" + (process.env.PORT || "3100");
        const res = await fetch(baseUrl + "/api/companies/" + companyId + "/issues", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-paperclip-internal": "true",
            "x-paperclip-agent-id": agentId,
            "x-paperclip-company-id": companyId,
          },
          body: JSON.stringify({
            title: input.titolo,
            description: input.descrizione,
            assigneeAgentId: input.agente_id,
            priority: input.priorita || "medium",
            status: "todo",
          }),
        });
        if (!res.ok) return "Errore creazione task: " + res.status;
        const issue = await res.json() as Record<string, unknown>;
        return "Task creato: " + (issue.identifier || issue.id) + " — " + input.titolo;
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
        }).from(issues).where(and(...conditions));
        if (!rows.length) return "Nessun task trovato.";
        return rows.map((i) => "- [" + i.status + "] " + (i.identifier || "") + ": " + i.title).join("\n");
      }

      case "commenta_task": {
        const input = toolInput as { task_id: string; commento: string };
        const baseUrl = "http://127.0.0.1:" + (process.env.PORT || "3100");
        const res = await fetch(baseUrl + "/api/issues/" + input.task_id + "/comments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-paperclip-internal": "true",
            "x-paperclip-agent-id": agentId,
            "x-paperclip-company-id": companyId,
          },
          body: JSON.stringify({ body: input.commento }),
        });
        if (!res.ok) return "Errore: " + res.status;
        return "Commento aggiunto al task " + input.task_id;
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

      const apiKey = decryptSecret(secret.description);

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
- stato_task: per controllare lo stato dei lavori
- commenta_task: per aggiungere istruzioni ai task

Rispondi sempre in italiano, in modo professionale e conciso.
Usa i tool per eseguire le richieste, non limitarti a descrivere cosa faresti.`;
        }
      }

      // Build messages from history
      type ApiMessage = { role: "user" | "assistant"; content: unknown };
      const messages: ApiMessage[] = [];
      if (history && Array.isArray(history)) {
        for (const msg of history.slice(-20)) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      messages.push({ role: "user", content: message });

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
          res.write("data: " + JSON.stringify({ type: "error", error: "Errore comunicazione Claude AI" }) + "\n\n");
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
            res.write("data: " + JSON.stringify({ type: "text", text: block.text }) + "\n\n");
          }
        }

        // If no tool calls, done
        if (!toolUseBlocks.length || data.stop_reason === "end_turn") {
          break;
        }

        // Stream tool activity
        for (const block of toolUseBlocks) {
          res.write("data: " + JSON.stringify({ type: "tool_start", tool: block.name }) + "\n\n");
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
          res.write("data: " + JSON.stringify({ type: "tool_result", tool: block.name, result }) + "\n\n");
        }

        messages.push({ role: "user", content: toolResults });
      }

      res.write("data: " + JSON.stringify({ type: "done" }) + "\n\n");
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Errore nella chat" });
      } else {
        res.write("data: " + JSON.stringify({ type: "error", error: "Errore interno" }) + "\n\n");
        res.end();
      }
    }
  });

  return router;
}
