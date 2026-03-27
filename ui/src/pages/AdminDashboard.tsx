import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { authApi } from "../api/auth";
import {
  Building2,
  Users,
  Bot,
  Plug,
  ChevronDown,
  Mail,
  Phone,
  MapPin,
  Globe,
  ExternalLink,
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  MessageCircle,
} from "lucide-react";
import { cn } from "../lib/utils";

const CONNECTOR_LABELS: Record<string, { label: string; color: string; short: string }> = {
  google: { label: "Google", color: "#4285F4", short: "G" },
  telegram: { label: "Telegram", color: "#26A5E4", short: "T" },
  whatsapp: { label: "WhatsApp", color: "#25D366", short: "W" },
  meta_ig: { label: "Instagram", color: "#E1306C", short: "IG" },
  meta_fb: { label: "Facebook", color: "#1877F2", short: "FB" },
  linkedin: { label: "LinkedIn", color: "#0A66C2", short: "LI" },
  fal: { label: "Fal.ai", color: "#6366F1", short: "F" },
  fic: { label: "FIC", color: "#F59E0B", short: "FC" },
  openapi: { label: "OpenAPI", color: "#10B981", short: "OA" },
  voice: { label: "Vocali", color: "#8B5CF6", short: "V" },
  pec: { label: "PEC", color: "#06B6D4", short: "PE" },
  stripe: { label: "Stripe", color: "#635BFF", short: "S" },
  hubspot: { label: "HubSpot", color: "#FF7A45", short: "H" },
  salesforce: { label: "Salesforce", color: "#00A1E0", short: "SF" },
};

const SUB_STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  active: { bg: "rgba(34,197,94,0.12)", text: "#22c55e", icon: CheckCircle2 },
  expired: { bg: "rgba(239,68,68,0.12)", text: "#ef4444", icon: XCircle },
  pending: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b", icon: Clock },
  cancelled: { bg: "rgba(107,114,128,0.12)", text: "#6b7280", icon: XCircle },
};

type CompanyData = {
  id: string;
  name: string;
  issuePrefix: string;
  createdAt: string;
  profile: { ragioneSociale?: string; partitaIva?: string; citta?: string; settore?: string; telefono?: string; email?: string } | null;
  agentsTotal: number;
  agentsActive: number;
  connectors: Array<{ type: string; label: string | null }>;
  users: Array<{ id: string; email: string; name: string }>;
  subscriptions: Array<{ service: string; status: string; phone?: string; expiresAt?: string }>;
};

