import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const a2aConnections = pgTable(
  "a2a_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromCompanyId: uuid("from_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    toCompanyId: uuid("to_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    relationshipLabel: text("relationship_label"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fromToUq: uniqueIndex("a2a_connections_from_to_key").on(table.fromCompanyId, table.toCompanyId),
    fromIdx: index("idx_a2a_connections_from").on(table.fromCompanyId),
    toIdx: index("idx_a2a_connections_to").on(table.toCompanyId),
  }),
);
