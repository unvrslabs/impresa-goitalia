import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, User, ToggleLeft, ToggleRight, Check, X, CalendarClock } from "lucide-react";
import { routinesApi } from "../api/routines";
import { api } from "../api/client";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";

interface PendingRun {
  id: string;
  routineId: string;
  routineName: string;
  agentName?: string;
  status: string;
  createdAt: string;
  content?: string;
}

type TabKey = "all" | "pending";

export function ScheduledActivities() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [now, setNow] = useState(Date.now());

  // Countdown timer - must be before any conditional returns
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const routinesQuery = useQuery({
    queryKey: [...queryKeys.routines.list(selectedCompanyId || ""), "scheduled"],
    queryFn: () => routinesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const pendingQuery = useQuery({
    queryKey: ["pending-runs", selectedCompanyId],
    queryFn: () => api.get<PendingRun[]>(`/routines/pending?companyId=${selectedCompanyId}`),
    enabled: !!selectedCompanyId && activeTab === "pending",
  });

  const toggleApproval = useMutation({
    mutationFn: ({ routineId, approvalRequired }: { routineId: string; approvalRequired: boolean }) =>
      routinesApi.update(routineId, { approvalRequired }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) });
      pushToast({ title: "Routine aggiornata", tone: "success" });
    },
  });

  const approveRun = useMutation({
    mutationFn: ({ routineId, runId }: { routineId: string; runId: string }) =>
      api.post(`/routines/${routineId}/runs/${runId}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-runs", selectedCompanyId] });
      pushToast({ title: "Approvata", tone: "success" });
    },
  });

  const rejectRun = useMutation({
    mutationFn: ({ routineId, runId }: { routineId: string; runId: string }) =>
      api.post(`/routines/${routineId}/runs/${runId}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-runs", selectedCompanyId] });
      pushToast({ title: "Rifiutata", tone: "success" });
    },
  });

  function formatCountdown(nextRunAt: string | Date | null): string | null {
    if (!nextRunAt) return null;
    const diff = new Date(nextRunAt).getTime() - now;
    if (diff <= 0) return "In esecuzione...";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (h > 24) return `tra ${Math.floor(h / 24)}g ${h % 24}h`;
    if (h > 0) return `tra ${h}h ${m}m`;
    if (m > 0) return `tra ${m}m ${s}s`;
    return `tra ${s}s`;
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={CalendarClock} message="Seleziona un'azienda per vedere le attività programmate." />;
  }

  if (routinesQuery.isLoading) return <PageSkeleton />;

  const routines = routinesQuery.data ?? [];
  const pendingRuns = pendingQuery.data ?? [];

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "all", label: "Tutte", count: routines.length },
    { key: "pending", label: "Da approvare", count: pendingRuns.length },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Attività Programmate</h1>

      <div className="flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white/10 text-white"
                : "text-muted-foreground hover:bg-white/5 hover:text-white"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-medium ${
                  activeTab === tab.key ? "bg-white/15 text-white" : "bg-white/8 text-muted-foreground"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "all" && (
        <div className="space-y-3">
          {routines.length === 0 ? (
            <EmptyState icon={CalendarClock} message="Non ci sono attività programmate per questa azienda." />
          ) : (
            routines.map((routine: any) => {
              const nextRunAt = routine.triggers?.[0]?.nextRunAt || routine.nextRunAt;
              const cronExpr = routine.triggers?.[0]?.cronExpression || routine.cronExpression;
              const enabled = routine.triggers?.[0]?.enabled ?? routine.enabled ?? (routine.status === "active");
              return (
                <div
                  key={routine.id}
                  className="rounded-xl border p-4"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <h3 className="text-sm font-medium">{routine.title || "Routine senza nome"}</h3>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {routine.assigneeAgent?.name && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {routine.assigneeAgent.name}
                          </span>
                        )}
                        {cronExpr && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {cronExpr}
                          </span>
                        )}
                        {nextRunAt && (
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {new Date(nextRunAt).toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                          </span>
                        )}
                        {nextRunAt && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-500/15 text-blue-400">
                            {formatCountdown(nextRunAt)}
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            enabled ? "bg-green-500/15 text-green-400" : "bg-white/8 text-muted-foreground"
                          }`}
                        >
                          {enabled ? "Attiva" : "Disattivata"}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        toggleApproval.mutate({
                          routineId: routine.id,
                          approvalRequired: !routine.approvalRequired,
                        })
                      }
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
                      title={routine.approvalRequired ? "Modalità: Manuale (richiede approvazione)" : "Modalità: Automatica"}
                    >
                      {routine.approvalRequired ? (
                        <>
                          <ToggleLeft className="h-4 w-4 text-yellow-400" />
                          Manuale
                        </>
                      ) : (
                        <>
                          <ToggleRight className="h-4 w-4 text-green-400" />
                          Auto
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === "pending" && (
        <div className="space-y-3">
          {pendingQuery.isLoading ? (
            <PageSkeleton />
          ) : pendingRuns.length === 0 ? (
            <EmptyState icon={Check} message="Nessuna attività da approvare." />
          ) : (
            pendingRuns.map((run) => (
              <div
                key={run.id}
                className="rounded-xl border p-4"
                style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-1">
                    <h3 className="text-sm font-medium">{run.routineName || "Run"}</h3>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {run.agentName && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {run.agentName}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(run.createdAt).toLocaleString("it-IT")}
                      </span>
                    </div>
                    {run.content && <p className="mt-2 text-xs text-muted-foreground">{run.content}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="rounded-xl bg-green-600 text-white hover:bg-green-700"
                      onClick={() => approveRun.mutate({ routineId: run.routineId, runId: run.id })}
                      disabled={approveRun.isPending}
                    >
                      <Check className="mr-1 h-3 w-3" />
                      Approva
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => rejectRun.mutate({ routineId: run.routineId, runId: run.id })}
                      disabled={rejectRun.isPending}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Rifiuta
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default ScheduledActivities;
