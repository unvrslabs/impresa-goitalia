import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Globe, Search, Loader2, AlertTriangle, Building2, Shield, MapPin, FileText, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

type TabType = "storico" | "cerca" | "risk" | "visure-camerali" | "sdi" | "cap" | "pec";

const greenGradient = { background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))" };
const greenShadow = { ...greenGradient, boxShadow: "0 4px 20px hsla(158,64%,42%,0.35)" };

const glass = {
  card: "rounded-2xl",
  cardStyle: {
    background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.01) 100%)",
    border: "1px solid rgba(255,255,255,0.1)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
  } as React.CSSProperties,
};

const TABS: { key: TabType; label: string; icon: typeof Globe; service: string }[] = [
  { key: "storico", label: "Storico", icon: Building2, service: "_always_" },
  { key: "cerca", label: "Cerca Azienda", icon: Search, service: "company" },
  { key: "risk", label: "Risk Score", icon: Shield, service: "risk" },
  { key: "visure-camerali", label: "Visure Camerali", icon: FileText, service: "visure" },
  { key: "sdi", label: "Codice SDI", icon: Building2, service: "company" },
  { key: "cap", label: "CAP", icon: MapPin, service: "cap" },
  { key: "pec", label: "PEC", icon: Mail, service: "pec" },
];

