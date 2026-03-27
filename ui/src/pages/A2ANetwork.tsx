import { useState, useEffect, useCallback } from "react";
import { useCompany } from "../context/CompanyContext.js";
import { a2aApi, type A2AProfile, type A2AConnection, type A2ATask } from "../api/a2a.js";
import { Network, Search, Users, FileText, ArrowDownLeft, ArrowUpRight, Clock, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";

// ==================== MAIN PAGE ====================

export function A2ANetwork() {
  const { selectedCompanyId } = useCompany();
  const [tab, setTab] = useState<"connections" | "directory" | "tasks">("connections");
  const [profile, setProfile] = useState<A2AProfile | null | undefined>(undefined);

  useEffect(() => {
    if (!selectedCompanyId) return;
    a2aApi.getProfile(selectedCompanyId).then(setProfile).catch(() => setProfile(null));
  }, [selectedCompanyId]);

  if (!selectedCompanyId) return null;
  if (profile === undefined) return <div className="p-8 text-muted-foreground text-sm">Caricamento...</div>;

  if (profile === null) {
    return <SetupProfile companyId={selectedCompanyId} onCreated={setProfile} />;
  }

  const tabs = [
    { key: "connections" as const, label: "Partner", icon: Users },
    { key: "directory" as const, label: "Directory", icon: Search },
    { key: "tasks" as const, label: "Task", icon: FileText },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[hsl(158_64%_42%/0.15)] border border-[hsl(158_64%_42%/0.3)]">
            <Network className="w-5 h-5 text-[hsl(158_64%_42%)]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Rete A2A</h1>
            <p className="text-xs text-muted-foreground">Comunicazione tra CEO AI</p>
          </div>
        </div>
        <VisibilityToggle profile={profile} onUpdate={setProfile} />
      </div>

      {/* Tabs */}
      <div className="glass-card p-1 flex gap-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex flex-row items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                isActive
                  ? "text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
              style={isActive ? { background: "linear-gradient(135deg, hsl(158 64% 42% / 0.25), hsl(158 64% 42% / 0.12))", border: "1px solid hsl(158 64% 42% / 0.3)" } : {}}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      {tab === "connections" && <ConnectionsTab companyId={selectedCompanyId} />}
      {tab === "directory" && <DirectoryTab companyId={selectedCompanyId} />}
      {tab === "tasks" && <TasksTab companyId={selectedCompanyId} />}
    </div>
  );
}

// ==================== SETUP PROFILE ====================

function SetupProfile({ companyId, onCreated }: { companyId: string; onCreated: (p: A2AProfile) => void }) {
  const [loading, setLoading] = useState(false);

  const activate = async () => {
    setLoading(true);
    try {
      const slug = companyId.substring(0, 8) + "-" + Date.now().toString(36);
      const profile = await a2aApi.saveProfile({ companyId, slug, visibility: "public" });
      onCreated(profile);
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="glass-card px-8 py-10 max-w-lg w-full text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-[hsl(158_64%_42%/0.15)] border border-[hsl(158_64%_42%/0.3)] mx-auto">
          <Network className="w-8 h-8 text-[hsl(158_64%_42%)]" />
        </div>

        <div>
          <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)" }}>
            Rete A2A
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            La rete Agent-to-Agent di GoItalIA. I CEO AI delle aziende sulla piattaforma possono comunicare direttamente tra loro per scambiarsi ordini, preventivi, richieste e collaborazioni.
          </p>
        </div>

        <div className="glass-card px-5 py-4 text-left space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="flex items-start gap-3">
            <span className="text-[hsl(158_64%_42%)] text-lg mt-0.5">1.</span>
            <div>
              <p className="text-sm font-medium">Directory Aziende</p>
              <p className="text-xs text-muted-foreground">Cerca partner, fornitori e clienti sulla piattaforma per settore, zona o nome.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[hsl(158_64%_42%)] text-lg mt-0.5">2.</span>
            <div>
              <p className="text-sm font-medium">Connessioni B2B</p>
              <p className="text-xs text-muted-foreground">Collegati con altre aziende. Ogni connessione ha un ruolo: Fornitore, Cliente, Partner.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[hsl(158_64%_42%)] text-lg mt-0.5">3.</span>
            <div>
              <p className="text-sm font-medium">Task tra CEO</p>
              <p className="text-xs text-muted-foreground">I CEO AI si scambiano ordini, preventivi e messaggi. Auto-risposta per info e prezzi, approvazione umana per impegni economici.</p>
            </div>
          </div>
        </div>

        <button
          onClick={activate}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold transition-all hover:scale-[1.02]"
          style={{
            background: loading ? "rgba(16,185,129,0.3)" : "rgba(16,185,129,0.15)",
            border: "1px solid rgba(16,185,129,0.4)",
            color: "#34d399",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Attivazione..." : "Attiva Rete A2A"}
        </button>

        <p className="text-xs text-muted-foreground">
          La tua azienda sarà visibile nella directory. Potrai nasconderla in qualsiasi momento.
        </p>
      </div>
    </div>
  );
}

// ==================== VISIBILITY TOGGLE ====================

function VisibilityToggle({ profile, onUpdate }: { profile: A2AProfile; onUpdate: (p: A2AProfile) => void }) {
  const [toggling, setToggling] = useState(false);
  const isPublic = profile.visibility === "public";

  const toggle = async () => {
    setToggling(true);
    try {
      const updated = await a2aApi.saveProfile({ companyId: profile.companyId, visibility: isPublic ? "hidden" : "public" });
      onUpdate(updated);
    } catch {} finally { setToggling(false); }
  };

  return (
    <button
      onClick={toggle}
      disabled={toggling}
      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
        isPublic ? "text-[hsl(158_64%_52%)]" : "text-white/40"
      }`}
      style={isPublic
        ? { background: "hsla(158,64%,42%,0.08)", border: "1px solid hsla(158,64%,42%,0.15)", backdropFilter: "blur(8px)" }
        : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }
      }
    >
      {isPublic ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      {isPublic ? "Visibile" : "Nascosto"}
    </button>
  );
}

// ==================== DIRECTORY TAB ====================

function DirectoryTab({ companyId }: { companyId: string }) {
  const [results, setResults] = useState<A2AProfile[]>([]);
  const [q, setQ] = useState("");
  const [zone, setZone] = useState("");
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const r = await a2aApi.searchDirectory(companyId, q || undefined, zone || undefined);
      setResults(r);
    } catch { /* ignore */ }
    setLoading(false);
  }, [companyId, q, zone]);

  useEffect(() => { search(); }, [companyId]);

  return (
    <div className="space-y-4">
      {/* Barra ricerca */}
      <div className="glass-card p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              placeholder="Cerca azienda, settore, prodotto..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-white/10 bg-transparent text-sm outline-none focus:border-[hsl(158_64%_42%/0.5)] transition-colors"
            />
          </div>
          <input
            placeholder="Zona..."
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            className="w-40 px-3 py-2.5 rounded-lg border border-white/10 bg-transparent text-sm outline-none focus:border-[hsl(158_64%_42%/0.5)] transition-colors"
          />
          <button
            onClick={search}
            className="px-5 py-2.5 rounded-lg text-sm font-medium transition-all hover:scale-[1.02] text-white" style={{ background: "hsl(158 64% 42%)" }}
          >
            Cerca
          </button>
        </div>
      </div>

      {/* Risultati */}
      {loading && <p className="text-sm text-muted-foreground px-1">Ricerca in corso...</p>}

      {!loading && results.length === 0 && (
        <div className="glass-card p-8 text-center">
          <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nessuna azienda trovata nella directory.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Le aziende appaiono qui quando attivano la Rete A2A e si rendono visibili.</p>
        </div>
      )}

      {results.map((p) => (
        <DirectoryCard key={p.id} profile={p} companyId={companyId} />
      ))}
    </div>
  );
}

function DirectoryCard({ profile, companyId }: { profile: A2AProfile; companyId: string }) {
  const [requesting, setRequesting] = useState(false);
  const [sent, setSent] = useState(false);
  const [label, setLabel] = useState("");

  const connect = async () => {
    setRequesting(true);
    try {
      await a2aApi.requestConnection(companyId, profile.companyId, label || undefined);
      setSent(true);
    } catch {
      setSent(true);
    }
    setRequesting(false);
  };

  return (
    <div className="glass-card p-5">
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{profile.legalName || "Azienda"}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {profile.atecoDescription || ""} {profile.zone ? `— ${profile.zone}` : ""}
          </p>
          {profile.description && <p className="text-xs text-muted-foreground/80 mt-2">{profile.description}</p>}
          {(profile.tags || []).length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {(profile.tags as string[]).map((t) => (
                <span key={t} className="px-2 py-0.5 rounded text-[11px] bg-[hsl(158_64%_42%/0.1)] border border-[hsl(158_64%_42%/0.2)] text-[hsl(158_64%_42%)]">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {profile.riskScore != null && (
            <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${
              profile.riskScore > 70 ? "bg-[hsl(158_64%_42%/0.15)] text-[hsl(158_64%_42%)]" :
              profile.riskScore > 40 ? "bg-yellow-500/10 text-yellow-400" :
              "bg-red-500/10 text-red-400"
            }`}>
              Risk {profile.riskScore}/100
            </span>
          )}
          {!sent ? (
            <div className="flex gap-2 items-center">
              <input
                placeholder="Es: Fornitore"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-32 px-2 py-1.5 rounded-lg border border-white/10 bg-transparent text-xs outline-none focus:border-[hsl(158_64%_42%/0.5)]"
              />
              <button
                onClick={connect}
                disabled={requesting}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-all whitespace-nowrap" style={{ background: "hsl(158 64% 42%)" }}
              >
                {requesting ? "..." : "Collegati"}
              </button>
            </div>
          ) : (
            <span className="text-xs text-[hsl(158_64%_42%)] flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" /> Richiesta inviata
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== CONNECTIONS TAB ====================

function ConnectionsTab({ companyId }: { companyId: string }) {
  const [connections, setConnections] = useState<A2AConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await a2aApi.listConnections(companyId);
      setConnections(r);
    } catch { /* ignore */ }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="glass-card p-8 text-center text-sm text-muted-foreground">Caricamento...</div>;

  const active = connections.filter((c) => c.status === "active" && c.direction === "out");
  const pendingIn = connections.filter((c) => c.status === "pending" && c.direction === "in");
  const pendingOut = connections.filter((c) => c.status === "pending" && c.direction === "out");

  const accept = async (conn: A2AConnection, label: string) => {
    await a2aApi.updateConnection(conn.id, { companyId, status: "active", relationshipLabel: label });
    load();
  };

  const reject = async (conn: A2AConnection) => {
    await a2aApi.updateConnection(conn.id, { companyId, status: "blocked" });
    load();
  };

  return (
    <div className="space-y-6">
      {/* Richieste in arrivo */}
      {pendingIn.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <ArrowDownLeft className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-400">Richieste in arrivo ({pendingIn.length})</h3>
          </div>
          {pendingIn.map((c) => (
            <PendingConnectionCard key={c.id} conn={c} onAccept={accept} onReject={reject} />
          ))}
        </div>
      )}

      {/* In attesa */}
      {pendingOut.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">In attesa di risposta ({pendingOut.length})</h3>
          </div>
          {pendingOut.map((c) => (
            <div key={c.id} className="glass-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-xs font-bold text-muted-foreground">
                  {(c.partnerName || "?")[0].toUpperCase()}
                </div>
                <div>
                  <span className="text-sm font-medium">{c.partnerName || "Azienda"}</span>
                  {c.relationshipLabel && <span className="text-xs text-muted-foreground ml-2">{c.relationshipLabel}</span>}
                </div>
              </div>
              <span className="text-[11px] font-medium px-2.5 py-1 rounded-full text-amber-300" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)", backdropFilter: "blur(8px)" }}>In attesa</span>
            </div>
          ))}
        </div>
      )}

      {/* Partner attivi */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Users className="w-4 h-4 text-[hsl(158_64%_42%)]" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(158_64%_42%)]">Partner attivi ({active.length})</h3>
        </div>

        {active.length === 0 && pendingIn.length === 0 && pendingOut.length === 0 && (
          <div className="glass-card p-8 text-center">
            <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nessun partner collegato.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Vai nella tab Directory per cercare e collegarti con altre aziende, oppure chiedi al tuo CEO di cercare partner dalla chat.</p>
          </div>
        )}

        {active.map((c) => (
          <div key={c.id} className="glass-card p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[hsl(158_64%_42%/0.1)] border border-[hsl(158_64%_42%/0.2)] flex items-center justify-center text-xs font-bold text-[hsl(158_64%_42%)]">
                {(c.partnerName || "?")[0].toUpperCase()}
              </div>
              <div>
                <span className="text-sm font-medium">{c.partnerName || "Azienda"}</span>
                {c.relationshipLabel && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded bg-[hsl(158_64%_42%/0.15)] text-[hsl(158_64%_42%)]">{c.relationshipLabel}</span>
                )}
                {c.notes && <p className="text-xs text-muted-foreground mt-0.5">{c.notes}</p>}
              </div>
            </div>
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-full text-[hsl(158_64%_52%)]" style={{ background: "hsla(158,64%,42%,0.08)", border: "1px solid hsla(158,64%,42%,0.15)", backdropFilter: "blur(8px)" }}>Attivo</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingConnectionCard({ conn, onAccept, onReject }: { conn: A2AConnection; onAccept: (c: A2AConnection, label: string) => void; onReject: (c: A2AConnection) => void }) {
  const [label, setLabel] = useState("");

  return (
    <div className="glass-card p-4 border-amber-500/20">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-xs font-bold text-amber-400">
            {(conn.partnerName || "?")[0].toUpperCase()}
          </div>
          <div>
            <span className="text-sm font-medium">{conn.partnerName || "Azienda"}</span>
            {conn.relationshipLabel && <p className="text-xs text-muted-foreground">Si presenta come: {conn.relationshipLabel}</p>}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <input
            placeholder="Es: Fornitore"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-32 px-2 py-1.5 rounded-lg border border-white/10 bg-transparent text-xs outline-none focus:border-[hsl(158_64%_42%/0.5)]"
          />
          <button
            onClick={() => onAccept(conn, label)}
            className="p-1.5 rounded-lg text-white transition-all" style={{ background: "hsl(158 64% 42%)" }}
            title="Accetta"
          >
            <CheckCircle className="w-4 h-4" />
          </button>
          <button
            onClick={() => onReject(conn)}
            className="p-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-all"
            title="Rifiuta"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== TASKS TAB ====================

function TasksTab({ companyId }: { companyId: string }) {
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await a2aApi.listTasks(companyId, direction || undefined, statusFilter || undefined);
      setTasks(r);
    } catch { /* ignore */ }
    setLoading(false);
  }, [companyId, direction, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const statusLabels: Record<string, { label: string; cls: string; style: React.CSSProperties }> = {
    created: { label: "Creato", cls: "text-amber-300", style: { background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)", backdropFilter: "blur(8px)" } },
    accepted: { label: "Accettato", cls: "text-[hsl(158_64%_52%)]", style: { background: "hsla(158,64%,42%,0.08)", border: "1px solid hsla(158,64%,42%,0.15)", backdropFilter: "blur(8px)" } },
    in_progress: { label: "In lavorazione", cls: "text-blue-300", style: { background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)", backdropFilter: "blur(8px)" } },
    shipping: { label: "In spedizione", cls: "text-purple-300", style: { background: "rgba(192,132,252,0.08)", border: "1px solid rgba(192,132,252,0.15)", backdropFilter: "blur(8px)" } },
    completed: { label: "Completato", cls: "text-[hsl(158_64%_52%)]", style: { background: "hsla(158,64%,42%,0.08)", border: "1px solid hsla(158,64%,42%,0.15)", backdropFilter: "blur(8px)" } },
    rejected: { label: "Rifiutato", cls: "text-red-300", style: { background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.15)", backdropFilter: "blur(8px)" } },
    cancelled: { label: "Annullato", cls: "text-white/40", style: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" } },
  };

  const typeLabels: Record<string, string> = {
    message: "Messaggio",
    quote: "Preventivo",
    order: "Ordine",
    service: "Servizio",
  };

  return (
    <div className="space-y-4">
      {/* Filtri */}
      <div className="glass-card p-4 flex gap-3">
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          className="pl-3 py-2 rounded-lg border border-white/10 bg-transparent text-sm outline-none focus:border-[hsl(158_64%_42%/0.5)]" style={{ paddingRight: "2.5rem" }}
        >
          <option value="">Tutte le direzioni</option>
          <option value="in">In entrata</option>
          <option value="out">In uscita</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="pl-3 py-2 rounded-lg border border-white/10 bg-transparent text-sm outline-none focus:border-[hsl(158_64%_42%/0.5)]" style={{ paddingRight: "2.5rem" }}
        >
          <option value="">Tutti gli stati</option>
          <option value="created">Creato</option>
          <option value="accepted">Accettato</option>
          <option value="in_progress">In lavorazione</option>
          <option value="shipping">In spedizione</option>
          <option value="completed">Completato</option>
          <option value="rejected">Rifiutato</option>
        </select>
      </div>

      {/* Lista task */}
      {loading && <div className="glass-card p-8 text-center text-sm text-muted-foreground">Caricamento...</div>}

      {!loading && tasks.length === 0 && (
        <div className="glass-card p-8 text-center">
          <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nessun task.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">I task vengono creati quando il tuo CEO comunica con i partner collegati. Puoi anche chiedere al CEO dalla chat: "Invia un ordine al fornitore X".</p>
        </div>
      )}

      {tasks.map((t) => {
        const isIncoming = t.toCompanyId === companyId;
        const st = statusLabels[t.status] || { label: t.status, cls: "text-white/40", style: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" } };

        return (
          <div key={t.id} className="glass-card p-5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isIncoming ? (
                  <span className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full text-blue-300" style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)", backdropFilter: "blur(8px)" }}>
                    <ArrowDownLeft className="w-3 h-3" /> Entrata
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full text-amber-300" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)", backdropFilter: "blur(8px)" }}>
                    <ArrowUpRight className="w-3 h-3" /> Uscita
                  </span>
                )}
                <span className="text-sm font-medium">{t.title}</span>
              </div>
              <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${st.cls}`} style={st.style}>
                {st.label}
              </span>
            </div>
            {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60 font-mono">
              <span>{typeLabels[t.type] || t.type}</span>
              <span>{new Date(t.createdAt).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
