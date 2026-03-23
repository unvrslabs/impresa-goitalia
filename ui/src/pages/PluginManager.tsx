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

      {/* Plugin installati */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Puzzle className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Plugin Installati</h2>
        </div>

        {!installedPlugins.length ? (
          <div className={glass.card} style={glass.cardStyle}>
            <div className="flex flex-col items-center justify-center py-8">
              <Puzzle className="h-10 w-10 text-muted-foreground/40 mb-4" />
              <p className="text-sm font-medium">Nessun plugin installato</p>
              <p className="text-xs text-muted-foreground mt-1">Installa un plugin per estendere le funzionalità.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {installedPlugins.map((plugin) => (
              <div key={plugin.id} className={glass.card} style={glass.cardStyle}>
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
