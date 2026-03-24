import { useMemo, useState, useEffect } from "react";
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
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <CollapsibleTrigger className="flex items-center gap-1 flex-1 min-w-0">
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100",
                open && "rotate-90"
              )}
            />
            <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
              Agenti
            </span>
          </CollapsibleTrigger>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowAgentPopup(true);
            }}
            className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="New agent"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 mt-0.5">
          {visibleAgents.map((agent: Agent) => {
            const runCount = liveCountByAgent.get(agent.id) ?? 0;
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
                <AgentIcon icon={agent.icon} className="shrink-0 h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{agent.name}</span>
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
      {showAgentPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowAgentPopup(false)}>
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
      )}
    </Collapsible>
  );
}
