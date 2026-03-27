import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companyProfiles, a2aConnections, a2aTasks, a2aMessages, companies } from "@goitalia/db";
import { eq, and, or, sql, desc, asc } from "drizzle-orm";
import { processIncomingA2ATask } from "../services/a2a-auto-respond.js";

export function a2aRoutes(db: Db) {
  const router = Router();

  // ==================== PROFILE ====================

  // Helper: convert companyProfiles row → A2A API response format (retrocompat)
  function toA2AProfileResponse(row: typeof companyProfiles.$inferSelect) {
    return {
      id: row.id,
      companyId: row.companyId,
      slug: row.slug,
      legalName: row.ragioneSociale,
      vatNumber: row.partitaIva,
      atecoCode: null,
      atecoDescription: row.settore,
      address: row.indirizzo ? `${row.indirizzo}, ${row.cap || ""} ${row.citta || ""} (${row.provincia || ""})`.trim() : null,
      zone: row.regione || row.provincia,
      description: row.description,
      riskScore: row.riskSeverity ? parseInt(row.riskSeverity) : null,
      tags: row.tags,
      services: row.services,
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // GET /api/a2a/profile?companyId=
  router.get("/a2a/profile", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const row = await db.select().from(companyProfiles)
      .where(eq(companyProfiles.companyId, companyId))
      .then((r) => r[0]);

    if (!row) return res.json(null);
    // Only return as "profile exists" if A2A is activated (has slug)
    if (!row.slug) return res.json(null);
    return res.json(toA2AProfileResponse(row));
  });

  // POST /api/a2a/profile — activate A2A or update A2A fields
  router.post("/a2a/profile", async (req, res) => {
    const { companyId, slug, tags, services, visibility, description } = req.body;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const existing = await db.select().from(companyProfiles)
      .where(eq(companyProfiles.companyId, companyId))
      .then((r) => r[0]);

    if (existing) {
      // Update only A2A-specific fields
      const finalSlug = slug || existing.slug || companyId.substring(0, 8) + "-" + Date.now().toString(36);
      const updated = await db.update(companyProfiles)
        .set({
          slug: finalSlug,
          tags: tags ?? existing.tags,
          services: services ?? existing.services,
          visibility: visibility ?? existing.visibility,
          description: description !== undefined ? description : existing.description,
          updatedAt: new Date(),
        })
        .where(eq(companyProfiles.id, existing.id))
        .returning();
      return res.json(toA2AProfileResponse(updated[0]));
    }

    // Create new company_profiles row with A2A fields
    const finalSlug = slug || companyId.substring(0, 8) + "-" + Date.now().toString(36);
    const created = await db.insert(companyProfiles).values({
      companyId,
      slug: finalSlug,
      tags: tags || [],
      services: services || [],
      visibility: visibility || "public",
      description: description || null,
    }).returning();

    return res.status(201).json(toA2AProfileResponse(created[0]));
  });

  // DELETE /api/a2a/profile?companyId= — deactivate A2A (reset A2A fields, keep profile)
  router.delete("/a2a/profile", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    await db.update(companyProfiles)
      .set({ slug: null, visibility: "hidden", updatedAt: new Date() })
      .where(eq(companyProfiles.companyId, companyId));
    return res.json({ ok: true });
  });

  // ==================== DIRECTORY ====================

  // GET /api/a2a/directory?companyId=&q=&zone=&ateco=
  router.get("/a2a/directory", async (req, res) => {
    const companyId = req.query.companyId as string;
    const q = (req.query.q as string || "").trim();
    const zone = (req.query.zone as string || "").trim();

    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const results = await db.select({
      id: companyProfiles.id,
      companyId: companyProfiles.companyId,
      slug: companyProfiles.slug,
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
      .orderBy(asc(companyProfiles.ragioneSociale))
      .limit(100);

    // In-memory filter for flexible multi-field text search
    let filtered = results;
    if (q) {
      const lower = q.toLowerCase();
      filtered = filtered.filter((p) =>
        (p.legalName || "").toLowerCase().includes(lower) ||
        (p.atecoDescription || "").toLowerCase().includes(lower) ||
        (p.description || "").toLowerCase().includes(lower) ||
        ((p.tags as string[]) || []).some((t) => t.toLowerCase().includes(lower)) ||
        ((p.services as string[]) || []).some((s) => s.toLowerCase().includes(lower))
      );
    }
    if (zone) {
      const lowerZone = zone.toLowerCase();
      filtered = filtered.filter((p) => (p.zone || "").toLowerCase().includes(lowerZone));
    }

    return res.json(filtered);
  });

  // ==================== CONNECTIONS ====================

  // GET /api/a2a/connections?companyId=
  router.get("/a2a/connections", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const outgoing = await db.select({
      id: a2aConnections.id,
      fromCompanyId: a2aConnections.fromCompanyId,
      toCompanyId: a2aConnections.toCompanyId,
      status: a2aConnections.status,
      relationshipLabel: a2aConnections.relationshipLabel,
      notes: a2aConnections.notes,
      createdAt: a2aConnections.createdAt,
      partnerName: sql<string>`COALESCE(${companyProfiles.ragioneSociale}, ${companies.name})`.as("partner_name"),
    })
      .from(a2aConnections)
      .innerJoin(companies, eq(companies.id, a2aConnections.toCompanyId))
      .leftJoin(companyProfiles, eq(companyProfiles.companyId, a2aConnections.toCompanyId))
      .where(eq(a2aConnections.fromCompanyId, companyId))
      .orderBy(desc(a2aConnections.createdAt));

    const incoming = await db.select({
      id: a2aConnections.id,
      fromCompanyId: a2aConnections.fromCompanyId,
      toCompanyId: a2aConnections.toCompanyId,
      status: a2aConnections.status,
      relationshipLabel: a2aConnections.relationshipLabel,
      notes: a2aConnections.notes,
      createdAt: a2aConnections.createdAt,
      partnerName: sql<string>`COALESCE(${companyProfiles.ragioneSociale}, ${companies.name})`.as("partner_name"),
    })
      .from(a2aConnections)
      .innerJoin(companies, eq(companies.id, a2aConnections.fromCompanyId))
      .leftJoin(companyProfiles, eq(companyProfiles.companyId, a2aConnections.fromCompanyId))
      .where(and(
        eq(a2aConnections.toCompanyId, companyId),
        eq(a2aConnections.status, "pending"),
      ))
      .orderBy(desc(a2aConnections.createdAt));

    const result = [
      ...outgoing.map((c) => ({ ...c, direction: "out" as const })),
      ...incoming.map((c) => ({ ...c, direction: "in" as const })),
    ];

    return res.json(result);
  });

  // POST /api/a2a/connections
  router.post("/a2a/connections", async (req, res) => {
    const { companyId, toCompanyId, relationshipLabel, notes } = req.body;
    if (!companyId || !toCompanyId) return res.status(400).json({ error: "companyId and toCompanyId required" });
    if (companyId === toCompanyId) return res.status(400).json({ error: "Cannot connect to yourself" });

    const existing = await db.select().from(a2aConnections)
      .where(or(
        and(eq(a2aConnections.fromCompanyId, companyId), eq(a2aConnections.toCompanyId, toCompanyId)),
        and(eq(a2aConnections.fromCompanyId, toCompanyId), eq(a2aConnections.toCompanyId, companyId)),
      ))
      .then((r) => r[0]);

    if (existing) return res.status(409).json({ error: "Connection already exists", connection: existing });

    const created = await db.insert(a2aConnections).values({
      fromCompanyId: companyId,
      toCompanyId,
      status: "pending",
      relationshipLabel: relationshipLabel || null,
      notes: notes || null,
    }).returning();

    return res.status(201).json(created[0]);
  });

  // PUT /api/a2a/connections/:id
  router.put("/a2a/connections/:id", async (req, res) => {
    const { id } = req.params;
    const { companyId, status, relationshipLabel, notes } = req.body;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const conn = await db.select().from(a2aConnections)
      .where(eq(a2aConnections.id, id))
      .then((r) => r[0]);

    if (!conn) return res.status(404).json({ error: "Connection not found" });

    await db.update(a2aConnections)
      .set({ status: status ?? conn.status, updatedAt: new Date() })
      .where(eq(a2aConnections.id, id));

    if (status === "active" && conn.status === "pending") {
      const reverseExists = await db.select().from(a2aConnections)
        .where(and(
          eq(a2aConnections.fromCompanyId, conn.toCompanyId),
          eq(a2aConnections.toCompanyId, conn.fromCompanyId),
        ))
        .then((r) => r[0]);

      if (!reverseExists) {
        await db.insert(a2aConnections).values({
          fromCompanyId: conn.toCompanyId,
          toCompanyId: conn.fromCompanyId,
          status: "active",
          relationshipLabel: relationshipLabel || null,
          notes: notes || null,
        });
      }
    }

    if (status === "blocked") {
      await db.delete(a2aConnections).where(or(
        and(eq(a2aConnections.fromCompanyId, conn.fromCompanyId), eq(a2aConnections.toCompanyId, conn.toCompanyId)),
        and(eq(a2aConnections.fromCompanyId, conn.toCompanyId), eq(a2aConnections.toCompanyId, conn.fromCompanyId)),
      ));
      return res.json({ ok: true, deleted: true });
    }

    const updated = await db.select().from(a2aConnections)
      .where(eq(a2aConnections.id, id))
      .then((r) => r[0]);

    return res.json(updated);
  });

  // DELETE /api/a2a/connections/:id
  router.delete("/a2a/connections/:id", async (req, res) => {
    const { id } = req.params;
    const companyId = req.query.companyId as string;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const conn = await db.select().from(a2aConnections)
      .where(eq(a2aConnections.id, id))
      .then((r) => r[0]);

    if (!conn) return res.status(404).json({ error: "Connection not found" });

    await db.delete(a2aConnections).where(or(
      and(eq(a2aConnections.fromCompanyId, conn.fromCompanyId), eq(a2aConnections.toCompanyId, conn.toCompanyId)),
      and(eq(a2aConnections.fromCompanyId, conn.toCompanyId), eq(a2aConnections.toCompanyId, conn.fromCompanyId)),
    ));

    return res.json({ ok: true });
  });

  // ==================== TASKS ====================

  // GET /api/a2a/tasks?companyId=&direction=in|out&status=&type=
  router.get("/a2a/tasks", async (req, res) => {
    const companyId = req.query.companyId as string;
    const direction = req.query.direction as string;
    const statusFilter = req.query.status as string;
    const typeFilter = req.query.type as string;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const conditions = [];
    if (direction === "in") {
      conditions.push(eq(a2aTasks.toCompanyId, companyId));
    } else if (direction === "out") {
      conditions.push(eq(a2aTasks.fromCompanyId, companyId));
    } else {
      conditions.push(or(eq(a2aTasks.fromCompanyId, companyId), eq(a2aTasks.toCompanyId, companyId)));
    }
    if (statusFilter) conditions.push(eq(a2aTasks.status, statusFilter));
    if (typeFilter) conditions.push(eq(a2aTasks.type, typeFilter));

    const tasks = await db.select().from(a2aTasks)
      .where(and(...conditions))
      .orderBy(desc(a2aTasks.createdAt))
      .limit(50);

    return res.json(tasks);
  });

  // POST /api/a2a/tasks
  router.post("/a2a/tasks", async (req, res) => {
    const { companyId, toCompanyId, type, title, description, requiresApproval, metadata } = req.body;
    if (!companyId || !toCompanyId || !title) return res.status(400).json({ error: "companyId, toCompanyId, title required" });

    // Verify target company has A2A active (has slug in company_profiles)
    const targetProfile = await db.select({ id: companyProfiles.id }).from(companyProfiles)
      .where(and(eq(companyProfiles.companyId, toCompanyId), sql`${companyProfiles.slug} IS NOT NULL`))
      .then((r) => r[0]);

    if (!targetProfile) return res.status(403).json({ error: "L'azienda destinataria non ha attivato la rete A2A" });

    const created = await db.insert(a2aTasks).values({
      fromCompanyId: companyId,
      toCompanyId,
      type: type || "message",
      title,
      description: description || null,
      status: "created",
      requiresApproval: requiresApproval || false,
      metadata: metadata || null,
    }).returning();

    // Fire-and-forget: auto-process task with destination CEO
    const senderProfile = await db.select({ ragioneSociale: companyProfiles.ragioneSociale })
      .from(companyProfiles).where(eq(companyProfiles.companyId, companyId)).then((r) => r[0]);
    processIncomingA2ATask(
      db, created[0].id, toCompanyId,
      senderProfile?.ragioneSociale || "Azienda",
      title, description || "", type || "message",
    ).catch((err) => console.error("[a2a] auto-respond error:", err));

    return res.status(201).json(created[0]);
  });

  // GET /api/a2a/tasks/:id
  router.get("/a2a/tasks/:id", async (req, res) => {
    const { id } = req.params;

    const task = await db.select().from(a2aTasks)
      .where(eq(a2aTasks.id, id))
      .then((r) => r[0]);

    if (!task) return res.status(404).json({ error: "Task not found" });

    const messages = await db.select().from(a2aMessages)
      .where(eq(a2aMessages.taskId, id))
      .orderBy(asc(a2aMessages.createdAt));

    return res.json({ ...task, messages });
  });

  // PUT /api/a2a/tasks/:id
  router.put("/a2a/tasks/:id", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status required" });

    const updated = await db.update(a2aTasks)
      .set({ status, updatedAt: new Date() })
      .where(eq(a2aTasks.id, id))
      .returning();

    if (!updated.length) return res.status(404).json({ error: "Task not found" });
    return res.json(updated[0]);
  });

  // POST /api/a2a/tasks/:id/messages
  router.post("/a2a/tasks/:id/messages", async (req, res) => {
    const { id } = req.params;
    const { companyId, role, content, attachments } = req.body;
    if (!companyId || !content) return res.status(400).json({ error: "companyId, content required" });

    const task = await db.select({ id: a2aTasks.id }).from(a2aTasks)
      .where(eq(a2aTasks.id, id))
      .then((r) => r[0]);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const created = await db.insert(a2aMessages).values({
      taskId: id,
      fromCompanyId: companyId,
      role: role || "ceo",
      content,
      attachments: attachments || null,
    }).returning();

    return res.status(201).json(created[0]);
  });

  // ==================== BADGE ====================

  // GET /api/a2a/unread-count?companyId=
  router.get("/a2a/unread-count", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) return res.json({ connections: 0, tasks: 0, total: 0 });

    const pendingConnections = await db.select({ count: sql<number>`count(*)` })
      .from(a2aConnections)
      .where(and(eq(a2aConnections.toCompanyId, companyId), eq(a2aConnections.status, "pending")))
      .then((r) => Number(r[0]?.count || 0));

    const pendingTasks = await db.select({ count: sql<number>`count(*)` })
      .from(a2aTasks)
      .where(and(eq(a2aTasks.toCompanyId, companyId), eq(a2aTasks.status, "created")))
      .then((r) => Number(r[0]?.count || 0));

    return res.json({ connections: pendingConnections, tasks: pendingTasks, total: pendingConnections + pendingTasks });
  });

  return router;
}
