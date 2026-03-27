import { useState, useEffect, useCallback } from "react";
import { useCompany } from "../context/CompanyContext.js";
import { a2aApi, type A2AProfile, type A2AConnection, type A2ATask } from "../api/a2a.js";
import { Network } from "lucide-react";

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
  if (profile === undefined) return <div style={{ padding: 32, color: "var(--muted, #888)" }}>Caricamento...</div>;

  if (profile === null) {
    return <SetupProfile companyId={selectedCompanyId} onCreated={setProfile} />;
  }

  const tabs = [
    { key: "connections" as const, label: "Partner" },
    { key: "directory" as const, label: "Directory" },
    { key: "tasks" as const, label: "Task" },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)" }}>A2A</h1>
        <ProfileBadge profile={profile} onUpdate={setProfile} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: tab === t.key ? "1px solid var(--gold, #f5c518)" : "1px solid var(--border, #333)",
              background: tab === t.key ? "rgba(245,197,24,0.15)" : "transparent",
              color: tab === t.key ? "var(--gold, #f5c518)" : "var(--text, #ccc)",
              fontWeight: tab === t.key ? 700 : 400,
              cursor: "pointer",
              fontSize: 14,
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "directory" && <DirectoryTab companyId={selectedCompanyId} />}
      {tab === "connections" && <ConnectionsTab companyId={selectedCompanyId} />}
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
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-emerald-500/15 border border-emerald-500/30 mx-auto">
          <Network className="w-8 h-8 text-emerald-400" />
        </div>

        <div>
          <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)" }}>
            Rete A2A
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            La rete Agent-to-Agent di GoItalIA. I CEO AI delle aziende sulla piattaforma possono comunicarsi direttamente tra loro per scambiarsi ordini, preventivi, richieste e collaborazioni.
          </p>
        </div>

        <div className="glass-card px-5 py-4 text-left space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="flex items-start gap-3">
            <span className="text-emerald-400 text-lg mt-0.5">1.</span>
            <div>
              <p className="text-sm font-medium">Directory Aziende</p>
              <p className="text-xs text-muted-foreground">Cerca partner, fornitori e clienti sulla piattaforma per settore, zona o nome.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-emerald-400 text-lg mt-0.5">2.</span>
            <div>
              <p className="text-sm font-medium">Connessioni B2B</p>
              <p className="text-xs text-muted-foreground">Collegati con altre aziende. Ogni connessione ha un ruolo: Fornitore, Cliente, Partner.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-emerald-400 text-lg mt-0.5">3.</span>
            <div>
              <p className="text-sm font-medium">Task tra CEO</p>
              <p className="text-xs text-muted-foreground">I CEO AI si scambiano ordini, preventivi e messaggi. Auto-risposta per info e prezzi, approvazione umana per impegni economici.</p>
            </div>
          </div>
        </div>

        <button
          onClick={activate}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold transition-all"
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

// ==================== PROFILE BADGE ====================

