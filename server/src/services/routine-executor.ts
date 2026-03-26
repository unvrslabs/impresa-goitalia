/**
 * RoutineExecutor — executes a routine run by calling the assigned agent via Claude API.
 *
 * If approval_required is true, the agent prepares a draft without executing the final action.
 * If false, the agent executes everything autonomously.
 */
import type { Db } from "@goitalia/db";
import { routines, routineRuns, agents, companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../utils/crypto.js";
import {
  TOOLS,
  TOOL_CONNECTOR,
  filterToolsForAgent,
  getAgentConnectorsFromDb,
  executeChatTool,
} from "../routes/chat.js";

export function createRoutineExecutor(db: Db) {
  async function executeRun(runId: string, routineId: string): Promise<void> {
    // 1. Load routine
    const routine = await db
      .select()
      .from(routines)
      .where(eq(routines.id, routineId))
      .then((r) => r[0]);
    if (!routine || !routine.assigneeAgentId) {
      await db
        .update(routineRuns)
        .set({ status: "failed", failureReason: "Routine o agente non trovato" })
        .where(eq(routineRuns.id, runId));
      return;
    }

    // 2. Load agent
    const agent = await db
      .select()
      .from(agents)
      .where(eq(agents.id, routine.assigneeAgentId))
      .then((r) => r[0]);
    if (!agent) {
      await db
        .update(routineRuns)
        .set({ status: "failed", failureReason: "Agente non trovato: " + routine.assigneeAgentId })
        .where(eq(routineRuns.id, runId));
      return;
    }

    // 3. Get Claude API key
    const secret = await db
      .select()
      .from(companySecrets)
      .where(
        and(
          eq(companySecrets.companyId, routine.companyId),
          eq(companySecrets.name, "claude_api_key"),
        ),
      )
      .then((r) => r[0]);
    if (!secret?.description) {
      await db
        .update(routineRuns)
        .set({ status: "failed", failureReason: "API key Claude non configurata" })
        .where(eq(routineRuns.id, runId));
      return;
    }
    const apiKey = decrypt(secret.description);

    // 4. Build system prompt
    const adapterConfig = (agent.adapterConfig as Record<string, unknown>) ?? {};
    const promptTemplate =
      typeof adapterConfig.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
    const customInstructions =
      typeof adapterConfig.customInstructions === "string" ? adapterConfig.customInstructions : "";
    const capabilities = agent.capabilities ?? "";

    const basePrompt =
      promptTemplate ||
      `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.\nCompetenze: ${capabilities}\nEsegui il compito assegnato usando i tool a disposizione. Rispondi in italiano, in modo conciso e operativo.`;

    let systemPrompt = customInstructions.trim()
      ? basePrompt + "\n\n## ISTRUZIONI AGGIUNTIVE\n" + customInstructions
      : basePrompt;

    // 5. If approval required, add draft mode instruction
    const approvalRequired = routine.approvalRequired;
    if (approvalRequired) {
      systemPrompt +=
        "\n\n## MODALITA' BOZZA\nIMPORTANTE: Prepara il contenuto completo ma NON eseguire l'azione finale (non pubblicare, non inviare, non creare). Restituisci SOLO la bozza pronta per l'approvazione del cliente. Descrivi cosa faresti e mostra il contenuto preparato.";
    }

    // 6. Get agent connectors and filter tools
    const legacyConnectors = (adapterConfig.connectors as Record<string, boolean>) || {};
    const connectors = await getAgentConnectorsFromDb(db, agent.id, legacyConnectors);
    const agentTools = filterToolsForAgent(agent.role || "general", connectors);

    // 7. Multi-turn tool loop
    const messages: Array<{ role: string; content: unknown }> = [
      {
        role: "user",
        content:
          routine.description || routine.title || "Esegui l'attività programmata.",
      },
    ];

    let result = "";
    const MAX_TURNS = 5;
    const model =
      (typeof adapterConfig.model === "string" && adapterConfig.model) ||
      "claude-haiku-4-5-20251001";

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
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
          tools: agentTools,
        }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        await db
          .update(routineRuns)
          .set({
            status: "failed",
            failureReason: "Claude API error: " + errText.slice(0, 500),
          })
          .where(eq(routineRuns.id, runId));
        return;
      }

      const data = (await claudeRes.json()) as {
        content?: Array<{
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
        }>;
        stop_reason?: string;
      };

      // Collect text blocks
      for (const block of data.content || []) {
        if (block.type === "text" && block.text) result += block.text;
      }

      // Check for tool use
      const toolBlocks = (data.content || []).filter((b) => b.type === "tool_use");
      if (toolBlocks.length === 0 || data.stop_reason === "end_turn") break;

      // Execute tools
      const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];
      for (const toolBlock of toolBlocks) {
        const toolResult = await executeChatTool(
          toolBlock.name!,
          toolBlock.input as Record<string, unknown>,
          db,
          routine.companyId,
          agent.id,
          apiKey,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id!,
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
        });
      }

      messages.push({ role: "assistant", content: data.content });
      messages.push({ role: "user", content: toolResults });
    }

    // 8. Save result
    const finalStatus = approvalRequired ? "pending_approval" : "completed";
    await db
      .update(routineRuns)
      .set({
        status: finalStatus,
        triggerPayload: { result, approval_required: approvalRequired },
        completedAt: approvalRequired ? null : new Date(),
      })
      .where(eq(routineRuns.id, runId));

    console.log(
      `[routine-executor] run ${runId} for routine "${routine.title}" finished: ${finalStatus}`,
    );
  }

  return { executeRun };
}
