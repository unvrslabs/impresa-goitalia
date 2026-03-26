import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@/lib/router";
import { NavLink, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { cn, agentRouteRef, agentUrl } from "../lib/utils";
import { AgentIcon } from "./AgentIconPicker";
import { BudgetSidebarMarker } from "./BudgetSidebarMarker";

const CONNECTOR_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  google: {
    icon: <svg viewBox="0 0 24 24" width="14" height="14"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>,
    color: "#4285F4",
  },
  telegram: {
    icon: <svg viewBox="0 0 24 24" width="14" height="14" fill="#26A5E4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>,
    color: "#26A5E4",
  },
  whatsapp: {
    icon: <svg viewBox="0 0 24 24" width="14" height="14" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>,
    color: "#25D366",
  },
  meta: {
    icon: <svg viewBox="0 0 24 24" width="14" height="14"><defs><linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#FFDC80"/><stop offset="25%" stopColor="#F77737"/><stop offset="50%" stopColor="#E1306C"/><stop offset="75%" stopColor="#C13584"/><stop offset="100%" stopColor="#833AB4"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="5" fill="url(#ig)"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="white" strokeWidth="1.5"/><circle cx="17.5" cy="6.5" r="1.2" fill="white"/></svg>,
    color: "#E1306C",
  },
  linkedin: {
    icon: <svg viewBox="0 0 24 24" width="14" height="14" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>,
    color: "#0A66C2",
  },
  fal: {
    icon: <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#6366F1"/><path d="M7 12l3-6 3 6m-5-1h4M17 8v8m-2-4h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    color: "#6366F1",
  },
  fic: {
    icon: <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#F59E0B"/><path d="M7 7h10M7 11h7M7 15h4M15 13l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    color: "#F59E0B",
  },
  openapi: {
    icon: <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#10B981"/><path d="M12 7v5l3 3M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>,
    color: "#10B981",
  },
  voice: {
    icon: <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#8B5CF6"/><path d="M12 7v6m0 0a2 2 0 0 1-2-2V9a2 2 0 1 1 4 0v2a2 2 0 0 1-2 2zm-4-1a4 4 0 0 0 8 0M12 17v-2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>,
    color: "#8B5CF6",
  },
};

function detectConnector(agent: Agent): string | null {
  // 1. Check primaryConnector in adapterConfig
  const config = agent.adapterConfig as Record<string, unknown> | null;
  const pc = config?.primaryConnector as string | undefined;
  if (pc && CONNECTOR_ICONS[pc]) return pc;

  // 2. Check connectors keys in adapterConfig
  const connectors = config?.connectors as Record<string, boolean> | undefined;
  if (connectors) {
    const keys = Object.keys(connectors).filter((k) => connectors[k]);
    if (keys.some((k) => ["gmail", "calendar", "drive", "sheets", "docs"].includes(k))) return "google";
    if (keys.some((k) => k.startsWith("tg_")) || keys.includes("telegram")) return "telegram";
    if (keys.includes("whatsapp")) return "whatsapp";
    if (keys.some((k) => k.startsWith("ig_") || k.startsWith("fb_")) || keys.includes("meta")) return "meta";
    if (keys.includes("linkedin")) return "linkedin";
    if (keys.includes("fal")) return "fal";
    if (keys.includes("fic")) return "fic";
    if (keys.some((k) => k.startsWith("oai_"))) return "openapi";
    if (keys.includes("voice")) return "voice";
  }

  // 3. Guess from agent name
  const n = agent.name.toLowerCase();
  if (n.includes("@") && (n.includes("gmail") || n.includes("google"))) return "google";
  if (n.includes("@") && !n.includes("+")) return "meta"; // @username = likely IG
  if (n.includes("+")) return "whatsapp"; // +phone
  if (n.includes("bot") || n.includes("_bot")) return "telegram";
  if (n.includes("linkedin")) return "linkedin";

  return null;
}

function getConnectorInfo(agent: Agent): { icon: React.ReactNode; displayName: string } | null {
  if (agent.role === "ceo") return null;

  const connKey = detectConnector(agent);
  if (!connKey) return null;

  const connInfo = CONNECTOR_ICONS[connKey];
  if (!connInfo) return null;

  // Clean name: remove "AG. " prefix, "@" prefix, and connector type suffix
  let displayName = agent.name.replace(/^AG\.\s*/i, "").replace(/^@/, "");
  // Remove trailing connector type words (e.g. "Emanuele Maccari LinkedIn" → "Emanuele Maccari")
  const connLabels = ["linkedin", "whatsapp", "telegram", "instagram", "facebook", "google", "meta"];
  for (const label of connLabels) {
    const re = new RegExp("\\s+" + label + "\\s*$", "i");
    displayName = displayName.replace(re, "");
  }

  return { icon: connInfo.icon, displayName };
}
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Agent } from "@goitalia/shared";

