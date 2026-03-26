import {
  Inbox,
  CircleDot,
  LayoutDashboard,
  Search,
  SquarePen,
  Target,
  MessageCircle,
  Mail,
  Calendar,
  HardDrive,
  MessageSquare,
  Phone,
  Share2 as Share2Icon,
  Share2,
  Plus,
  ChevronDown,
  Settings,
  Plug,
  ShieldCheck,
  Key,
  LogOut,
  FolderOpen, Sparkles, Receipt, Globe, CalendarClock, Shield,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents, ConnectorAgentList, sortByHierarchy } from "./SidebarAgents";
import { agentsApi } from "../api/agents";
import { useDialog } from "../context/DialogContext";
import { useLocation } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useOnboarding } from "../context/OnboardingContext";
import { heartbeatsApi } from "../api/heartbeats";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { PluginSlotOutlet } from "@/plugins/slots";
import { CompanyPatternIcon } from "./CompanyPatternIcon";
import { useState, useEffect, useMemo } from "react";

export function Sidebar() {
  const { openNewIssue } = useDialog();
  const { companies, selectedCompanyId, selectedCompany, setSelectedCompanyId } = useCompany();
  const { step: onboardingStep } = useOnboarding();
  const { data: sidebarAgents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const [mailUnread, setMailUnread] = useState(0);
  const location = useLocation();
  const [hasGoogle, setHasGoogle] = useState(false);
  const [hasTelegram, setHasTelegram] = useState(false);
  const [hasWhatsApp, setHasWhatsApp] = useState(false);
  const [hasSocial, setHasSocial] = useState(false);
  const [hasFal, setHasFal] = useState(false);
  const [hasFic, setHasFic] = useState(false);
  const [hasOpenapi, setHasOpenapi] = useState(false);
  const [hasPec, setHasPec] = useState(false);
  const [pecUnread, setPecUnread] = useState(0);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [telegramUnread, setTelegramUnread] = useState(0);
  const [waUnread, setWaUnread] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!selectedCompanyId) return;
    const checkConnectors = () => {
      fetch("/api/oauth/google/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setHasGoogle(d.connected || false))
        .catch(() => {});
      fetch("/api/telegram/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setHasTelegram(d.connected || false))
        .catch(() => {});
      fetch("/api/whatsapp/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setHasWhatsApp(d.connected || false))
        .catch(() => {});
      fetch("/api/fal/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setHasFal(d.connected || false))
        .catch(() => {});
      fetch("/api/fic/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setHasFic(d.connected || false))
        .catch(() => {});
      fetch("/api/onboarding/claude-key/" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json()).then((d) => setHasApiKey(!!d.hasKey)).catch(() => {});
      fetch("/api/openapi-it/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setHasOpenapi(d.connected || false))
        .catch(() => {});
      fetch("/api/pec/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setHasPec(d.connected || false))
        .catch(() => {});
      fetch("/api/routines/pending?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setPendingCount(Array.isArray(d) ? d.length : 0))
        .catch(() => {});
      Promise.all([
        fetch("/api/oauth/meta/status?companyId=" + selectedCompanyId, { credentials: "include" }).then((r) => r.json()).catch(() => ({ connected: false })),
        fetch("/api/oauth/linkedin/status?companyId=" + selectedCompanyId, { credentials: "include" }).then((r) => r.json()).catch(() => ({ connected: false })),
      ]).then(([meta, li]) => setHasSocial(meta.connected || li.connected));
    };
    checkConnectors();
    const connectorInterval = setInterval(checkConnectors, 10000);

    const fetchWaUnread = () => {
      if (!selectedCompanyId) return;
      fetch("/api/whatsapp/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setWaUnread(d.count || 0))
        .catch(() => {});
    };
    fetchWaUnread();
    if (location.pathname.includes("/whatsapp")) setWaUnread(0);
    if (location.pathname.includes("/telegram")) setTelegramUnread(0);

    const fetchTgUnread = () => {
      if (!selectedCompanyId) return;
      fetch("/api/telegram/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setTelegramUnread(d.count || 0))
        .catch(() => {});
    };
    fetchTgUnread();

    const fetchPecUnread = () => {
      fetch("/api/pec/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setPecUnread(d.count || 0))
        .catch(() => {});
    };
    fetchPecUnread();
    if (location.pathname.includes("/pec")) setPecUnread(0);

    const fetchUnread = () => {
      fetch("/api/gmail/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setMailUnread(d.count || 0))
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(() => { fetchUnread(); fetchTgUnread(); fetchWaUnread(); fetchPecUnread();
    if (location.pathname.includes("/whatsapp")) setWaUnread(0);
    if (location.pathname.includes("/telegram")) setTelegramUnread(0);
    if (location.pathname.includes("/pec")) setPecUnread(0); }, 30000);
    const onMailUpdated = () => fetchUnread();
    const onTgRead = () => { setTelegramUnread(0); };
    const onWaRead = () => { setWaUnread(0); };
    window.addEventListener("mail-updated", onMailUpdated);
    window.addEventListener("telegram-read", onTgRead);
    window.addEventListener("whatsapp-read", onWaRead);
    return () => { clearInterval(interval); clearInterval(connectorInterval); window.removeEventListener("mail-updated", onMailUpdated); window.removeEventListener("telegram-read", onTgRead); window.removeEventListener("whatsapp-read", onWaRead); };
  }, [selectedCompanyId]);

  // Listen for API key changes
  useEffect(() => {
    const handler = () => {
      if (!selectedCompanyId) return;
      fetch("/api/onboarding/claude-key/" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json()).then((d) => setHasApiKey(!!d.hasKey)).catch(() => {});
    };
    window.addEventListener("onboarding-step-changed", handler);
    return () => window.removeEventListener("onboarding-step-changed", handler);
  }, [selectedCompanyId]);

  const inboxBadge = useInboxBadge(selectedCompanyId);
  const queryClient = useQueryClient();
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;

  const liveCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of liveRuns ?? []) {
      counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
    }
    return counts;
  }, [liveRuns]);

  const sortedAgents = useMemo(() => {
    return sortByHierarchy((sidebarAgents ?? []).filter((a) => a.status !== "terminated"));
  }, [sidebarAgents]);

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const sidebarCompanies = companies.filter((c) => c.status !== "archived");

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  // Determine disabled states based on onboarding step
  // null (loading) or 99 (complete) = everything enabled
  const isComplete = onboardingStep === null || onboardingStep >= 99;
  const isStep0 = onboardingStep === 0;
  const isStep1 = onboardingStep === 1;
  const isStep2 = onboardingStep === 2;
  const isStep3 = onboardingStep === 3;

  const glowStyle = {
    background: "hsl(158 64% 42% / 0.25)",
    boxShadow: "0 0 15px hsl(158 64% 42% / 0.4)",
  };

  return (
    <aside className="w-60 h-full min-h-0 flex flex-col" style={{
      background: "linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 50%, rgba(255, 255, 255, 0.01) 100%)",
      backdropFilter: "blur(40px) saturate(150%)",
      WebkitBackdropFilter: "blur(40px) saturate(150%)",
      borderRight: "1px solid rgba(255, 255, 255, 0.1)",
    }}>
      {/* Search */}
      <div className="px-3 pt-3 pb-1 shrink-0">
        <button
          onClick={openSearch}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-[13px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          style={{
            background: "hsl(0 0% 100% / 0.04)",
            border: "1px solid hsl(0 0% 100% / 0.06)",
          }}
        >
          <Search className="h-3.5 w-3.5" />
          <span>Cerca</span>
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-1 px-2 py-2">
        {/* Top items - disabled during onboarding steps 0-3 */}
        <div className={"flex flex-col gap-0.5" + (!isComplete ? " opacity-30 pointer-events-none" : "")}>
          <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} liveCount={liveRunCount} />
          <SidebarNavItem to="/org" label="Organigramma" icon={Share2Icon} />
          <SidebarNavItem to="/scheduled" label="Attività" icon={CalendarClock} badge={pendingCount > 0 ? pendingCount : undefined} />
        </div>

        {/* Lavoro */}
        <SidebarSection label="Lavoro">
          {isStep1 ? (
            <div className="relative" id="chat-ceo-nav">
              <div className="absolute inset-0 rounded-lg animate-pulse" style={glowStyle} />
              <SidebarNavItem to="/chat" label="Chat (CEO)" icon={MessageCircle} className="relative z-10 !text-white font-bold" />
            </div>
          ) : isStep2 ? (
            <div id="chat-ceo-nav"><SidebarNavItem to="/chat" label="Chat (CEO)" icon={MessageCircle} /></div>
          ) : (
            <div className={!isComplete && !isStep1 ? "opacity-30 pointer-events-none" : ""} id="chat-ceo-nav">
              <SidebarNavItem to="/chat" label="Chat (CEO)" icon={MessageCircle} />
            </div>
          )}
          <div className={!isComplete ? "opacity-30 pointer-events-none" : ""}>
            {hasPec && <SidebarNavItem to="/pec" label="PEC" icon={Shield} badge={pecUnread > 0 ? pecUnread : undefined} />}
            {hasPec && <ConnectorAgentList connectorKeys="pec" agents={sortedAgents} liveCountByAgent={liveCountByAgent} />}
            {hasGoogle && <SidebarNavItem to="/mail" label="Mail" icon={Mail} badge={mailUnread > 0 ? mailUnread : undefined} />}
            {hasGoogle && <ConnectorAgentList connectorKeys="google" agents={sortedAgents} liveCountByAgent={liveCountByAgent} />}
            {hasWhatsApp && <SidebarNavItem to="/whatsapp" label="WhatsApp" icon={Phone} badge={waUnread > 0 ? waUnread : undefined} />}
            {hasWhatsApp && <ConnectorAgentList connectorKeys="whatsapp" agents={sortedAgents} liveCountByAgent={liveCountByAgent} />}
            {hasTelegram && <SidebarNavItem to="/telegram" label="Telegram" icon={MessageSquare} badge={telegramUnread > 0 ? telegramUnread : undefined} />}
            {hasTelegram && <ConnectorAgentList connectorKeys="telegram" agents={sortedAgents} liveCountByAgent={liveCountByAgent} />}
            {hasSocial && <SidebarNavItem to="/social" label="Social" icon={Share2Icon} />}
            {hasSocial && <ConnectorAgentList connectorKeys={["meta", "linkedin"]} agents={sortedAgents} liveCountByAgent={liveCountByAgent} />}
            {hasFal && <SidebarNavItem to="/genera" label="Genera Contenuti" icon={Sparkles} />}
            {hasFal && <ConnectorAgentList connectorKeys="fal" agents={sortedAgents} liveCountByAgent={liveCountByAgent} />}
            {hasFic && <SidebarNavItem to="/fatturazione" label="Fatture in Cloud" icon={Receipt} />}
            {hasFic && <ConnectorAgentList connectorKeys="fic" agents={sortedAgents} liveCountByAgent={liveCountByAgent} />}
            {hasOpenapi && <SidebarNavItem to="/analisi-aziende" label="OpenAPI.it" icon={Globe} />}
            {hasOpenapi && <ConnectorAgentList connectorKeys="openapi" agents={sortedAgents} liveCountByAgent={liveCountByAgent} />}
            {hasGoogle && <SidebarNavItem to="/calendario" label="Calendario" icon={Calendar} />}
            {hasGoogle && <SidebarNavItem to="/documenti" label="Documenti" icon={HardDrive} />}
          </div>
        </SidebarSection>

        {/* Agents */}
        <div className={!isComplete ? "opacity-30 pointer-events-none" : ""}>
          <SidebarAgents />
          <SidebarProjects />
        </div>

        {/* Impostazioni */}
        <SidebarSection label="Impostazioni">
          {isStep3 ? (
            <div className="relative" id="connettori-nav">
              <div className="absolute inset-0 rounded-lg animate-pulse" style={glowStyle} />
              <SidebarNavItem to="/plugins" label="Connettori" icon={Plug} className="relative z-10 !text-white font-bold" />
            </div>
          ) : (
            <div className={!isComplete ? "opacity-30 pointer-events-none" : ""} id="connettori-nav"><SidebarNavItem to="/plugins" label="Connettori" icon={Plug} /></div>
          )}
          <div className={!isComplete ? "opacity-30 pointer-events-none" : ""}><SidebarNavItem to="/company/settings" label="Profilo" icon={Settings} /></div>
          {isStep0 ? (
            <div className="relative" id="api-claude-nav">
              <div className="absolute inset-0 rounded-lg animate-pulse" style={glowStyle} />
              <SidebarNavItem to="/api-claude" label="API Claude" icon={Key} className="relative z-10 !text-white font-bold" />
            </div>
          ) : (
            <div className={!isComplete && onboardingStep !== null && onboardingStep > 0 ? "opacity-30 pointer-events-none" : ""} id="api-claude-nav">
              <SidebarNavItem to="/api-claude" label="API Claude" icon={Key} />
            </div>
          )}
          {session?.user?.email === "emanuele@unvrslabs.dev" && (
            <SidebarNavItem to="/admin" label="GoItalIA" icon={ShieldCheck} />
          )}
        </SidebarSection>

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex flex-col gap-3"
          itemClassName="rounded-lg border border-border p-3"
          missingBehavior="placeholder"
        />
      </nav>

      {/* Bottom: Company switcher */}
      <div className="shrink-0 mt-auto px-3 pb-3" style={{ borderTop: "1px solid hsl(0 0% 100% / 0.06)", paddingTop: "12px" }}>
        <div className="relative">
          <button
            onClick={() => setCompanyMenuOpen(!companyMenuOpen)}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl transition-colors"
            style={{
              background: "hsl(0 0% 100% / 0.04)",
              border: "1px solid hsl(0 0% 100% / 0.08)",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.08)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.04)"}
          >
            {selectedCompany ? (
              <CompanyPatternIcon
                companyName={selectedCompany.name}
                logoUrl={selectedCompany.logoUrl ?? null}
                brandColor={selectedCompany.brandColor ?? null}
                className="rounded-lg !w-8 !h-8"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg" style={{ background: "hsl(270 60% 50%)" }} />
            )}
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium text-foreground truncate">
                {selectedCompany?.name ?? "Seleziona"}
              </div>
              {session?.user?.email && (
                <div className="text-[11px] text-muted-foreground/50 truncate">
                  {session.user.email}
                </div>
              )}
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/40 transition-transform ${companyMenuOpen ? "rotate-180" : ""}`} />
          </button>

          {companyMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setCompanyMenuOpen(false)} />
              <div
                className="absolute bottom-full left-0 right-0 mb-1 rounded-xl overflow-hidden z-50"
                style={{
                  background: "rgba(15, 22, 36, 0.85)",
                  backdropFilter: "blur(40px) saturate(150%)",
                  WebkitBackdropFilter: "blur(40px) saturate(150%)",
                  border: "1px solid hsl(0 0% 100% / 0.1)",
                  boxShadow: "0 8px 32px hsl(0 0% 0% / 0.5)",
                }}
              >
                <div className="py-1.5">
                  {sidebarCompanies.map((company) => (
                    <button
                      key={company.id}
                      onClick={() => {
                        setSelectedCompanyId(company.id);
                        setCompanyMenuOpen(false);
                      }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-left transition-colors"
                      style={{
                        background: company.id === selectedCompany?.id ? "hsl(0 0% 100% / 0.06)" : "transparent",
                        color: company.id === selectedCompany?.id ? "hsl(0 0% 98%)" : "hsl(0 0% 70%)",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.08)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = company.id === selectedCompany?.id ? "hsl(0 0% 100% / 0.06)" : "transparent"}
                    >
                      <CompanyPatternIcon
                        companyName={company.name}
                        logoUrl={company.logoUrl ?? null}
                        brandColor={company.brandColor ?? null}
                        className="rounded-md !w-6 !h-6"
                      />
                      <span className="truncate">{company.name}</span>
                    </button>
                  ))}

                  <div style={{ borderTop: "1px solid hsl(0 0% 100% / 0.06)", margin: "4px 0" }} />

                  <button
                    onClick={() => {
                      setCompanyMenuOpen(false);
                      window.location.href = "/companies";
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] transition-colors"
                    style={{ color: "hsl(158 64% 52%)" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.06)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <Plus className="h-4 w-4" />
                    <span>Nuova impresa</span>
                  </button>

                  <button
                    onClick={async () => {
                      setLoggingOut(true);
                      try {
                        await authApi.signOut();
                        await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
                        window.location.href = "/auth";
                      } catch {
                        setLoggingOut(false);
                      }
                    }}
                    disabled={loggingOut}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] transition-colors"
                    style={{ color: "hsl(0 65% 55%)" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.06)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <LogOut className="h-4 w-4" />
                    <span>{loggingOut ? "Disconnessione..." : "Logout"}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
