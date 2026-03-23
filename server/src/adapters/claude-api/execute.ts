import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";

// Pricing per model (USD per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-haiku-4-20250414": { input: 0.25, output: 1.25 },
};
const DEFAULT_PRICING = { input: 3, output: 15 }; // fallback to Sonnet pricing

/**
 * claude_api adapter — calls the Anthropic Messages API directly.
 * The API key is injected via context.claudeApiKey (decrypted by heartbeat service).
 */
export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const startTime = Date.now();

  // Get API key from context (injected by heartbeat service)
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
  const agentCapabilities = ctx.agent.capabilities || "";
  const agentTitle = (ctx.agent as Record<string, unknown>).title as string || "";
  const model = (ctx.config.model as string) || "claude-sonnet-4-20250514";

  const taskTitle = (ctx.context.taskTitle as string) || "";
  const taskDescription = (ctx.context.taskDescription as string) || "";
  const wakeReason = (ctx.context.wakeReason as string) || "heartbeat";
  const wakeComment = (ctx.context.wakeComment as string) || "";
  const companyName = (ctx.context.companyName as string) || "";

  const systemPrompt = `Sei ${agentName}, un agente AI che lavora per l'azienda "${companyName}".

Il tuo ruolo: ${agentTitle}
Le tue competenze: ${agentCapabilities}

Istruzioni:
- Rispondi SEMPRE in italiano
- Sii professionale, conciso e orientato all'azione
- Quando completi un task, riporta cosa hai fatto e il risultato
- Se hai bisogno di informazioni aggiuntive, chiedi in modo specifico
- Non inventare dati che non hai`;

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

  try {
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
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const status = response.status;
      await ctx.onLog("stderr", `Errore API Claude (${status})\n`);
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: `Claude API error: ${status}`,
        errorCode: "API_ERROR",
      };
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };

    const responseText = data.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n") || "Nessuna risposta";

    await ctx.onLog("stdout", `\n${responseText}\n`);

    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    const actualModel = data.model || model;

    // Use correct pricing for the model
    const pricing = MODEL_PRICING[actualModel] || DEFAULT_PRICING;
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const totalCostUsd = inputCost + outputCost;

    const elapsedMs = Date.now() - startTime;
    await ctx.onLog("stdout", `\n[Completato in ${(elapsedMs / 1000).toFixed(1)}s | ${inputTokens} in / ${outputTokens} out | $${totalCostUsd.toFixed(4)}]\n`);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      provider: "anthropic",
      model: actualModel,
      costUsd: totalCostUsd,
      billingType: "request",
      summary: responseText.slice(0, 500),
      resultJson: { responseText, inputTokens, outputTokens },
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
