import { useState, useEffect, useRef } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Send as SendIcon, Sparkles, Loader2, RefreshCw } from "lucide-react";

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
  const [replyText, setReplyText] = useState("");
  const [replyToChatId, setReplyToChatId] = useState<number | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setBreadcrumbs([{ label: "Telegram" }]); }, [setBreadcrumbs]);

  const fetchMessages = async () => {
    if (!selectedCompany?.id) return;
    try {
      const res = await fetch("/api/telegram/messages?companyId=" + selectedCompany.id + "&limit=100", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) { setError(data.error); } else { setMessages((data.messages || []).reverse()); }
    } catch { setError("Errore connessione"); }
    setLoading(false);
  };

  useEffect(() => { fetchMessages(); }, [selectedCompany?.id]);
  useEffect(() => { const i = setInterval(fetchMessages, 10000); return () => clearInterval(i); }, [selectedCompany?.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const generateReply = async (msg: TgMessage) => {
    if (!selectedCompany?.id) return;
    setGenerating(msg.id);
    try {
      const res = await fetch("/api/telegram/generate-reply", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, messageText: msg.message_text, fromName: msg.from_name }),
      });
      const data = await res.json();
      if (res.ok) { setReplyText(data.reply); setReplyToChatId(msg.chat_id); }
    } catch {}
    setGenerating(null);
  };

  const sendReply = async () => {
    if (!selectedCompany?.id || !replyToChatId || !replyText.trim()) return;
    setSending(true);
    try {
      await fetch("/api/telegram/send", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, chatId: replyToChatId, text: replyText }),
      });
      setReplyText(""); setReplyToChatId(null);
      fetchMessages();
    } catch {}
    setSending(false);
  };

  const formatTime = (d: string) => {
    try { return new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
  };

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "long" }); } catch { return ""; }
  };

  // Group messages by date
  let lastDate = "";

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Caricamento...</div>;
  if (error && !messages.length) return (
    <div className="p-6"><div className="glass-card p-6 text-center space-y-3">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="#0088cc" className="mx-auto"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
      <p className="text-sm text-muted-foreground">{error}</p>
      <a href={"/" + (selectedCompany?.issuePrefix || "") + "/plugins"} className="text-sm text-blue-400 hover:underline">Collega il bot da Plugin</a>
    </div></div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#0088cc"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
          <h1 className="text-xl font-semibold">Telegram</h1>
        </div>
        <button onClick={fetchMessages} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto glass-card p-4 space-y-1">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">Nessun messaggio. Quando qualcuno scrive al bot, la conversazione apparirà qui.</div>
        ) : messages.map((msg) => {
          const msgDate = formatDate(msg.created_at);
          const showDate = msgDate !== lastDate;
          lastDate = msgDate;
          const isOut = msg.direction === "outgoing";

          return (
            <div key={msg.id}>
              {showDate && <div className="text-center text-[10px] text-muted-foreground py-2">{msgDate}</div>}
              <div className={"flex " + (isOut ? "justify-end" : "justify-start") + " mb-1"}>
                <div className={"max-w-[75%] rounded-2xl px-3.5 py-2 " + (isOut ? "rounded-br-sm" : "rounded-bl-sm")} style={isOut ? { background: "rgba(34, 197, 94, 0.15)", border: "1px solid rgba(34, 197, 94, 0.2)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {!isOut && <div className="text-[11px] font-medium text-blue-400 mb-0.5">{msg.from_name || msg.from_username || "Utente"}</div>}
                  <div className="text-sm" style={{ color: "rgba(255,255,255,0.9)" }}>{msg.message_text}</div>
                  <div className={"text-[10px] mt-1 " + (isOut ? "text-green-400/60" : "text-muted-foreground/60")}>{formatTime(msg.created_at)}</div>
                  {!isOut && (
                    <button onClick={() => generateReply(msg)} disabled={generating === msg.id} className="flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-lg text-[10px] transition-all" style={{ background: "rgba(251, 191, 36, 0.1)", border: "1px solid rgba(251, 191, 36, 0.2)" }}>
                      {generating === msg.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                      {generating === msg.id ? "..." : "Genera risposta AI"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply input */}
      <div className="pt-3">
        <div className="flex items-end gap-2">
          <textarea
            className="flex-1 min-h-[44px] max-h-[120px] rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none resize-none"
            placeholder={replyToChatId ? "Scrivi la risposta..." : "Seleziona un messaggio con 'Genera risposta AI'"}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
            disabled={!replyToChatId}
          />
          <button
            onClick={sendReply}
            disabled={sending || !replyText.trim() || !replyToChatId}
            className="h-[44px] w-[44px] rounded-2xl flex items-center justify-center shrink-0 disabled:opacity-30"
            style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))" }}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <SendIcon className="w-4 h-4 text-white" />}
          </button>
        </div>
      </div>
    </div>
  );
}
