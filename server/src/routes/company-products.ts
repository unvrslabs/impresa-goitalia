import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companyProducts } from "@goitalia/db";
import { eq, and, asc } from "drizzle-orm";

export function companyProductRoutes(db: Db) {
  const router = Router();

  // Auth helper
  function requireAuth(req: any, res: any, companyId: string | undefined): companyId is string {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return false; }
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return false; }
    return true;
  }

  // GET /api/company-products?companyId=
  router.get("/company-products", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!requireAuth(req, res, companyId)) return;

    const products = await db.select().from(companyProducts)
      .where(eq(companyProducts.companyId, companyId))
      .orderBy(asc(companyProducts.category), asc(companyProducts.name));

    return res.json(products);
  });

  // POST /api/company-products
  router.post("/company-products", async (req, res) => {
    const { companyId, type, name, description, category, unit, priceB2b, priceB2c, currency, available, stockQty, vatRate, sku } = req.body;
    if (!requireAuth(req, res, companyId)) return;
    if (!name) return res.status(400).json({ error: "name required" });

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
      stockQty: stockQty || null,
      vatRate: vatRate || null,
      sku: sku || null,
    }).returning();

    return res.status(201).json(created[0]);
  });

  // PUT /api/company-products/:id
  router.put("/company-products/:id", async (req, res) => {
    const { id } = req.params;
    const { companyId, type, name, description, category, unit, priceB2b, priceB2c, currency, available, stockQty, vatRate, sku } = req.body;
    if (!requireAuth(req, res, companyId || req.query.companyId as string)) return;

    const existing = await db.select().from(companyProducts)
      .where(and(eq(companyProducts.id, id), eq(companyProducts.companyId, companyId || req.query.companyId as string)))
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
        stockQty: stockQty !== undefined ? stockQty : existing.stockQty,
        vatRate: vatRate !== undefined ? vatRate : existing.vatRate,
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
    if (!requireAuth(req, res, companyId)) return;

    await db.delete(companyProducts)
      .where(and(eq(companyProducts.id, id), eq(companyProducts.companyId, companyId)));

    return res.json({ ok: true });
  });

  // POST /api/company-products/import — import from CSV text
  router.post("/company-products/import", async (req, res) => {
    const { companyId, csvText } = req.body;
    if (!requireAuth(req, res, companyId)) return;
    if (!csvText) return res.status(400).json({ error: "csvText required" });

    try {
      const lines = csvText.split("\n").map((l: string) => l.trim()).filter((l: string) => l);
      if (lines.length < 2) return res.status(400).json({ error: "CSV deve avere almeno un header e una riga" });

      // Parse header (case-insensitive, flexible names)
      const header = lines[0].split(/[;,\t]/).map((h: string) => h.trim().toLowerCase().replace(/['"]/g, ""));
      const colMap: Record<string, number> = {};
      const aliases: Record<string, string[]> = {
        name: ["nome", "name", "prodotto", "servizio", "articolo"],
        type: ["tipo", "type"],
        category: ["categoria", "category", "cat"],
        unit: ["unita", "unità", "unit", "um"],
        priceB2b: ["prezzo_b2b", "prezzo b2b", "price_b2b", "b2b", "prezzo_ingrosso"],
        priceB2c: ["prezzo_b2c", "prezzo b2c", "price_b2c", "b2c", "prezzo", "prezzo_pubblico", "price"],
        description: ["descrizione", "description", "desc"],
        sku: ["sku", "codice", "codice_articolo", "cod"],
        stockQty: ["stock", "stock_qty", "quantita", "quantità", "magazzino", "giacenza", "qty"],
        vatRate: ["iva", "vat", "vat_rate", "aliquota", "aliquota_iva"],
      };
      for (const [field, names] of Object.entries(aliases)) {
        const idx = header.findIndex((h: string) => names.includes(h));
        if (idx >= 0) colMap[field] = idx;
      }

      if (!("name" in colMap)) return res.status(400).json({ error: "CSV deve avere una colonna 'nome' o 'name'" });

      // Parse rows
      const products: Array<Record<string, unknown>> = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/[;,\t]/).map((c: string) => c.trim().replace(/^['"]|['"]$/g, ""));
        const name = cols[colMap.name] || "";
        if (!name) continue;

        products.push({
          companyId,
          name,
          type: colMap.type !== undefined ? (cols[colMap.type] === "service" ? "service" : "product") : "product",
          category: colMap.category !== undefined ? cols[colMap.category] || null : null,
          unit: colMap.unit !== undefined ? cols[colMap.unit] || null : null,
          priceB2b: colMap.priceB2b !== undefined ? cols[colMap.priceB2b] || null : null,
          priceB2c: colMap.priceB2c !== undefined ? cols[colMap.priceB2c] || null : null,
          description: colMap.description !== undefined ? cols[colMap.description] || null : null,
          sku: colMap.sku !== undefined ? cols[colMap.sku] || null : null,
          stockQty: colMap.stockQty !== undefined ? cols[colMap.stockQty] || null : null,
          vatRate: colMap.vatRate !== undefined ? cols[colMap.vatRate] || null : null,
        });
      }

      if (products.length === 0) return res.status(400).json({ error: "Nessun prodotto valido trovato nel CSV" });

      // Insert all
      await db.insert(companyProducts).values(products as any);

      return res.json({ imported: products.length });
    } catch (err) {
      console.error("CSV import error:", err);
      return res.status(500).json({ error: "Errore durante l'importazione" });
    }
  });

  return router;
}
