import { useState, useEffect, useRef } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Send as SendIcon, Sparkles, Loader2, RefreshCw, User, Bot } from "lucide-react";
import { MarkdownBody } from "../components/MarkdownBody";

interface TgMessage {
  id: string;
  chat_id: number;
  from_name: string;
  from_username: string;
  message_text: string;
  direction: "incoming" | "outgoing";
  created_at: string;
}

interface ChatThread {
  chatId: number;
  name: string;
  username: string;
  lastMessage: string;
  lastTime: string;
  unread: number;
}

export function TelegramPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [messages, setMessages] = useState<TgMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setBreadcrumbs([{ label: "Telegram" }]); }, [setBreadcrumbs]);

  const fetchMessages = async () => {
    if (!selectedCompany?.id) return;
    try {
      const res = await fetch("/api/telegram/messages?companyId=" + selectedCompany.id + "&limit=200", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) { setError(data.error); } else { setMessages((data.messages || []).reverse()); }
    } catch { setError("Errore connessione"); }
    setLoading(false);
  };

  useEffect(() => { fetchMessages(); }, [selectedCompany?.id]);
  useEffect(() => { const i = setInterval(fetchMessages, 10000); return () => clearInterval(i); }, [selectedCompany?.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, selectedChat]);

  // Build chat threads
  const threads: ChatThread[] = [];
  const chatMap = new Map<number, TgMessage[]>();
  for (const msg of messages) {
    if (!chatMap.has(msg.chat_id)) chatMap.set(msg.chat_id, []);
    chatMap.get(msg.chat_id)!.push(msg);
  }
  for (const [chatId, msgs] of chatMap) {
    const incoming = msgs.filter((m) => m.direction === "incoming");
    const last = msgs[msgs.length - 1];
    if (last) {
      threads.push({
        chatId,
        name: incoming[0]?.from_name || "Utente",
        username: incoming[0]?.from_username || "",
        lastMessage: last.message_text.slice(0, 60),
        lastTime: last.created_at,
        unread: 0,
      });
    }
  }
  threads.sort((a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime());

  const chatMessages = selectedChat ? (chatMap.get(selectedChat) || []) : [];
  const selectedThread = threads.find((t) => t.chatId === selectedChat);

  const generateReply = async () => {
    if (!selectedCompany?.id || !selectedChat) return;
    const lastIncoming = [...chatMessages].reverse().find((m) => m.direction === "incoming");
    if (!lastIncoming) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/telegram/generate-reply", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, messageText: lastIncoming.message_text, fromName: lastIncoming.from_name }),
      });
      const data = await res.json();
      if (res.ok) { setReplyText(data.reply); inputRef.current?.focus(); }
    } catch {}
    setGenerating(false);
  };

  const sendReply = async () => {
    if (!selectedCompany?.id || !selectedChat || !replyText.trim()) return;
    setSending(true);
    try {
      await fetch("/api/telegram/send", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, chatId: selectedChat, text: replyText }),
      });
      setReplyText("");
      fetchMessages();
    } catch {}
    setSending(false);
  };

  const formatTime = (d: string) => { try { return new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
  const formatDate = (d: string) => { try { return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "long" }); } catch { return ""; } };
  const timeAgo = (d: string) => {
    try {
      const diff = Date.now() - new Date(d).getTime();
      if (diff < 60000) return "ora";
      if (diff < 3600000) return Math.floor(diff / 60000) + "m";
      if (diff < 86400000) return Math.floor(diff / 3600000) + "h";
      return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
    } catch { return ""; }
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Caricamento...</div>;
  if (error && !messages.length) return (
    <div className="p-6"><div className="glass-card p-6 text-center space-y-3">
      <Bot className="w-10 h-10 mx-auto text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{error}</p>
      <a href={"/" + (selectedCompany?.issuePrefix || "") + "/plugins"} className="text-sm text-blue-400 hover:underline">Collega il bot da Plugin</a>
    </div></div>
  );

  let lastDate = "";

  return (
    <div className="flex h-[calc(100vh-120px)] gap-3">
      {/* Chat list */}
      <div className="w-72 shrink-0 glass-card overflow-hidden flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 text-xs font-medium text-muted-foreground flex items-center justify-between">
          <span>Conversazioni</span>
          <button onClick={fetchMessages}><RefreshCw className="w-3 h-3" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center">Nessuna conversazione</div>
          ) : threads.map((thread) => (
            <button
              key={thread.chatId}
              onClick={() => { setSelectedChat(thread.chatId); setReplyText(""); }}
              className={"w-full text-left px-3 py-2.5 border-b border-white/5 transition-colors " + (selectedChat === thread.chatId ? "bg-white/10" : "hover:bg-white/5")}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium truncate">{thread.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(thread.lastTime)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{thread.lastMessage}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedChat ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Seleziona una conversazione
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="glass-card px-4 py-2.5 mb-2 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                <User className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <div className="text-sm font-medium">{selectedThread?.name}</div>
                {selectedThread?.username && <div className="text-xs text-muted-foreground">@{selectedThread.username}</div>}
              </div>
              <div className="ml-auto">
                <button onClick={generateReply} disabled={generating} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={{ background: "rgba(251, 191, 36, 0.15)", border: "1px solid rgba(251, 191, 36, 0.3)" }}>
                  {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Genera risposta AI
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto glass-card px-4 py-3 space-y-1">
              {chatMessages.map((msg) => {
                const msgDate = formatDate(msg.created_at);
                const showDate = msgDate !== lastDate;
                lastDate = msgDate;
                const isOut = msg.direction === "outgoing";
                return (
                  <div key={msg.id}>
                    {showDate && <div className="text-center text-[10px] text-muted-foreground py-2">{msgDate}</div>}
                    <div className={"flex mb-1 " + (isOut ? "justify-end" : "justify-start")}>
                      <div className={"max-w-[70%] px-3 py-2 rounded-2xl " + (isOut ? "rounded-br-sm bg-green-500/15 border border-green-500/20" : "rounded-bl-sm bg-white/5 border border-white/8")}>
                        <div className="text-sm">{msg.message_text}</div>
                        <div className={"text-[10px] mt-0.5 " + (isOut ? "text-green-400/50" : "text-muted-foreground/50")}>{formatTime(msg.created_at)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="pt-2 flex items-end gap-2">
              <textarea
                ref={inputRef}
                className="flex-1 min-h-[44px] max-h-[120px] rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none resize-none"
                placeholder="Scrivi un messaggio..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
              />
              <button onClick={sendReply} disabled={sending || !replyText.trim()} className="h-[44px] w-[44px] rounded-2xl flex items-center justify-center shrink-0 disabled:opacity-30" style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))" }}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <SendIcon className="w-4 h-4 text-white" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
