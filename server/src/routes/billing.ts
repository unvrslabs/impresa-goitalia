import { Router, type Request, type Response } from "express";
import type { Db } from "@goitalia/db";
import { whatsappSubscriptions } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import Stripe from "stripe";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY non configurata");
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

const PRICE_MONTHLY_EUR = 2000; // €20.00
const PRICE_ANNUAL_EUR = 19200; // €192.00

let cachedPriceMonthly: string | null = null;
let cachedPriceAnnual: string | null = null;

async function ensurePrices(stripe: Stripe): Promise<{ monthly: string; annual: string }> {
  if (cachedPriceMonthly && cachedPriceAnnual) {
    return { monthly: cachedPriceMonthly, annual: cachedPriceAnnual };
  }

  const products = await stripe.products.list({ limit: 100 });
  let product = products.data.find((p) => p.metadata?.goitalia_type === "whatsapp_number");

  if (!product) {
    product = await stripe.products.create({
      name: "Numero WhatsApp — GoItalIA Impresa",
      description: "Numero WhatsApp connesso tramite WaSender. €20/mese o €192/anno.",
      metadata: { goitalia_type: "whatsapp_number" },
    });
  }

  const prices = await stripe.prices.list({ product: product.id, limit: 10, active: true });
  let monthly = prices.data.find((p) => p.recurring?.interval === "month" && p.unit_amount === PRICE_MONTHLY_EUR);
  let annual = prices.data.find((p) => p.recurring?.interval === "year" && p.unit_amount === PRICE_ANNUAL_EUR);

  if (!monthly) {
    monthly = await stripe.prices.create({
      product: product.id, unit_amount: PRICE_MONTHLY_EUR, currency: "eur",
      recurring: { interval: "month" },
      metadata: { goitalia_type: "whatsapp_monthly" },
    });
  }

  if (!annual) {
    annual = await stripe.prices.create({
      product: product.id, unit_amount: PRICE_ANNUAL_EUR, currency: "eur",
      recurring: { interval: "year" },
      metadata: { goitalia_type: "whatsapp_annual" },
    });
  }

  cachedPriceMonthly = monthly.id;
  cachedPriceAnnual = annual.id;
  return { monthly: monthly.id, annual: annual.id };
}

async function ensureStripeCustomer(stripe: Stripe, db: Db, companyId: string, companyName: string): Promise<string> {
  const existing = await db
    .select({ stripeCustomerId: whatsappSubscriptions.stripeCustomerId })
    .from(whatsappSubscriptions)
    .where(eq(whatsappSubscriptions.companyId, companyId))
    .limit(1);

  if (existing[0]?.stripeCustomerId) return existing[0].stripeCustomerId;

  const customer = await stripe.customers.create({
    name: companyName,
    metadata: { goitalia_company_id: companyId },
  });
  return customer.id;
}