function ProfileBadge({ profile, onUpdate }: { profile: A2AProfile; onUpdate: (p: A2AProfile) => void }) {
  const toggleVisibility = async () => {
    const newVis = profile.visibility === "public" ? "hidden" : "public";
    const updated = await a2aApi.saveProfile({ companyId: profile.companyId, visibility: newVis });
    onUpdate(updated);
  };

  const isPublic = profile.visibility === "public";

  return (
    <button
      onClick={toggleVisibility}
      style={{
        padding: "6px 16px",
        borderRadius: 6,
        border: `1px solid ${isPublic ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
        background: isPublic ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
        color: isPublic ? "#22c55e" : "#ef4444",
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
      }}
    >
      {isPublic ? "Visibile nella directory" : "Nascosto dalla directory"}
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

  const inputStyle = {
    padding: 10,
    borderRadius: 8,
    border: "1px solid var(--border, #333)",
    background: "var(--bg-secondary, #1a1a1a)",
    color: "var(--text, #fff)",
    fontSize: 14,
    fontFamily: "var(--font-body, 'Outfit', sans-serif)",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Cerca azienda, settore, prodotto..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          style={{ ...inputStyle, flex: 1 }}
        />
        <input
          placeholder="Zona (regione, citta...)"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          style={{ ...inputStyle, width: 200 }}
        />
        <button onClick={search} style={{ padding: "10px 20px", borderRadius: 8, background: "var(--gold, #f5c518)", color: "#000", fontWeight: 600, border: "none", cursor: "pointer", fontSize: 14 }}>
          Cerca
        </button>
      </div>

      {loading && <p style={{ color: "var(--muted, #888)" }}>Ricerca...</p>}
      {!loading && results.length === 0 && <p style={{ color: "var(--muted, #888)" }}>Nessuna azienda trovata nella directory.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {results.map((p) => (
          <DirectoryCard key={p.id} profile={p} companyId={companyId} />
        ))}
      </div>
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
      setSent(true); // probably already connected
    }
    setRequesting(false);
  };

  return (
    <div style={{ padding: 16, borderRadius: 12, border: "1px solid var(--border, #333)", background: "var(--bg-secondary, #1a1a1a)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{profile.legalName || "Azienda"}</h3>
          <p style={{ fontSize: 13, color: "var(--muted, #888)", marginBottom: 4 }}>
            {profile.atecoDescription || ""} {profile.zone ? `— ${profile.zone}` : ""}
          </p>
          {profile.description && <p style={{ fontSize: 14, marginBottom: 8, color: "var(--text, #ccc)" }}>{profile.description}</p>}
          {(profile.tags || []).length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(profile.tags as string[]).map((t) => (
                <span key={t} style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(245,197,24,0.12)", color: "var(--gold, #f5c518)", fontSize: 12, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{t}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", minWidth: 200 }}>
          {profile.riskScore != null && (
            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: profile.riskScore > 70 ? "#22c55e" : profile.riskScore > 40 ? "#eab308" : "#ef4444" }}>
              Risk: {profile.riskScore}/100
            </span>
          )}
          {!sent ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                placeholder="Es: Fornitore vini"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                style={{ width: 140, padding: 6, borderRadius: 6, border: "1px solid var(--border, #333)", background: "var(--bg, #111)", color: "var(--text, #fff)", fontSize: 12 }}
              />
              <button
                onClick={connect}
                disabled={requesting}
                style={{ padding: "6px 14px", borderRadius: 6, background: "var(--gold, #f5c518)", color: "#000", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {requesting ? "..." : "Collegati"}
              </button>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: "#22c55e" }}>Richiesta inviata</span>
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

  if (loading) return <p style={{ color: "var(--muted, #888)" }}>Caricamento...</p>;

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
    <div>
      {pendingIn.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--gold, #f5c518)", marginBottom: 8, fontFamily: "var(--font-mono)" }}>
            Richieste in arrivo ({pendingIn.length})
          </h3>
          {pendingIn.map((c) => (
            <PendingConnectionCard key={c.id} conn={c} onAccept={accept} onReject={reject} />
          ))}
        </div>
      )}

      {pendingOut.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--muted, #888)", marginBottom: 8, fontFamily: "var(--font-mono)" }}>
            In attesa di risposta ({pendingOut.length})
          </h3>
          {pendingOut.map((c) => (
            <div key={c.id} style={{ padding: 12, borderRadius: 8, border: "1px solid var(--border, #333)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{c.partnerName || "Azienda"}</span>
              {c.relationshipLabel && <span style={{ color: "var(--muted, #888)", fontSize: 13 }}>{c.relationshipLabel}</span>}
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#eab308", fontFamily: "var(--font-mono)" }}>In attesa</span>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, fontFamily: "var(--font-mono)" }}>
        Partner attivi ({active.length})
      </h3>
      {active.length === 0 && <p style={{ color: "var(--muted, #888)" }}>Nessun partner collegato. Cerca nella Directory!</p>}
      {active.map((c) => (
        <div key={c.id} style={{ padding: 12, borderRadius: 8, border: "1px solid var(--border, #333)", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontWeight: 600 }}>{c.partnerName || "Azienda"}</span>
            {c.relationshipLabel && <span style={{ marginLeft: 8, color: "var(--gold, #f5c518)", fontSize: 13 }}>{c.relationshipLabel}</span>}
            {c.notes && <p style={{ fontSize: 12, color: "var(--muted, #888)", marginTop: 2 }}>{c.notes}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PendingConnectionCard({ conn, onAccept, onReject }: { conn: A2AConnection; onAccept: (c: A2AConnection, label: string) => void; onReject: (c: A2AConnection) => void }) {
  const [label, setLabel] = useState("");

  return (
    <div style={{ padding: 12, borderRadius: 8, border: "1px solid var(--gold, #f5c518)", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div>
        <span style={{ fontWeight: 600 }}>{conn.partnerName || "Azienda"}</span>
        {conn.relationshipLabel && <span style={{ marginLeft: 8, fontSize: 13, color: "var(--muted, #888)" }}>Si presenta come: {conn.relationshipLabel}</span>}
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          placeholder="Es: Cliente, Fornitore..."
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ width: 150, padding: 6, borderRadius: 6, border: "1px solid var(--border, #333)", background: "var(--bg, #111)", color: "var(--text, #fff)", fontSize: 12 }}
        />
        <button onClick={() => onAccept(conn, label)} style={{ padding: "6px 12px", borderRadius: 6, background: "#22c55e", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}>Accetta</button>
        <button onClick={() => onReject(conn)} style={{ padding: "6px 12px", borderRadius: 6, background: "#ef4444", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}>Rifiuta</button>
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

  const selectStyle = {
    padding: 8,
    borderRadius: 6,
    border: "1px solid var(--border, #333)",
    background: "var(--bg-secondary, #1a1a1a)",
    color: "var(--text, #fff)",
    fontSize: 13,
  };

  const statusColors: Record<string, string> = {
    created: "#eab308",
    accepted: "#22c55e",
    in_progress: "#3b82f6",
    completed: "#22c55e",
    rejected: "#ef4444",
    cancelled: "#888",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} style={selectStyle}>
          <option value="">Tutti</option>
          <option value="in">In entrata</option>
          <option value="out">In uscita</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">Tutti gli stati</option>
          <option value="created">Creato</option>
          <option value="accepted">Accettato</option>
          <option value="in_progress">In corso</option>
          <option value="completed">Completato</option>
          <option value="rejected">Rifiutato</option>
        </select>
      </div>

      {loading && <p style={{ color: "var(--muted, #888)" }}>Caricamento...</p>}
      {!loading && tasks.length === 0 && (
        <p style={{ color: "var(--muted, #888)" }}>
          Nessun task. I CEO inizieranno a creare task quando comunicheranno con i partner.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tasks.map((t) => {
          const isIncoming = t.toCompanyId === companyId;
          return (
            <div key={t.id} style={{ padding: 14, borderRadius: 8, border: "1px solid var(--border, #333)", background: "var(--bg-secondary, #1a1a1a)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    background: isIncoming ? "rgba(59,130,246,0.12)" : "rgba(245,197,24,0.12)",
                    color: isIncoming ? "#3b82f6" : "var(--gold, #f5c518)",
                  }}>
                    {isIncoming ? "ENTRATA" : "USCITA"}
                  </span>
                  <span style={{ fontWeight: 600 }}>{t.title}</span>
                </div>
                <span style={{ fontSize: 12, color: statusColors[t.status] || "#888", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                  {t.status.toUpperCase()}
                </span>
              </div>
              {t.description && <p style={{ fontSize: 13, color: "var(--muted, #888)", marginTop: 4 }}>{t.description}</p>}
              <div style={{ fontSize: 11, color: "var(--muted, #666)", marginTop: 6, fontFamily: "var(--font-mono)" }}>
                Tipo: {t.type} | {new Date(t.createdAt).toLocaleDateString("it-IT")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
