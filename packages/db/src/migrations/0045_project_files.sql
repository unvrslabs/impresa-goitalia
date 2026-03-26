CREATE TABLE IF NOT EXISTS "project_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text DEFAULT 'upload' NOT NULL,
  "mime_type" text,
  "size_bytes" integer,
  "drive_url" text,
  "drive_file_id" text,
  "content_text" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_files_project" ON "project_files" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_files_company" ON "project_files" ("company_id");
