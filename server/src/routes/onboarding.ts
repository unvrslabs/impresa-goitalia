import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companyService } from "../services/companies.js";
import { agentService } from "../services/agents.js";
import { accessService } from "../services/access.js";
import { logActivity } from "../services/activity-log.js";
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

  router.post("/activate", async (req, res) => {
    try {
      const body = req.body as OnboardingRequest;

      if (!body.companyName || !body.email || !body.password || !body.members?.length) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      // 1. Create user via Better Auth signup API
      const signupRes = await fetch(`http://127.0.0.1:${serverPort}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": `http://127.0.0.1:${serverPort}`,
        },
        body: JSON.stringify({
          email: body.email,
          password: body.password,
          name: body.companyName,
        }),
      });

      if (!signupRes.ok) {
        const err = await signupRes.text();
        res.status(400).json({ error: "Signup failed", detail: err });
        return;
      }

      const signupData = await signupRes.json() as { user?: { id?: string }; token?: string };
      const userId = signupData.user?.id;
      if (!userId) {
        res.status(500).json({ error: "User creation failed - no user ID returned" });
        return;
      }

      // 2. Create company
      const issuePrefix = body.companyName
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase()
        .slice(0, 5) || "COMP";

      const company = await companySvc.create({
        name: body.companyName,
        description: `Azienda AI - ${body.members.length} agenti`,
        issuePrefix,
        budgetMonthlyCents: 10000000, // €100k default budget
      });

      // 3. Create membership (user as owner)
      await access.ensureMembership(company.id, "user", userId, "owner", "active");

      // 4. Create CEO agent
      const ceo = await agentSvc.create(company.id, {
        name: "CEO",
        role: "ceo",
        title: "Chief Executive Officer",
        adapterType: "http",
        adapterConfig: {},
        capabilities: "Coordina tutti gli agenti, delega task, monitora progressi e costi. È il punto di contatto con il board.",
        budgetMonthlyCents: 5000000,
        status: "idle",
      });

      // 5. Create agents for each team member
      const createdAgents = [];
      for (const member of body.members) {
        const agent = await agentSvc.create(company.id, {
          name: `Agente ${member.name}`,
          role: "general",
          title: member.role,
          adapterType: "http",
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
        details: {
          name: company.name,
          source: "onboarding_wizard",
          agentCount: createdAgents.length + 1,
        },
      });

      res.status(201).json({
        success: true,
        companyId: company.id,
        issuePrefix: company.issuePrefix,
        agentCount: createdAgents.length + 1, // +1 for CEO
        userId,
      });
    } catch (error: unknown) {
      console.error("Onboarding activation error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: "Activation failed", detail: message });
    }
  });

  return router;
}
