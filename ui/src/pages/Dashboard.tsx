import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import {
  Building2, Plug, Bot, MessageCircle, Network, Package, Plus,
  ArrowRight, Globe, Phone, Mail, MapPin, ChevronRight,
} from "lucide-react";
import type { Agent } from "@goitalia/shared";

import type { ReactNode } from "react";

const CONNECTOR_INFO: Record<string, { label: string; color: string; icon: ReactNode }> = {
  google: { label: "Google", color: "#4285F4", icon: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> },
  telegram: { label: "Telegram", color: "#26A5E4", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="#26A5E4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg> },
  whatsapp: { label: "WhatsApp", color: "#25D366", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg> },
  meta_ig: { label: "Instagram", color: "#E1306C", icon: <svg viewBox="0 0 24 24" width="16" height="16"><defs><linearGradient id="ig-dash" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#FFDC80"/><stop offset="25%" stopColor="#F77737"/><stop offset="50%" stopColor="#E1306C"/><stop offset="75%" stopColor="#C13584"/><stop offset="100%" stopColor="#833AB4"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="5" fill="url(#ig-dash)"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="white" strokeWidth="1.5"/><circle cx="17.5" cy="6.5" r="1.2" fill="white"/></svg> },
  meta_fb: { label: "Facebook", color: "#1877F2", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg> },
  linkedin: { label: "LinkedIn", color: "#0A66C2", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> },
  fal: { label: "Fal.ai", color: "#6366F1", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#6366F1"/><path d="M7 12l3-6 3 6m-5-1h4M17 8v8m-2-4h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  fic: { label: "Fatture in Cloud", color: "#F59E0B", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#F59E0B"/><path d="M7 7h10M7 11h7M7 15h4M15 13l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  openapi: { label: "OpenAPI.it", color: "#10B981", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#10B981"/><path d="M12 7v5l3 3M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  voice: { label: "Vocali AI", color: "#8B5CF6", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#8B5CF6"/><path d="M12 7v6m0 0a2 2 0 0 1-2-2V9a2 2 0 1 1 4 0v2a2 2 0 0 1-2 2zm-4-1a4 4 0 0 0 8 0M12 17v-2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  pec: { label: "PEC", color: "#06B6D4", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#06B6D4"/><path d="M4 8l8 5 8-5M4 8v8l8 5 8-5V8" stroke="white" strokeWidth="1.2" strokeLinejoin="round"/></svg> },
  stripe: { label: "Stripe", color: "#635BFF", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#635BFF"/><path d="M9.5 8.5c0-1.1.9-1.5 2-1.5 1.7 0 2.5.8 2.5.8l.5-2.5S13.5 4.5 11.5 4.5C9 4.5 7 6 7 8.5c0 4 5 3.5 5 5.5 0 1-.7 1.5-2 1.5-1.7 0-3-.9-3-.9l-.5 2.5s1.3 1 3.5 1c2.5 0 4.5-1.3 4.5-4 0-4-5-3.5-5-5.6z" fill="white"/></svg> },
  hubspot: { label: "HubSpot", color: "#FF7A45", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#FF7A45"/><text x="12" y="16" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">H</text></svg> },
  salesforce: { label: "Salesforce", color: "#00A1E0", icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#00A1E0"/><text x="12" y="15" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">SF</text></svg> },
};

export function Dashboard() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => { setBreadcrumbs([{ label: "Dashboard" }]); }, [setBreadcrumbs]);

  // Profile
  const { data: profileData } = useQuery({
    queryKey: ["company-profile", selectedCompanyId],
    queryFn: () => fetch("/api/company-profile?companyId=" + selectedCompanyId, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });
  const profile = profileData?.profile || {};

  // Agents
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const activeAgents = (agents || []).filter((a: Agent) => a.status !== "terminated" && a.role !== "ceo");

  // Connectors
  const { data: connectors } = useQuery({
    queryKey: ["connectors", selectedCompanyId],
    queryFn: () => fetch("/api/connector-accounts?companyId=" + selectedCompanyId, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });

  // Products
  const { data: products } = useQuery({
    queryKey: ["products", selectedCompanyId],
    queryFn: () => fetch("/api/company-products?companyId=" + selectedCompanyId, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });

  // A2A profile
  const { data: a2aProfile } = useQuery({
    queryKey: ["a2a-profile", selectedCompanyId],
    queryFn: () => fetch("/api/a2a/profile?companyId=" + selectedCompanyId, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });

  // Chat history (last messages)
  const { data: chatHistory } = useQuery({
    queryKey: ["chat-history-dash", selectedCompanyId],
    queryFn: () => fetch("/api/chat/history?companyId=" + selectedCompanyId + "&limit=5", { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });

  const connectorsList = Array.isArray(connectors) ? connectors : [];
  const productsList = Array.isArray(products) ? products : [];
  const categories = [...new Set(productsList.map((p: any) => p.category).filter(Boolean))];
  const lastMessages = (chatHistory?.messages || []).filter((m: any) => !m.content?.startsWith("__PENDING__")).slice(-5);

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header — Company Info */}
      <div className="rounded-xl p-5 flex items-center gap-4" style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02))", border: "1px solid rgba(34,197,94,0.15)" }}>
        <div className="h-12 w-12 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "hsl(158 64% 42% / 0.15)", color: "hsl(158 64% 42%)" }}>
          {(profile.ragione_sociale || selectedCompany?.name || "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">{profile.ragione_sociale || selectedCompany?.name}</h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {profile.settore && <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {profile.settore}</span>}
            {profile.citta && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {profile.citta}</span>}
            {profile.telefono && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {profile.telefono}</span>}
            {profile.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {profile.email}</span>}
          </div>
        </div>
        <Link to="company/settings" className="text-xs px-3 py-1.5 rounded-lg no-underline transition-all" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)" }}>
          Profilo <ChevronRight className="w-3 h-3 inline" />
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4" style={{ color: "#a855f7" }} />
            <span className="text-xl font-bold" style={{ color: "#a855f7" }}>{connectorsList.length}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Connettori</p>
        </div>
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4" style={{ color: "#f59e0b" }} />
            <span className="text-xl font-bold" style={{ color: "#f59e0b" }}>{activeAgents.length}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Agenti</p>
        </div>
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" style={{ color: "#3b82f6" }} />
            <span className="text-xl font-bold" style={{ color: "#3b82f6" }}>{productsList.length}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Catalogo</p>
        </div>
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4" style={{ color: "#22c55e" }} />
            <span className="text-xl font-bold" style={{ color: "#22c55e" }}>{a2aProfile ? "ON" : "OFF"}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Rete A2A</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Connectors */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Connettori Attivi</h2>
              <Link to="plugins" className="text-[10px] text-muted-foreground hover:text-white no-underline flex items-center gap-0.5">
                <Plus className="w-3 h-3" /> Aggiungi
              </Link>
            </div>
            {connectorsList.length === 0 ? (
              <div className="text-center py-4">
                <Plug className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Nessun connettore attivo</p>
                <Link to="plugins" className="text-xs no-underline mt-1 inline-block" style={{ color: "hsl(158 64% 52%)" }}>Vai ai Connettori</Link>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {connectorsList.map((c: any, i: number) => {
                  const info = CONNECTOR_INFO[c.connectorType];
                  return (
                    <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg" style={{ background: `${info?.color || "#666"}08`, border: `1px solid ${info?.color || "#666"}18` }}>
                      <div className="shrink-0">{info?.icon || <Plug className="w-4 h-4" style={{ color: "#666" }} />}</div>
                      <span className="text-xs font-medium" style={{ color: info?.color || "#999" }}>{c.accountLabel || info?.label || c.connectorType}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Agents */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agenti ({activeAgents.length})</h2>
            </div>
            {activeAgents.length === 0 ? (
              <div className="text-center py-4">
                <Bot className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Nessun agente creato</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">Collega un connettore e crea il tuo primo agente</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {activeAgents.map((a: Agent) => (
                  <Link key={a.id} to={`agents/${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}/instructions`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg no-underline text-inherit transition-all hover:bg-white/5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: a.status === "idle" ? "#22c55e" : a.status === "running" ? "#f59e0b" : "#6b7280" }} />
                    <span className="text-xs font-medium flex-1 truncate">{a.name}</span>
                    <span className="text-[10px] text-muted-foreground">{a.title || a.role}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Catalog quick view */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Catalogo ({productsList.length})</h2>
              <Link to="company/settings#catalogo" className="text-[10px] text-muted-foreground hover:text-white no-underline flex items-center gap-0.5">
                Gestisci <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {categories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat: string) => {
                  const count = productsList.filter((p: any) => p.category === cat).length;
                  return (
                    <span key={cat} className="px-2 py-0.5 rounded-lg text-[10px] font-medium" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}>
                      {cat} ({count})
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/50">Nessun prodotto nel catalogo</p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Chat with CEO */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ultime Conversazioni CEO</h2>
              <Link to="chat" className="text-[10px] text-muted-foreground hover:text-white no-underline flex items-center gap-0.5">
                Apri Chat <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {lastMessages.length === 0 ? (
              <div className="text-center py-4">
                <MessageCircle className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Nessuna conversazione</p>
                <Link to="chat" className="text-xs no-underline mt-1 inline-block" style={{ color: "hsl(158 64% 52%)" }}>Inizia a parlare col CEO</Link>
              </div>
            ) : (
              <div className="space-y-1.5">
                {lastMessages.map((m: any, i: number) => (
                  <div key={i} className="flex gap-2 py-1">
                    <div className="w-1 rounded-full shrink-0" style={{ background: m.role === "user" ? "hsl(158 64% 42%)" : "rgba(255,255,255,0.15)" }} />
                    <p className="text-[11px] text-muted-foreground truncate">{m.content?.substring(0, 100)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* A2A Network */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rete A2A</h2>
              <Link to="a2a" className="text-[10px] text-muted-foreground hover:text-white no-underline flex items-center gap-0.5">
                Gestisci <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {a2aProfile ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-xs font-medium">A2A Attiva</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  La tua azienda è visibile nella directory. Altre aziende possono trovarti e inviarti richieste.
                </p>
              </div>
            ) : (
              <div className="text-center py-4">
                <Network className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Rete A2A non attiva</p>
                <Link to="a2a" className="text-xs no-underline mt-1 inline-block" style={{ color: "hsl(158 64% 52%)" }}>Attiva A2A</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
