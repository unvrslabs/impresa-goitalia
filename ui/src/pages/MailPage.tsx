import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Mail, Inbox, RefreshCw, Sparkles, Send, X, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  isUnread: boolean;
  isStarred: boolean;
}

export function MailPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<GmailMessage | null>(null);
  const [generatingReply, setGeneratingReply] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<{ messageId: string; text: string; subject: string; to: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState("INBOX");

  useEffect(() => {
    setBreadcrumbs([{ label: "Mail" }]);
  }, [setBreadcrumbs]);

  const fetchMail = async (filter?: string) => {
    if (!selectedCompany?.id) return;
    const useFilter = filter || activeFilter;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gmail/messages?companyId=" + selectedCompany.id + "&label=" + useFilter, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setLoading(false); return; }
      setMessages(data.messages || []);
      setEmail(data.email || "");
      setNextPageToken(data.nextPageToken || null);
    } catch { setError("Errore di connessione"); }
    setLoading(false);
  };

  const loadMore = async () => {
    if (!selectedCompany?.id || !nextPageToken) return;
    setLoadingMore(true);
    try {
      const res = await fetch("/api/gmail/messages?companyId=" + selectedCompany.id + "&pageToken=" + nextPageToken + "&label=" + activeFilter, { credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [...prev, ...(data.messages || [])]);
        setNextPageToken(data.nextPageToken || null);
      }
    } catch {}
    setLoadingMore(false);
  };

  useEffect(() => { fetchMail(activeFilter); }, [selectedCompany?.id, activeFilter]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!selectedCompany?.id) return;
    const interval = setInterval(() => { fetchMail(activeFilter); }, 30000);
    return () => clearInterval(interval);
  }, [selectedCompany?.id, activeFilter]);

  const generateReply = async (msg: GmailMessage) => {
    if (!selectedCompany?.id) return;
    setGeneratingReply(msg.id);
    try {
      const res = await fetch("/api/gmail/generate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, messageId: msg.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setGeneratingReply(null); return; }
      setReplyDraft({
        messageId: msg.id,
        text: data.reply,
        subject: data.originalSubject,
        to: msg.from.replace(/.*</, "").replace(/>.*/, ""),
      });
    } catch { setError("Errore generazione risposta"); }
    setGeneratingReply(null);
  };

  const sendReply = async () => {
    if (!selectedCompany?.id || !replyDraft) return;
    setSending(true);
    try {
      const msg = messages.find((m) => m.id === replyDraft.messageId);
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          companyId: selectedCompany.id,
          to: replyDraft.to,
          subject: replyDraft.subject,
          body: replyDraft.text,
          threadId: msg?.threadId,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setSending(false); return; }
      setSendSuccess(replyDraft.to);
      setReplyDraft(null);
      setTimeout(() => setSendSuccess(null), 3000);
    } catch { setError("Errore invio"); }
    setSending(false);
  };

  const gmailAction = async (action: string, messageId: string, extra?: Record<string, unknown>) => {
    if (!selectedCompany?.id) return;
    await fetch("/api/gmail/" + action, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ companyId: selectedCompany.id, messageId, ...extra }),
    });
  };

  const trashMessage = async (id: string) => {
    await gmailAction("trash", id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
    if (selectedMessage?.id === id) setSelectedMessage(null);
  };

  const archiveMessage = async (id: string) => {
    await gmailAction("archive", id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
    if (selectedMessage?.id === id) setSelectedMessage(null);
  };

  const toggleStar = async (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    await gmailAction("star", id, { starred: !msg.isStarred });
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, isStarred: !m.isStarred } : m));
  };

  const changeFilter = (filter: string) => {
    setActiveFilter(filter);
    setMessages([]);
    setSelectedMessage(null);
    setNextPageToken(null);
    // Direct fetch with new filter
    fetchMail(filter);
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
    } catch { return dateStr; }
  };

  const formatFrom = (from: string) => {
    const match = from.match(/^"?([^"<]+)"?\s*</);
    return match ? match[1].trim() : from.split("@")[0];
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Caricamento email...</div>;
  if (error && !messages.length) return (
    <div className="p-6">
      <div className="glass-card p-6 text-center space-y-3">
        <Mail className="w-10 h-10 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <a href={`/${selectedCompany?.issuePrefix || ""}/plugins`} className="text-sm text-green-400 hover:underline">
          Vai su Plugin per collegare Google
        </a>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox className="w-5 h-5" />
          <h1 className="text-xl font-semibold">Mail</h1>
          {email && <span className="text-xs text-muted-foreground">{email}</span>}
        </div>
        <button
          onClick={() => fetchMail()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1">
        {[
          { id: "INBOX", label: "Inbox" },
          { id: "STARRED", label: "Preferiti" },
          { id: "SENT", label: "Inviate" },
          { id: "ARCHIVE", label: "Archiviate" },
          { id: "TRASH", label: "Cestino" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => changeFilter(tab.id)}
            className={"px-3 py-1.5 rounded-lg text-xs font-medium transition-all " + (activeFilter === tab.id ? "text-white" : "text-muted-foreground hover:text-foreground")}
            style={activeFilter === tab.id ? { background: "linear-gradient(135deg, hsl(158 64% 42% / 0.2), hsl(158 64% 42% / 0.1))", border: "1px solid hsl(158 64% 42% / 0.3)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Success toast */}
      {sendSuccess && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(34, 197, 94, 0.15)", border: "1px solid rgba(34, 197, 94, 0.3)", color: "rgb(134, 239, 172)" }}>
          Email inviata a {sendSuccess}
        </div>
      )}

      {/* Reply draft modal */}
      {replyDraft && (
        <div className="glass-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium">Risposta generata dall'AI</span>
            </div>
            <button onClick={() => setReplyDraft(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-xs text-muted-foreground">A: {replyDraft.to} — Re: {replyDraft.subject}</div>
          <textarea
            className="w-full min-h-[150px] rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none resize-y"
            value={replyDraft.text}
            onChange={(e) => setReplyDraft({ ...replyDraft, text: e.target.value })}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={sendReply}
              disabled={sending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
              style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))", color: "white" }}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? "Invio..." : "Approva e Invia"}
            </button>
            <button onClick={() => setReplyDraft(null)} className="text-xs text-muted-foreground hover:text-foreground">
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* Email list */}
      {messages.length === 0 ? (
        <div className="glass-card p-6 text-center text-sm text-muted-foreground">Nessuna email nella inbox.</div>
      ) : (
        <div className="glass-card overflow-hidden divide-y divide-white/5">
          {messages.map((msg) => (
            <div key={msg.id}>
              <button
                className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors"
                onClick={() => setSelectedMessage(selectedMessage?.id === msg.id ? null : msg)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {msg.isStarred && <svg width="14" height="14" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="2" className="shrink-0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
                      {msg.isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                      <span className={"text-sm truncate " + (msg.isUnread ? "font-semibold" : "font-normal")}>{formatFrom(msg.from)}</span>
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">{formatDate(msg.date)}</span>
                    </div>
                    <div className={"text-sm truncate mt-0.5 " + (msg.isUnread ? "font-medium" : "text-muted-foreground")}>{msg.subject || "(nessun oggetto)"}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{msg.snippet}</div>
                  </div>
                  {selectedMessage?.id === msg.id ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
                </div>
              </button>

              {selectedMessage?.id === msg.id && (
                <div className="px-4 pb-4 space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>Da: {msg.from}</div>
                    <div>A: {msg.to}</div>
                    <div>Data: {msg.date}</div>
                  </div>
                  <div className="text-sm whitespace-pre-wrap max-h-[300px] overflow-y-auto" style={{ color: "rgba(255,255,255,0.85)" }}>
                    {msg.body || msg.snippet}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleStar(msg.id)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" title={msg.isStarred ? "Rimuovi preferito" : "Aggiungi ai preferiti"}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={msg.isStarred ? "#fbbf24" : "none"} stroke={msg.isStarred ? "#fbbf24" : "currentColor"} strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    </button>
                    <button onClick={() => archiveMessage(msg.id)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground" title="Archivia">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
                    </button>
                    <button onClick={() => trashMessage(msg.id)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-red-400/70" title="Elimina">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                  <button
                    onClick={() => generateReply(msg)}
                    disabled={generatingReply === msg.id}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                    style={{ background: "linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(251, 191, 36, 0.1))", border: "1px solid rgba(251, 191, 36, 0.3)", color: "rgba(255,255,255,0.9)" }}
                  >
                    {generatingReply === msg.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {generatingReply === msg.id ? "Generazione in corso..." : "Genera risposta AI"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Load more */}
      {nextPageToken && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-3 rounded-xl text-sm font-medium transition-all"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {loadingMore ? "Caricamento..." : "Carica altre email"}
        </button>
      )}
    </div>
  );
}
