import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

function getKeyHash(): Buffer {
  const key = process.env.GOITALIA_SECRET_KEY || process.env.BETTER_AUTH_SECRET || "goitalia-default-key-change-me";
  return crypto.createHash("sha256").update(key).digest();
}
function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(":");
  if (!ivHex || !encryptedHex) throw new Error("Invalid");
  const iv = Buffer.from(ivHex, "hex");
  const d = crypto.createDecipheriv("aes-256-cbc", getKeyHash(), iv);
  let r = d.update(encryptedHex, "hex", "utf8");
  r += d.final("utf8");
  return r;
}
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-cbc", getKeyHash(), iv);
  let e = c.update(text, "utf8", "hex");
  e += c.final("hex");
  return iv.toString("hex") + ":" + e;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";

async function getToken(db: Db, companyId: string): Promise<string | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
    .then((rows) => rows[0]);
  if (!secret?.description) return null;
  const decrypted = JSON.parse(decrypt(secret.description));
  const tokenData = Array.isArray(decrypted) ? decrypted[0] : decrypted;
  if (!tokenData) return null;
  if (tokenData.expires_at && tokenData.expires_at < Date.now() && tokenData.refresh_token) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: tokenData.refresh_token, grant_type: "refresh_token" }),
    });
    if (res.ok) {
      const t = await res.json() as { access_token: string; expires_in: number };
      tokenData.access_token = t.access_token;
      tokenData.expires_at = Date.now() + t.expires_in * 1000;
      await db.update(companySecrets).set({ description: encrypt(JSON.stringify(tokenData)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
    }
  }
  return tokenData.access_token;
}

export function calendarRoutes(db: Db) {
  const router = Router();

  // GET /calendar/events?companyId=xxx&timeMin=&timeMax=
  router.get("/calendar/events", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const token = await getToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }

    const now = new Date();
    const timeMin = (req.query.timeMin as string) || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const timeMax = (req.query.timeMax as string) || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    try {
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=100`,
        { headers: { Authorization: "Bearer " + token } }
      );
      if (!r.ok) { res.status(502).json({ error: "Errore lettura calendario" }); return; }
      const data = await r.json() as { items?: any[] };
      const events = (data.items || []).map((e: any) => ({
        id: e.id,
        title: e.summary || "(senza titolo)",
        description: e.description || "",
        start: e.start?.dateTime || e.start?.date || "",
        end: e.end?.dateTime || e.end?.date || "",
        location: e.location || "",
        allDay: !e.start?.dateTime,
        htmlLink: e.htmlLink || "",
      }));
      res.json({ events });
    } catch (err) {
      console.error("Calendar error:", err);
      res.status(500).json({ error: "Errore calendario" });
    }
  });


  // POST /calendar/events - Create event
  router.post("/calendar/events", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, title, description, start, end, allDay, location } = req.body as {
      companyId: string; title: string; description?: string; start: string; end: string; allDay?: boolean; location?: string;
    };
    if (!companyId || !title || !start || !end) { res.status(400).json({ error: "companyId, title, start, end richiesti" }); return; }

    const token = await getToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }

    const event: Record<string, unknown> = {
      summary: title,
      description: description || "",
      location: location || "",
    };

    if (allDay) {
      event.start = { date: start.split("T")[0] };
      event.end = { date: end.split("T")[0] };
    } else {
      // Ensure proper ISO format with seconds
      const formatDt = (dt: string) => dt.includes(":") && dt.split(":").length === 2 ? dt + ":00" : dt;
      event.start = { dateTime: formatDt(start), timeZone: "Europe/Rome" };
      event.end = { dateTime: formatDt(end), timeZone: "Europe/Rome" };
    }

    try {
      const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      if (!r.ok) { const err = await r.text(); console.error("Calendar create error:", err); res.status(502).json({ error: "Errore creazione evento" }); return; }
      const created = await r.json() as { id: string; htmlLink?: string };
      res.json({ id: created.id, htmlLink: created.htmlLink || "" });
    } catch (err) {
      console.error("Calendar create error:", err);
      res.status(500).json({ error: "Errore creazione evento" });
    }
  });


  // DELETE /calendar/events/:id?companyId=xxx
  router.delete("/calendar/events/:id", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }
    const token = await getToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }
    try {
      const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events/" + req.params.id, {
        method: "DELETE", headers: { Authorization: "Bearer " + token },
      });
      if (!r.ok && r.status !== 204) { res.status(502).json({ error: "Errore eliminazione" }); return; }
      res.json({ deleted: true });
    } catch { res.status(500).json({ error: "Errore" }); }
  });

  return router;
}
