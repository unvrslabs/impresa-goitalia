import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { Send, Bot, User, Loader2 } from "lucide-react";
import { MarkdownBody } from "../components/MarkdownBody";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function ChatPage() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    setBreadcrumbs([{ label: "Chat" }]);
  }, [setBreadcrumbs]);

  // Auto-start onboarding conversation
  useEffect(() => {
    if (isOnboarding && !autoStarted && ceoAgent && messages.length === 0 && !isStreaming) {
      setAutoStarted(true);
      // Simulate sending a start message
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

      const history = [{ role: "user" as const, content: startMsg.content }];
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
            prev.map((m) => m.id === assistantId && !m.content ? { ...m, content: "Ciao! Sono il tuo Direttore AI. Raccontami della tua impresa." } : m)
          );
        }
        if (selectedCompanyId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
        }
        setIsStreaming(false);
      }).catch(() => { setIsStreaming(false); });
    }
  }, [isOnboarding, autoStarted, ceoAgent, messages.length, isStreaming, selectedCompanyId]);

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

      // Parse SSE stream from Claude
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
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
            } catch {
              // Not JSON, skip
            }
          }
        }
      }

      // If no streaming text was parsed, try reading as regular JSON
      if (!fullText) {
        try {
          const text = decoder.decode();
          if (text) {
            buffer += text;
            // Try to find content in accumulated buffer
            const jsonMatch = buffer.match(/"text"\s*:\s*"([^"]+)"/g);
            if (jsonMatch) {
              fullText = jsonMatch.map(m => {
                try { return JSON.parse(`{${m}}`).text; } catch { return ""; }
              }).join("");
            }
          }
        } catch { /* ignore */ }

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

    // Refresh sidebar in case agent was created/deleted
    if (selectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
    }
    setIsStreaming(false);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="glass-card p-4 mb-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(158 64% 42% / 0.15)" }}>
          <Bot className="h-5 w-5" style={{ color: "hsl(158 64% 42%)" }} />
        </div>
        <div>
          <h1 className="text-sm font-semibold">{ceoAgent?.name ?? "CEO"}</h1>
          <p className="text-xs text-muted-foreground">
            {selectedCompany?.name ?? "La tua impresa AI"} — Parla con il tuo direttore AI
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
                "Qual è lo stato delle vendite?",
                "Prepara un report mensile",
                "Assegna un task al promotore",
                "Riassumi le attività in corso",
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
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === "user" ? "" : ""
              }`}
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
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="glass-card p-3 flex items-end gap-2">
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
