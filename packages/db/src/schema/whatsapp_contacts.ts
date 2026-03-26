import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const whatsappContacts = pgTable("whatsapp_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),
  name: text("name"),
  notes: text("notes"),
  customInstructions: text("custom_instructions"),
  autoMode: text("auto_mode").notNull().default("inherit"), // "auto" | "manual" | "inherit"
  lastSummary: text("last_summary"),
  lastSummaryAt: timestamp("last_summary_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentPhoneUq: uniqueIndex("uq_wa_contacts_agent_phone").on(table.agentId, table.phoneNumber),
  companyIdx: index("idx_wa_contacts_company").on(table.companyId),
}));
