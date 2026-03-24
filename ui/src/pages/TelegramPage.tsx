import { useState, useEffect, useRef } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Send as SendIcon, Sparkles, Loader2, RefreshCw, User, Bot, Paperclip } from "lucide-react";
import { MarkdownBody } from "../components/MarkdownBody";

interface TgMessage {
  id: string;
  chat_id: number;
  from_name: string;
  from_username: string;
  message_text: string;
  direction: "incoming" | "outgoing";
  created_at: string;
  bot_index: number;
  message_type?: string;
  media_url?: string;
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
  const [generating, setGenerating] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [bots, setBots] = useState<Array<{ username: string; name: string }>>([]);
  const [selectedBot, setSelectedBot] = useState(-1); // -1 = all
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendMedia = async (file: File) => {
    if (!selectedCompany?.id || !selectedChat) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("companyId", selectedCompany.id);
      fd.append("chatId", String(selectedChat));
      if (replyText.trim()) fd.append("caption", replyText);
      await fetch("/api/telegram/send-media", { method: "POST", credentials: "include", body: fd });
      setReplyText("");
      fetchMessages();
    } catch {}
    setSending(false);
  };
  const readChatsRef = useRef<Set<number>>(new Set());
  const [, forceRender] = useState(0);

  useEffect(() => { setBreadcrumbs([{ label: "Telegram" }]); }, [setBreadcrumbs]);

  const isFirstLoad = useRef(true);
  const fetchMessages = async () => {
    if (!selectedCompany?.id) return;
    if (isFirstLoad.current) { setLoading(true); isFirstLoad.current = false; }
    try {
      const res = await fetch("/api/telegram/messages?companyId=" + selectedCompany.id + "&limit=200" + (selectedBot >= 0 ? "&bot=" + selectedBot : ""), { credentials: "include" });
      const data = await res.json();
      if (!res.ok) { setError(data.error); } else { setMessages((data.messages || []).reverse()); }
    } catch { if (messages.length === 0) setError("Errore connessione"); }
    setLoading(false);
  };

  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch("/api/telegram/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setBots(d.bots || []))
      .catch(() => {});
    fetch("/api/telegram/settings?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAutoReply(d.autoReply || false))
      .catch(() => {});
  }, [selectedCompany?.id]);

  // Mark as read when page opens
  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch("/api/telegram/mark-read", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ companyId: selectedCompany.id }),
    }).catch(() => {});
    window.dispatchEvent(new CustomEvent("telegram-read"));
  }, [selectedCompany?.id]);

  useEffect(() => { fetchMessages(); }, [selectedCompany?.id, selectedBot]);
  useEffect(() => { const i = setInterval(fetchMessages, 10000); return () => clearInterval(i); }, [selectedCompany?.id]);
  useEffect(() => { setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100); }, [messages, selectedChat]);

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
      // Count unread: incoming messages after last outgoing
      const lastOutIdx = msgs.map((m, i) => m.direction === "outgoing" ? i : -1).filter((i) => i >= 0).pop() ?? -1;
      const unreadCount = msgs.slice(lastOutIdx + 1).filter((m) => m.direction === "incoming").length;
      threads.push({
        chatId,
        name: incoming[0]?.from_name || "Utente",
        username: incoming[0]?.from_username || "",
        lastMessage: last.message_text.slice(0, 60),
        lastTime: last.created_at,
        unread: readChatsRef.current.has(chatId) ? 0 : unreadCount,
      });
    }
  }
  threads.sort((a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime());

  const chatMessages = selectedChat ? (chatMap.get(selectedChat) || []) : [];
  const selectedThread = threads.find((t) => t.chatId === selectedChat);

  const generateReply = async (msg: TgMessage) => {
    if (!selectedCompany?.id) return;
    setGenerating(msg.id);
    setSelectedChat(msg.chat_id);
    try {
      const res = await fetch("/api/telegram/generate-reply", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, messageText: msg.message_text, fromName: msg.from_name, chatId: msg.chat_id, mediaUrl: msg.media_url, messageType: msg.message_type }),
      });
      const data = await res.json();
      if (res.ok) { setReplyText(data.reply); inputRef.current?.focus(); }
    } catch {}
    setGenerating(null);
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
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Bot selector */}
      {bots.length > 1 && (
        <div className="flex items-center gap-2 pb-3">
          <span className="text-xs text-muted-foreground">Bot:</span>
          <button onClick={() => setSelectedBot(-1)} className={"px-2.5 py-1 rounded-lg text-xs font-medium transition-all " + (selectedBot === -1 ? "text-white" : "text-muted-foreground")} style={selectedBot === -1 ? { background: "rgba(0, 136, 204, 0.2)", border: "1px solid rgba(0, 136, 204, 0.3)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>Tutti</button>
          {bots.map((b, i) => (
            <button key={b.username} onClick={() => setSelectedBot(i)} className={"px-2.5 py-1 rounded-lg text-xs font-medium transition-all truncate max-w-[120px] " + (selectedBot === i ? "text-white" : "text-muted-foreground")} style={selectedBot === i ? { background: "rgba(0, 136, 204, 0.2)", border: "1px solid rgba(0, 136, 204, 0.3)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>@{b.username}</button>
          ))}
        </div>
      )}
      <div className="flex flex-1 gap-3 min-h-0">
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
              onClick={() => { setSelectedChat(thread.chatId); setReplyText(""); readChatsRef.current.add(thread.chatId); forceRender((n) => n + 1); if (selectedCompany?.id) { fetch("/api/telegram/mark-read", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ companyId: selectedCompany.id, chatId: String(thread.chatId) }) }).catch(() => {}); window.dispatchEvent(new CustomEvent("telegram-read")); } }}
              className={"w-full text-left px-3 py-2.5 border-b border-white/5 transition-colors " + (selectedChat === thread.chatId ? "bg-white/10" : "hover:bg-white/5")}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium truncate">{thread.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {thread.unread > 0 && <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-green-500 text-[10px] font-bold text-white px-1">{thread.unread}</span>}
                      <span className="text-[10px] text-muted-foreground">{timeAgo(thread.lastTime)}</span>
                    </div>
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
                        {msg.media_url && msg.message_type === "image" && (
                        <img src={msg.media_url} alt="" className="max-w-[240px] rounded-lg mb-1" loading="lazy" onLoad={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })} />
                      )}
                      {msg.media_url && msg.message_type === "video" && (
                        <video src={msg.media_url} controls className="max-w-[240px] rounded-lg mb-1" />
                      )}
                      {(!msg.media_url || (msg.message_text && msg.message_text !== "[Immagine]" && msg.message_text !== "[Video]" && msg.message_text !== "[Documento]")) && <div className="text-sm">{msg.message_text}</div>}
                        <div className={"text-[10px] mt-0.5 " + (isOut ? "text-green-400/50" : "text-muted-foreground/50")}>{formatTime(msg.created_at)}</div>
                        {!isOut && !autoReply && (
                          <button onClick={() => generateReply(msg)} disabled={generating === msg.id} className="flex items-center gap-1 mt-1 px-2 py-0.5 rounded-lg text-[10px] transition-all" style={{ background: "rgba(251, 191, 36, 0.1)", border: "1px solid rgba(251, 191, 36, 0.2)" }}>
                            {generating === msg.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                            Genera risposta AI
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="glass-card p-3 flex items-end gap-2 mt-3">
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendMedia(f); e.target.value = ""; }} />
              <button onClick={() => fileInputRef.current?.click()} className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground transition-colors" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                ref={inputRef}
                className="flex-1 resize-none rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "hsl(0 0% 98%)", maxHeight: "120px" }}
                placeholder="Scrivi un messaggio..."
                rows={1}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
              />
              <button onClick={sendReply} disabled={sending || !replyText.trim()} className="h-11 w-11 rounded-xl flex items-center justify-center transition-all disabled:opacity-30" style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))", boxShadow: "0 4px 20px hsl(158 64% 42% / 0.3)" }}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <SendIcon className="w-4 h-4 text-white" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
    </div>
  );
}
