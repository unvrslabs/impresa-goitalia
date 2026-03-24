import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Send as SendIcon, Bot, User, Sparkles, Loader2, RefreshCw } from "lucide-react";

interface TgMessage {
  id: string;
  chat_id: number;
  from_name: string;
  from_username: string;
  message_text: string;
  direction: "incoming" | "outgoing";
  created_at: string;
}

export function TelegramPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [messages, setMessages] = useState<TgMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<{ chatId: number; text: string; fromName: string } | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { setBreadcrumbs([{ label: "Telegram" }]); }, [setBreadcrumbs]);

  const fetchMessages = async () => {
    if (!selectedCompany?.id) return;
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/messages?companyId=" + selectedCompany.id, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) { setError(data.error); } else { setMessages(data.messages || []); }
    } catch { setError("Errore connessione"); }
    setLoading(false);
  };

  useEffect(() => { fetchMessages(); }, [selectedCompany?.id]);
  useEffect(() => {
    if (!selectedCompany?.id) return;
    const i = setInterval(fetchMessages, 15000);
    return () => clearInterval(i);
  }, [selectedCompany?.id]);

  const generateReply = async (msg: TgMessage) => {
    if (!selectedCompany?.id) return;
    setGenerating(msg.id);
    try {
      const res = await fetch("/api/telegram/generate-reply", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, messageText: msg.message_text, fromName: msg.from_name }),
      });
      const data = await res.json();
      if (res.ok) { setReplyDraft({ chatId: msg.chat_id, text: data.reply, fromName: msg.from_name }); }
    } catch {}
    setGenerating(null);
  };

  const sendReply = async () => {
    if (!selectedCompany?.id || !replyDraft) return;
    setSending(true);
    try {
      await fetch("/api/telegram/send", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, chatId: replyDraft.chatId, text: replyDraft.text }),
      });
      setReplyDraft(null);
      fetchMessages();
    } catch {}
    setSending(false);
  };

  const formatTime = (d: string) => {
    try { return new Date(d).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
  };

  if (error && !messages.length) return (
    <div className="p-6"><div className="glass-card p-6 text-center space-y-3">
      <Bot className="w-10 h-10 mx-auto text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{error}</p>
      <a href={"/" + (selectedCompany?.issuePrefix || "") + "/plugins"} className="text-sm text-blue-400 hover:underline">Vai su Plugin per collegare il bot Telegram</a>
    </div></div>
  );

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#0088cc"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
          <h1 className="text-xl font-semibold">Telegram</h1>
        </div>
        <button onClick={fetchMessages} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
        </button>
      </div>

      {replyDraft && (
        <div className="glass-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium">Risposta per {replyDraft.fromName}</span>
          </div>
          <textarea className="w-full min-h-[100px] rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm outline-none resize-y" value={replyDraft.text} onChange={(e) => setReplyDraft({ ...replyDraft, text: e.target.value })} />
          <div className="flex gap-3">
            <button onClick={sendReply} disabled={sending} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium" style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))", color: "white" }}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendIcon className="w-4 h-4" />} {sending ? "Invio..." : "Invia"}
            </button>
            <button onClick={() => setReplyDraft(null)} className="text-xs text-muted-foreground">Annulla</button>
          </div>
        </div>
      )}

      {loading ? <div className="text-sm text-muted-foreground p-4">Caricamento...</div> :
        messages.length === 0 ? (
          <div className="glass-card p-6 text-center text-sm text-muted-foreground">Nessun messaggio. Quando qualcuno scrive al bot, i messaggi appariranno qui.</div>
        ) : (
          <div className="glass-card overflow-hidden divide-y divide-white/5">
            {messages.map((msg) => (
              <div key={msg.id} className={"px-4 py-3 " + (msg.direction === "outgoing" ? "bg-green-500/5" : "")}>
                <div className="flex items-start gap-3">
                  {msg.direction === "incoming" ? <User className="w-4 h-4 mt-0.5 text-blue-400 shrink-0" /> : <Bot className="w-4 h-4 mt-0.5 text-green-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium">{msg.direction === "incoming" ? (msg.from_name || msg.from_username || "Utente") : "Bot"}</span>
                      {msg.from_username && msg.direction === "incoming" && <span className="text-muted-foreground">@{msg.from_username}</span>}
                      <span className="text-muted-foreground ml-auto">{formatTime(msg.created_at)}</span>
                    </div>
                    <div className="text-sm mt-1">{msg.message_text}</div>
                    {msg.direction === "incoming" && (
                      <button onClick={() => generateReply(msg)} disabled={generating === msg.id} className="flex items-center gap-1.5 mt-2 px-3 py-1 rounded-lg text-xs transition-all" style={{ background: "rgba(251, 191, 36, 0.15)", border: "1px solid rgba(251, 191, 36, 0.3)" }}>
                        {generating === msg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        {generating === msg.id ? "Generazione..." : "Genera risposta AI"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
}