/** BFS sort: roots first (no reportsTo), then their direct reports, etc. */
function sortByHierarchy(agents: Agent[]): Agent[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const childrenOf = new Map<string | null, Agent[]>();
  for (const a of agents) {
    const parent = a.reportsTo && byId.has(a.reportsTo) ? a.reportsTo : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(a);
    childrenOf.set(parent, list);
  }
  const sorted: Agent[] = [];
  const queue = childrenOf.get(null) ?? [];
  while (queue.length > 0) {
    const agent = queue.shift()!;
    sorted.push(agent);
    const children = childrenOf.get(agent.id);
    if (children) queue.push(...children);
  }
  return sorted;
}

export function SidebarAgents() {
  const [open, setOpen] = useState(true);
  const [showAgentPopup, setShowAgentPopup] = useState(false);
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialog();
  const { isMobile, setSidebarOpen } = useSidebar();
  const location = useLocation();

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const liveCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of liveRuns ?? []) {
      counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
    }
    return counts;
  }, [liveRuns]);

  const visibleAgents = useMemo(() => {
    const filtered = (agents ?? []).filter(
      (a: Agent) => a.status !== "terminated"
    );
    return sortByHierarchy(filtered);
  }, [agents]);

  const agentMatch = location.pathname.match(/^\/(?:[^/]+\/)?agents\/([^/]+)(?:\/([^/]+))?/);
  const activeAgentId = agentMatch?.[1] ?? null;
  const activeTab = agentMatch?.[2] ?? null;


  return (
    <>
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
            Agenti
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowAgentPopup(true);
            }}
            className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors ml-1.5"
            aria-label="New agent"
          >
            <Plus className="h-3 w-3" />
          </button>
          <CollapsibleTrigger className="ml-auto flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground transition-colors">
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                open && "rotate-90"
              )}
            />
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 mt-0.5">
          {visibleAgents.map((agent: Agent) => {
            const runCount = liveCountByAgent.get(agent.id) ?? 0;
            const connInfo = getConnectorInfo(agent);
            return (
              <NavLink
                key={agent.id}
                to={activeTab ? `${agentUrl(agent)}/${activeTab}` : agentUrl(agent)}
                onClick={() => {
                  if (isMobile) setSidebarOpen(false);
                }}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium transition-all rounded-xl",
                  activeAgentId === agentRouteRef(agent)
                    ? "text-white"
                    : "text-foreground/70 hover:text-foreground"
                )}
                style={activeAgentId === agentRouteRef(agent) ? {
                  background: "linear-gradient(135deg, hsl(158 64% 42% / 0.2), hsl(158 64% 42% / 0.1))",
                  boxShadow: "0 0 12px hsl(158 64% 42% / 0.1)",
                } : {}}
              >
                {connInfo ? (
                  <span className="shrink-0 flex items-center justify-center h-3.5 w-3.5">{connInfo.icon}</span>
                ) : (
                  <AgentIcon icon={agent.icon} className="shrink-0 h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{connInfo ? connInfo.displayName : agent.name}</span>
                {(agent.pauseReason === "budget" || runCount > 0) && (
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    {agent.pauseReason === "budget" ? (
                      <BudgetSidebarMarker title="Agent paused by budget" />
                    ) : null}
                    {runCount > 0 ? (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                      </span>
                    ) : null}
                    {runCount > 0 ? (
                      <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                        {runCount} live
                      </span>
                    ) : null}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>

      {/* Popup: go to chat to create agent */}
      {showAgentPopup && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowAgentPopup(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative glass-card p-6 mx-4 max-w-sm space-y-4 text-center" onClick={(e) => e.stopPropagation()} style={{ background: "linear-gradient(135deg, rgba(20,30,40,0.98), rgba(15,25,35,0.98))", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "1rem" }}>
            <div className="w-12 h-12 mx-auto rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h3 className="text-base font-semibold">Crea un nuovo agente</h3>
            <p className="text-sm text-muted-foreground">Vai in Chat con il Direttore AI e chiedigli di creare un agente. Descrivi cosa deve fare e lui lo configurerà per te.</p>
            <button
              onClick={() => {
                setShowAgentPopup(false);
                navigate("/" + (selectedCompanyId ? "" : "") + "chat?msg=" + encodeURIComponent("Crea un nuovo agente per la mia impresa."));
                window.location.href = "/" + (document.location.pathname.split("/")[1] || "") + "/chat?msg=" + encodeURIComponent("Crea un nuovo agente per la mia impresa.");
              }}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-white transition-all"
              style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))", boxShadow: "0 4px 20px hsl(158 64% 42% / 0.3)" }}
            >
              Vai alla Chat
            </button>
          </div>
        </div>
      , document.body)}
    
    </>
  );
}
