import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companyProducts } from "@goitalia/db";
import { eq, and, asc } from "drizzle-orm";

export function companyProductRoutes(db: Db) {
  const router = Router();

  // GET /api/company-products?companyId=
  router.get("/company-products", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const products = await db.select().from(companyProducts)
      .where(eq(companyProducts.companyId, companyId))
      .orderBy(asc(companyProducts.category), asc(companyProducts.name));

    return res.json(products);
  });

  // POST /api/company-products
  router.post("/company-products", async (req, res) => {
    const { companyId, type, name, description, category, unit, priceB2b, priceB2c, currency, available, sku } = req.body;
    if (!companyId || !name) return res.status(400).json({ error: "companyId and name required" });

    const created = await db.insert(companyProducts).values({
      companyId,
      type: type || "product",
      name,
      description: description || null,
      category: category || null,
      unit: unit || null,
      priceB2b: priceB2b || null,
      priceB2c: priceB2c || null,
      currency: currency || "EUR",
      available: available !== false,
      sku: sku || null,
    }).returning();

    return res.status(201).json(created[0]);
  });

  // PUT /api/company-products/:id
  router.put("/company-products/:id", async (req, res) => {
    const { id } = req.params;
    const { type, name, description, category, unit, priceB2b, priceB2c, currency, available, sku } = req.body;

    const existing = await db.select().from(companyProducts)
      .where(eq(companyProducts.id, id))
      .then((r) => r[0]);
    if (!existing) return res.status(404).json({ error: "Product not found" });

    const updated = await db.update(companyProducts)
      .set({
        type: type !== undefined ? type : existing.type,
        name: name !== undefined ? name : existing.name,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        unit: unit !== undefined ? unit : existing.unit,
        priceB2b: priceB2b !== undefined ? priceB2b : existing.priceB2b,
        priceB2c: priceB2c !== undefined ? priceB2c : existing.priceB2c,
        currency: currency !== undefined ? currency : existing.currency,
        available: available !== undefined ? available : existing.available,
        sku: sku !== undefined ? sku : existing.sku,
        updatedAt: new Date(),
      })
      .where(eq(companyProducts.id, id))
      .returning();

    return res.json(updated[0]);
  });

  // DELETE /api/company-products/:id?companyId=
  router.delete("/company-products/:id", async (req, res) => {
    const { id } = req.params;
    const companyId = req.query.companyId as string;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    await db.delete(companyProducts)
      .where(and(eq(companyProducts.id, id), eq(companyProducts.companyId, companyId)));

    return res.json({ ok: true });
  });

  return router;
}
