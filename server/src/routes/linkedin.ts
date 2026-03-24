import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "";
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "";
const REDIRECT_URI = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/api/oauth/linkedin/callback";

function getKeyHash(): Buffer {
  const key = process.env.GOITALIA_SECRET_KEY || process.env.BETTER_AUTH_SECRET || "goitalia-default-key-change-me";
  return crypto.createHash("sha256").update(key).digest();
}
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-cbc", getKeyHash(), iv);
  let e = c.update(text, "utf8", "hex"); e += c.final("hex");
  return iv.toString("hex") + ":" + e;
}
function decrypt(text: string): string {
  const [ivHex, enc] = text.split(":");
  if (!ivHex || !enc) throw new Error("Invalid");
  const d = crypto.createDecipheriv("aes-256-cbc", getKeyHash(), Buffer.from(ivHex, "hex"));
  let r = d.update(enc, "hex", "utf8"); r += d.final("utf8");
  return r;
}

const oauthStates = new Map<string, { companyId: string; userId: string; prefix: string; expiresAt: number }>();

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

      const linkedinData = {
        accessToken: tokens.access_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        sub: profile.sub,
        name: profile.name,
        email: profile.email,
        picture: profile.picture,
      };

      const encrypted = encrypt(JSON.stringify(linkedinData));
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, stateData.companyId), eq(companySecrets.name, "linkedin_tokens")))
        .then((rows) => rows[0]);

      if (existing) {
        await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId: stateData.companyId, name: "linkedin_tokens", provider: "encrypted", description: encrypted });
      }

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
      const data = JSON.parse(decrypt(secret.description));
      res.json({ connected: true, name: data.name, email: data.email, picture: data.picture });
    } catch { res.json({ connected: false }); }
  });

  router.post("/oauth/linkedin/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "linkedin_tokens")));
    res.json({ disconnected: true });
  });

  return router;
}