export function AnalisiAziende() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState<TabType>("storico");
  const [services, setServices] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [visuraTipo, setVisuraTipo] = useState("ordinaria-societa-capitale");
  const [savedSearches, setSavedSearches] = useState<any[]>([]);
  const [expandedSearch, setExpandedSearch] = useState<string | null>(null);
  const [allSearches, setAllSearches] = useState<any[]>([]);

  const loadSaved = () => {
    if (!selectedCompanyId) return;
    fetch("/api/openapi-it/searches?companyId=" + selectedCompanyId + "&type=" + activeTab, { credentials: "include" })
      .then((r) => r.json()).then((d) => setSavedSearches(d.searches || [])).catch(() => {});
    fetch("/api/openapi-it/searches?companyId=" + selectedCompanyId, { credentials: "include" })
      .then((r) => r.json()).then((d) => setAllSearches(d.searches || [])).catch(() => {});
  };

  useEffect(() => { loadSaved(); }, [selectedCompanyId, activeTab]);

  // Group all searches by P.IVA/query for storico
  const groupedSearches = (() => {
    const groups: Record<string, { query: string; name: string; types: string[]; searches: any[]; riskScore?: string }> = {};
    for (const s of allSearches) {
      const key = s.query;
      if (!groups[key]) groups[key] = { query: key, name: s.result_name || key, types: [], searches: [] };
      groups[key].searches.push(s);
      if (!groups[key].types.includes(s.search_type)) groups[key].types.push(s.search_type);
      if (s.search_type === "cerca" && s.result_name) groups[key].name = s.result_name;
      else if (!groups[key].name || groups[key].name === key) groups[key].name = s.result_name || key;
      // Store risk score for badge
      if (s.search_type === "risk") { const rd = s.result_data?.data || s.result_data; groups[key].riskScore = rd?.risk_score; }
    }
    return Object.values(groups).sort((a, b) => {
      const aDate = Math.max(...a.searches.map((s: any) => new Date(s.created_at).getTime()));
      const bDate = Math.max(...b.searches.map((s: any) => new Date(s.created_at).getTime()));
      return bDate - aDate;
    });
  })();

  useEffect(() => { setBreadcrumbs([{ label: "Analisi Aziende" }]); }, [setBreadcrumbs]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    fetch("/api/openapi-it/status?companyId=" + selectedCompanyId, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setServices(d.services || []))
      .catch(() => {});
  }, [selectedCompanyId]);

  const doSearch = async () => {
    if (!query.trim() || !selectedCompanyId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSearchResults([]);

    try {
      if (activeTab === "cerca") {
        const isCode = /^\d{11}$/.test(query.trim()) || /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i.test(query.trim());
        if (isCode) {
          const r = await fetch(`/api/openapi-it/company/${encodeURIComponent(query.trim())}?companyId=${selectedCompanyId}&level=advanced`, { credentials: "include" });
          const data = await r.json();
          if (data.error) setError(data.error);
          else {
            setResult(data);
            const items = Array.isArray(data.data) ? data.data : [data];
            const active = items.find((i: any) => i.activityStatus === "ATTIVA") || items[0];
            fetch("/api/openapi-it/searches", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ companyId: selectedCompanyId, searchType: "cerca", query: query.trim(), resultName: active?.companyName || query.trim(), resultData: data }) }).then(() => loadSaved());
          }
        } else {
          const r = await fetch(`/api/openapi-it/company-search?companyId=${selectedCompanyId}&q=${encodeURIComponent(query.trim())}`, { credentials: "include" });
          const data = await r.json();
          if (data.error) setError(data.error);
          else if (data.data) setSearchResults(data.data);
          else if (Array.isArray(data)) setSearchResults(data);
          else {
          setResult(data);
          const items = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [data];
          const active = items.find((i: any) => i.activityStatus === "ATTIVA") || items[0];
          fetch("/api/openapi-it/searches", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ companyId: selectedCompanyId, searchType: activeTab, query: query.trim(), resultName: active?.companyName || query.trim(), resultData: data }) });
          loadSaved();
        }
        }
      } else if (activeTab === "risk") {
        const r = await fetch(`/api/openapi-it/risk/${encodeURIComponent(query.trim())}?companyId=${selectedCompanyId}&level=advanced`, { credentials: "include" });
        const data = await r.json();
        if (data.error) setError(data.error);
        else {
          setResult(data);
          const d = data.data || data;
          fetch("/api/openapi-it/searches", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ companyId: selectedCompanyId, searchType: activeTab, query: query.trim(), resultName: (d.denomination || query.trim()) + " — " + (d.risk_score || ""), resultData: data }) });
          loadSaved();
        }
      } else if (activeTab === "visure-camerali") {
        const r = await fetch("/api/openapi-it/visura", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ companyId: selectedCompanyId, cfPiva: query.trim(), tipo: visuraTipo }),
        });
        const data = await r.json();
        if (data.error) setError(data.error);
        else {
          setResult(data);
          fetch("/api/openapi-it/searches", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ companyId: selectedCompanyId, searchType: "visure-camerali", query: query.trim(), resultName: visuraTipo + " — " + query.trim(), resultData: data }) }).then(() => loadSaved());
        }
      } else if (activeTab === "sdi") {
        const r = await fetch(`/api/openapi-it/sdi-code/${encodeURIComponent(query.trim())}?companyId=${selectedCompanyId}`, { credentials: "include" });
        const data = await r.json();
        if (data.error) setError(data.error);
        else {
          setResult(data);
          const items = Array.isArray(data.data) ? data.data : [];
          fetch("/api/openapi-it/searches", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ companyId: selectedCompanyId, searchType: "sdi", query: query.trim(), resultName: "SDI: " + (items[0]?.sdiCode || "—"), resultData: data }) }).then(() => loadSaved());
        }
      } else if (activeTab === "cap") {
        const r = await fetch(`/api/openapi-it/cap/${encodeURIComponent(query.trim())}?companyId=${selectedCompanyId}`, { credentials: "include" });
        const data = await r.json();
        if (data.error) setError(data.error);
        else {
          setResult(data);
          fetch("/api/openapi-it/searches", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ companyId: selectedCompanyId, searchType: "cap", query: query.trim(), resultName: "CAP " + query.trim(), resultData: data }) }).then(() => loadSaved());
        }
      } else if (activeTab === "pec") {
        const isPec = query.trim().includes("@");
        const endpoint = isPec
          ? `/api/openapi-it/pec/verify/${encodeURIComponent(query.trim())}?companyId=${selectedCompanyId}`
          : `/api/openapi-it/pec/verify-domain/${encodeURIComponent(query.trim())}?companyId=${selectedCompanyId}`;
        const r = await fetch(endpoint, { credentials: "include" });
        const data = await r.json();
        if (data.error) setError(data.error);
        else setResult(data);
      }
    } catch {
      setError("Errore di rete");
    } finally {
      setLoading(false);
    }
  };

  const loadCompany = async (vatCode: string) => {
    setQuery(vatCode);
    setLoading(true);
    setError(null);
    setSearchResults([]);
    try {
      const r = await fetch(`/api/openapi-it/company/${encodeURIComponent(vatCode)}?companyId=${selectedCompanyId}&level=advanced`, { credentials: "include" });
      const data = await r.json();
      if (data.error) setError(data.error);
      else setResult(data);
    } catch { setError("Errore di rete"); }
    finally { setLoading(false); }
  };

  const placeholder: Record<TabType, string> = {
    storico: "",
    cerca: "P.IVA, Codice Fiscale o nome azienda...",
    risk: "Partita IVA dell'azienda...",
    "visure-camerali": "P.IVA o Codice Fiscale dell'azienda...",
    sdi: "P.IVA dell'azienda...",
    cap: "Codice postale (es: 00100)...",
    pec: "Indirizzo PEC o dominio da verificare...",
  };

  const riskColor = (score: string) => {
    const s = (score || "").toUpperCase();
    if (s.includes("VERDE") || s === "GREEN") return "bg-green-500";
    if (s.includes("GIALLO") || s === "YELLOW") return "bg-yellow-400";
    if (s.includes("ARANCIONE") || s === "ORANGE") return "bg-orange-500";
    if (s.includes("ROSSO") || s === "RED" || s === "DARK_RED") return "bg-red-500";
    return "bg-gray-400";
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          {TABS.filter((t) => t.service === "_always_" || services.includes(t.service)).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setResult(null); setSearchResults([]); setError(null); }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border",
                  activeTab !== tab.key && "bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10"
                )}
                style={activeTab === tab.key ? { ...greenGradient, borderColor: "transparent", color: "white" } : undefined}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        {activeTab !== "storico" && <div className={glass.card} style={glass.cardStyle}>
          <div className="p-4 space-y-3">
            {activeTab === "visure-camerali" && (
              <select
                value={visuraTipo}
                onChange={(e) => setVisuraTipo(e.target.value)}
                className="w-64 px-5 py-3.5 rounded-2xl border border-white/10 bg-white/5 text-sm outline-none backdrop-blur-md cursor-pointer"
              >
                <option value="ordinaria-societa-capitale">Ordinaria Soc. Capitali</option>
                <option value="ordinaria-societa-persone">Ordinaria Soc. Persone</option>
                <option value="ordinaria-impresa-individuale">Ordinaria Impresa Individuale</option>
                <option value="storica-societa-capitale">Storica Soc. Capitali</option>
                <option value="storica-societa-persone">Storica Soc. Persone</option>
                <option value="storica-impresa-individuale">Storica Impresa Individuale</option>
                <option value="soci-attivi">Soci Attivi</option>
                <option value="bilancio-ottico">Bilancio Ottico</option>
                <option value="certificato-iscrizione">Certificato Iscrizione</option>
              </select>
            )}
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 bg-transparent text-sm outline-none focus:border-green-500/50"
                  placeholder={placeholder[activeTab]}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                />
              </div>
              <button
                onClick={doSearch}
                disabled={loading || !query.trim()}
                className="px-6 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-40"
                style={greenGradient}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : activeTab === "visure-camerali" ? "Richiedi" : "Cerca"}
              </button>
            </div>
          </div>
        </div>}

        {/* Storico tab */}
        {activeTab === "storico" && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 bg-white/5 text-sm outline-none focus:border-green-500/50"
                placeholder="Filtra per nome o P.IVA..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {groupedSearches.filter((g) => !query.trim() || g.name.toLowerCase().includes(query.trim().toLowerCase()) || g.query.includes(query.trim())).length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">{query.trim() ? "Nessun risultato" : "Nessuna ricerca salvata. Usa le tab sopra per cercare aziende."}</div>
            )}
            {groupedSearches.filter((g) => !query.trim() || g.name.toLowerCase().includes(query.trim().toLowerCase()) || g.query.includes(query.trim())).map((group) => {
              const isOpen = expandedSearch === group.query;
              const typeLabels: Record<string, string> = { cerca: "Azienda", risk: "Risk", "visure-camerali": "Visura", sdi: "SDI", cap: "CAP" };
              const typeColors: Record<string, string> = { cerca: "bg-blue-500/20 text-blue-400 border-blue-500/30", risk: "bg-orange-500/20 text-orange-400 border-orange-500/30", "visure-camerali": "bg-purple-500/20 text-purple-400 border-purple-500/30", sdi: "bg-green-500/20 text-green-400 border-green-500/30", cap: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" };
              return (
                <div key={group.query} className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <button onClick={() => setExpandedSearch(isOpen ? null : group.query)} className="w-full px-5 py-4 flex items-center gap-3 text-left">
                    <Building2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{group.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">P.IVA/CF: {group.query}</div>
                    </div>
                    <div className="flex gap-1.5 items-center shrink-0">
                      {group.types.map((t) => (
                        t === "risk" ? (
                          <span key={t} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-medium border bg-white/5 border-white/15 text-muted-foreground">
                            <span className={"w-2 h-2 rounded-full shrink-0 " + riskColor(group.riskScore || "")} />
                            Risk Score
                          </span>
                        ) : (
                          <span key={t} className={cn("px-2 py-0.5 rounded-full text-[9px] font-medium border", typeColors[t] || "bg-white/10 text-muted-foreground border-white/20")}>{typeLabels[t] || t}</span>
                        )
                      ))}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 space-y-4 border-t border-white/5 pt-4">
                      {group.searches.filter((s: any) => s.search_type === "cerca").map((s: any) => (
                        <div key={s.id}><CompanyCard data={s.result_data} /></div>
                      ))}
                      {group.searches.filter((s: any) => s.search_type === "risk").map((s: any) => (
                        <div key={s.id}><RiskCard data={s.result_data} riskColor={riskColor} /></div>
                      ))}
                      {group.searches.filter((s: any) => s.search_type === "visure-camerali").map((s: any) => (
                        <div key={s.id}><VisuraCard data={s.result_data} companyId={selectedCompanyId || ""} /></div>
                      ))}
                      {group.searches.filter((s: any) => s.search_type === "sdi").map((s: any) => (
                        <div key={s.id}><SdiCard data={s.result_data} /></div>
                      ))}
                      {group.searches.filter((s: any) => s.search_type === "cap").map((s: any) => (
                        <div key={s.id}><CapCard data={s.result_data} /></div>
                      ))}
                      {group.searches.filter((s: any) => s.search_type === "pec").map((s: any) => (
                        <div key={s.id}><PecCard data={s.result_data} /></div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Search Results (name search) */}
        {searchResults.length > 0 && (
          <div className={glass.card} style={glass.cardStyle}>
            <div className="p-4 space-y-2">
              <div className="text-sm font-medium text-muted-foreground mb-3">{searchResults.length} risultati</div>
              {searchResults.map((item: any, idx: number) => (
                <button
                  key={idx}
                  onClick={() => loadCompany(item.vat_code || item.tax_code || item.id || "")}
                  className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 transition-colors border border-white/5"
                >
                  <div className="text-sm font-medium">{item.denomination || item.name || "—"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {item.vat_code && `P.IVA: ${item.vat_code}`}
                    {item.city && ` · ${item.city}`}
                    {item.province && ` (${item.province})`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Result */}
        {result && activeTab === "cerca" && <CompanyCard data={result} />}
        {result && activeTab === "risk" && <RiskCard data={result} riskColor={riskColor} />}
        {result && activeTab === "visure-camerali" && <VisuraCard data={result} companyId={selectedCompanyId || ""} />}
        {result && activeTab === "sdi" && <SdiCard data={result} />}
        {result && activeTab === "cap" && <CapCard data={result} />}
        {result && activeTab === "pec" && <PecCard data={result} />}

      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-sm mt-0.5">{String(value)}</div>
    </div>
  );
}

function CompanyCard({ data }: { data: any }) {
  const items = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [data];
  const d = items.find((i: any) => i.activityStatus === "ATTIVA") || items[0];
  if (!d) return null;
  const addr = d.address?.registeredOffice || {};
  const ateco = d.atecoClassification?.ateco2007 || d.atecoClassification?.ateco || {};
  const legal = d.detailedLegalForm || {};
  const balance = d.balanceSheets?.last || {};
  const fmt = (n: number | null | undefined) => n != null ? "\u20ac " + Number(n).toLocaleString("it-IT") : undefined;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-emerald-500/15 border border-emerald-500/30 shrink-0">
            <Building2 className="w-6 h-6 text-emerald-400" />
          </div>
          <div className="flex-1">
            <div className="text-lg font-semibold">{d.companyName || "—"}</div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {legal.description && <span className="text-xs text-muted-foreground">{legal.description}</span>}
              {d.activityStatus && <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", d.activityStatus === "ATTIVA" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400")}>{d.activityStatus}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Dati Principali */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-xs font-medium text-muted-foreground">Dati Principali</div>
          <div className="space-y-2">
            <Field label="P.IVA" value={d.vatCode} />
            <Field label="Codice Fiscale" value={d.taxCode} />
            <Field label="Data Inizio Attività" value={d.startDate} />
            <Field label="Data Registrazione" value={d.registrationDate} />
            {d.endDate && <Field label="Data Cessazione" value={d.endDate} />}
            <Field label="Codice ATECO" value={ateco.code} />
            <Field label="Attività" value={ateco.description} />
            <Field label="Forma Giuridica" value={legal.description} />
            <Field label="CCIAA" value={d.cciaa} />
            <Field label="REA" value={d.reaCode} />
          </div>
        </div>

        {/* Sede & Contatti */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-xs font-medium text-muted-foreground">Sede & Contatti</div>
          <div className="space-y-2">
            <Field label="Indirizzo" value={addr.streetName} />
            <Field label="Comune" value={[addr.town, addr.province && `(${addr.province})`].filter(Boolean).join(" ")} />
            <Field label="CAP" value={addr.zipCode} />
            <Field label="Regione" value={addr.region?.description} />
            <Field label="PEC" value={d.pec} />
            <Field label="Codice SDI" value={d.sdiCode} />
            <Field label="Gruppo IVA" value={d.vatGroup?.vatGroupParticipation ? "Sì" : undefined} />
          </div>
        </div>
      </div>

      {/* Bilancio */}
      {(balance.turnover || balance.netWorth || balance.shareCapital || balance.employees != null) && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-xs font-medium text-muted-foreground">Bilancio {balance.year || ""}</div>
          <div className="grid grid-cols-3 gap-4">
            {balance.turnover != null && (
              <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[10px] text-muted-foreground uppercase">Fatturato</div>
                <div className="text-sm font-bold mt-1">{fmt(balance.turnover)}</div>
              </div>
            )}
            {balance.netWorth != null && (
              <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[10px] text-muted-foreground uppercase">Patrimonio Netto</div>
                <div className="text-sm font-bold mt-1">{fmt(balance.netWorth)}</div>
              </div>
            )}
            {balance.shareCapital != null && (
              <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[10px] text-muted-foreground uppercase">Capitale Sociale</div>
                <div className="text-sm font-bold mt-1">{fmt(balance.shareCapital)}</div>
              </div>
            )}
            {balance.totalAssets != null && (
              <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[10px] text-muted-foreground uppercase">Totale Attivo</div>
                <div className="text-sm font-bold mt-1">{fmt(balance.totalAssets)}</div>
              </div>
            )}
            {balance.employees != null && (
              <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[10px] text-muted-foreground uppercase">Dipendenti</div>
                <div className="text-sm font-bold mt-1">{balance.employees}</div>
              </div>
            )}
            {balance.totalStaffCost != null && (
              <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[10px] text-muted-foreground uppercase">Costo Personale</div>
                <div className="text-sm font-bold mt-1">{fmt(balance.totalStaffCost)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Soci */}
      {d.shareHolders && d.shareHolders.length > 0 && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-xs font-medium text-muted-foreground">Soci</div>
          <div className="space-y-2">
            {d.shareHolders.map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div>
                  <div className="text-sm font-medium">{s.companyName || [s.name, s.surname].filter(Boolean).join(" ") || "—"}</div>
                  {s.taxCode && <div className="text-[10px] text-muted-foreground">CF: {s.taxCode}</div>}
                </div>
                {s.percentShare != null && <span className="text-sm font-bold text-green-400">{s.percentShare}%</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RiskCard({ data, riskColor }: { data: any; riskColor: (s: string) => string }) {
  const d = data.data || data;
  const fmt = (n: number | null | undefined) => n != null ? "\u20ac " + Number(n).toLocaleString("it-IT") : "—";
  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-center gap-4">
          <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center shrink-0", riskColor(d.risk_score || ""))}>
            <Shield className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-lg font-semibold">{d.organization_name || "—"}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-2xl font-bold">{d.risk_score || "—"}</span>
              <span className="text-xs text-muted-foreground">{d.risk_score_description || ""}</span>
            </div>
            {(d.vat || d.tax) && <div className="text-[10px] text-muted-foreground mt-1">P.IVA {d.vat || d.tax}</div>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-[10px] text-muted-foreground uppercase">Rating</div>
          <div className="text-2xl font-bold mt-1">{d.rating || "—"}</div>
        </div>
        <div className="rounded-2xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-[10px] text-muted-foreground uppercase">Severity</div>
          <div className="text-2xl font-bold mt-1">{d.risk_severity ?? "—"}</div>
          <div className="text-[10px] text-muted-foreground">/990</div>
        </div>
        <div className="rounded-2xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-[10px] text-muted-foreground uppercase">Limite Credito</div>
          <div className="text-xl font-bold mt-1">{fmt(d.operational_credit_limit)}</div>
        </div>
      </div>
    </div>
  );
}

function SdiCard({ data }: { data: any }) {
  const items = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [data];
  const d = items[0] || {};
  return (
    <div className="rounded-2xl p-5 space-y-3" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="text-sm font-medium text-muted-foreground">Codice Destinatario SDI</div>
      <div className="text-3xl font-mono font-bold tracking-wider">{d.sdiCode || d.sdi_code || "—"}</div>
      {items.length > 1 && (
        <div className="space-y-1 pt-2">
          {items.slice(1).map((item: any, i: number) => (
            <div key={i} className="text-sm font-mono text-muted-foreground">{item.sdiCode || item.sdi_code}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function CapCard({ data }: { data: any }) {
  const d = data.data || data;
  const comuni = d.comuni || [];
  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-emerald-500/15 border border-emerald-500/30 shrink-0">
          <MapPin className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <div className="text-lg font-semibold">{comuni[0]?.comune || "—"}</div>
          <div className="text-xs text-muted-foreground">{d.provincia} ({d.sigla_provincia}) — {d.regione}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-[10px] text-muted-foreground uppercase">Provincia</div>
          <div className="text-sm font-bold mt-1">{d.provincia || "—"}</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-[10px] text-muted-foreground uppercase">Sigla</div>
          <div className="text-sm font-bold mt-1">{d.sigla_provincia || "—"}</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-[10px] text-muted-foreground uppercase">Regione</div>
          <div className="text-sm font-bold mt-1">{d.regione || "—"}</div>
        </div>
      </div>
      {comuni.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Comuni</div>
          {comuni.map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm" style={{ background: "rgba(255,255,255,0.03)" }}>
              <span className="font-medium">{c.comune}</span>
              {c.frazione && <span className="text-xs text-muted-foreground">({c.frazione})</span>}
              <span className="text-xs text-muted-foreground ml-auto">ISTAT: {c.istat}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VisuraCard({ data, companyId }: { data: any; companyId: string }) {
  const [status, setStatus] = useState<string>(data.status || "In elaborazione");
  const [polling, setPolling] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const visuraId = data.id || data.data?.id;

  const checkStatus = async () => {
    if (!visuraId) return;
    setPolling(true);
    try {
      const r = await fetch(`/api/openapi-it/visura/${visuraId}?companyId=${companyId}`, { credentials: "include" });
      const d = await r.json();
      const s = d.status || d.data?.status || "In elaborazione";
      setStatus(s);
      if (s === "Visura evasa" || s === "completed" || s === "done") {
        // Try to download
        const dl = await fetch(`/api/openapi-it/visura/${visuraId}/download?companyId=${companyId}`, { credentials: "include" });
        const dlData = await dl.json();
        if (dlData.data?.file) {
          setDownloadUrl("data:application/zip;base64," + dlData.data.file);
        }
      }
    } catch {} finally { setPolling(false); }
  };

  useEffect(() => {
    if (!visuraId) return;
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [visuraId]);

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="text-sm font-medium">Visura Camerale</div>
      <div className="flex items-center gap-3">
        <div className={"px-3 py-1.5 rounded-lg text-xs font-medium " + (status === "Visura evasa" || status === "completed" ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-amber-500/20 text-amber-400 border border-amber-500/30")}>
          {status}
        </div>
        {visuraId && <span className="text-xs text-muted-foreground">ID: {visuraId}</span>}
      </div>
      {downloadUrl && (
        <a href={downloadUrl} download={`visura_${visuraId}.zip`} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
          <FileText className="w-4 h-4" />
          Scarica Visura (ZIP)
        </a>
      )}
      {!downloadUrl && status !== "Visura evasa" && status !== "completed" && (
        <div className="text-xs text-muted-foreground">La visura è in elaborazione. Il download sarà disponibile automaticamente quando pronta.</div>
      )}
    </div>
  );
}

function PecCard({ data }: { data: any }) {
  const d = data.data || data;
  return (
    <div className="rounded-2xl p-5 space-y-3" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-pink-500/15 border border-pink-500/30 shrink-0">
          <Mail className="w-6 h-6 text-pink-400" />
        </div>
        <div>
          <div className="text-lg font-semibold">Verifica PEC</div>
        </div>
      </div>
      <div className="space-y-2">
        {typeof d === "object" && Object.entries(d).map(([k, v]) => (
          <Field key={k} label={k.replace(/_/g, " ")} value={String(v)} />
        ))}
      </div>
    </div>
  );
}
