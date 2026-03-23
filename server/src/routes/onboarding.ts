import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, companyMemberships } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { companyService } from "../services/companies.js";
import { agentService } from "../services/agents.js";
import { accessService } from "../services/access.js";
import { logActivity } from "../services/activity-log.js";

// --- Encryption helpers for API keys ---
const ENCRYPTION_KEY = process.env.GOITALIA_SECRET_KEY || process.env.BETTER_AUTH_SECRET || "goitalia-default-key-change-me";
const KEY_HASH = createHash("sha256").update(ENCRYPTION_KEY).digest();

function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", KEY_HASH, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(":");
  if (!ivHex || !encryptedHex) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", KEY_HASH, iv);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// --- Rate limiting (simple in-memory) ---
const activationAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ACTIVATIONS_PER_IP = 5;
const ACTIVATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = activationAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    activationAttempts.set(ip, { count: 1, resetAt: now + ACTIVATION_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ACTIVATIONS_PER_IP) return false;
  entry.count++;
  return true;
}

// --- Auth helper ---
function assertBoardAuth(req: { actor?: { type?: string; userId?: string } }): string {
  const actor = req.actor as { type?: string; userId?: string } | undefined;
  if (!actor || actor.type !== "board" || !actor.userId) {
    throw new Error("AUTH_REQUIRED");
  }
  return actor.userId;
}

function assertCompanyAccess(req: { actor?: { type?: string; userId?: string } }, companyId: string, db: Db): Promise<boolean> {
  const userId = assertBoardAuth(req);
  return db.select().from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)))
    .then((rows) => {
      if (rows.length === 0) throw new Error("ACCESS_DENIED");
      return true;
    });
}

// --- Validation ---
const MAX_MEMBERS = 50;
const MAX_STRING_LENGTH = 500;

function sanitizeString(value: string, maxLen = MAX_STRING_LENGTH): string {
  return String(value || "").trim().slice(0, maxLen);
}

interface TeamMember {
  name: string;
  role: string;
  department: string;
  software: string;
  description: string;
}

interface OnboardingRequest {
  companyName: string;
  email: string;
  password: string;
  members: TeamMember[];
}

