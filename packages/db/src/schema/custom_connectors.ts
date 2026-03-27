import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const customConnectors = pgTable(
  "custom_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    baseUrl: text("base_url").notNull(),
    authType: text("auth_type").notNull().default("bearer"),
    authHeader: text("auth_header").default("Authorization"),
    authPrefix: text("auth_prefix").default("Bearer"),
    description: text("description"),
    actions: jsonb("actions").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySlugUq: uniqueIndex("custom_connectors_company_slug_key").on(table.companyId, table.slug),
    companyIdx: index("idx_custom_connectors_company").on(table.companyId),
  }),
);
