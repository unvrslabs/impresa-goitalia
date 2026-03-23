import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { authApi } from "../api/auth";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { heartbeatsApi } from "../api/heartbeats";
import { companiesApi } from "../api/companies";
import { dashboardApi } from "../api/dashboard";
import { formatCents } from "../lib/utils";
import {
  Building2,
  Users,
  Bot,
  CircleDot,
  DollarSign,
  Activity,
  Settings,
  ExternalLink,
} from "lucide-react";

function StatCard({ icon: Icon, value, label, color, to }: {
  icon: typeof Building2;
  value: string | number;
  label: string;
  color: string;
  to?: string;
}) {
  const inner = (
    <div className="glass-card p-5 transition-all hover:scale-[1.02]" style={{ borderColor: `${color}30` }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-3xl font-bold" style={{ color }}>{value}</p>
          <p className="text-sm text-muted-foreground mt-1">{label}</p>
        </div>
        <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: `${color}15`, color }}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
  if (to) return <Link to={to} className="no-underline text-inherit">{inner}</Link>;
  return inner;
}

export function AdminDashboard() {
  const { companies, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Admin Dashboard" }]);
  }, [setBreadcrumbs]);

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: dashboardData } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const totalCompanies = companies.filter(c => c.status !== "archived").length;
  const totalAgents = agents?.length ?? 0;
  const activeAgents = agents?.filter(a => a.status === "idle" || a.status === "paused").length ?? 0;
  const totalIssues = issues?.length ?? 0;
  const totalRuns = runs?.length ?? 0;
  const monthSpend = dashboardData?.costs?.monthSpendCents ?? 0;

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl flex items-center justify-center" style={{ background: "hsl(158 64% 42% / 0.15)", color: "hsl(158 64% 42%)" }}>
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Pannello Admin</h1>
            <p className="text-sm text-muted-foreground">
              Benvenuto, {session?.user?.name ?? "Admin"} — {session?.user?.email}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          icon={Building2}
          value={totalCompanies}
          label="Imprese Registrate"
          color="hsl(158 64% 42%)"
          to="/companies"
        />
        <StatCard
          icon={Bot}
          value={totalAgents}
          label="Agenti Totali"
          color="hsl(200 60% 50%)"
        />
        <StatCard
          icon={Users}
          value={activeAgents}
          label="Agenti Attivi"
          color="hsl(38 92% 50%)"
        />
        <StatCard
          icon={CircleDot}
          value={totalIssues}
          label="Attività Totali"
          color="hsl(270 60% 55%)"
        />
        <StatCard
          icon={Activity}
          value={totalRuns}
          label="Esecuzioni Totali"
          color="hsl(340 70% 55%)"
        />
        <StatCard
          icon={DollarSign}
          value={formatCents(monthSpend)}
          label="Spesa Mensile"
          color="hsl(170 50% 45%)"
          to="/costs"
        />
      </div>

      {/* Companies List */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Imprese Registrate
        </h2>
        {totalCompanies === 0 ? (
          <div className="glass-card p-8 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nessuna impresa registrata</p>
            <p className="text-xs text-muted-foreground/50 mt-1">Le PMI si registreranno tramite goitalia.eu</p>
          </div>
        ) : (
          <div className="space-y-2">
            {companies.filter(c => c.status !== "archived").map((company) => (
              <div key={company.id} className="glass-card p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: "hsl(158 64% 42% / 0.15)", color: "hsl(158 64% 42%)" }}>
                    {company.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{company.name}</p>
                    <p className="text-xs text-muted-foreground">{company.description ?? "Nessuna descrizione"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{company.issuePrefix}</span>
                  <Link
                    to={`/${company.issuePrefix}/dashboard`}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-all no-underline"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "hsl(158 64% 52%)" }}
                  >
                    Apri <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Azioni Rapide
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Link
            to="/instance/settings/general"
            className="glass-card p-4 flex items-center gap-3 transition-all hover:scale-[1.02] no-underline text-inherit"
          >
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Impostazioni Istanza</span>
          </Link>
          <Link
            to="/instance/settings/plugins"
            className="glass-card p-4 flex items-center gap-3 transition-all hover:scale-[1.02] no-underline text-inherit"
          >
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Gestione Plugin</span>
          </Link>
          <a
            href="https://goitalia.eu"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-4 flex items-center gap-3 transition-all hover:scale-[1.02] no-underline text-inherit"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Sito GoItalIA</span>
          </a>
          <Link
            to="/costs"
            className="glass-card p-4 flex items-center gap-3 transition-all hover:scale-[1.02] no-underline text-inherit"
          >
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Costi e Budget</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
