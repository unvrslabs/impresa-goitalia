import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";

const META_APP_ID = process.env.META_APP_ID || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";
const REDIRECT_URI = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/api/oauth/meta/callback";

const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_messages",
  "instagram_manage_comments",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "public_profile",
].join(",");


const oauthStates = new Map<string, { companyId: string; userId: string; prefix: string; expiresAt: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of oauthStates) { if (v.expiresAt < now) oauthStates.delete(k); } }, 300000);

export function metaRoutes(db: Db) {
  const router = Router();

  // GET /oauth/meta/connect?companyId=xxx&prefix=xxx
  router.get("/oauth/meta/connect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const prefix = (req.query.prefix as string) || "";
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const state = crypto.randomBytes(32).toString("hex");
    oauthStates.set(state, { companyId, userId: actor.userId, prefix, expiresAt: Date.now() + 600000 });

    const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}&state=${state}&response_type=code`;
    res.redirect(authUrl);
  });

  // GET /oauth/meta/callback
  router.get("/oauth/meta/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    if (oauthError) { res.redirect("/?error=meta_oauth_denied"); return; }
    if (!code || !state) { res.redirect("/?error=meta_oauth_invalid"); return; }

    const stateData = oauthStates.get(state);
    oauthStates.delete(state);
    if (!stateData || stateData.expiresAt < Date.now()) { res.redirect("/?error=meta_oauth_expired"); return; }

    try {
      // Exchange code for short-lived token
      const tokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`);
      if (!tokenRes.ok) { res.redirect("/?error=meta_token_failed"); return; }
      const tokens = await tokenRes.json() as { access_token: string; token_type: string; expires_in: number };

      // Exchange for long-lived token (60 days)
      const longRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${tokens.access_token}`);
      const longToken = longRes.ok ? await longRes.json() as { access_token: string; expires_in: number } : tokens;

      // Get user info
      const meRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${longToken.access_token}`);
      const me = await meRes.json() as { id?: string; name?: string };

      // Get pages
      const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${longToken.access_token}`);
      const pagesData = await pagesRes.json() as { data?: Array<{ id: string; name: string; access_token: string }> };
      const pages = pagesData.data || [];

      // Get Instagram accounts linked to pages
      const igAccounts: Array<{ id: string; username: string; pageId: string; pageName: string }> = [];
      for (const page of pages) {
        const igRes = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account{id,username}&access_token=${page.access_token}`);
        const igData = await igRes.json() as { instagram_business_account?: { id: string; username: string } };
        if (igData.instagram_business_account) {
          igAccounts.push({
            id: igData.instagram_business_account.id,
            username: igData.instagram_business_account.username || "",
            pageId: page.id,
            pageName: page.name,
          });
        }
      }

      // Save everything
      const metaData = {
        accessToken: longToken.access_token,
        expiresAt: Date.now() + (longToken.expires_in || 5184000) * 1000,
        userId: me.id,
        userName: me.name,
        pages: pages.map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token })),
        instagram: igAccounts,
      };

      const encrypted = encrypt(JSON.stringify(metaData));
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, stateData.companyId), eq(companySecrets.name, "meta_tokens")))
        .then((rows) => rows[0]);

      if (existing) {
        await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId: stateData.companyId, name: "meta_tokens", provider: "encrypted", description: encrypted });
      }

      const prefix = stateData.prefix || "";
      res.redirect(prefix ? "/" + prefix + "/plugins?meta_connected=true" : "/?meta_connected=true");
    } catch (err) {
      console.error("Meta OAuth error:", err);
      res.redirect("/?error=meta_oauth_error");
    }
  });

  // GET /oauth/meta/status?companyId=xxx
  router.get("/oauth/meta/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ connected: false }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "meta_tokens")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ connected: false }); return; }

    try {
      const data = JSON.parse(decrypt(secret.description));
      res.json({
        connected: true,
        userName: data.userName,
        pages: (data.pages || []).map((p: any) => ({ id: p.id, name: p.name })),
        instagram: (data.instagram || []).map((ig: any) => ({ id: ig.id, username: ig.username, pageName: ig.pageName })),
      });
    } catch { res.json({ connected: false }); }
  });

  // POST /oauth/meta/disconnect?companyId=xxx
  router.post("/oauth/meta/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    if (!companyId) { res.json({ disconnected: true }); return; }
    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "meta_tokens")));
    res.json({ disconnected: true });
  });

  return router;
}
