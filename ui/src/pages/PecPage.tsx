import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Mail, RefreshCw, Send, X, Shield, CheckCircle, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface PecMessage {
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
  pecTipo?: string;
  pecErrore?: string;
}

interface PecMessageDetail extends PecMessage {
  to: string;
  body: string;
  daticert?: Record<string, string>;
}

const TIPO_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  "posta-certificata": { label: "PEC", color: "text-blue-400", icon: <Mail className="w-3 h-3" /> },
  "accettazione": { label: "Accettata", color: "text-green-400", icon: <CheckCircle className="w-3 h-3" /> },
  "avvenuta-consegna": { label: "Consegnata", color: "text-green-500", icon: <CheckCircle className="w-3 h-3" /> },
  "non-accettazione": { label: "Non accettata", color: "text-red-400", icon: <AlertTriangle className="w-3 h-3" /> },
  "errore-consegna": { label: "Errore consegna", color: "text-red-500", icon: <AlertTriangle className="w-3 h-3" /> },
  "preavviso-errore-consegna": { label: "Preavviso errore", color: "text-amber-400", icon: <Clock className="w-3 h-3" /> },
};

export function PecPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [messages, setMessages] = useState<PecMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PecMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [pecEmail, setPecEmail] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "PEC" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch("/api/pec/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.connected) setPecEmail(d.email); })
      .catch(() => {});
    fetchMessages();
  }, [selectedCompany?.id]);

  const fetchMessages = async () => {
    if (!selectedCompany?.id) return;
    setLoading(true);
    try {
      const r = await fetch("/api/pec/messages?companyId=" + selectedCompany.id + "&limit=30", { credentials: "include" });
      const d = await r.json();
      setMessages(d.messages || []);
    } catch { setMessages([]); } finally { setLoading(false); }
  };

  const openMessage = async (uid: number) => {
    if (!selectedCompany?.id) return;
    setLoadingDetail(true);
    try {
      const r = await fetch("/api/pec/message/" + uid + "?companyId=" + selectedCompany.id, { credentials: "include" });
      const d = await r.json();
      setSelected({ ...d, uid });
      setMessages((prev) => prev.map((m) => m.uid === uid ? { ...m, seen: true } : m));
    } catch {} finally { setLoadingDetail(false); }
  };

  const handleReply = () => {
    if (!selected) return;
    setComposeTo(selected.from);
    setComposeSubject(selected.subject.startsWith("Re:") ? selected.subject : "Re: " + selected.subject);
    setComposeBody("");
    setShowCompose(true);
  };

  const handleSend = async () => {
    if (!selectedCompany?.id || !composeTo || !composeSubject || !composeBody) return;
    setSending(true);
    setSendResult(null);
    try {
      const r = await fetch("/api/pec/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, to: composeTo, subject: composeSubject, body: composeBody }),
      });
      if (r.ok) {
        setSendResult("PEC inviata con successo!");
        setComposeTo(""); setComposeSubject(""); setComposeBody("");
        setTimeout(() => { setShowCompose(false); setSendResult(null); }, 2000);
      } else {
        const d = await r.json();
        setSendResult("Errore: " + (d.error || "invio fallito"));
      }
    } catch { setSendResult("Errore di rete"); } finally { setSending(false); }
  };

  const cardStyle: React.CSSProperties = {
    background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
    border: "1px solid rgba(255,255,255,0.08)",
    backdropFilter: "blur(20px)",
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-green-400" />
          <h1 className="text-xl font-semibold">PEC</h1>
          {pecEmail && <span className="text-xs text-muted-foreground ml-1">— {pecEmail}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchMessages} className="p-2 rounded-lg hover:bg-white/5 transition-colors" title="Aggiorna">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
          <button onClick={() => { setComposeTo(""); setComposeSubject(""); setComposeBody(""); setShowCompose(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))", color: "white" }}>
            <Send className="w-3.5 h-3.5" />
            Nuova PEC
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Message list */}
        <div className="w-72 shrink-0 flex flex-col gap-1 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-muted-foreground p-4">Caricamento...</div>
          ) : messages.length === 0 ? (
            <div className="text-xs text-muted-foreground p-4">Nessuna PEC ricevuta.</div>
          ) : (
            messages.map((msg) => {
              const tipo = msg.pecTipo ? TIPO_LABELS[msg.pecTipo] : null;
              return (
                <button key={msg.uid} onClick={() => openMessage(msg.uid)}
                  className={cn("w-full text-left px-3 py-2.5 rounded-xl transition-all", selected?.uid === msg.uid ? "bg-white/10" : "hover:bg-white/5")}
                  style={cardStyle}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {!msg.seen && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
                    {tipo && <span className={cn("flex items-center gap-0.5 text-[10px] font-medium", tipo.color)}>{tipo.icon}{tipo.label}</span>}
                    <span className="text-[10px] text-muted-foreground ml-auto">{msg.date.substring(0, 10)}</span>
                  </div>
                  <div className={cn("text-xs truncate", !msg.seen && "font-semibold")}>{msg.subject}</div>
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">{msg.from}</div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 rounded-2xl overflow-hidden" style={cardStyle}>
          {loadingDetail ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">Caricamento messaggio...</div>
          ) : selected ? (
            <div className="flex flex-col h-full">
              <div className="px-5 py-4 border-b border-white/5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">{selected.subject}</h2>
                    <div className="text-xs text-muted-foreground mt-1">Da: {selected.from}</div>
                    <div className="text-xs text-muted-foreground">A: {selected.to}</div>
                    <div className="text-xs text-muted-foreground">{new Date(selected.date).toLocaleString("it-IT")}</div>
                  </div>
                  <button onClick={handleReply}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-all"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }}>
                    <Mail className="w-3 h-3" />
                    Rispondi
                  </button>
                </div>
                {selected.daticert && Object.keys(selected.daticert).length > 0 && (
                  <div className="mt-3 px-3 py-2 rounded-xl text-xs space-y-0.5" style={{ background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.2)" }}>
                    <div className="flex items-center gap-1.5 font-medium text-green-400 mb-1">
                      <Shield className="w-3 h-3" />
                      Certificazione PEC
                    </div>
                    {Object.entries(selected.daticert).map(([k, v]) => (
                      <div key={k} className="text-muted-foreground"><span className="text-white/60">{k}:</span> {v}</div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans">{selected.body}</pre>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Seleziona una PEC per leggerla
            </div>
          )}
        </div>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => !sending && setShowCompose(false)}>
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />
          <div className="relative rounded-2xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={(e) => e.stopPropagation()}
            style={{ background: "rgba(20,20,20,0.95)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-green-400" />
                <h3 className="text-sm font-semibold">Nuova PEC</h3>
              </div>
              <button onClick={() => setShowCompose(false)} className="text-muted-foreground hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Destinatario PEC</label>
                <input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="destinatario@pec.example.it"
                  className="w-full px-3 py-2 rounded-xl border border-white/10 bg-transparent text-xs outline-none" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Oggetto</label>
                <input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} placeholder="Oggetto della PEC"
                  className="w-full px-3 py-2 rounded-xl border border-white/10 bg-transparent text-xs outline-none" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Testo</label>
                <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} rows={6} placeholder="Testo del messaggio..."
                  className="w-full px-3 py-2 rounded-xl border border-white/10 bg-transparent text-xs outline-none resize-none" />
              </div>
              {sendResult && (
                <div className={cn("text-xs px-3 py-2 rounded-lg", sendResult.startsWith("Errore") ? "text-red-400 bg-red-500/10" : "text-green-400 bg-green-500/10")}>
                  {sendResult}
                </div>
              )}
              <button onClick={handleSend} disabled={sending || !composeTo || !composeSubject || !composeBody}
                className="w-full py-2.5 rounded-xl text-xs font-semibold disabled:opacity-40 transition-all"
                style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))", color: "white" }}>
                {sending ? "Invio..." : "Invia PEC"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
