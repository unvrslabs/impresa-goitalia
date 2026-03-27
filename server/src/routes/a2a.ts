import { Router } from "express";
import type { Db } from "@goitalia/db";
import { a2aProfiles, a2aConnections, a2aTasks, a2aMessages, companies } from "@goitalia/db";
import { eq, and, or, sql, desc, asc } from "drizzle-orm";

export function a2aRoutes(db: Db) {
  const router = Router();

  // ==================== PROFILE ====================

  // GET /api/a2a/profile?companyId=
  router.get("/a2a/profile", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const profile = await db.select().from(a2aProfiles)
      .where(eq(a2aProfiles.companyId, companyId))
      .then((r) => r[0] ?? null);

    return res.json(profile);
  });

  // POST /api/a2a/profile — create or update
  router.post("/a2a/profile", async (req, res) => {
    const {
      companyId, slug, vatNumber, legalName, atecoCode, atecoDescription,
      address, zone, description, riskScore, tags, services, visibility,
    } = req.body;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const existing = await db.select().from(a2aProfiles)
      .where(eq(a2aProfiles.companyId, companyId))
      .then((r) => r[0]);

    if (existing) {
      const updated = await db.update(a2aProfiles)
        .set({
          slug: slug ?? existing.slug,
          vatNumber: vatNumber ?? existing.vatNumber,
          legalName: legalName ?? existing.legalName,
          atecoCode: atecoCode ?? existing.atecoCode,
          atecoDescription: atecoDescription ?? existing.atecoDescription,
          address: address ?? existing.address,
          zone: zone ?? existing.zone,
          description: description ?? existing.description,
          riskScore: riskScore ?? existing.riskScore,
          tags: tags ?? existing.tags,
          services: services ?? existing.services,
          visibility: visibility ?? existing.visibility,
          updatedAt: new Date(),
        })
        .where(eq(a2aProfiles.id, existing.id))
        .returning();
      return res.json(updated[0]);
    }

    const finalSlug = slug || companyId.substring(0, 8) + "-" + Date.now().toString(36);
    const created = await db.insert(a2aProfiles).values({
      companyId,
      slug: finalSlug,
      vatNumber: vatNumber || null,
      legalName: legalName || null,
      atecoCode: atecoCode || null,
      atecoDescription: atecoDescription || null,
      address: address || null,
      zone: zone || null,
      description: description || null,
      riskScore: riskScore ?? null,
      tags: tags || [],
      services: services || [],
      visibility: visibility || "hidden",
    }).returning();

    return res.status(201).json(created[0]);
  });

  // DELETE /api/a2a/profile?companyId=
  router.delete("/a2a/profile", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    await db.delete(a2aProfiles).where(eq(a2aProfiles.companyId, companyId));
    return res.json({ ok: true });
  });

  // ==================== DIRECTORY ====================

  // GET /api/a2a/directory?companyId=&q=&zone=&ateco=
  router.get("/a2a/directory", async (req, res) => {
    const companyId = req.query.companyId as string;
    const q = (req.query.q as string || "").trim();
    const zone = (req.query.zone as string || "").trim();

    if (!companyId) return res.status(400).json({ error: "companyId required" });

    // Fetch all public profiles except own company
    const results = await db.select({
      id: a2aProfiles.id,
      companyId: a2aProfiles.companyId,
      slug: a2aProfiles.slug,
      legalName: a2aProfiles.legalName,
      atecoCode: a2aProfiles.atecoCode,
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
      .orderBy(asc(a2aProfiles.legalName))
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

    // Get all connections where this company is sender (outgoing perspective with labels)
    const outgoing = await db.select({
      id: a2aConnections.id,
      fromCompanyId: a2aConnections.fromCompanyId,
      toCompanyId: a2aConnections.toCompanyId,
      status: a2aConnections.status,
      relationshipLabel: a2aConnections.relationshipLabel,
      notes: a2aConnections.notes,
      createdAt: a2aConnections.createdAt,
      partnerName: companies.name,
    })
      .from(a2aConnections)
      .innerJoin(companies, eq(companies.id, a2aConnections.toCompanyId))
      .where(eq(a2aConnections.fromCompanyId, companyId))
      .orderBy(desc(a2aConnections.createdAt));

    // Get incoming pending requests (where someone else requested connection to me)
    const incoming = await db.select({
      id: a2aConnections.id,
      fromCompanyId: a2aConnections.fromCompanyId,
      toCompanyId: a2aConnections.toCompanyId,
      status: a2aConnections.status,
      relationshipLabel: a2aConnections.relationshipLabel,
      notes: a2aConnections.notes,
      createdAt: a2aConnections.createdAt,
      partnerName: companies.name,
    })
      .from(a2aConnections)
      .innerJoin(companies, eq(companies.id, a2aConnections.fromCompanyId))
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

  // POST /api/a2a/connections — send connection request
  router.post("/a2a/connections", async (req, res) => {
    const { companyId, toCompanyId, relationshipLabel, notes } = req.body;
    if (!companyId || !toCompanyId) return res.status(400).json({ error: "companyId and toCompanyId required" });
    if (companyId === toCompanyId) return res.status(400).json({ error: "Cannot connect to yourself" });

    // Check if connection already exists in either direction
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

  // PUT /api/a2a/connections/:id — accept/reject/block + set label
  router.put("/a2a/connections/:id", async (req, res) => {
    const { id } = req.params;
    const { companyId, status, relationshipLabel, notes } = req.body;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const conn = await db.select().from(a2aConnections)
      .where(eq(a2aConnections.id, id))
      .then((r) => r[0]);

    if (!conn) return res.status(404).json({ error: "Connection not found" });

    // Update the original connection
    await db.update(a2aConnections)
      .set({
        status: status ?? conn.status,
        updatedAt: new Date(),
      })
      .where(eq(a2aConnections.id, id));

    // If accepted: create the reverse record (how B sees A)
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

    // If blocked: remove both directions
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

    // Delete both directions
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

  // POST /api/a2a/tasks — create task
  router.post("/a2a/tasks", async (req, res) => {
    const { companyId, toCompanyId, type, title, description, requiresApproval, metadata } = req.body;
    if (!companyId || !toCompanyId || !title) return res.status(400).json({ error: "companyId, toCompanyId, title required" });

    // Verify target company has A2A profile (is on the network)
    const targetProfile = await db.select({ id: a2aProfiles.id }).from(a2aProfiles)
      .where(eq(a2aProfiles.companyId, toCompanyId))
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

    return res.status(201).json(created[0]);
  });

  // GET /api/a2a/tasks/:id — task detail with messages
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

  // PUT /api/a2a/tasks/:id — update status
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

  // POST /api/a2a/tasks/:id/messages — add message to task
  router.post("/a2a/tasks/:id/messages", async (req, res) => {
    const { id } = req.params;
    const { companyId, role, content, attachments } = req.body;
    if (!companyId || !content) return res.status(400).json({ error: "companyId, content required" });

    // Verify task exists
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
