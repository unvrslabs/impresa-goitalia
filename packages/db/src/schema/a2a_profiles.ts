import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const a2aProfiles = pgTable(
  "a2a_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    vatNumber: text("vat_number"),
    legalName: text("legal_name"),
    atecoCode: text("ateco_code"),
    atecoDescription: text("ateco_description"),
    address: text("address"),
    zone: text("zone"),
    description: text("description"),
    riskScore: integer("risk_score"),
    tags: jsonb("tags").$type<string[]>().default([]),
    services: jsonb("services").$type<string[]>().default([]),
    visibility: text("visibility").notNull().default("hidden"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUq: uniqueIndex("a2a_profiles_company_id_key").on(table.companyId),
    slugUq: uniqueIndex("a2a_profiles_slug_key").on(table.slug),
    visibilityIdx: index("idx_a2a_profiles_visibility").on(table.visibility),
  }),
);
