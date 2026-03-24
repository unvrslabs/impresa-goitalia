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
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents } from "./SidebarAgents";
import { agentsApi } from "../api/agents";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { heartbeatsApi } from "../api/heartbeats";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { PluginSlotOutlet } from "@/plugins/slots";
import { CompanyPatternIcon } from "./CompanyPatternIcon";
import { useState, useEffect } from "react";

const chatPulseStyle = `
@keyframes chatPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; color: hsl(158 64% 52%); }
}
.chat-pulse { animation: chatPulse 1s ease-in-out infinite; }
`;

export function Sidebar() {
  const { openNewIssue } = useDialog();
  const { companies, selectedCompanyId, selectedCompany, setSelectedCompanyId } = useCompany();
  const { data: sidebarAgents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const [mailUnread, setMailUnread] = useState(0);
  const [hasGoogle, setHasGoogle] = useState(false);
  const [hasTelegram, setHasTelegram] = useState(false);
  const [hasWhatsApp, setHasWhatsApp] = useState(false);
  const [hasSocial, setHasSocial] = useState(false);
  const [telegramUnread, setTelegramUnread] = useState(0);
  const [waUnread, setWaUnread] = useState(0);

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

    const fetchTgUnread = () => {
      if (!selectedCompanyId) return;
      fetch("/api/telegram/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setTelegramUnread(d.count || 0))
        .catch(() => {});
    };
    fetchTgUnread();

    const fetchUnread = () => {
      fetch("/api/gmail/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setMailUnread(d.count || 0))
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(() => { fetchUnread(); fetchTgUnread(); fetchWaUnread(); }, 30000);
    const onMailUpdated = () => fetchUnread();
    const onTgRead = () => { setTelegramUnread(0); setTimeout(fetchTgUnread, 2000); };
    const onWaRead = () => { setWaUnread(0); setTimeout(fetchWaUnread, 2000); };
    window.addEventListener("mail-updated", onMailUpdated);
    window.addEventListener("telegram-read", onTgRead);
    window.addEventListener("whatsapp-read", onWaRead);
    return () => { clearInterval(interval); clearInterval(connectorInterval); window.removeEventListener("mail-updated", onMailUpdated); window.removeEventListener("telegram-read", onTgRead); window.removeEventListener("whatsapp-read", onWaRead); };
  }, [selectedCompanyId]);

  const isClaudeApi = !!selectedCompanyId && (sidebarAgents ?? []).length > 0 && (sidebarAgents ?? []).every((a: any) => a.adapterType === "claude_api");
  const isOnboarding = !!selectedCompanyId && (sidebarAgents ?? []).length > 0 && (sidebarAgents ?? []).every((a: any) => a.adapterType === "claude_api") && (sidebarAgents ?? []).filter((a: any) => a.role !== "ceo").length === 0;
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
        {/* Top items */}
        <div className="flex flex-col gap-0.5">
          {!isOnboarding && <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} liveCount={liveRunCount} />}
          {!isOnboarding && <SidebarNavItem to="/org" label="Organigramma" icon={Share2Icon} />}
          {!isOnboarding && !isClaudeApi && <SidebarNavItem
            to="/inbox"
            label="Inbox"
            icon={Inbox}
            badge={inboxBadge.inbox}
            badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
            alert={inboxBadge.failedRuns > 0}
          />}
          {!isOnboarding && !isClaudeApi && <button
            onClick={() => openNewIssue()}
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors rounded-lg"
            style={{ color: "hsl(158 64% 52%)" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "hsl(158 64% 42% / 0.1)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <SquarePen className="h-4 w-4 shrink-0" />
            <span className="truncate">Nuova attività</span>
          </button>}
          <PluginSlotOutlet
            slotTypes={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-[13px] font-medium"
            missingBehavior="placeholder"
          />
        </div>

        {/* Lavoro */}
        <SidebarSection label="Lavoro">
          <SidebarNavItem to="/chat" label="Chat" icon={MessageCircle} />
          {hasGoogle && <SidebarNavItem to="/mail" label="Mail" icon={Mail} badge={mailUnread > 0 ? mailUnread : undefined} />}
          {hasWhatsApp && <SidebarNavItem to="/whatsapp" label="WhatsApp" icon={Phone} badge={waUnread > 0 ? waUnread : undefined} />}
          {hasTelegram && <SidebarNavItem to="/telegram" label="Telegram" icon={MessageSquare} badge={telegramUnread > 0 ? telegramUnread : undefined} />}
          {hasSocial && <SidebarNavItem to="/social" label="Social" icon={Share2Icon} />}
          {hasGoogle && <SidebarNavItem to="/calendario" label="Calendario" icon={Calendar} />}
          {hasGoogle && <SidebarNavItem to="/documenti" label="Documenti" icon={HardDrive} />}
          {!isOnboarding && !isClaudeApi && <SidebarNavItem to="/issues" label="Attività" icon={CircleDot} />}
          {!isOnboarding && !isClaudeApi && <SidebarNavItem to="/goals" label="Obiettivi" icon={Target} />}
        </SidebarSection>



        {/* Projects */}
        {!isOnboarding && <SidebarProjects />}

        {/* Agents */}
        {!isOnboarding && <SidebarAgents />}

        {/* Impostazioni - nel menu principale */}
        <SidebarSection label="Impostazioni">
          {!isOnboarding && <SidebarNavItem to="/plugins" label="Connettori" icon={Plug} />}
          {!isOnboarding && <SidebarNavItem to="/company/settings" label="Impostazioni" icon={Settings} />}
          <SidebarNavItem to="/api-claude" label="API Claude" icon={Key} />
          {session?.user?.email === "emanuele@unvrslabs.dev" && (
            <SidebarNavItem to="/admin" label="Admin" icon={ShieldCheck} />
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

          {/* Dropdown */}
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
