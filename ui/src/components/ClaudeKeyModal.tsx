import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { Key, ExternalLink, AlertCircle, ChevronRight } from "lucide-react";

// Liquid glass styles matching goitalia.eu
const glass = {
  card: {
    background: "linear-gradient(135deg, hsl(0 0% 100% / 0.12) 0%, hsl(0 0% 100% / 0.06) 50%, hsl(0 0% 100% / 0.03) 100%)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid hsl(0 0% 100% / 0.18)",
    boxShadow: "0 8px 32px hsl(0 0% 0% / 0.3), inset 0 1px 0 0 hsl(0 0% 100% / 0.15), inset 0 -1px 0 0 hsl(0 0% 0% / 0.05)",
  } as React.CSSProperties,
  step: {
    background: "linear-gradient(135deg, hsl(0 0% 100% / 0.06) 0%, hsl(0 0% 100% / 0.02) 100%)",
    border: "1px solid hsl(0 0% 100% / 0.08)",
  } as React.CSSProperties,
  input: {
    background: "hsl(215 30% 12%)",
    border: "1px solid hsl(0 0% 100% / 0.15)",
  } as React.CSSProperties,
  btn: {
    background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
    boxShadow: "0 4px 20px hsl(158 64% 42% / 0.35), 0 0 0 1px hsl(158 64% 42% / 0.1) inset",
  } as React.CSSProperties,
  overlay: {
    background: `
      radial-gradient(ellipse at 30% 30%, hsl(158 64% 42% / 0.08) 0%, transparent 50%),
      radial-gradient(ellipse at 70% 70%, hsl(170 50% 50% / 0.05) 0%, transparent 50%),
      hsl(0 0% 0% / 0.8)
    `,
    backdropFilter: "blur(12px)",
  } as React.CSSProperties,
};

export function ClaudeKeyModal() {
  const { selectedCompany } = useCompany();
  const [visible, setVisible] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!selectedCompany) return;
    setChecking(true);
    fetch(`/api/onboarding/claude-key/${selectedCompany.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.hasKey) setVisible(true);
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [selectedCompany]);

  if (checking || !visible || success) return null;

  const handleSubmit = async () => {
    if (!selectedCompany || !apiKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/claude-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Errore nel salvataggio");
        setLoading(false);
        return;
      }
      setApiKey(""); // Clear key from memory immediately
      setSuccess(true);
      setTimeout(() => setVisible(false), 1500);
    } catch {
      setError("Errore di connessione");
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={glass.overlay}>
      <div className="w-full max-w-lg rounded-[2rem] overflow-hidden" style={glass.card}>

        {/* Gradient accent top */}
        <div className="h-1" style={{ background: "linear-gradient(90deg, hsl(158 64% 42%), hsl(170 50% 50%), hsl(158 64% 42%))" }} />

        {/* Header */}
        <div className="p-8 pb-5">
          <div className="flex items-center gap-4 mb-1">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "hsl(158 64% 42% / 0.15)", border: "1px solid hsl(158 64% 42% / 0.25)" }}>
              <Key className="w-6 h-6" style={{ color: "hsl(158 64% 42%)" }} />
            </div>
            <div>
              <h2 className="text-xl font-black" style={{ color: "hsl(0 0% 98%)" }}>Collega Claude AI</h2>
              <p className="text-sm" style={{ color: "hsl(215 20% 60%)" }}>Inserisci la tua API key per attivare gli agenti</p>
            </div>
          </div>
        </div>

        {/* Tutorial */}
        <div className="px-8 pb-6 space-y-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "hsl(158 64% 42%)" }}>Come ottenere la API key</p>

          <div className="space-y-2.5">
            <div className="flex items-start gap-3 p-4 rounded-2xl" style={glass.step}>
              <span className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: "hsl(158 64% 42% / 0.2)", color: "hsl(158 64% 42%)" }}>1</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: "hsl(0 0% 98%)" }}>Crea un account su Anthropic</p>
                <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-xs inline-flex items-center gap-1 mt-1 hover:underline" style={{ color: "hsl(158 64% 42%)" }}>
                  console.anthropic.com <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-2xl" style={glass.step}>
              <span className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: "hsl(158 64% 42% / 0.2)", color: "hsl(158 64% 42%)" }}>2</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: "hsl(0 0% 98%)" }}>Vai su "API Keys" nel menu</p>
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-xs inline-flex items-center gap-1 mt-1 hover:underline" style={{ color: "hsl(158 64% 42%)" }}>
                  Vai alle API Keys <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-2xl" style={glass.step}>
              <span className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: "hsl(158 64% 42% / 0.2)", color: "hsl(158 64% 42%)" }}>3</span>
              <p className="text-sm font-semibold" style={{ color: "hsl(0 0% 98%)" }}>Clicca "Create Key", copia la chiave e incollala qui sotto</p>
            </div>
          </div>

          {/* Input */}
          <div>
            <label className="text-xs font-medium mb-2 block" style={{ color: "hsl(215 20% 70%)" }}>API Key *</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setError(null); }}
              placeholder="sk-ant-api03-..."
              className="w-full px-4 py-3.5 rounded-2xl text-sm focus:outline-none transition-colors"
              style={{
                ...glass.input,
                color: "hsl(0 0% 98%)",
                borderColor: apiKey && !apiKey.startsWith("sk-ant-") ? "hsl(0 65% 50% / 0.5)" : error ? "hsl(0 65% 50% / 0.5)" : "hsl(0 0% 100% / 0.15)",
              }}
              autoComplete="off"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2.5 p-4 rounded-2xl text-sm" style={{ background: "hsl(0 65% 50% / 0.1)", border: "1px solid hsl(0 65% 50% / 0.2)", color: "hsl(0 65% 65%)" }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Note */}
          <p className="text-xs" style={{ color: "hsl(215 20% 45%)" }}>
            La key viene verificata con una chiamata di test e salvata in modo sicuro. Non viene mai condivisa.
          </p>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={!apiKey || !apiKey.startsWith("sk-ant-") || loading}
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg"
            style={!apiKey || !apiKey.startsWith("sk-ant-") || loading ? {} : glass.btn}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Verifica in corso...
              </>
            ) : (
              <>
                Attiva agenti <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