export function billingRoutes(db: Db) {
  const router = Router();

  // GET /billing/whatsapp/status?companyId=xxx&phone=xxx
  router.get("/billing/whatsapp/status", async (req: Request, res: Response) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, phone } = req.query as { companyId: string; phone?: string };
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    if (phone) {
      const sub = await db
        .select().from(whatsappSubscriptions)
        .where(and(eq(whatsappSubscriptions.companyId, companyId), eq(whatsappSubscriptions.phoneNumber, phone)))
        .then((r) => r[0]);
      if (!sub) { res.json({ active: false }); return; }
      const active = sub.status === "active" && (!sub.currentPeriodEnd || sub.currentPeriodEnd > new Date());
      res.json({ active, status: sub.status, interval: sub.interval, currentPeriodEnd: sub.currentPeriodEnd });
    } else {
      const subs = await db.select().from(whatsappSubscriptions).where(eq(whatsappSubscriptions.companyId, companyId));
      res.json({ subscriptions: subs });
    }
  });

  // POST /billing/whatsapp/checkout
  router.post("/billing/whatsapp/checkout", async (req: Request, res: Response) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, companyName, phone, interval, successUrl, cancelUrl } = req.body as {
      companyId: string; companyName: string; phone: string;
      interval: "monthly" | "annual"; successUrl: string; cancelUrl: string;
    };
    if (!companyId || !phone || !interval) { res.status(400).json({ error: "Campi obbligatori mancanti" }); return; }

    try {
      const stripe = getStripe();
      const prices = await ensurePrices(stripe);
      const customerId = await ensureStripeCustomer(stripe, db, companyId, companyName || companyId);

      const existing = await db.select().from(whatsappSubscriptions)
        .where(and(eq(whatsappSubscriptions.companyId, companyId), eq(whatsappSubscriptions.phoneNumber, phone)))
        .then((r) => r[0]);

      if (existing) {
        await db.update(whatsappSubscriptions)
          .set({ stripeCustomerId: customerId, status: "pending", interval, updatedAt: new Date() })
          .where(eq(whatsappSubscriptions.id, existing.id));
      } else {
        await db.insert(whatsappSubscriptions).values({
          companyId, phoneNumber: phone, stripeCustomerId: customerId, status: "pending", interval,
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: interval === "annual" ? prices.annual : prices.monthly, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { goitalia_company_id: companyId, goitalia_phone: phone },
        subscription_data: { metadata: { goitalia_company_id: companyId, goitalia_phone: phone } },
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error("[billing] checkout error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /billing/whatsapp/portal
  router.post("/billing/whatsapp/portal", async (req: Request, res: Response) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, returnUrl } = req.body as { companyId: string; returnUrl: string };

    const sub = await db.select().from(whatsappSubscriptions)
      .where(eq(whatsappSubscriptions.companyId, companyId)).limit(1).then((r) => r[0]);

    if (!sub?.stripeCustomerId) { res.status(404).json({ error: "Nessun abbonamento trovato" }); return; }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({ customer: sub.stripeCustomerId, return_url: returnUrl });
    res.json({ url: session.url });
  });

  return router;
}

// Webhook handler — registered on /api with raw body
export function billingWebhookRouter(db: Db) {
  const router = Router();

  router.post("/billing/webhook", async (req: Request, res: Response) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    const stripe = getStripe();

    let event: Stripe.Event;
    try {
      if (!webhookSecret) {
        console.error("[billing webhook] STRIPE_WEBHOOK_SECRET not configured — rejecting webhook");
        res.status(500).json({ error: "Webhook secret not configured" });
        return;
      }
      if (!rawBody) {
        res.status(400).json({ error: "Raw body not available" });
        return;
      }
      const sig = req.headers["stripe-signature"] as string;
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch {
      res.status(400).json({ error: "Webhook verification failed" });
      return;
    }

    try { await handleStripeEvent(db, stripe, event); } catch (err) {
      console.error("[billing webhook]", event.type, err);
    }
    res.json({ received: true });
  });

  return router;
}

async function handleStripeEvent(db: Db, stripe: Stripe, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const companyId = session.metadata?.goitalia_company_id;
      const phone = session.metadata?.goitalia_phone;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!companyId || !phone || !subscriptionId) break;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const interval = subscription.items.data[0]?.plan.interval === "year" ? "annual" : "monthly";
      // Estimate period end: billing_cycle_anchor + 1 month or 1 year
      const anchor = subscription.billing_cycle_anchor;
      const periodEnd = new Date((anchor + (interval === "annual" ? 365 : 31) * 86400) * 1000);

      await db.update(whatsappSubscriptions)
        .set({ stripeSubscriptionId: subscriptionId, status: "active", interval, currentPeriodEnd: periodEnd, updatedAt: new Date() })
        .where(and(eq(whatsappSubscriptions.companyId, companyId), eq(whatsappSubscriptions.phoneNumber, phone)));
      console.log("[billing] WhatsApp subscription activated:", phone, companyId);
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionDetails = invoice.parent?.type === "subscription_details" ? invoice.parent.subscription_details : null;
      const subscriptionId = typeof subscriptionDetails?.subscription === "string"
        ? subscriptionDetails.subscription
        : subscriptionDetails?.subscription?.id;
      if (!subscriptionId) break;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const companyId = subscription.metadata?.goitalia_company_id;
      const phone = subscription.metadata?.goitalia_phone;
      if (!companyId || !phone) break;

      // Use invoice period_end as current period end
      const periodEnd = new Date(invoice.period_end * 1000);
      await db.update(whatsappSubscriptions)
        .set({ status: "active", currentPeriodEnd: periodEnd, updatedAt: new Date() })
        .where(and(eq(whatsappSubscriptions.companyId, companyId), eq(whatsappSubscriptions.phoneNumber, phone)));
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionDetails = invoice.parent?.type === "subscription_details" ? invoice.parent.subscription_details : null;
      const subscriptionId = typeof subscriptionDetails?.subscription === "string"
        ? subscriptionDetails.subscription
        : subscriptionDetails?.subscription?.id;
      if (!subscriptionId) break;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const companyId = subscription.metadata?.goitalia_company_id;
      const phone = subscription.metadata?.goitalia_phone;
      if (!companyId || !phone) break;

      await db.update(whatsappSubscriptions)
        .set({ status: "past_due", updatedAt: new Date() })
        .where(and(eq(whatsappSubscriptions.companyId, companyId), eq(whatsappSubscriptions.phoneNumber, phone)));
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const companyId = subscription.metadata?.goitalia_company_id;
      const phone = subscription.metadata?.goitalia_phone;
      if (!companyId || !phone) break;

      await db.update(whatsappSubscriptions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(whatsappSubscriptions.companyId, companyId), eq(whatsappSubscriptions.phoneNumber, phone)));
      console.log("[billing] WhatsApp subscription cancelled:", phone, companyId);
      break;
    }
  }
}
