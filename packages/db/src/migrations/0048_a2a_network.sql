-- A2A Profiles
CREATE TABLE "a2a_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "vat_number" text,
  "legal_name" text,
  "ateco_code" text,
  "ateco_description" text,
  "address" text,
  "zone" text,
  "description" text,
  "risk_score" integer,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "services" jsonb DEFAULT '[]'::jsonb,
  "visibility" text NOT NULL DEFAULT 'hidden',
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "a2a_profiles_company_id_key" ON "a2a_profiles" ("company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "a2a_profiles_slug_key" ON "a2a_profiles" ("slug");
--> statement-breakpoint
CREATE INDEX "idx_a2a_profiles_visibility" ON "a2a_profiles" ("visibility");
--> statement-breakpoint

-- A2A Connections
CREATE TABLE "a2a_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "to_company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "relationship_label" text,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "a2a_connections_from_to_key" ON "a2a_connections" ("from_company_id", "to_company_id");
--> statement-breakpoint
CREATE INDEX "idx_a2a_connections_from" ON "a2a_connections" ("from_company_id");
--> statement-breakpoint
CREATE INDEX "idx_a2a_connections_to" ON "a2a_connections" ("to_company_id");
--> statement-breakpoint

-- A2A Tasks
CREATE TABLE "a2a_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "to_company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "type" text NOT NULL DEFAULT 'message',
  "title" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'created',
  "requires_approval" boolean NOT NULL DEFAULT false,
  "metadata" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_a2a_tasks_from" ON "a2a_tasks" ("from_company_id");
--> statement-breakpoint
CREATE INDEX "idx_a2a_tasks_to" ON "a2a_tasks" ("to_company_id");
--> statement-breakpoint
CREATE INDEX "idx_a2a_tasks_status" ON "a2a_tasks" ("status");
--> statement-breakpoint

-- A2A Messages
CREATE TABLE "a2a_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "a2a_tasks"("id") ON DELETE CASCADE,
  "from_company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'ceo',
  "content" text NOT NULL,
  "attachments" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_a2a_messages_task" ON "a2a_messages" ("task_id");
