import { pgTable, uuid, text, boolean, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const a2aTasks = pgTable(
  "a2a_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromCompanyId: uuid("from_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    toCompanyId: uuid("to_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("message"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("created"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fromIdx: index("idx_a2a_tasks_from").on(table.fromCompanyId),
    toIdx: index("idx_a2a_tasks_to").on(table.toCompanyId),
    statusIdx: index("idx_a2a_tasks_status").on(table.status),
  }),
);

export const a2aMessages = pgTable(
  "a2a_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull().references(() => a2aTasks.id, { onDelete: "cascade" }),
    fromCompanyId: uuid("from_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("ceo"),
    content: text("content").notNull(),
    attachments: jsonb("attachments").$type<Record<string, unknown>[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    taskIdx: index("idx_a2a_messages_task").on(table.taskId),
  }),
);
