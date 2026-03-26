import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const connectorAccounts = pgTable(
  "connector_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    connectorType: text("connector_type").notNull(),
    accountId: text("account_id").notNull(),
    accountLabel: text("account_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyTypeAccountUq: uniqueIndex("connector_accounts_company_id_connector_type_account_id_key").on(
      table.companyId,
      table.connectorType,
      table.accountId,
    ),
    companyIdx: index("idx_connector_accounts_company").on(table.companyId),
  }),
);
