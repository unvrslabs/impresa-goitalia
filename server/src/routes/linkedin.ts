import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "";
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "";
const REDIRECT_URI = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/api/oauth/linkedin/callback";

const oauthStates = new Map<string, { companyId: string; userId: string; prefix: string; expiresAt: number }>();
// Cleanup expired states every 5 minutes
setInterval(() => { const now = Date.now(); for (const [k, v] of oauthStates) { if (v.expiresAt < now) oauthStates.delete(k); } }, 300000);

interface LinkedInAccount {
  accessToken: string;
  expiresAt: number;
  sub: string;
  name: string;
  email: string;
  picture?: string;
}

export function linkedinRoutes(db: Db) {
  const router = Router();

  router.get("/oauth/linkedin/connect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const prefix = (req.query.prefix as string) || "";
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const state = crypto.randomBytes(32).toString("hex");
    oauthStates.set(state, { companyId, userId: actor.userId, prefix, expiresAt: Date.now() + 600000 });

    const scopes = "openid profile email w_member_social";
    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}&state=${state}`;
    res.redirect(authUrl);
  });

  router.get("/oauth/linkedin/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    if (oauthError) { res.redirect("/?error=linkedin_denied"); return; }
    if (!code || !state) { res.redirect("/?error=linkedin_invalid"); return; }

    const stateData = oauthStates.get(state);
    oauthStates.delete(state);
    if (!stateData || stateData.expiresAt < Date.now()) { res.redirect("/?error=linkedin_expired"); return; }

    try {
      const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: LINKEDIN_CLIENT_ID, client_secret: LINKEDIN_CLIENT_SECRET }),
      });
      if (!tokenRes.ok) { res.redirect("/?error=linkedin_token_failed"); return; }
      const tokens = await tokenRes.json() as { access_token: string; expires_in: number };

      // Get profile
      const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: "Bearer " + tokens.access_token },
      });
      const profile = await profileRes.json() as { sub?: string; name?: string; email?: string; picture?: string };

      const newAccount: LinkedInAccount = {
        accessToken: tokens.access_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        sub: profile.sub || "",
        name: profile.name || "",
        email: profile.email || "",
        picture: profile.picture,
      };

      // Multi-account: read existing accounts, merge or add
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, stateData.companyId), eq(companySecrets.name, "linkedin_tokens")))
        .then((rows) => rows[0]);

      let accounts: LinkedInAccount[] = [];
      if (existing?.description) {
        try {
          const decrypted = JSON.parse(decrypt(existing.description));
          // Migrate from single-account to array
          if (Array.isArray(decrypted)) {
            accounts = decrypted;
          } else {
            accounts = [decrypted];
          }
        } catch {}
      }

      // Update existing or add new
      const emailIndex = accounts.findIndex((a) => a.email === newAccount.email);
      if (emailIndex >= 0) {
        accounts[emailIndex] = newAccount;
      } else {
        accounts.push(newAccount);
      }

      const encrypted = encrypt(JSON.stringify(accounts));
      if (existing) {
        await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId: stateData.companyId, name: "linkedin_tokens", provider: "encrypted", description: encrypted });
      }

      await upsertConnectorAccount(db, stateData.companyId, "linkedin", newAccount.email, newAccount.name);

      const prefix = stateData.prefix || "";
      res.redirect(prefix ? "/" + prefix + "/plugins?linkedin_connected=true" : "/?linkedin_connected=true");
    } catch (err) {
      console.error("LinkedIn OAuth error:", err);
      res.redirect("/?error=linkedin_error");
    }
  });

  router.get("/oauth/linkedin/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ connected: false }); return; }
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "linkedin_tokens")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ connected: false }); return; }
    try {
      const decrypted = JSON.parse(decrypt(secret.description));
      const accounts: LinkedInAccount[] = Array.isArray(decrypted) ? decrypted : [decrypted];
      res.json({
        connected: true,
        name: accounts[0]?.name,
        email: accounts[0]?.email,
        accounts: accounts.map((a) => ({ name: a.name, email: a.email, picture: a.picture })),
      });
    } catch { res.json({ connected: false }); }
  });

  router.post("/oauth/linkedin/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    const emailToRemove = req.query.email as string || req.body?.email;

    if (emailToRemove) {
      // Remove single account
      const secret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "linkedin_tokens")))
        .then((rows) => rows[0]);
      if (secret?.description) {
        try {
          const decrypted = JSON.parse(decrypt(secret.description));
          const accounts: LinkedInAccount[] = Array.isArray(decrypted) ? decrypted : [decrypted];
          const filtered = accounts.filter((a) => a.email !== emailToRemove);
          if (filtered.length > 0) {
            await db.update(companySecrets).set({ description: encrypt(JSON.stringify(filtered)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
          } else {
            await db.delete(companySecrets).where(eq(companySecrets.id, secret.id));
          }
        } catch {}
      }
      await removeConnectorAccount(db, companyId, "linkedin", emailToRemove);
    } else {
      // Remove all
      await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "linkedin_tokens")));
      await removeConnectorAccount(db, companyId, "linkedin");
    }
    res.json({ disconnected: true });
  });

  return router;
}
