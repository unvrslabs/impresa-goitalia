-- Company products/services catalog
CREATE TABLE "company_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "type" text NOT NULL DEFAULT 'product',
  "name" text NOT NULL,
  "description" text,
  "category" text,
  "unit" text,
  "price_b2b" text,
  "price_b2c" text,
  "currency" text NOT NULL DEFAULT 'EUR',
  "available" boolean NOT NULL DEFAULT true,
  "sku" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_company_products_company" ON "company_products" ("company_id");
--> statement-breakpoint
CREATE INDEX "idx_company_products_category" ON "company_products" ("company_id", "category");
--> statement-breakpoint

-- Add opening hours fields to company_profiles
ALTER TABLE "company_profiles" ADD COLUMN "orari_apertura" text;
--> statement-breakpoint
ALTER TABLE "company_profiles" ADD COLUMN "giorno_chiusura" text;
--> statement-breakpoint
ALTER TABLE "company_profiles" ADD COLUMN "note_orari" text;
