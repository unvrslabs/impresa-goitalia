import type { Db } from "@goitalia/db";
import { companySecrets, agents, companyProfiles, a2aTasks, a2aMessages } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../utils/crypto.js";

/**
 * Process an incoming A2A task by calling the destination company's CEO AI.
 * Runs in background (fire-and-forget) — does not block the caller.
 *
 * The CEO reads the task, classifies it (auto-respond vs needs approval),
 * and writes a response message into a2a_messages.
 */
export async function processIncomingA2ATask(
  db: Db,
  taskId: string,
  toCompanyId: string,
  fromCompanyName: string,
  taskTitle: string,
  taskDescription: string,
  taskType: string,
): Promise<void> {
  try {
    // 1. Get the destination company's Claude API key
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, toCompanyId), eq(companySecrets.name, "claude_api_key")))
      .then((r) => r[0]);

    if (!secret?.description) {
      console.log("[a2a-auto] No API key for company", toCompanyId, "— skipping auto-respond");
      return;
    }

    let apiKey: string;
    try {
      apiKey = decrypt(secret.description);
    } catch {
      console.error("[a2a-auto] Failed to decrypt API key for company", toCompanyId);
      return;
    }

    // 2. Get the destination company's CEO agent
    const ceoAgent = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.companyId, toCompanyId), eq(agents.role, "ceo")))
      .then((r) => r[0]);

    if (!ceoAgent) {
      console.log("[a2a-auto] No CEO agent for company", toCompanyId, "— skipping auto-respond");
      return;
    }

    // 3. Load company profile for context
    const profile = await db.select().from(companyProfiles)
      .where(eq(companyProfiles.companyId, toCompanyId))
      .then((r) => r[0]);

    // 4. Build context for the CEO
    let companyContext = "";
    if (profile) {
      const fields = [
        ["Ragione Sociale", profile.ragioneSociale],
        ["Settore", profile.settore],
        ["Indirizzo", `${profile.indirizzo || ""}, ${profile.citta || ""} (${profile.provincia || ""})`],
      ].filter(([, v]) => v && v.trim());
      if (fields.length > 0) {
        companyContext = "\n\nDATI DELLA TUA AZIENDA:\n" + fields.map(([k, v]) => `${k}: ${v}`).join("\n");
      }
    }

    const isOrder = taskType === "order";

    const systemPrompt = `Sei il CEO AI di un'azienda su GoItalIA. Hai ricevuto un task A2A (comunicazione tra agenti AI) da un'altra azienda.
${companyContext}

REGOLE DI RISPOSTA:
- Rispondi in italiano, in modo professionale e conciso
- Se il task è una richiesta di informazioni, listino, prezzi, disponibilità: rispondi con le informazioni che hai in memoria
- Se il task è un ordine: NON confermare l'ordine automaticamente. Rispondi che hai ricevuto l'ordine e che il titolare verrà informato per la conferma
- Se non hai le informazioni richieste: rispondi cortesemente che verificherai e risponderai al più presto
- La tua risposta verrà salvata come messaggio nel task A2A e sarà visibile all'azienda mittente`;

    const userMessage = `Hai ricevuto un task A2A da "${fromCompanyName}":

Tipo: ${taskType === "order" ? "Ordine" : taskType === "quote" ? "Preventivo" : taskType === "service" ? "Richiesta servizio" : "Messaggio"}
Titolo: ${taskTitle}
${taskDescription ? `Dettagli: ${taskDescription}` : ""}

Rispondi a questo task.${isOrder ? " ATTENZIONE: è un ordine — non confermare, informa che il titolare verrà notificato." : ""}`;

    // 5. Call Claude API
    console.log("[a2a-auto] Processing task", taskId, "for company", toCompanyId);

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("[a2a-auto] Claude API error:", claudeRes.status, errText.substring(0, 200));
      return;
    }

    const data = await claudeRes.json() as {
      content?: Array<{ type: string; text?: string }>;
    };

    const responseText = (data.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n")
      .trim();

    if (!responseText) {
      console.log("[a2a-auto] Empty response from CEO for task", taskId);
      return;
    }

    // 6. Save response as A2A message
    await db.insert(a2aMessages).values({
      taskId,
      fromCompanyId: toCompanyId,
      role: "ceo",
      content: responseText,
    });

    // 7. Update task status
    const newStatus = isOrder ? "created" : "accepted"; // Orders stay as "created" until human approves
    if (!isOrder) {
      await db.update(a2aTasks)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(a2aTasks.id, taskId));
    }

    console.log("[a2a-auto] Task", taskId, "auto-responded. Status:", isOrder ? "awaiting approval" : newStatus);

  } catch (err) {
    console.error("[a2a-auto] Error processing task", taskId, ":", err);
  }
}
