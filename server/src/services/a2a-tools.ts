import type { Db } from "@goitalia/db";
import { companyProfiles, a2aConnections, a2aTasks, a2aMessages, companies } from "@goitalia/db";
import { eq, and, or, sql, desc, asc } from "drizzle-orm";
import { processIncomingA2ATask } from "./a2a-auto-respond.js";

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

  // Check if company has A2A active (slug set in company_profiles)
  if (toolName !== "cerca_azienda_a2a") {
    const profile = await db.select({ slug: companyProfiles.slug }).from(companyProfiles)
      .where(eq(companyProfiles.companyId, companyId))
      .then((r) => r[0]);
    if (!profile?.slug) {
      return "La Rete A2A non è ancora attiva per questa azienda. Il titolare deve attivarla dalla pagina A2A nella sidebar.";
    }
  }

  switch (toolName) {

    case "cerca_azienda_a2a": {
      const q = (toolInput.query as string || "").trim();
      const zone = (toolInput.zona as string || "").trim();
      if (!q && !zone) return "Specifica almeno un criterio di ricerca (nome, settore, zona, tag).";

      const results = await db.select({
        companyId: companyProfiles.companyId,
        legalName: companyProfiles.ragioneSociale,
        atecoDescription: companyProfiles.settore,
        zone: companyProfiles.regione,
        description: companyProfiles.description,
        tags: companyProfiles.tags,
        services: companyProfiles.services,
        riskScore: companyProfiles.riskSeverity,
      }).from(companyProfiles)
        .where(and(
          eq(companyProfiles.visibility, "public"),
          sql`${companyProfiles.companyId} != ${companyId}`,
          sql`${companyProfiles.slug} IS NOT NULL`,
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
      let toCompanyId = (toolInput.azienda_id as string || "").trim();
      const type = (toolInput.tipo as string) || "message";
      const title = toolInput.titolo as string;
      const description = toolInput.descrizione as string || "";

      if (!toCompanyId || !title) return "Specifica azienda_id (dall'elenco partner o dalla directory) e titolo del task.";

      // Orders always require approval
      const requiresApproval = type === "order";

      // If not a UUID, try to find by name/slug
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(toCompanyId);
      if (!isUuid) {
        const found = await db.select({ companyId: companyProfiles.companyId })
          .from(companyProfiles)
          .where(or(
            sql`LOWER(${companyProfiles.ragioneSociale}) LIKE ${"%" + toCompanyId.toLowerCase() + "%"}`,
            sql`LOWER(${companyProfiles.slug}) = ${toCompanyId.toLowerCase()}`,
          ))
          .then((r) => r[0]);
        if (found) {
          toCompanyId = found.companyId;
        } else {
          return `Azienda "${toCompanyId}" non trovata. Usa cerca_azienda_a2a per cercare nella directory.`;
        }
      }

      // Verify target company has A2A active
      const targetProfile = await db.select({ id: companyProfiles.id, legalName: companyProfiles.ragioneSociale, slug: companyProfiles.slug })
        .from(companyProfiles)
        .where(eq(companyProfiles.companyId, toCompanyId))
        .then((r) => r[0]);

      if (!targetProfile || !targetProfile.slug) return "L'azienda destinataria non ha attivato la rete A2A.";

      // Check if it's a known partner (for label)
      const conn = await db.select({ relationshipLabel: a2aConnections.relationshipLabel })
        .from(a2aConnections)
        .where(and(
          eq(a2aConnections.fromCompanyId, companyId),
          eq(a2aConnections.toCompanyId, toCompanyId),
          eq(a2aConnections.status, "active"),
        ))
        .then((r) => r[0]);

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

      // Fire-and-forget: auto-process with destination CEO
      const senderProfile = await db.select({ ragioneSociale: companyProfiles.ragioneSociale })
        .from(companyProfiles).where(eq(companyProfiles.companyId, companyId)).then((r) => r[0]);
      processIncomingA2ATask(
        db, created[0].id, toCompanyId,
        senderProfile?.ragioneSociale || "Azienda",
        title, description, type,
      ).catch((err) => console.error("[a2a-tool] auto-respond error:", err));

      const partnerLabel = conn?.relationshipLabel || targetProfile.legalName || toCompanyId;
      return `Task inviato a ${partnerLabel}!\nID: ${created[0].id}\nTipo: ${type}\nTitolo: ${title}\nStato: creato — il CEO dell'azienda destinataria sta elaborando la risposta.`;
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