export function onboardingRoutes(db: Db, serverPort: number) {
  const router = Router();
  const companySvc = companyService(db);
  const agentSvc = agentService(db);
  const access = accessService(db);

  // Resolve origin from config or env
  const publicOrigin = process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || `http://127.0.0.1:${serverPort}`;

  // ============================================
  // POST /activate — Create account + company + agents
  // Public endpoint (no auth required) but rate-limited
  // ============================================
  router.post("/activate", async (req, res) => {
    try {
      // Rate limit by IP
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(ip)) {
        res.status(429).json({ error: "Troppe richieste. Riprova tra un'ora." });
        return;
      }

      const body = req.body as OnboardingRequest;

      // Validate required fields
      if (!body.companyName || !body.email || !body.password || !body.members?.length) {
        res.status(400).json({ error: "Campi obbligatori mancanti" });
        return;
      }

      // Validate email format
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        res.status(400).json({ error: "Email non valida" });
        return;
      }

      // Validate password length
      if (body.password.length < 8) {
        res.status(400).json({ error: "La password deve avere almeno 8 caratteri" });
        return;
      }

      // Cap members
      if (body.members.length > MAX_MEMBERS) {
        res.status(400).json({ error: `Massimo ${MAX_MEMBERS} membri del team` });
        return;
      }

      // Sanitize all inputs
      const companyName = sanitizeString(body.companyName, 200);
      const members = body.members.map((m) => ({
        name: sanitizeString(m.name, 100),
        role: sanitizeString(m.role, 200),
        department: sanitizeString(m.department, 100),
        software: sanitizeString(m.software, 300),
        description: sanitizeString(m.description, 500),
      }));

      // 1. Create user via Better Auth signup API
      const signupRes = await fetch(`http://127.0.0.1:${serverPort}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": publicOrigin,
        },
        body: JSON.stringify({
          email: body.email,
          password: body.password,
          name: companyName,
        }),
      });

      if (!signupRes.ok) {
        // Don't expose internal auth errors
        const status = signupRes.status;
        if (status === 422 || status === 409) {
          res.status(400).json({ error: "Questa email è già registrata. Prova ad accedere." });
        } else {
          console.error("Signup failed:", await signupRes.text());
          res.status(400).json({ error: "Registrazione fallita. Riprova." });
        }
        return;
      }

      const signupData = await signupRes.json() as { user?: { id?: string }; token?: string };
      const userId = signupData.user?.id;
      if (!userId) {
        res.status(500).json({ error: "Errore nella creazione dell'account. Riprova." });
        return;
      }

      // 2-5: Create company + agents (with error recovery)
      let company: { id: string; issuePrefix: string; name: string } | null = null;
      try {
        // 2. Create company
        const issuePrefix = companyName
          .replace(/[^a-zA-Z0-9]/g, "")
          .toUpperCase()
          .slice(0, 5) || "COMP";

        company = await companySvc.create({
          name: companyName,
          description: `Azienda AI - ${members.length} agenti`,
          issuePrefix,
          budgetMonthlyCents: 10000000,
        });

        // 3. Create membership (user as owner)
        await access.ensureMembership(company.id, "user", userId, "owner", "active");

        // 4. Create CEO agent
        const ceo = await agentSvc.create(company.id, {
          name: "CEO",
          role: "ceo",
          title: "Chief Executive Officer",
          adapterType: "claude_api",
          adapterConfig: {},
          capabilities: "Coordina tutti gli agenti, delega task, monitora progressi e costi.",
          budgetMonthlyCents: 5000000,
          status: "idle",
        });

        // 5. Create agents for each team member
        const createdAgents = [];
        for (const member of members) {
          const agent = await agentSvc.create(company.id, {
            name: `Agente ${member.name}`,
            role: "general",
            title: member.role,
            adapterType: "claude_api",
            adapterConfig: {},
            reportsTo: ceo.id,
            capabilities: [
              `Reparto: ${member.department}`,
              `Compito: ${member.description || member.role}`,
              member.software ? `Software: ${member.software}` : "",
            ].filter(Boolean).join(". "),
            budgetMonthlyCents: 1000000,
            status: "idle",
          });
          createdAgents.push(agent);
        }

        // 6. Log activity
        await logActivity(db, {
          companyId: company.id,
          actorType: "user",
          actorId: userId,
          action: "company.created",
          entityType: "company",
          entityId: company.id,
          details: { name: company.name, source: "onboarding_wizard", agentCount: createdAgents.length + 1 },
        });

        res.status(201).json({
          success: true,
          companyId: company.id,
          issuePrefix: company.issuePrefix,
          agentCount: createdAgents.length + 1,
        });
      } catch (innerError: unknown) {
        // Log but don't expose internals
        console.error("Company/agent creation failed after user signup:", innerError);
        // The user was created but company failed — they can log in and we can retry
        res.status(500).json({
          error: "Errore nella creazione dell'azienda. L'account è stato creato — accedi e riprova.",
          userId,
        });
      }
    } catch (error: unknown) {
      console.error("Onboarding activation error:", error);
      res.status(500).json({ error: "Errore durante l'attivazione. Riprova." });
    }
  });

  // ============================================
  // POST /claude-key — Save Claude API key (AUTHENTICATED + company access)
  // ============================================
  router.post("/claude-key", async (req, res) => {
    try {
      // Require authentication
      let userId: string;
      try {
        userId = assertBoardAuth(req);
      } catch {
        res.status(401).json({ error: "Autenticazione richiesta" });
        return;
      }

      const { companyId, apiKey } = req.body as { companyId: string; apiKey: string };

      if (!companyId || !apiKey) {
        res.status(400).json({ error: "companyId e apiKey sono obbligatori" });
        return;
      }

      // Verify user has access to this company
      try {
        await assertCompanyAccess(req, companyId, db);
      } catch {
        res.status(403).json({ error: "Accesso non autorizzato a questa azienda" });
        return;
      }

      // Validate key format
      if (!apiKey.startsWith("sk-ant-")) {
        res.status(400).json({ error: "La API key deve iniziare con sk-ant-" });
        return;
      }

      // Key length sanity check
      if (apiKey.length < 20 || apiKey.length > 300) {
        res.status(400).json({ error: "Formato API key non valido" });
        return;
      }

      // Test the key with a minimal API call
      try {
        const testRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 10,
            messages: [{ role: "user", content: "test" }],
          }),
        });

        if (!testRes.ok) {
          res.status(400).json({ error: "API key non valida. Verifica di averla copiata correttamente." });
          return;
        }
      } catch {
        res.status(400).json({ error: "Impossibile verificare la API key. Controlla la connessione." });
        return;
      }

      // Encrypt the key before storing
      const encryptedKey = encrypt(apiKey);

      // Upsert the secret
      const existing = await db
        .select()
        .from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
        .then((rows) => rows[0]);

      if (existing) {
        await db
          .update(companySecrets)
          .set({ description: encryptedKey, provider: "encrypted", updatedAt: new Date() })
          .where(eq(companySecrets.id, existing.id));
      } else {
        await db
          .insert(companySecrets)
          .values({
            companyId,
            name: "claude_api_key",
            provider: "encrypted",
            description: encryptedKey,
            createdByUserId: userId,
          });
      }

      res.json({ success: true });
    } catch (error: unknown) {
      console.error("Claude key save error:", error);
      res.status(500).json({ error: "Errore nel salvataggio della chiave. Riprova." });
    }
  });

  // ============================================
  // GET /claude-key/:companyId — Check if key exists (AUTHENTICATED)
  // ============================================
  router.get("/claude-key/:companyId", async (req, res) => {
    try {
      // Require authentication
      try {
        assertBoardAuth(req);
      } catch {
        res.status(401).json({ error: "Autenticazione richiesta" });
        return;
      }

      const { companyId } = req.params;

      // Verify user has access
      try {
        await assertCompanyAccess(req, companyId, db);
      } catch {
        res.status(403).json({ error: "Accesso non autorizzato" });
        return;
      }

      const secret = await db
        .select({ id: companySecrets.id })
        .from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
        .then((rows) => rows[0]);

      // Only return whether the key exists — no prefix, no details
      res.json({ hasKey: !!secret });
    } catch {
      res.json({ hasKey: false });
    }
  });

  return router;
}

// Export decrypt for use by the adapter
export { decrypt as decryptSecret };
