import { Router } from "express";
import type { Db } from "@goitalia/db";
import { connectorAccounts, agentConnectorAccounts, agents } from "@goitalia/db";
import { eq, and } from "drizzle-orm";

export function connectorAccountRoutes(db: Db) {
  const router = Router();

  // ─── Company connector accounts ─────────────────────────────────

  // GET /connector-accounts?companyId=xxx — list all connector accounts for a company
  router.get("/connector-accounts", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const rows = await db.select().from(connectorAccounts)
      .where(eq(connectorAccounts.companyId, companyId))
      .orderBy(connectorAccounts.createdAt);
    res.json(rows);
  });

  // POST /connector-accounts — upsert a connector account
  router.post("/connector-accounts", async (req, res) => {
    const { companyId, connectorType, accountId, accountLabel } = req.body as {
      companyId: string; connectorType: string; accountId: string; accountLabel?: string;
    };
    if (!companyId || !connectorType || !accountId) {
      res.status(400).json({ error: "companyId, connectorType, accountId required" }); return;
    }
    // Upsert: find existing or create
    const existing = await db.select().from(connectorAccounts)
      .where(and(
        eq(connectorAccounts.companyId, companyId),
        eq(connectorAccounts.connectorType, connectorType),
        eq(connectorAccounts.accountId, accountId),
      ))
      .then((r) => r[0]);

    if (existing) {
      // Update label if provided
      if (accountLabel !== undefined) {
        await db.update(connectorAccounts)
          .set({ accountLabel })
          .where(eq(connectorAccounts.id, existing.id));
      }
      res.json({ ...existing, accountLabel: accountLabel ?? existing.accountLabel });
    } else {
      const [row] = await db.insert(connectorAccounts).values({
        companyId, connectorType, accountId, accountLabel: accountLabel ?? null,
      }).returning();
      res.status(201).json(row);
    }
  });

  // DELETE /connector-accounts/:id — remove a connector account (cascades to agent associations)
  router.delete("/connector-accounts/:id", async (req, res) => {
    const { id } = req.params;
    await db.delete(connectorAccounts).where(eq(connectorAccounts.id, id));
    res.json({ ok: true });
  });

  // DELETE /connector-accounts?companyId=xxx&connectorType=xxx — remove all accounts of a type
  router.delete("/connector-accounts", async (req, res) => {
    const companyId = req.query.companyId as string;
    const connectorType = req.query.connectorType as string;
    if (!companyId || !connectorType) {
      res.status(400).json({ error: "companyId and connectorType required" }); return;
    }
    await db.delete(connectorAccounts).where(and(
      eq(connectorAccounts.companyId, companyId),
      eq(connectorAccounts.connectorType, connectorType),
    ));
    res.json({ ok: true });
  });

  // ─── Agent connector accounts ───────────────────────────────────

  // GET /agents/:agentId/connector-accounts — list connector accounts for an agent
  router.get("/agents/:agentId/connector-accounts", async (req, res) => {
    const { agentId } = req.params;
    const rows = await db.select({
      id: agentConnectorAccounts.id,
      agentId: agentConnectorAccounts.agentId,
      connectorAccountId: agentConnectorAccounts.connectorAccountId,
      connectorType: connectorAccounts.connectorType,
      accountId: connectorAccounts.accountId,
      accountLabel: connectorAccounts.accountLabel,
      createdAt: agentConnectorAccounts.createdAt,
    })
      .from(agentConnectorAccounts)
      .innerJoin(connectorAccounts, eq(agentConnectorAccounts.connectorAccountId, connectorAccounts.id))
      .where(eq(agentConnectorAccounts.agentId, agentId));
    res.json(rows);
  });

  // POST /agents/:agentId/connector-accounts/:connectorAccountId — activate connector for agent
  router.post("/agents/:agentId/connector-accounts/:connectorAccountId", async (req, res) => {
    const { agentId, connectorAccountId } = req.params;
    // Check if already exists
    const existing = await db.select().from(agentConnectorAccounts)
      .where(and(
        eq(agentConnectorAccounts.agentId, agentId),
        eq(agentConnectorAccounts.connectorAccountId, connectorAccountId),
      ))
      .then((r) => r[0]);
    if (existing) { res.json(existing); return; }
    const [row] = await db.insert(agentConnectorAccounts).values({
      agentId, connectorAccountId,
    }).returning();
    res.status(201).json(row);
  });

  // DELETE /agents/:agentId/connector-accounts/:connectorAccountId — deactivate connector for agent
  router.delete("/agents/:agentId/connector-accounts/:connectorAccountId", async (req, res) => {
    const { agentId, connectorAccountId } = req.params;
    await db.delete(agentConnectorAccounts).where(and(
      eq(agentConnectorAccounts.agentId, agentId),
      eq(agentConnectorAccounts.connectorAccountId, connectorAccountId),
    ));
    res.json({ ok: true });
  });

  // GET /agents/:agentId/connector-types — get active connector types for an agent (for tool filtering)
  router.get("/agents/:agentId/connector-types", async (req, res) => {
    const { agentId } = req.params;
    const rows = await db.select({
      connectorType: connectorAccounts.connectorType,
      accountId: connectorAccounts.accountId,
    })
      .from(agentConnectorAccounts)
      .innerJoin(connectorAccounts, eq(agentConnectorAccounts.connectorAccountId, connectorAccounts.id))
      .where(eq(agentConnectorAccounts.agentId, agentId));
    res.json(rows);
  });

  return router;
}
