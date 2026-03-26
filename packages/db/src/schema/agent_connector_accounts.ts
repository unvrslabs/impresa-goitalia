import { pgTable, uuid, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { connectorAccounts } from "./connector_accounts.js";

export const agentConnectorAccounts = pgTable(
  "agent_connector_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    connectorAccountId: uuid("connector_account_id").notNull().references(() => connectorAccounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentConnectorUq: uniqueIndex("agent_connector_accounts_agent_id_connector_account_id_key").on(
      table.agentId,
      table.connectorAccountId,
    ),
    agentIdx: index("idx_agent_connector_accounts_agent").on(table.agentId),
  }),
);
