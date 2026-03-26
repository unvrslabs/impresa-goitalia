import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PluginRecord } from "@goitalia/shared";
import { Link } from "@/lib/router";
import { AlertTriangle, ChevronDown, Globe, Plus, Power, Puzzle, Settings, Trash } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";

const glass = {
  card: "rounded-2xl px-5 py-5",
  cardStyle: {
    background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.01) 100%)",
    border: "1px solid rgba(255,255,255,0.1)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
  } as React.CSSProperties,
};

function firstNonEmptyLine(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.split(/\r?\n/).map((e) => e.trim()).find(Boolean) ?? null;
}

function getPluginErrorSummary(plugin: PluginRecord): string {
  return firstNonEmptyLine(plugin.lastError) ?? "Errore sconosciuto.";
}

export function PluginManager() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [installPackage, setInstallPackage] = useState("");
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [uninstallPluginId, setUninstallPluginId] = useState<string | null>(null);
  const [uninstallPluginName, setUninstallPluginName] = useState("");
  const [errorDetailsPlugin, setErrorDetailsPlugin] = useState<PluginRecord | null>(null);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; email?: string; accounts?: string[] } | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<{ connected: boolean; bots?: Array<{ username: string; name: string }> } | null>(null);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [showTelegramForm, setShowTelegramForm] = useState(false);
  const [waStatus, setWaStatus] = useState<{ connected: boolean; status?: string; numbers?: Array<{ phoneNumber: string }> } | null>(null);
  const [waAutoReply, setWaAutoReply] = useState<Record<string, boolean>>({});
  const [waPhone, setWaPhone] = useState("");
  const [waConnecting, setWaConnecting] = useState(false);
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [showWaForm, setShowWaForm] = useState(false);
  const [linkedinStatus, setLinkedinStatus] = useState<{ connected: boolean; name?: string; email?: string } | null>(null);
  const [metaStatus, setMetaStatus] = useState<{ connected: boolean; userName?: string; pages?: Array<{ id: string; name: string }>; instagram?: Array<{ id: string; username: string; pageName: string }> } | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [falConnected, setFalConnected] = useState(false);
  const [falKey, setFalKey] = useState("");
  const [falSaving, setFalSaving] = useState(false);
  const [showVoiceSetup, setShowVoiceSetup] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [telegramAutoReply, setTelegramAutoReply] = useState<Record<string, boolean>>({});
  const [ficConnected, setFicConnected] = useState(false);
  const [ficToken, setFicToken] = useState("");
  const [ficSaving, setFicSaving] = useState(false);
  const [oaiConnected, setOaiConnected] = useState(false);
  const [oaiServices, setOaiServices] = useState<string[]>([]);
  const [oaiKey, setOaiKey] = useState("");
  const [oaiTokens, setOaiTokens] = useState<Record<string, string>>({ company: "", risk: "", cap: "", sdi: "", visure: "" });
  const [oaiSaving, setOaiSaving] = useState(false);
  const [ficCompany, setFicCompany] = useState<string | null>(null);
  const [expandedConnector, setExpandedConnector] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch("/api/oauth/google/status?companyId=" + selectedCompany?.id, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setGoogleStatus(data))
      .catch(() => setGoogleStatus({ connected: false }));
  }, [selectedCompany?.id]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch("/api/telegram/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setTelegramStatus(d))
      .catch(() => setTelegramStatus({ connected: false }));
    fetch("/api/fal/status?companyId=" + selectedCompany.id, { credentials: "include" }).then((r) => r.json()).then((d) => setFalConnected(d.connected)).catch(() => {});
    fetch("/api/fic/status?companyId=" + selectedCompany.id, { credentials: "include" }).then((r) => r.json()).then((d) => { setFicConnected(d.connected || false); setFicCompany(d.companyName || null); }).catch(() => {});
    fetch("/api/openapi-it/status?companyId=" + selectedCompany.id, { credentials: "include" }).then((r) => r.json()).then((d) => { setOaiConnected(d.connected || false); setOaiServices(d.services || []); }).catch(() => {});
    fetch("/api/voice/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setVoiceEnabled(d.enabled || false))
      .catch(() => {});
    fetch("/api/whatsapp/settings?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { const m: Record<string, boolean> = {}; for (const [k, v] of Object.entries(d.numbers || {})) { m[k] = (v as any).autoReply || false; } setWaAutoReply(m); })
      .catch(() => {});
    fetch("/api/oauth/linkedin/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setLinkedinStatus(d))
      .catch(() => setLinkedinStatus({ connected: false }));
    fetch("/api/oauth/meta/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setMetaStatus(d))
      .catch(() => setMetaStatus({ connected: false }));
    fetch("/api/whatsapp/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setWaStatus(d))
      .catch(() => setWaStatus({ connected: false }));
    fetch("/api/telegram/settings?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { const bots = d.bots || {}; const map: Record<string, boolean> = {}; for (const [k, v] of Object.entries(bots)) { map[k] = (v as any).autoReply || false; } setTelegramAutoReply(map); })
      .catch(() => {});
  }, [selectedCompany?.id]);

  // Poll WhatsApp status while QR is shown
  useEffect(() => {
    if (!waQrCode || !selectedCompany?.id) return;
    const poll = setInterval(async () => {
      try {
        const r = await fetch("/api/whatsapp/status?companyId=" + selectedCompany.id, { credentials: "include" });
        const d = await r.json();
        if (d.connected) {
          setWaStatus(d);
          setWaQrCode(null);
          clearInterval(poll);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(poll);
  }, [waQrCode, selectedCompany?.id]);

  // Auto-refresh QR every 40 seconds while showing
  useEffect(() => {
    if (!waQrCode || !selectedCompany?.id) return;
    const refresh = setInterval(async () => {
      try {
        const r = await fetch("/api/whatsapp/qr?companyId=" + selectedCompany.id, { credentials: "include" });
        const d = await r.json();
        if (d.qrCode) setWaQrCode(d.qrCode);
      } catch {}
    }, 40000);
    return () => clearInterval(refresh);
  }, [waQrCode, selectedCompany?.id]);

  const connectTelegram = async () => {
    if (!selectedCompany?.id || !telegramToken) return;
    setTelegramConnecting(true);
    try {
      const res = await fetch("/api/telegram/connect", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, token: telegramToken }),
      });
      const data = await res.json();
      if (res.ok) {
        setTelegramStatus({ connected: true, bots: [...(telegramStatus?.bots || []), { username: data.username, name: data.name }] });
        setShowTelegramForm(false); setTelegramToken("");
      }
    } catch {}
    setTelegramConnecting(false);
  };

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Impresa", href: "/dashboard" },
      { label: "Connettori" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const { data: plugins, isLoading, error } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.examples });
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.uiContributions });
  };

  const installMutation = useMutation({
    mutationFn: (params: { packageName: string; version?: string; isLocalPath?: boolean }) => pluginsApi.install(params),
    onSuccess: () => { invalidate(); setInstallDialogOpen(false); setInstallPackage(""); pushToast({ title: "Plugin installato", tone: "success" }); },
    onError: (err: Error) => { pushToast({ title: "Installazione fallita", body: err.message, tone: "error" }); },
  });

  const uninstallMutation = useMutation({
    mutationFn: (id: string) => pluginsApi.uninstall(id),
    onSuccess: () => { invalidate(); pushToast({ title: "Plugin disinstallato", tone: "success" }); },
    onError: (err: Error) => { pushToast({ title: "Disinstallazione fallita", body: err.message, tone: "error" }); },
  });

  const enableMutation = useMutation({
    mutationFn: (id: string) => pluginsApi.enable(id),
    onSuccess: () => { invalidate(); pushToast({ title: "Plugin attivato", tone: "success" }); },
    onError: (err: Error) => { pushToast({ title: "Attivazione fallita", body: err.message, tone: "error" }); },
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => pluginsApi.disable(id),
    onSuccess: () => { invalidate(); pushToast({ title: "Plugin disattivato", tone: "info" }); },
    onError: (err: Error) => { pushToast({ title: "Disattivazione fallita", body: err.message, tone: "error" }); },
  });

  const installedPlugins = plugins ?? [];

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Caricamento plugin...</div>;
  if (error) return <div className="p-4 text-sm text-destructive">Errore nel caricamento dei plugin.</div>;

  const toggle = (id: string) => setExpandedConnector(expandedConnector === id ? null : id);

  const isGoogleConnected = googleStatus?.connected ?? false;
  const isTelegramConnected = !!(telegramStatus?.connected && telegramStatus.bots?.length);
  const isWaConnected = !!(waStatus?.connected && waStatus.numbers?.length);
  const isMetaConnected = metaStatus?.connected ?? false;
  const isLinkedinConnected = linkedinStatus?.connected ?? false;
  const isVoiceConnected = voiceEnabled;
  const isFalConnected = falConnected;
  const isFicConnected = ficConnected;
  const isOaiConnected = oaiConnected;


  // Uniform row style for sub-items
  const row = "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs";
  const rowBg = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as React.CSSProperties;
  const greenDot = <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />;
  const toggleBtn = (active: boolean, onClick: () => void) => (
    <button onClick={onClick} style={{ width: 36, height: 20, minWidth: 36, borderRadius: 10, background: active ? "#16a34a" : "rgba(255,255,255,0.1)", position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0, transition: "background 0.2s", border: "none", cursor: "pointer", padding: 0 }}>
      <span style={{ width: 14, height: 14, borderRadius: 7, background: "white", position: "absolute", left: active ? 19 : 3, transition: "left 0.2s" }} />
    </button>
  );
  const actionRow = "flex items-center gap-2 pt-2";
  const actionBtn = (label: string, onClick: () => void, style?: React.CSSProperties) => (
    <button onClick={onClick} className="text-xs px-3 py-1.5 rounded-lg transition-all" style={style || { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>{label}</button>
  );
  const agentBtn = (msg: string) => (
    <a href={"/" + (selectedCompany?.issuePrefix || "") + "/chat?msg=" + encodeURIComponent(msg)} className="text-xs px-3 py-1.5 rounded-lg transition-all no-underline" style={{ background: "linear-gradient(135deg, hsl(158 64% 42% / 0.15), hsl(158 64% 42% / 0.08))", border: "1px solid hsl(158 64% 42% / 0.25)", color: "rgba(255,255,255,0.7)" }}>Crea agente</a>
  );
  const connectBtn = (label: string, onClick: () => void) => (
    <button onClick={onClick} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all mt-1" style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}>{label}</button>
  );
  // Platform mini icons for rows
  const miniGoogle = <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>;
  const miniTg = <svg width="14" height="14" viewBox="0 0 24 24" fill="#0088cc"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>;
  const miniWa = <svg width="14" height="14" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>;
  const miniIg = <svg width="14" height="14" viewBox="0 0 24 24" fill="url(#ig-r)"><defs><linearGradient id="ig-r" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#feda75"/><stop offset="50%" stopColor="#d62976"/><stop offset="100%" stopColor="#4f5bd5"/></linearGradient></defs><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8z"/></svg>;
  const miniFb = <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
  const miniLi = <svg width="14" height="14" viewBox="0 0 24 24" fill="#0077B5"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>;

  const xIcon = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Puzzle className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Connettori</h1>
      </div>

      {/* Connector list */}
      <div className="space-y-1">

        {/* 1. Google Workspace */}
        <div className="rounded-xl overflow-hidden" style={glass.cardStyle}>
          <button onClick={() => toggle("google")} className="w-full px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium">Google Workspace</div>
              <div className="text-xs text-muted-foreground">Gmail, Calendar, Drive, Docs, Sheets</div>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0", isGoogleConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30")}>
              {isGoogleConnected ? "Connesso" : "Non connesso"}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expandedConnector === "google" && "rotate-180")} />
          </button>
          {expandedConnector === "google" && (
            <div className="px-4 pb-3 space-y-2 border-t border-white/5">
              {isGoogleConnected ? (
                <>
                  {(googleStatus!.accounts || [googleStatus!.email]).map((email) => (
                    <div key={email} className={row} style={rowBg}>
                      {greenDot}
                      {miniGoogle}
                      <span className="flex-1 truncate">{email}</span>
                      <button className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-all shrink-0" onClick={async () => {
                        await fetch("/api/oauth/google/disconnect?companyId=" + selectedCompany?.id + "&email=" + encodeURIComponent(email as string), { credentials: "include" });
                        const newAccounts = (googleStatus!.accounts || []).filter((a) => a !== email);
                        setGoogleStatus(newAccounts.length > 0 ? { connected: true, email: newAccounts[0], accounts: newAccounts } : { connected: false });
                      }} title="Disconnetti">{xIcon}</button>
                    </div>
                  ))}
                  <div className={actionRow}>
                    {actionBtn("+ Aggiungi account", () => { setGoogleLoading(true); window.location.href = "/api/oauth/google/connect?companyId=" + selectedCompany?.id + "&prefix=" + (selectedCompany?.issuePrefix || ""); })}
                    {agentBtn("Ho collegato Google Workspace. Crea un agente per gestire le email.")}
                  </div>
                </>
              ) : (
                <button
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all mt-2"
                  style={{ background: "linear-gradient(135deg, rgba(66, 133, 244, 0.2), rgba(66, 133, 244, 0.1))", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}
                  onClick={() => {
                    setGoogleLoading(true);
                    window.location.href = "/api/oauth/google/connect?companyId=" + selectedCompany?.id + "&prefix=" + (selectedCompany?.issuePrefix || "");
                  }}
                  disabled={googleLoading}
                >{googleLoading ? "Connessione..." : "Collega Google"}</button>
              )}
            </div>
          )}
        </div>

        {/* 2. Telegram */}
        <div className="rounded-xl overflow-hidden" style={glass.cardStyle}>
          <button onClick={() => toggle("telegram")} className="w-full px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0, 136, 204, 0.15)", border: "1px solid rgba(0, 136, 204, 0.3)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#0088cc"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium">Telegram</div>
              <div className="text-xs text-muted-foreground">Bot multi-account via @BotFather</div>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0", isTelegramConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30")}>
              {isTelegramConnected ? "Connesso" : "Non connesso"}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expandedConnector === "telegram" && "rotate-180")} />
          </button>
          {expandedConnector === "telegram" && (
            <div className="px-4 pb-3 space-y-2 border-t border-white/5">
              {isTelegramConnected ? (
                <>
                  {telegramStatus!.bots!.map((bot) => (
                    <div key={bot.username} className={row} style={rowBg}>
                      {greenDot}
                      {miniTg}
                      <span className="flex-1 truncate">@{bot.username}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <a href={"/" + (selectedCompany?.issuePrefix || "") + "/chat?msg=" + encodeURIComponent("Ho collegato il bot Telegram @" + bot.username + ". Crea un agente dedicato per rispondere ai messaggi di questo bot.")} className="text-[10px] px-2 py-0.5 rounded-md no-underline shrink-0" style={{ background: "hsl(158 64% 42% / 0.12)", border: "1px solid hsl(158 64% 42% / 0.2)", color: "hsl(158 64% 62%)" }}>Crea agente</a>
                        <button
                          onClick={async () => {
                            const newVal = !telegramAutoReply[bot.username];
                            setTelegramAutoReply({ ...telegramAutoReply, [bot.username]: newVal });
                            await fetch("/api/telegram/settings", {
                              method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                              body: JSON.stringify({ companyId: selectedCompany?.id, autoReply: newVal, botUsername: bot.username }),
                            });
                          }}
                          style={{ width: 36, height: 20, minWidth: 36, borderRadius: 10, background: telegramAutoReply[bot.username] ? "#16a34a" : "rgba(255,255,255,0.1)", position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0, transition: "background 0.2s", border: "none", cursor: "pointer", padding: 0 }}
                        >
                          <span style={{ width: 14, height: 14, borderRadius: 7, background: "white", position: "absolute", left: telegramAutoReply[bot.username] ? 19 : 3, transition: "left 0.2s" }} />
                        </button>
                        <button className="text-red-400/50 hover:text-red-400 transition-colors" onClick={async () => {
                          await fetch("/api/telegram/disconnect?companyId=" + selectedCompany?.id + "&bot=" + bot.username, { method: "POST", credentials: "include" });
                          const newBots = (telegramStatus!.bots || []).filter((b) => b.username !== bot.username);
                          setTelegramStatus(newBots.length > 0 ? { connected: true, bots: newBots } : { connected: false });
                        }} title="Disconnetti">{xIcon}</button>
                      </div>
                    </div>
                  ))}
                  <div className={actionRow}>
                    {actionBtn("+ Aggiungi bot", () => setShowTelegramForm(true))}
                  </div>
                  {showTelegramForm && (
                    <div className="space-y-2 mt-2">
                      <input className="w-full px-3 py-2 rounded-xl border border-white/10 bg-transparent text-xs outline-none" placeholder="Token da @BotFather: 123456:ABC-DEF..." value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} />
                      <div className="flex gap-2">
                        <button onClick={connectTelegram} disabled={telegramConnecting || !telegramToken} className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-40" style={{ background: "rgba(0, 136, 204, 0.2)", border: "1px solid rgba(0, 136, 204, 0.3)", color: "rgba(255,255,255,0.9)" }}>{telegramConnecting ? "Verifica..." : "Collega"}</button>
                        <button onClick={() => setShowTelegramForm(false)} className="text-xs text-muted-foreground">Annulla</button>
                      </div>
                    </div>
                  )}
                </>
              ) : showTelegramForm ? (
                <div className="space-y-2 mt-2">
                  <p className="text-xs text-muted-foreground">Incolla il token del bot da @BotFather</p>
                  <input className="w-full px-3 py-2 rounded-xl border border-white/10 bg-transparent text-xs outline-none" placeholder="123456:ABC-DEF..." value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={connectTelegram} disabled={telegramConnecting || !telegramToken} className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-40" style={{ background: "rgba(0, 136, 204, 0.2)", border: "1px solid rgba(0, 136, 204, 0.3)", color: "rgba(255,255,255,0.9)" }}>{telegramConnecting ? "Verifica..." : "Collega"}</button>
                    <button onClick={() => setShowTelegramForm(false)} className="text-xs text-muted-foreground">Annulla</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowTelegramForm(true)} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all mt-2" style={{ background: "rgba(66, 133, 244, 0.2)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}>Collega Bot Telegram</button>
              )}
            </div>
          )}
        </div>

        {/* 3. WhatsApp */}
        <div className="rounded-xl overflow-hidden" style={glass.cardStyle}>
          <button onClick={() => toggle("whatsapp")} className="w-full px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(37, 211, 102, 0.15)", border: "1px solid rgba(37, 211, 102, 0.3)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium">WhatsApp</div>
              <div className="text-xs text-muted-foreground">Via WaSender, QR code per collegare</div>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0", isWaConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30")}>
              {isWaConnected ? "Connesso" : "Non connesso"}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expandedConnector === "whatsapp" && "rotate-180")} />
          </button>
          {expandedConnector === "whatsapp" && (
            <div className="px-4 pb-3 space-y-2 border-t border-white/5">
              {isWaConnected ? (
                <>
                  {waStatus!.numbers!.map((num) => (
                    <div key={num.phoneNumber} className={row} style={rowBg}>
                      {greenDot}
                      {miniWa}
                      <span className="flex-1 truncate">{num.phoneNumber}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <a href={"/" + (selectedCompany?.issuePrefix || "") + "/chat?msg=" + encodeURIComponent("Ho collegato WhatsApp " + num.phoneNumber + ". Crea un agente dedicato per rispondere ai messaggi di questo numero.")} className="text-[10px] px-2 py-0.5 rounded-md no-underline shrink-0" style={{ background: "hsl(158 64% 42% / 0.12)", border: "1px solid hsl(158 64% 42% / 0.2)", color: "hsl(158 64% 62%)" }}>Crea agente</a>
                        <button
                          onClick={async () => {
                            const newVal = !waAutoReply[num.phoneNumber];
                            setWaAutoReply({ ...waAutoReply, [num.phoneNumber]: newVal });
                            await fetch("/api/whatsapp/settings", {
                              method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                              body: JSON.stringify({ companyId: selectedCompany?.id, autoReply: newVal, phoneNumber: num.phoneNumber }),
                            });
                          }}
                          style={{ width: 36, height: 20, minWidth: 36, borderRadius: 10, background: waAutoReply[num.phoneNumber] ? "#16a34a" : "rgba(255,255,255,0.1)", position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0, transition: "background 0.2s", border: "none", cursor: "pointer", padding: 0 }}
                        >
                          <span style={{ width: 14, height: 14, borderRadius: 7, background: "white", position: "absolute", left: waAutoReply[num.phoneNumber] ? 19 : 3, transition: "left 0.2s" }} />
                        </button>
                        <button className="text-red-400/50 hover:text-red-400 transition-colors" onClick={async () => {
                          await fetch("/api/whatsapp/disconnect?companyId=" + selectedCompany?.id + "&phone=" + encodeURIComponent(num.phoneNumber), { method: "POST", credentials: "include" });
                          const newNums = (waStatus!.numbers || []).filter((n) => n.phoneNumber !== num.phoneNumber);
                          setWaStatus(newNums.length > 0 ? { connected: true, numbers: newNums } : { connected: false });
                        }} title="Disconnetti">{xIcon}</button>
                      </div>
                    </div>
                  ))}
                  <div className={actionRow}>
                    {actionBtn("+ Aggiungi numero", () => setShowWaForm(true))}
                  </div>
                  {showWaForm && (
                    <div className="space-y-2 mt-2">
                      <p className="text-xs text-muted-foreground">Inserisci il numero WhatsApp da collegare</p>
                      <input className="w-full px-3 py-2 rounded-xl border border-white/10 bg-transparent text-xs outline-none" placeholder="+39 333 1234567" value={waPhone} onChange={(e) => setWaPhone(e.target.value)} />
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          setWaConnecting(true);
                          try {
                            const r = await fetch("/api/whatsapp/connect", {
                              method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                              body: JSON.stringify({ companyId: selectedCompany?.id, phoneNumber: waPhone }),
                            });
                            const d = await r.json();
                            if (d.qrCode) { setWaQrCode(d.qrCode); setShowWaForm(false); }
                            else if (d.error) { alert(d.error); }
                          } catch {}
                          setWaConnecting(false);
                        }} disabled={waConnecting || !waPhone} className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-40" style={{ background: "rgba(37, 211, 102, 0.2)", border: "1px solid rgba(37, 211, 102, 0.3)", color: "rgba(255,255,255,0.9)" }}>{waConnecting ? "Connessione..." : "Collega"}</button>
                        <button onClick={() => setShowWaForm(false)} className="text-xs text-muted-foreground">Annulla</button>
                      </div>
                    </div>
                  )}
                </>
              ) : waQrCode ? (
                <div className="space-y-3 mt-2">
                  <p className="text-xs text-muted-foreground">Scansiona il QR code con WhatsApp sul telefono</p>
                  <div className="flex justify-center p-3 bg-white rounded-xl">
                    <img src={"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(waQrCode)} alt="QR Code WhatsApp" className="w-48 h-48" />
                  </div>
                  <p className="text-[10px] text-muted-foreground text-center">Il QR scade ogni 45 secondi. Se non funziona, riprova.</p>
                  <button onClick={async () => {
                    const r = await fetch("/api/whatsapp/qr?companyId=" + selectedCompany?.id, { credentials: "include" });
                    const d = await r.json();
                    if (d.qrCode) setWaQrCode(d.qrCode);
                  }} className="text-xs text-blue-400 hover:underline">Aggiorna QR</button>
                </div>
              ) : showWaForm ? (
                <div className="space-y-2 mt-2">
                  <p className="text-xs text-muted-foreground">Inserisci il numero WhatsApp da collegare</p>
                  <input className="w-full px-3 py-2 rounded-xl border border-white/10 bg-transparent text-xs outline-none" placeholder="+39 333 1234567" value={waPhone} onChange={(e) => setWaPhone(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={async () => {
                      setWaConnecting(true);
                      try {
                        const r = await fetch("/api/whatsapp/connect", {
                          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                          body: JSON.stringify({ companyId: selectedCompany?.id, phoneNumber: waPhone }),
                        });
                        const d = await r.json();
                        if (d.qrCode) { setWaQrCode(d.qrCode); setShowWaForm(false); }
                        else if (d.error) { alert(d.error); }
                      } catch {}
                      setWaConnecting(false);
                    }} disabled={waConnecting || !waPhone} className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-40" style={{ background: "rgba(37, 211, 102, 0.2)", border: "1px solid rgba(37, 211, 102, 0.3)", color: "rgba(255,255,255,0.9)" }}>{waConnecting ? "Connessione..." : "Collega"}</button>
                    <button onClick={() => setShowWaForm(false)} className="text-xs text-muted-foreground">Annulla</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowWaForm(true)} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all mt-2" style={{ background: "rgba(66, 133, 244, 0.2)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}>Collega WhatsApp</button>
              )}
            </div>
          )}
        </div>

        {/* 4. Instagram + Facebook */}
        <div className="rounded-xl overflow-hidden" style={glass.cardStyle}>
          <button onClick={() => toggle("meta")} className="w-full px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(131, 58, 180, 0.15), rgba(253, 29, 29, 0.15), rgba(252, 176, 69, 0.15))", border: "1px solid rgba(253, 29, 29, 0.3)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="url(#ig-grad)"><defs><linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#feda75"/><stop offset="25%" stopColor="#fa7e1e"/><stop offset="50%" stopColor="#d62976"/><stop offset="75%" stopColor="#962fbf"/><stop offset="100%" stopColor="#4f5bd5"/></linearGradient></defs><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium">Instagram + Facebook</div>
              <div className="text-xs text-muted-foreground">Gestisci i tuoi social media</div>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0", isMetaConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30")}>
              {isMetaConnected ? "Connesso" : "Non connesso"}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expandedConnector === "meta" && "rotate-180")} />
          </button>
          {expandedConnector === "meta" && (
            <div className="px-4 pb-3 space-y-2 border-t border-white/5">
              {isMetaConnected ? (
                <>
                  {metaStatus!.instagram?.map((ig) => (
                    <div key={ig.id} className={row} style={rowBg}>
                      {greenDot}
                      {miniIg}
                      <span className="flex-1 truncate">@{ig.username}</span>
                      <span className="text-[10px] text-muted-foreground/40">{ig.pageName}</span>
                    </div>
                  ))}
                  {metaStatus!.pages?.map((p) => (
                    <div key={p.id} className={row} style={rowBg}>
                      {greenDot}
                      {miniFb}
                      <span className="flex-1 truncate">{p.name}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2">
                    {agentBtn("Ho collegato Instagram e Facebook. Crea un agente per gestire i social media.")}
                    <button className="flex items-center gap-1 text-[10px] text-red-400/60 hover:text-red-400 transition-all" onClick={async () => {
                      await fetch("/api/oauth/meta/disconnect?companyId=" + selectedCompany?.id, { method: "POST", credentials: "include" });
                      setMetaStatus({ connected: false });
                    }}>{xIcon} <span>Disconnetti</span></button>
                  </div>
                </>
              ) : (
                <button onClick={() => { window.location.href = "/api/oauth/meta/connect?companyId=" + selectedCompany?.id + "&prefix=" + (selectedCompany?.issuePrefix || ""); }} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all mt-2" style={{ background: "rgba(66, 133, 244, 0.2)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}>Collega Instagram + Facebook</button>
              )}
            </div>
          )}
        </div>

        {/* 5. LinkedIn */}
        <div className="rounded-xl overflow-hidden" style={glass.cardStyle}>
          <button onClick={() => toggle("linkedin")} className="w-full px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0, 119, 181, 0.15)", border: "1px solid rgba(0, 119, 181, 0.3)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#0077B5"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium">LinkedIn</div>
              <div className="text-xs text-muted-foreground">Pubblica e gestisci il profilo LinkedIn</div>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0", isLinkedinConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30")}>
              {isLinkedinConnected ? "Connesso" : "Non connesso"}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expandedConnector === "linkedin" && "rotate-180")} />
          </button>
          {expandedConnector === "linkedin" && (
            <div className="px-4 pb-3 space-y-2 border-t border-white/5">
              {isLinkedinConnected ? (
                <>
                  <div className={row} style={rowBg}>
                    {greenDot}
                    {miniLi}
                    <span className="flex-1 truncate">{linkedinStatus!.name}</span>
                    <button className="flex items-center gap-1 text-[10px] text-red-400/60 hover:text-red-400 transition-all" onClick={async () => {
                      await fetch("/api/oauth/linkedin/disconnect?companyId=" + selectedCompany?.id, { method: "POST", credentials: "include" });
                      setLinkedinStatus({ connected: false });
                    }}>{xIcon} <span>Disconnetti</span></button>
                  </div>
                  <div className={actionRow}>
                    {agentBtn("Ho collegato LinkedIn. Crea un agente per gestire il profilo LinkedIn.")}
                  </div>
                </>
              ) : (
                <button onClick={() => { window.location.href = "/api/oauth/linkedin/connect?companyId=" + selectedCompany?.id + "&prefix=" + (selectedCompany?.issuePrefix || ""); }} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all mt-2" style={{ background: "rgba(66, 133, 244, 0.2)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}>Collega LinkedIn</button>
              )}
            </div>
          )}
        </div>

        {/* 6. Vocali AI */}
        <div className="rounded-xl overflow-hidden" style={glass.cardStyle}>
          <button onClick={() => toggle("voice")} className="w-full px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(34, 197, 94, 0.15)", border: "1px solid rgba(34, 197, 94, 0.3)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium">Vocali AI</div>
              <div className="text-xs text-muted-foreground">Trascrivi vocali WhatsApp e Telegram in testo</div>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0", isVoiceConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30")}>
              {isVoiceConnected ? "Connesso" : "Non connesso"}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expandedConnector === "voice" && "rotate-180")} />
          </button>
          {expandedConnector === "voice" && (
            <div className="px-4 pb-3 space-y-2 border-t border-white/5">
              <p className="text-xs text-muted-foreground pt-1">Trascrive automaticamente i messaggi vocali ricevuti su WhatsApp e Telegram in testo, usando OpenAI Whisper.</p>
              {isVoiceConnected ? (
                <div className="space-y-2">
                  <div className={row} style={rowBg}>
                    {greenDot}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                    <span className="flex-1 text-xs">OpenAI Whisper — Attivo</span>
                    <button className="flex items-center gap-1 text-[10px] text-red-400/60 hover:text-red-400 transition-all" onClick={async () => { await fetch("/api/voice/key?companyId=" + selectedCompany?.id, { method: "DELETE", credentials: "include" }); setVoiceEnabled(false); }}>{xIcon} <span>Disattiva</span></button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1.5 block">API Key OpenAI</label>
                    <input type="password" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-transparent text-xs outline-none" placeholder="sk-..." value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground mt-1">Ottieni la key da <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">platform.openai.com/api-keys</a> · Costo: ~$0.006/min</p>
                  </div>
                  <button onClick={async () => {
                    if (!openaiKey.startsWith("sk-")) return;
                    setVoiceSaving(true);
                    try {
                      const r = await fetch("/api/voice/save-key", {
                        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                        body: JSON.stringify({ companyId: selectedCompany?.id, apiKey: openaiKey }),
                      });
                      if (r.ok) { setVoiceEnabled(true); setOpenaiKey(""); }
                    } catch {}
                    setVoiceSaving(false);
                  }} disabled={voiceSaving || !openaiKey.startsWith("sk-")} className="px-4 py-2 rounded-xl text-xs font-medium disabled:opacity-40 transition-all" style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}>{voiceSaving ? "Verifica..." : "Attiva trascrizione vocali"}</button>
                </div>
              )}
            </div>
          )}
        </div>


        {/* 7. Fal.ai */}
        <div className="rounded-xl overflow-hidden" style={glass.cardStyle}>
          <button onClick={() => toggle("fal")} className="w-full px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(168, 85, 247, 0.15)", border: "1px solid rgba(168, 85, 247, 0.3)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium">Fal.ai</div>
              <div className="text-xs text-muted-foreground">Genera immagini e video con AI</div>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0", isFalConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30")}>
              {isFalConnected ? "Connesso" : "Non connesso"}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expandedConnector === "fal" && "rotate-180")} />
          </button>
          {expandedConnector === "fal" && (
            <div className="px-4 pb-3 space-y-2 border-t border-white/5">
              <p className="text-xs text-muted-foreground pt-1">Genera immagini e video con AI. Ottieni la key da <a href="https://Fal.ai/dashboard/keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Fal.ai/dashboard/keys</a></p>
              {isFalConnected ? (
                <div className="space-y-2">
                  <div className={row} style={rowBg}>
                    {greenDot}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                    <span className="flex-1 text-xs">Fal.ai — 11 modelli AI</span>
                    <button className="flex items-center gap-1 text-[10px] text-red-400/60 hover:text-red-400 transition-all" onClick={async () => { await fetch("/api/fal/key?companyId=" + selectedCompany?.id, { method: "DELETE", credentials: "include" }); setFalConnected(false); }}>{xIcon} <span>Disconnetti</span></button>
                  </div>
                  <div className={actionRow}>
                    {agentBtn("Ho collegato Fal.ai per la generazione di contenuti. Crea un agente specializzato in generazione immagini e video con AI.")}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1.5 block">API Key Fal.ai</label>
                    <input type="password" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-transparent text-xs outline-none" placeholder="Incolla la tua Fal.ai API key" value={falKey} onChange={(e) => setFalKey(e.target.value)} />
                  </div>
                  <button onClick={async () => {
                    if (!falKey) return;
                    setFalSaving(true);
                    try {
                      const r = await fetch("/api/fal/save-key", {
                        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                        body: JSON.stringify({ companyId: selectedCompany?.id, apiKey: falKey }),
                      });
                      if (r.ok) { setFalConnected(true); setFalKey(""); }
                      else { const d = await r.json(); alert(d.error || "Errore"); }
                    } catch {}
                    setFalSaving(false);
                  }} disabled={falSaving || !falKey} className="px-4 py-2 rounded-xl text-xs font-medium disabled:opacity-40 transition-all" style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}>{falSaving ? "Verifica..." : "Collega Fal.ai"}</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 8. Fatture in Cloud */}
        <div className="rounded-xl overflow-hidden" style={glass.cardStyle}>
          <button onClick={() => toggle("fic")} className="w-full px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(59, 130, 246, 0.15)", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium">Fatture in Cloud</div>
              <div className="text-xs text-muted-foreground">Fatturazione elettronica, clienti, SDI</div>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0", isFicConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30")}>
              {isFicConnected ? "Connesso" : "Non connesso"}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expandedConnector === "fic" && "rotate-180")} />
          </button>
          {expandedConnector === "fic" && (
            <div className="px-4 pb-3 space-y-2 border-t border-white/5">
              {isFicConnected ? (
                <div className="space-y-2">
                  <div className={row} style={rowBg}>
                    {greenDot}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span className="flex-1 text-xs">{ficCompany || "Fatture in Cloud"}</span>
                    <button className="flex items-center gap-1 text-[10px] text-red-400/60 hover:text-red-400 transition-all" onClick={async () => { await fetch("/api/fic/disconnect?companyId=" + selectedCompany?.id, { method: "POST", credentials: "include" }); setFicConnected(false); setFicCompany(null); }}>{xIcon} <span>Disconnetti</span></button>
                  </div>
                  <div className={actionRow}>
                    {agentBtn("Ho collegato Fatture in Cloud. Crea un agente per gestire la fatturazione elettronica, emettere fatture e monitorare i pagamenti.")}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1.5 block">Token personale Fatture in Cloud</label>
                    <input type="password" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-transparent text-xs outline-none" placeholder="Incolla il token personale da Fatture in Cloud" value={ficToken} onChange={(e) => setFicToken(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground mt-1">Genera il token da <a href="https://secure.fattureincloud.it/settings/developers" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Impostazioni &gt; Sviluppatore</a> &gt; Token personale</p>
                  </div>
                  <button onClick={async () => {
                    if (!ficToken) return;
                    setFicSaving(true);
                    try {
                      const r = await fetch("/api/fic/save-token", {
                        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                        body: JSON.stringify({ companyId: selectedCompany?.id, accessToken: ficToken }),
                      });
                      const d = await r.json();
                      if (r.ok) { setFicConnected(true); setFicToken(""); }
                      else { alert(d.error || "Errore"); }
                    } catch {}
                    setFicSaving(false);
                  }} disabled={ficSaving || !ficToken} className="px-4 py-2 rounded-xl text-xs font-medium disabled:opacity-40 transition-all" style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}>{ficSaving ? "Verifica..." : "Collega Fatture in Cloud"}</button>
                </div>
              )}
            </div>
          )}
        </div>



        {/* 9. OpenAPI.it */}
        <div className="rounded-xl overflow-hidden" style={glass.cardStyle}>
          <button onClick={() => toggle("openapi")} className="w-full px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(59, 130, 246, 0.15)", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
              <Globe className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium">OpenAPI.it</div>
              <div className="text-xs text-muted-foreground">Dati aziendali, visure, risk, CAP, SDI</div>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0", isOaiConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30")}>
              {isOaiConnected ? "Connesso" : "Non connesso"}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expandedConnector === "openapi" && "rotate-180")} />
          </button>
          {expandedConnector === "openapi" && (
            <div className="px-4 pb-3 space-y-3 border-t border-white/5">
              <p className="text-xs text-muted-foreground pt-2">Registrati su <a href="https://console.openapi.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">console.openapi.com</a> — 1 API key + 1 token per ogni servizio che usi.</p>
              {!isOaiConnected && (
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1.5 block">API Key</label>
                  <input type="password" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-transparent text-xs outline-none" placeholder="API Key da console.openapi.com/autenticazione" value={oaiKey} onChange={(e) => setOaiKey(e.target.value)} />
                </div>
              )}
              {[
                { key: "company", label: "Company", desc: "Dati aziendali, P.IVA, Visure" },
                { key: "risk", label: "Risk", desc: "Credit score, Rating" },
                { key: "cap", label: "CAP", desc: "Codici postali" },
                { key: "sdi", label: "SDI", desc: "Fatturazione elettronica" },
                { key: "visure", label: "Visure Camerali", desc: "Visure da Camera di Commercio" },
                { key: "pec", label: "PEC", desc: "Gestione caselle PEC certificate" },
              ].map((svc) => {
                const isActive = oaiServices.includes(svc.key);
                return (
                  <div key={svc.key} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <span className={"w-2 h-2 rounded-full shrink-0 " + (isActive ? "bg-green-500" : "bg-white/20")} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{svc.label}</span>
                      <span className="text-muted-foreground ml-1.5">{svc.desc}</span>
                    </div>
                    {isActive ? (
                      <button className="flex items-center gap-1 text-[10px] text-red-400/60 hover:text-red-400 transition-all" onClick={async () => {
                        await fetch("/api/openapi-it/remove-service", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: selectedCompany?.id, service: svc.key }), credentials: "include" });
                        setOaiServices((prev) => prev.filter((s) => s !== svc.key));
                        if (oaiServices.length <= 1) setOaiConnected(false);
                      }}>{xIcon} <span>Rimuovi</span></button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input type="password" className="w-40 px-2.5 py-1.5 rounded-lg border border-white/10 bg-transparent text-[11px] outline-none" placeholder="Token" value={oaiTokens[svc.key] || ""} onChange={(e) => setOaiTokens((prev) => ({ ...prev, [svc.key]: e.target.value }))} />
                        <button onClick={async () => {
                          const tok = oaiTokens[svc.key];
                          if (!tok) return;
                          const apiKeyToSend = isOaiConnected ? "_existing_" : oaiKey;
                          if (!apiKeyToSend) { alert("Inserisci prima la API Key"); return; }
                          setOaiSaving(true);
                          try {
                            const r = await fetch("/api/openapi-it/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: selectedCompany?.id, apiKey: apiKeyToSend, tokens: { [svc.key]: tok } }), credentials: "include" });
                            const d = await r.json();
                            if (d.connected) { setOaiConnected(true); setOaiServices(d.services || []); setOaiTokens((prev) => ({ ...prev, [svc.key]: "" })); setOaiKey(""); }
                            else alert(d.error || "Errore");
                          } catch { alert("Errore"); } finally { setOaiSaving(false); }
                        }} disabled={oaiSaving || !oaiTokens[svc.key]} className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium disabled:opacity-40 transition-all" style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.9)" }}>Aggiungi</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {isOaiConnected && (
                <div className={actionRow}>
                  {agentBtn("Ho collegato OpenAPI.it con i servizi: " + oaiServices.join(", ") + ". Crea un agente specializzato in analisi aziende, visure e due diligence.")}
                </div>
              )}
            </div>
          )}
        </div>
        {/* 9. Prossimamente */}
        <div className="rounded-xl overflow-hidden" style={{ ...glass.cardStyle, opacity: 0.5 }}>
          <div className="w-full px-4 py-3 flex items-center gap-3 cursor-default">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <Plus className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium text-muted-foreground">Prossimamente</div>
              <div className="text-xs text-muted-foreground">Microsoft 365, Slack, HubSpot...</div>
            </div>
          </div>
        </div>

      </div>

      {/* Uninstall dialog */}
      <Dialog open={uninstallPluginId !== null} onOpenChange={(open) => { if (!open) setUninstallPluginId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disinstalla Plugin</DialogTitle>
            <DialogDescription>
              Sei sicuro di voler disinstallare <strong>{uninstallPluginName}</strong>? Questa azione non può essere annullata.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUninstallPluginId(null)}>Annulla</Button>
            <Button
              variant="destructive"
              disabled={uninstallMutation.isPending}
              onClick={() => {
                if (uninstallPluginId) {
                  uninstallMutation.mutate(uninstallPluginId, { onSettled: () => setUninstallPluginId(null) });
                }
              }}
            >
              {uninstallMutation.isPending ? "Disinstallazione..." : "Disinstalla"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error details dialog */}
      <Dialog open={errorDetailsPlugin !== null} onOpenChange={(open) => { if (!open) setErrorDetailsPlugin(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Dettagli Errore</DialogTitle>
            <DialogDescription>
              {errorDetailsPlugin?.manifestJson.displayName ?? errorDetailsPlugin?.packageName ?? "Plugin"} ha riscontrato un errore.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <pre className="max-h-[50vh] overflow-auto rounded-xl p-3 text-xs leading-5 whitespace-pre-wrap break-words" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
              {errorDetailsPlugin?.lastError ?? "Nessun messaggio di errore."}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErrorDetailsPlugin(null)}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
