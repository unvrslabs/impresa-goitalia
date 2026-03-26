import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, companyMemberships } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
const REDIRECT_URI = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/api/oauth/google/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

// Encrypt/decrypt using same key as onboarding



// Temporary state store for OAuth flow
const oauthStates = new Map<string, { companyId: string; userId: string; prefix: string; expiresAt: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of oauthStates) { if (v.expiresAt < now) oauthStates.delete(k); } }, 300000);

export function googleOAuthRoutes(db: Db) {
  const router = Router();

  // GET /oauth/google/connect?companyId=xxx - Start OAuth flow
  router.get("/oauth/google/connect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const state = crypto.randomBytes(32).toString("hex");
    const companyPrefix = (req.query.prefix as string) || "";
    oauthStates.set(state, { companyId, userId: actor.userId, prefix: companyPrefix, expiresAt: Date.now() + 600000 }); // 10min

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    res.redirect(authUrl.toString());
  });

  // GET /oauth/google/callback - Handle OAuth callback
  router.get("/oauth/google/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      res.redirect("/plugins?error=google_oauth_denied");
      return;
    }

    if (!code || !state) {
      res.redirect("/plugins?error=google_oauth_invalid");
      return;
    }

    const stateData = oauthStates.get(state);
    oauthStates.delete(state);

    if (!stateData || stateData.expiresAt < Date.now()) {
      res.redirect("/plugins?error=google_oauth_expired");
      return;
    }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        console.error("Google token exchange failed:", await tokenRes.text());
        res.redirect("/plugins?error=google_oauth_token_failed");
        return;
      }

      const tokens = await tokenRes.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        token_type: string;
      };

      // Get user email
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: "Bearer " + tokens.access_token },
      });
      const userInfo = await userInfoRes.json() as { email?: string };
      console.info("[google-oauth] userInfo:", JSON.stringify(userInfo));

      // Save encrypted tokens — support multiple accounts
      const newAccount = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
        email: userInfo.email || "",
      };

      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, stateData.companyId), eq(companySecrets.name, "google_oauth_tokens")))
        .then((rows) => rows[0]);

      let accounts: Array<typeof newAccount> = [];
      if (existing?.description) {
        try {
          const decrypted = JSON.parse(decrypt(existing.description));
          // Migrate from single account to array
          if (Array.isArray(decrypted)) {
            accounts = decrypted;
          } else if (decrypted.access_token) {
            accounts = [decrypted];
          }
        } catch {}
      }

      // Replace if same email, otherwise append
      const emailIndex = accounts.findIndex((a) => a.email === newAccount.email);
      if (emailIndex >= 0) {
        accounts[emailIndex] = newAccount;
      } else {
        accounts.push(newAccount);
      }

      const encrypted = encrypt(JSON.stringify(accounts));

      if (existing) {
        await db.update(companySecrets)
          .set({ description: encrypted, updatedAt: new Date() })
          .where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({
          id: crypto.randomUUID(),
          companyId: stateData.companyId,
          name: "google_oauth_tokens",
          provider: "encrypted",
          description: encrypted,
        });
      }

      // Sync connector_accounts
      const email = newAccount.email;
      if (email) {
        await upsertConnectorAccount(db, stateData.companyId, "google", email, email);
      }

      // Redirect back to plugins page with success
      const prefix = stateData.prefix || "";
      res.redirect(prefix ? "/" + prefix + "/plugins?google_connected=true" : "/?google_connected=true");
    } catch (err) {
      console.error("Google OAuth error:", err);
      res.redirect("/?error=google_oauth_error");
    }
  });

  // GET /oauth/google/status?companyId=xxx - Check connection status
  router.get("/oauth/google/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ connected: false }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
      .then((rows) => rows[0]);

    if (!secret?.description) {
      res.json({ connected: false });
      return;
    }

    try {
      const decrypted = JSON.parse(decrypt(secret.description));
      // Support both array and single account format
      const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
      const emails = accounts.map((a: any) => a.email || "Account Google");
      res.json({ connected: true, email: emails[0], accounts: emails });
    } catch {
      res.json({ connected: false });
    }
  });

  // GET /oauth/google/disconnect?companyId=xxx - Disconnect Google
  router.get("/oauth/google/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const emailToRemove = req.query.email as string || "";

    if (emailToRemove) {
      // Remove specific account
      const secret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
        .then((rows) => rows[0]);
      if (secret?.description) {
        try {
          const decrypted = JSON.parse(decrypt(secret.description));
          const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
          const filtered = accounts.filter((a: any) => a.email !== emailToRemove);
          if (filtered.length > 0) {
            await db.update(companySecrets)
              .set({ description: encrypt(JSON.stringify(filtered)), updatedAt: new Date() })
              .where(eq(companySecrets.id, secret.id));
          } else {
            await db.delete(companySecrets).where(eq(companySecrets.id, secret.id));
          }
        } catch {}
      }
      await removeConnectorAccount(db, companyId, "google", emailToRemove);
    } else {
      // Remove all
      await db.delete(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")));
      await removeConnectorAccount(db, companyId, "google");
    }

    res.json({ disconnected: true });
  });

  return router;
}
