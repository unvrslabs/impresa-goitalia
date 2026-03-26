import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useOnboarding } from "../context/OnboardingContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { Send, Paperclip, Bot, User, Loader2 } from "lucide-react";
import { MarkdownBody } from "../components/MarkdownBody";
import { useNavigate } from "@/lib/router";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function ChatPage() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { step: onboardingStep, advanceStep } = useOnboarding();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const ceoAgent = (agents ?? []).find((a) => a.role === "ceo");
  const otherAgents = (agents ?? []).filter((a) => a.role !== "ceo");
  const isOnboarding = otherAgents.length === 0 && !!ceoAgent && (ceoAgent as any).adapterType === "claude_api";
  const [autoStarted, setAutoStarted] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [showOnboardingButton, setShowOnboardingButton] = useState(false);

  // Listen for onboarding-chat-start event (fired when user clicks "Ho capito" on step 1 tooltip)
  useEffect(() => {
    if (!selectedCompanyId) return;
    // If step is already >= 2, we are ready
    if (onboardingStep !== null && onboardingStep >= 2) {
      setOnboardingReady(true);
    }
    const onStart = () => {
      setOnboardingReady(true);
      setTimeout(() => window.dispatchEvent(new Event("onboarding-force-send")), 100);
    };
    window.addEventListener("onboarding-chat-start", onStart);
    return () => window.removeEventListener("onboarding-chat-start", onStart);
  }, [selectedCompanyId, onboardingStep]);

  // Check for pre-filled message from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefillMsg = params.get("msg");
    if (prefillMsg && !isStreaming && selectedCompany?.id) {
      setInput(prefillMsg);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [selectedCompany?.id]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Chat" }]);
  }, [setBreadcrumbs]);

  // Load chat history from DB
  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch("/api/chat/history?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.messages?.length > 0) {
          const loaded = data.messages.map((m: any) => ({
            id: m.id || crypto.randomUUID(),
            role: m.role,
            content: m.content,
            timestamp: new Date(m.created_at),
          }));
          setMessages(loaded);
        }
        setHistoryLoaded(true);
      })
      .catch(() => { setHistoryLoaded(true); });
  }, [selectedCompany?.id]);

  // Auto-send message from URL ?msg= param
  useEffect(() => {
    const msg = searchParams.get("msg");
    if (!msg || !ceoAgent || !selectedCompanyId || autoStarted || isStreaming) return;
    setSearchParams({}, { replace: true });
    setAutoStarted(true);
    const startMsg = { id: crypto.randomUUID(), role: "user" as const, content: msg, timestamp: new Date() };
    setMessages(prev => [...prev, startMsg]);
    setIsStreaming(true);
    const aId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: aId, role: "assistant", content: "", timestamp: new Date() }]);
    advanceStep(99);
    fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ companyId: selectedCompanyId, agentId: ceoAgent.id, message: msg, history: [] }) })
      .then(async (res) => {
        if (!res.ok || !res.body) { setIsStreaming(false); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const ln of chunk.split(String.fromCharCode(10))) {
            if (!ln.startsWith("data: ")) continue;
            try {
              const d = JSON.parse(ln.slice(6));
              if (d.type === "text" || d.type === "content_block_delta") { fullText += d.text || d.delta?.text || ""; setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: fullText } : m)); }
            } catch {}
          }
        }
        setIsStreaming(false);
      }).catch(() => setIsStreaming(false));
  }, [ceoAgent, selectedCompanyId, searchParams]);

  // Also trigger on force-send event
  useEffect(() => {
    const onForce = () => {
      if (!ceoAgent || !selectedCompanyId || autoStarted) return;
      setAutoStarted(true);
      const startMsg = { id: crypto.randomUUID(), role: "user" as const, content: "Ciao! Ho appena registrato la mia impresa. Aiutami a configurare gli agenti AI.", timestamp: new Date() };
      setMessages([startMsg]);
      setIsStreaming(true);
      const aId = crypto.randomUUID();
      setMessages(prev => [...prev, { id: aId, role: "assistant", content: "", timestamp: new Date() }]);
      fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ companyId: selectedCompanyId, agentId: ceoAgent.id, message: startMsg.content, history: [] }) })
        .then(async (res) => {
          if (!res.ok || !res.body) { setIsStreaming(false); return; }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let fullText = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const ln of chunk.split(String.fromCharCode(10))) {
              if (!ln.startsWith("data: ")) continue;
              try {
                const d = JSON.parse(ln.slice(6));
                if (d.type === "text" || d.type === "content_block_delta") { fullText += d.text || d.delta?.text || ""; setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: fullText } : m)); }
              } catch {}
            }
          }
          if (!fullText) setMessages(prev => prev.map(m => m.id === aId && !m.content ? { ...m, content: "Ciao! Raccontami della tua impresa." } : m));
          setIsStreaming(false);
        }).catch(() => setIsStreaming(false));
    };
    window.addEventListener("onboarding-force-send", onForce);
    return () => window.removeEventListener("onboarding-force-send", onForce);
  });

  // Auto-start onboarding conversation
  useEffect(() => {
    if (isOnboarding && !autoStarted && ceoAgent && messages.length === 0 && !isStreaming && historyLoaded && onboardingReady) {
      setAutoStarted(true);
      const startMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: "Ciao! Ho appena registrato la mia impresa. Aiutami a configurare gli agenti AI.",
        timestamp: new Date(),
      };
      setMessages([startMsg]);
      setIsStreaming(true);
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", timestamp: new Date() }]);

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          companyId: selectedCompanyId,
          agentId: ceoAgent.id,
          message: startMsg.content,
          history: [],
        }),
      }).then(async (res) => {
        if (!res.ok) {
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, content: "Errore nella connessione. Riprova." } : m)
          );
          setIsStreaming(false);
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) { setIsStreaming(false); return; }
        const decoder = new TextDecoder();
        let fullText = "";
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  fullText += parsed.delta.text;
                  setMessages((prev) =>
                    prev.map((m) => m.id === assistantId ? { ...m, content: fullText } : m)
                  );
                }
              } catch {}
            }
          }
        }
        if (!fullText) {
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId && !m.content ? { ...m, content: "Ciao! Sono il CEO della tua azienda AI. Raccontami della tua impresa." } : m)
          );
        }
        if (selectedCompanyId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
        }
        setIsStreaming(false);
      }).catch(() => { setIsStreaming(false); });
    }
  }, [isOnboarding, autoStarted, ceoAgent, messages.length, isStreaming, selectedCompanyId, historyLoaded, onboardingReady]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || isStreaming || !selectedCompanyId) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", timestamp: new Date() }]);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          companyId: selectedCompanyId,
          agentId: ceoAgent?.id,
          message: userMessage.content,
          history,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Errore sconosciuto" }));
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: `**Errore:** ${err.error}` } : m)
        );
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                fullText += parsed.delta.text;
                setMessages((prev) =>
                  prev.map((m) => m.id === assistantId ? { ...m, content: fullText } : m)
                );
              }
            } catch {}
          }
        }
      }

      if (!fullText) {
        try {
          const text = decoder.decode();
          if (text) {
            buffer += text;
            const jsonMatch = buffer.match(/"text"\s*:\s*"([^"]+)"/g);
            if (jsonMatch) {
              fullText = jsonMatch.map(m => {
                try { return JSON.parse(`{${m}}`).text; } catch { return ""; }
              }).join("");
            }
          }
        } catch {}

        if (fullText) {
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, content: fullText } : m)
          );
        } else {
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, content: "Non ho ricevuto una risposta. Verifica la configurazione della API key Claude." } : m)
          );
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: "**Errore di connessione.** Riprova." } : m)
      );
    }

    if (selectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
    }
    setIsStreaming(false);
    inputRef.current?.focus();
  }

  // Determine if we should show the "go to connettori" button
  const shouldShowConnettoriButton = (() => {
    if (onboardingStep !== 2) return false;
    if (isStreaming) return false;
    if (messages.length < 4) return false;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return false;
    const content = lastMsg.content || "";
    return content.includes("Connettori") || content.includes("connettori") || content.includes("collegare");
  })();

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] max-w-5xl mx-auto">
      {/* Header */}
      <div className="glass-card p-4 mb-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(158 64% 42% / 0.15)" }}>
          <Bot className="h-5 w-5" style={{ color: "hsl(158 64% 42%)" }} />
        </div>
        <div>
          <h1 className="text-sm font-semibold">{ceoAgent?.name ?? "CEO"}</h1>
          <p className="text-xs text-muted-foreground">
            {selectedCompany?.name ?? "La tua impresa AI"} — Parla con il tuo CEO
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-12 w-12 text-muted-foreground/20 mb-4" />
            <p className="text-sm text-muted-foreground">Scrivi un messaggio per iniziare</p>
            <p className="text-xs text-muted-foreground/50 mt-1">
              Puoi chiedere qualsiasi cosa al tuo direttore AI
            </p>
            <div className="flex flex-wrap gap-2 mt-4 max-w-md justify-center">
              {[
                "Qual e lo stato delle vendite?",
                "Prepara un report mensile",
                "Assegna un task al promotore",
                "Riassumi le attivita in corso",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  className="px-3 py-1.5 rounded-full text-xs transition-all"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-1" style={{ background: "hsl(158 64% 42% / 0.15)" }}>
                <Bot className="h-3.5 w-3.5" style={{ color: "hsl(158 64% 42%)" }} />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm`}
              style={msg.role === "user" ? {
                background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
                color: "white",
              } : {
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {msg.role === "assistant" && msg.content === "" && isStreaming ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Sta scrivendo...</span>
                </div>
              ) : msg.role === "assistant" ? (
                <MarkdownBody className="prose-sm prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{msg.content}</MarkdownBody>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
            {msg.role === "user" && (
              <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-1" style={{ background: "rgba(255,255,255,0.08)" }}>
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        {/* "Go to Connettori" button during onboarding step 2 */}
        {shouldShowConnettoriButton && !showOnboardingButton && (
          <div className="flex justify-center my-4">
            <button
              onClick={async () => {
                setShowOnboardingButton(true);
                await advanceStep(3);
                const prefix = window.location.pathname.split("/")[1]; window.location.href = "/" + prefix + "/plugins";
              }}
              className="px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:scale-105"
              style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))", boxShadow: "0 4px 20px hsl(158 64% 42% / 0.4)" }}
            >
              Ho capito, andiamo ai Connettori
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="glass-card p-3 flex items-end gap-2">
        <input type="file" ref={fileInputRef} className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setInput((prev) => prev + (prev ? "\n" : "") + "[Allegato: " + f.name + "]"); } e.target.value = ""; }} />
        <button onClick={() => fileInputRef.current?.click()} className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground transition-colors" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }} disabled={isStreaming}>
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Scrivi un messaggio..."
          rows={1}
          className="flex-1 resize-none rounded-xl px-4 py-3 text-sm outline-none"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "hsl(0 0% 98%)",
            maxHeight: "120px",
          }}
          disabled={isStreaming}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || isStreaming}
          className="h-11 w-11 rounded-xl flex items-center justify-center transition-all disabled:opacity-30"
          style={{
            background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
            boxShadow: "0 4px 20px hsl(158 64% 42% / 0.3)",
          }}
        >
          <Send className="h-4 w-4 text-white" />
        </button>
      </div>
    </div>
  );
}
