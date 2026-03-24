import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PluginRecord } from "@goitalia/shared";
import { Link } from "@/lib/router";
import { AlertTriangle, Plus, Power, Puzzle, Settings, Trash } from "lucide-react";
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

  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch("/api/oauth/google/status?companyId=" + selectedCompany?.id, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setGoogleStatus(data))
      .catch(() => setGoogleStatus({ connected: false }));
  }, [selectedCompany?.id]);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Impresa", href: "/dashboard" },
      { label: "Plugin" },
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

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Puzzle className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Gestione Plugin</h1>
        </div>

        <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
          <DialogTrigger asChild>
            <button
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all"
              style={{
                background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
                boxShadow: "0 4px 20px hsl(158 64% 42% / 0.3)",
              }}
            >
              <Plus className="h-4 w-4" />
              Installa Plugin
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Installa Plugin</DialogTitle>
              <DialogDescription>Inserisci il nome del pacchetto npm del plugin.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="packageName">Nome pacchetto npm</Label>
                <Input
                  id="packageName"
                  placeholder="@goitalia/plugin-esempio"
                  value={installPackage}
                  onChange={(e) => setInstallPackage(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInstallDialogOpen(false)}>Annulla</Button>
              <Button
                onClick={() => installMutation.mutate({ packageName: installPackage })}
                disabled={!installPackage || installMutation.isPending}
              >
                {installMutation.isPending ? "Installazione..." : "Installa"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Connettori */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Connettori</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Google Workspace */}
          <div className={glass.card} style={glass.cardStyle}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">Google Workspace</div>
                <div className="text-xs text-muted-foreground">Gmail, Calendar, Drive, Docs, Sheets</div>
              </div>
            </div>
            {googleStatus?.connected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">Connesso</span>
                </div>
                {(googleStatus.accounts || [googleStatus.email]).map((email) => (
                  <div key={email} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                      <span>{email}</span>
                    </div>
                    <button
                      className="text-red-400/50 hover:text-red-400 transition-colors"
                      onClick={async () => {
                        await fetch("/api/oauth/google/disconnect?companyId=" + selectedCompany?.id + "&email=" + encodeURIComponent(email as string), { credentials: "include" });
                        const newAccounts = (googleStatus.accounts || []).filter((a) => a !== email);
                        setGoogleStatus(newAccounts.length > 0 ? { connected: true, email: newAccounts[0], accounts: newAccounts } : { connected: false });
                      }}
                      title="Disconnetti questo account"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className="text-xs px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.8)" }}
                  onClick={() => {
                    setGoogleLoading(true);
                    window.location.href = "/api/oauth/google/connect?companyId=" + selectedCompany?.id + "&prefix=" + (selectedCompany?.issuePrefix || "");
                  }}
                >
                  + Aggiungi account
                </button>
              </div>
            ) : (
              <button
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: "linear-gradient(135deg, rgba(66, 133, 244, 0.2), rgba(66, 133, 244, 0.1))",
                  border: "1px solid rgba(66, 133, 244, 0.3)",
                  color: "rgba(255,255,255,0.9)",
                }}
                onClick={() => {
                  setGoogleLoading(true);
                  window.location.href = "/api/oauth/google/connect?companyId=" + selectedCompany?.id + "&prefix=" + (selectedCompany?.issuePrefix || "");
                }}
                disabled={googleLoading}
              >
                {googleLoading ? "Connessione..." : "Collega Google"}
              </button>
            )}
          </div>

          {/* Placeholder per futuri connettori */}
          <div className={glass.card} style={{ ...glass.cardStyle, opacity: 0.5 }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <Plus className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-muted-foreground">Prossimamente</div>
                <div className="text-xs text-muted-foreground">Microsoft 365, Slack, HubSpot...</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Plugin installati */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Puzzle className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Plugin Installati</h2>
        </div>

        {!installedPlugins.length ? (
          <div className="glass-card px-5 py-5">
            <div className="flex flex-col items-center justify-center py-8">
              <Puzzle className="h-10 w-10 text-muted-foreground/40 mb-4" />
              <p className="text-sm font-medium">Nessun plugin installato</p>
              <p className="text-xs text-muted-foreground mt-1">Installa un plugin per estendere le funzionalità.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {installedPlugins.map((plugin) => (
              <div key={plugin.id} className="glass-card px-5 py-5">
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/plugins/${plugin.id}`}
                        className="font-medium hover:underline truncate"
                      >
                        {plugin.manifestJson.displayName ?? plugin.packageName}
                      </Link>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{plugin.packageName} · v{plugin.manifestJson.version ?? plugin.version}</p>
                    <p className="text-sm text-muted-foreground truncate mt-1">{plugin.manifestJson.description || "Nessuna descrizione."}</p>

                    {plugin.status === "error" && (
                      <div className="mt-3 rounded-xl px-3 py-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-red-400">Errore plugin</p>
                            <p className="text-xs text-red-300/80 mt-1 break-words">{getPluginErrorSummary(plugin)}</p>
                          </div>
                          <button
                            onClick={() => setErrorDetailsPlugin(plugin)}
                            className="text-xs text-red-400 hover:text-red-300 shrink-0 underline"
                          >
                            Dettagli
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={plugin.status === "ready" ? "default" : plugin.status === "error" ? "destructive" : "secondary"}
                      className={cn("shrink-0", plugin.status === "ready" ? "bg-green-600 hover:bg-green-700" : "")}
                    >
                      {plugin.status === "ready" ? "attivo" : plugin.status === "error" ? "errore" : plugin.status}
                    </Badge>
                    <button
                      title={plugin.status === "ready" ? "Disattiva" : "Attiva"}
                      onClick={() => plugin.status === "ready" ? disableMutation.mutate(plugin.id) : enableMutation.mutate(plugin.id)}
                      disabled={enableMutation.isPending || disableMutation.isPending}
                      className="h-8 w-8 flex items-center justify-center rounded-lg transition-colors"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      <Power className={cn("h-4 w-4", plugin.status === "ready" ? "text-green-400" : "text-muted-foreground")} />
                    </button>
                    <button
                      title="Disinstalla"
                      onClick={() => { setUninstallPluginId(plugin.id); setUninstallPluginName(plugin.manifestJson.displayName ?? plugin.packageName); }}
                      disabled={uninstallMutation.isPending}
                      className="h-8 w-8 flex items-center justify-center rounded-lg transition-colors"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      <Trash className="h-4 w-4 text-red-400" />
                    </button>
                  </div>
                </div>

                <div className="flex justify-end mt-2">
                  <Link
                    to={`/plugins/${plugin.id}`}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "hsl(158 64% 52%)" }}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Configura
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