export function AdminDashboard() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);

  useEffect(() => { setBreadcrumbs([{ label: "GoItalIA Admin" }]); }, [setBreadcrumbs]);

  const { data: session } = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession() });
  const { data: stats } = useQuery({ queryKey: ["admin", "stats"], queryFn: () => fetch("/api/admin/stats", { credentials: "include" }).then(r => r.json()) });
  const { data: companies } = useQuery<CompanyData[]>({ queryKey: ["admin", "companies"], queryFn: () => fetch("/api/admin/companies", { credentials: "include" }).then(r => r.json()) });

  const statItems = [
    { value: stats?.totalCompanies ?? "–", label: "Imprese", icon: Building2, color: "#22c55e" },
    { value: stats?.totalUsers ?? "–", label: "Utenti", icon: Users, color: "#3b82f6" },
    { value: stats?.totalAgents ?? "–", label: "Agenti", icon: Bot, color: "#f59e0b" },
    { value: stats?.totalConnectors ?? "–", label: "Connettori", icon: Plug, color: "#a855f7" },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">GoItalIA Admin</h1>
          <p className="text-xs text-muted-foreground">Pannello di gestione piattaforma</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{session?.user?.email}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {statItems.map((s) => (
          <div key={s.label} className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${s.color}15`, color: s.color }}>
              <s.icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Companies */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Imprese ({companies?.length ?? 0})</h2>
        </div>

        {(companies ?? []).map((c) => {
          const isExpanded = expandedCompany === c.id;
          const hasActiveSub = c.subscriptions?.some(s => s.status === "active");
          return (
            <div key={c.id} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {/* Header row */}
              <button onClick={() => setExpandedCompany(isExpanded ? null : c.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
                <div className="h-9 w-9 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "hsl(158 64% 42% / 0.12)", color: "hsl(158 64% 42%)" }}>
                  {(c.profile?.ragioneSociale || c.name).slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.profile?.ragioneSociale || c.name}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    {c.profile?.citta && <span>{c.profile.citta}</span>}
                    {c.profile?.citta && c.profile?.partitaIva && <span>·</span>}
                    {c.profile?.partitaIva && <span>{c.profile.partitaIva}</span>}
                  </div>
                </div>

                {/* Connectors badges */}
                <div className="flex items-center gap-1 shrink-0">
                  {c.connectors.slice(0, 6).map((co, i) => {
                    const info = CONNECTOR_LABELS[co.type];
                    return (
                      <div key={i} className="h-5 px-1.5 rounded flex items-center justify-center text-[8px] font-bold text-white" style={{ background: info?.color || "#555" }} title={info?.label || co.type}>
                        {info?.short || co.type.slice(0, 2).toUpperCase()}
                      </div>
                    );
                  })}
                </div>

                {/* Subscription indicator */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {c.subscriptions?.length > 0 ? (
                    c.subscriptions.map((sub, i) => {
                      const style = SUB_STATUS_STYLES[sub.status] || SUB_STATUS_STYLES.pending;
                      const Icon = style.icon;
                      return (
                        <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium" style={{ background: style.bg, color: style.text }}>
                          <Icon className="w-3 h-3" />
                          {sub.service}
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[9px] text-muted-foreground/40">No sub</span>
                  )}
                </div>

                <span className="text-[10px] text-muted-foreground shrink-0">{c.agentsActive} ag.</span>
                <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0", isExpanded && "rotate-180")} />
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Left: info */}
                    <div className="space-y-3">
                      {/* Users */}
                      <div>
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Utenti</div>
                        {c.users.map(u => (
                          <div key={u.id} className="flex items-center gap-1.5 text-[11px] py-0.5">
                            <Mail className="w-3 h-3 text-muted-foreground" />
                            <span>{u.email}</span>
                            <span className="text-muted-foreground">({u.name})</span>
                          </div>
                        ))}
                      </div>

                      {/* Profile */}
                      {c.profile && (
                        <div className="space-y-1">
                          <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Profilo</div>
                          {c.profile.settore && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Globe className="w-3 h-3" /> {c.profile.settore}</div>}
                          {c.profile.telefono && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Phone className="w-3 h-3" /> {c.profile.telefono}</div>}
                          {c.profile.email && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Mail className="w-3 h-3" /> {c.profile.email}</div>}
                          {c.profile.citta && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><MapPin className="w-3 h-3" /> {c.profile.citta}</div>}
                        </div>
                      )}
                    </div>

                    {/* Right: subscriptions + connectors */}
                    <div className="space-y-3">
                      {/* Subscriptions */}
                      <div>
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Abbonamenti</div>
                        {c.subscriptions?.length > 0 ? (
                          c.subscriptions.map((sub, i) => {
                            const style = SUB_STATUS_STYLES[sub.status] || SUB_STATUS_STYLES.pending;
                            const Icon = style.icon;
                            return (
                              <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-lg mb-1" style={{ background: "rgba(255,255,255,0.03)" }}>
                                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: style.text }} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-medium">{sub.service}</div>
                                  {sub.phone && <div className="text-[10px] text-muted-foreground">{sub.phone}</div>}
                                </div>
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: style.bg, color: style.text }}>{sub.status}</span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-[11px] text-muted-foreground/50 py-1">Nessun abbonamento attivo</div>
                        )}

                        {/* Placeholder for future subscriptions */}
                        <div className="flex flex-wrap gap-1 mt-1">
                          <span className="px-1.5 py-0.5 rounded text-[9px] text-muted-foreground/30" style={{ border: "1px dashed rgba(255,255,255,0.1)" }}>Piattaforma</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] text-muted-foreground/30" style={{ border: "1px dashed rgba(255,255,255,0.1)" }}>AI Credits</span>
                        </div>
                      </div>

                      {/* Connectors */}
                      <div>
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Connettori ({c.connectors.length})</div>
                        <div className="flex flex-wrap gap-1">
                          {c.connectors.map((co, i) => {
                            const info = CONNECTOR_LABELS[co.type];
                            return (
                              <span key={i} className="px-2 py-0.5 rounded text-[10px] font-medium" style={{ background: `${info?.color || "#666"}15`, color: info?.color || "#999", border: `1px solid ${info?.color || "#666"}25` }}>
                                {info?.label || co.type}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action */}
                  <div className="pt-1">
                    <Link to={`/${c.issuePrefix}/dashboard`} className="inline-flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg no-underline" style={{ background: "hsl(158 64% 42% / 0.1)", color: "hsl(158 64% 52%)", border: "1px solid hsl(158 64% 42% / 0.2)" }}>
                      Apri Dashboard <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
