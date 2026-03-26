import type { Db } from "@goitalia/db";
import { connectorAccounts } from "@goitalia/db";
import { eq, and } from "drizzle-orm";

/**
 * Upsert a connector account row. Idempotent.
 * Returns the connector_account row (existing or newly created).
 */
export async function upsertConnectorAccount(
  db: Db,
  companyId: string,
  connectorType: string,
  accountId: string,
  accountLabel?: string,
) {
  const existing = await db.select().from(connectorAccounts)
    .where(and(
      eq(connectorAccounts.companyId, companyId),
      eq(connectorAccounts.connectorType, connectorType),
      eq(connectorAccounts.accountId, accountId),
    ))
    .then((r) => r[0]);

  if (existing) {
    if (accountLabel !== undefined && accountLabel !== existing.accountLabel) {
      await db.update(connectorAccounts)
        .set({ accountLabel })
        .where(eq(connectorAccounts.id, existing.id));
    }
    return { ...existing, accountLabel: accountLabel ?? existing.accountLabel };
  }

  const [row] = await db.insert(connectorAccounts).values({
    companyId, connectorType, accountId, accountLabel: accountLabel ?? null,
  }).returning();
  return row;
}

/**
 * Remove a connector account by type + accountId.
 * Cascades to agent_connector_accounts.
 */
export async function removeConnectorAccount(
  db: Db,
  companyId: string,
  connectorType: string,
  accountId?: string,
) {
  if (accountId) {
    await db.delete(connectorAccounts).where(and(
      eq(connectorAccounts.companyId, companyId),
      eq(connectorAccounts.connectorType, connectorType),
      eq(connectorAccounts.accountId, accountId),
    ));
  } else {
    // Remove all accounts of this type for the company
    await db.delete(connectorAccounts).where(and(
      eq(connectorAccounts.companyId, companyId),
      eq(connectorAccounts.connectorType, connectorType),
    ));
  }
}

/**
 * Remove all connector accounts for a company of a given type.
 */
export async function removeAllConnectorAccountsByType(
  db: Db,
  companyId: string,
  connectorType: string,
) {
  await db.delete(connectorAccounts).where(and(
    eq(connectorAccounts.companyId, companyId),
    eq(connectorAccounts.connectorType, connectorType),
  ));
}
