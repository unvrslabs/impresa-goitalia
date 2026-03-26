ALTER TABLE "whatsapp_contacts" ADD COLUMN "last_summary" text;
--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD COLUMN "last_summary_at" timestamptz;
