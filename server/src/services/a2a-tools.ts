import type { Db } from "@goitalia/db";
import { a2aProfiles, a2aConnections, a2aTasks, a2aMessages, companies } from "@goitalia/db";
import { eq, and, or, sql, desc, asc } from "drizzle-orm";

/**
 * Execute an A2A CEO tool.
 * Returns a human-readable string for the CEO to present to the user.
 */
export async function executeA2aTool(
  db: Db,
  companyId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<string> {

  // Check if company has an A2A profile (required for all A2A tools)
  if (toolName !== "cerca_azienda_a2a") {
    const profile = await db.select({ id: a2aProfiles.id }).from(a2aProfiles)
      .where(eq(a2aProfiles.companyId, companyId))
      .then((r) => r[0]);
    if (!profile && toolName !== "cerca_azienda_a2a") {
      return "La Rete B2B non è ancora attiva per questa azienda. Il titolare deve attivarla dalla pagina Rete B2B nella sidebar.";
    }
  }

  switch (toolName) {

    case "cerca_azienda_a2a": {
      const q = (toolInput.query as string || "").trim();
      const zone = (toolInput.zona as string || "").trim();
      if (!q && !zone) return "Specifica almeno un criterio di ricerca (nome, settore, zona, tag).";

      const results = await db.select({
        companyId: a2aProfiles.companyId,
        legalName: a2aProfiles.legalName,
        atecoDescription: a2aProfiles.atecoDescription,
        zone: a2aProfiles.zone,
        description: a2aProfiles.description,
        tags: a2aProfiles.tags,
        services: a2aProfiles.services,
        riskScore: a2aProfiles.riskScore,
      }).from(a2aProfiles)
        .where(and(
          eq(a2aProfiles.visibility, "public"),
          sql`${a2aProfiles.companyId} != ${companyId}`,
        ))
        .limit(100);

      let filtered = results;
      if (q) {
        const lower = q.toLowerCase();
        filtered = filtered.filter((p) =>
          (p.legalName || "").toLowerCase().includes(lower) ||
          (p.atecoDescription || "").toLowerCase().includes(lower) ||
          (p.description || "").toLowerCase().includes(lower) ||
          ((p.tags as string[]) || []).some((t: string) => t.toLowerCase().includes(lower)) ||
          ((p.services as string[]) || []).some((s: string) => s.toLowerCase().includes(lower))
        );
      }
      if (zone) {
        const lz = zone.toLowerCase();
        filtered = filtered.filter((p) => (p.zone || "").toLowerCase().includes(lz));
      }

      if (filtered.length === 0) return "Nessuna azienda trovata con questi criteri nella directory.";

      return filtered.map((p) =>
        `• ${p.legalName || "Azienda senza nome"} — ${p.atecoDescription || "N/A"} — ${p.zone || "?"}\n  ${p.description || ""}\n  Tag: ${((p.tags as string[]) || []).join(", ") || "nessuno"}\n  Servizi: ${((p.services as string[]) || []).join(", ") || "nessuno"}\n  Risk Score: ${p.riskScore ?? "N/D"}\n  [ID: ${p.companyId}]`
      ).join("\n\n");
    }

    case "lista_partner_a2a": {
      const connections = await db.select({
        toCompanyId: a2aConnections.toCompanyId,
        relationshipLabel: a2aConnections.relationshipLabel,
        notes: a2aConnections.notes,
        partnerName: companies.name,
      })
        .from(a2aConnections)
        .innerJoin(companies, eq(companies.id, a2aConnections.toCompanyId))
        .where(and(
          eq(a2aConnections.fromCompanyId, companyId),
          eq(a2aConnections.status, "active"),
        ))
        .orderBy(asc(a2aConnections.relationshipLabel));

      if (connections.length === 0) return "Nessun partner collegato nella Rete B2B. Il titolare può cercare e collegare aziende dalla pagina Rete B2B.";

      return "Partner B2B collegati:\n\n" + connections.map((c) =>
        `• ${c.partnerName} — ${c.relationshipLabel || "Partner"}\n  ${c.notes || ""}\n  [ID: ${c.toCompanyId}]`
      ).join("\n\n");
    }

    case "invia_task_a2a": {
      const toCompanyId = toolInput.azienda_id as string;
      const type = (toolInput.tipo as string) || "message";
      const title = toolInput.titolo as string;
      const description = toolInput.descrizione as string || "";

      if (!toCompanyId || !title) return "Specifica azienda_id (dall'elenco partner) e titolo del task.";

      // Orders always require approval
      const requiresApproval = type === "order";

      // Verify active connection
      const conn = await db.select({
        id: a2aConnections.id,
        relationshipLabel: a2aConnections.relationshipLabel,
      }).from(a2aConnections)
        .where(and(
          eq(a2aConnections.fromCompanyId, companyId),
          eq(a2aConnections.toCompanyId, toCompanyId),
          eq(a2aConnections.status, "active"),
        ))
        .then((r) => r[0]);

      if (!conn) return "Non sei collegato a questa azienda. Il titolare deve prima inviare una richiesta di connessione dalla pagina Rete B2B.";

      const created = await db.insert(a2aTasks).values({
        fromCompanyId: companyId,
        toCompanyId,
        type,
        title,
        description: description || null,
        status: "created",
        requiresApproval,
      }).returning();

      // Add initial message with the description
      if (description) {
        await db.insert(a2aMessages).values({
          taskId: created[0].id,
          fromCompanyId: companyId,
          role: "ceo",
          content: description,
        });
      }

      const partnerLabel = conn.relationshipLabel || toCompanyId;
      return `Task inviato a ${partnerLabel}!\nID: ${created[0].id}\nTipo: ${type}\nTitolo: ${title}\nStato: creato — in attesa di risposta dal CEO dell'azienda destinataria.`;
    }

    case "rispondi_task_a2a": {
      const taskId = toolInput.task_id as string;
      const risposta = toolInput.risposta as string;
      const nuovoStato = (toolInput.stato as string) || "accepted";

      if (!taskId || !risposta) return "Specifica task_id e risposta.";

      const task = await db.select().from(a2aTasks)
        .where(eq(a2aTasks.id, taskId))
        .then((r) => r[0]);

      if (!task) return "Task non trovato con questo ID.";
      if (task.toCompanyId !== companyId) return "Questo task non è indirizzato alla tua azienda.";

      await db.update(a2aTasks)
        .set({ status: nuovoStato, updatedAt: new Date() })
        .where(eq(a2aTasks.id, taskId));

      await db.insert(a2aMessages).values({
        taskId,
        fromCompanyId: companyId,
        role: "ceo",
        content: risposta,
      });

      return `Risposta inviata al task "${task.title}". Stato aggiornato a: ${nuovoStato}.`;
    }

    case "lista_task_a2a": {
      const direction = (toolInput.direzione as string) || "all";
      const statusFilter = toolInput.stato as string;

      const conditions = [];
      if (direction === "in" || direction === "entrata") {
        conditions.push(eq(a2aTasks.toCompanyId, companyId));
      } else if (direction === "out" || direction === "uscita") {
        conditions.push(eq(a2aTasks.fromCompanyId, companyId));
      } else {
        conditions.push(or(eq(a2aTasks.fromCompanyId, companyId), eq(a2aTasks.toCompanyId, companyId)));
      }
      if (statusFilter) conditions.push(eq(a2aTasks.status, statusFilter));

      const tasks = await db.select().from(a2aTasks)
        .where(and(...conditions))
        .orderBy(desc(a2aTasks.createdAt))
        .limit(20);

      if (tasks.length === 0) return "Nessun task B2B trovato.";

      return tasks.map((t) => {
        const dir = t.fromCompanyId === companyId ? "→ USCITA" : "← ENTRATA";
        return `• [${t.status.toUpperCase()}] ${dir} — ${t.title}\n  Tipo: ${t.type} | ID: ${t.id} | ${t.createdAt?.toLocaleDateString?.("it-IT") || ""}`;
      }).join("\n\n");
    }

    case "aggiorna_stato_task_a2a": {
      const taskId = toolInput.task_id as string;
      const newStatus = toolInput.stato as string;

      if (!taskId || !newStatus) return "Specifica task_id e stato (accepted, rejected, in_progress, completed, cancelled).";

      const validStatuses = ["accepted", "rejected", "in_progress", "completed", "cancelled"];
      if (!validStatuses.includes(newStatus)) return `Stato non valido. Usa uno di: ${validStatuses.join(", ")}`;

      const updated = await db.update(a2aTasks)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(a2aTasks.id, taskId))
        .returning();

      if (!updated.length) return "Task non trovato con questo ID.";
      return `Task "${updated[0].title}" aggiornato a: ${newStatus}.`;
    }

    case "messaggio_a2a": {
      const taskId = toolInput.task_id as string;
      const content = toolInput.messaggio as string;

      if (!taskId || !content) return "Specifica task_id e messaggio.";

      const task = await db.select({ id: a2aTasks.id, title: a2aTasks.title }).from(a2aTasks)
        .where(eq(a2aTasks.id, taskId))
        .then((r) => r[0]);

      if (!task) return "Task non trovato con questo ID.";

      await db.insert(a2aMessages).values({
        taskId,
        fromCompanyId: companyId,
        role: "ceo",
        content,
      });

      return `Messaggio inviato nel task "${task.title}".`;
    }

    default:
      return `Tool A2A non riconosciuto: ${toolName}`;
  }
}
