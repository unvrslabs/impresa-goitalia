import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyProducts = pgTable(
  "company_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("product"),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    unit: text("unit"),
    priceB2b: text("price_b2b"),
    priceB2c: text("price_b2c"),
    currency: text("currency").notNull().default("EUR"),
    available: boolean("available").notNull().default(true),
    stockQty: text("stock_qty"),
    vatRate: text("vat_rate"),
    sku: text("sku"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("idx_company_products_company").on(table.companyId),
    categoryIdx: index("idx_company_products_category").on(table.companyId, table.category),
  }),
);
