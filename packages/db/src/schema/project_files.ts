import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const projectFiles = pgTable("project_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("upload"), // upload | drive_link
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  driveUrl: text("drive_url"),
  driveFileId: text("drive_file_id"),
  contentText: text("content_text"), // extracted text for CEO access
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("idx_project_files_project").on(table.projectId),
  companyIdx: index("idx_project_files_company").on(table.companyId),
}));
