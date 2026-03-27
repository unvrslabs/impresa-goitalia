import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companies, agents, connectorAccounts, companyProfiles, customConnectors } from "@goitalia/db";
import { eq, sql, ne, count } from "drizzle-orm";

const ADMIN_EMAIL = "emanuele@unvrslabs.dev";

export function adminRoutes(db: Db) {
  const router = Router();

  // Middleware: only admin
  const requireAdmin = async (req: any, res: any, next: any) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const user = await db.execute(sql`SELECT email FROM "user" WHERE id = ${actor.userId}`);
    const rows = (user as any).rows || user;
    const ADMIN_USER_ID = "nAVU4wn2Chz3WJdcvl6JmoDbBfXJsX5y";
    if (!rows[0] || (rows[0].email !== ADMIN_EMAIL && actor.userId !== ADMIN_USER_ID)) { res.status(403).json({ error: "Accesso negato" }); return; }
    next();
  };

  // GET /admin/stats — overview stats
  router.get("/admin/stats", requireAdmin, async (_req, res) => {
    try {
      const [companiesCount] = await db.select({ count: count() }).from(companies);
      const [agentsCount] = await db.select({ count: count() }).from(agents).where(ne(agents.status, "terminated"));
      const [connectorsCount] = await db.select({ count: count() }).from(connectorAccounts);

      const usersResult = await db.execute(sql`SELECT count(*) as count FROM "user"`);
      const usersRows = (usersResult as any).rows || usersResult;
      const totalUsers = usersRows[0]?.count || 0;

      res.json({
        totalCompanies: companiesCount.count,
        totalUsers: Number(totalUsers),
        totalAgents: agentsCount.count,
        totalConnectors: connectorsCount.count,
      });
    } catch (err) {
      console.error("[admin] stats error:", err);
      res.status(500).json({ error: "Errore" });
    }
  });

  // GET /admin/companies — all companies with details
  router.get("/admin/companies", requireAdmin, async (_req, res) => {
    try {
      const allCompanies = await db.select({
        id: companies.id,
        name: companies.name,
        issuePrefix: companies.issuePrefix,
        createdAt: companies.createdAt,
      }).from(companies);

      // Enrich with profile, agents count, connectors count
      const enriched = await Promise.all(allCompanies.map(async (c) => {
        const profile = await db.select({
          ragioneSociale: companyProfiles.ragioneSociale,
          partitaIva: companyProfiles.partitaIva,
          citta: companyProfiles.citta,
          settore: companyProfiles.settore,
          telefono: companyProfiles.telefono,
          email: companyProfiles.email,
        }).from(companyProfiles).where(eq(companyProfiles.companyId, c.id)).then(r => r[0]);

        const [agentCount] = await db.select({ count: count() }).from(agents)
          .where(eq(agents.companyId, c.id));
        const activeAgents = await db.select({ count: count() }).from(agents)
          .where(sql`${agents.companyId} = ${c.id} AND ${agents.status} != 'terminated'`);

        const connectors = await db.select({
          connectorType: connectorAccounts.connectorType,
          accountLabel: connectorAccounts.accountLabel,
        }).from(connectorAccounts).where(eq(connectorAccounts.companyId, c.id));

        // Users for this company
        const usersResult = await db.execute(
          sql`SELECT u.id, u.email, u.name FROM "user" u JOIN company_memberships cm ON cm.principal_id = u.id WHERE cm.company_id = ${c.id}`
        );
        const users = ((usersResult as any).rows || usersResult) as Array<{ id: string; email: string; name: string }>;

        return {
          ...c,
          profile: profile || null,
          agentsTotal: agentCount.count,
          agentsActive: activeAgents[0].count,
          connectors: connectors.map(co => ({ type: co.connectorType, label: co.accountLabel })),
          users,
        };
      }));

      res.json(enriched);
    } catch (err) {
      console.error("[admin] companies error:", err);
      res.status(500).json({ error: "Errore" });
    }
  });

  return router;
}
