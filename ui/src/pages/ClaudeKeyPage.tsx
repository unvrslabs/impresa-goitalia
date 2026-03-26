import { useState, useEffect } from "react";
import { useNavigate } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useOnboarding } from "../context/OnboardingContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Key, ExternalLink, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

export function ClaudeKeyPage() {
  const { selectedCompanyId } = useCompany();
  const { advanceStep } = useOnboarding();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setBreadcrumbs([{ label: "API Claude" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    setChecking(true);
    fetch(`/api/onboarding/claude-key/${selectedCompanyId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { setHasKey(!!data.hasKey); setChecking(false); })
      .catch(() => setChecking(false));
  }, [selectedCompanyId]);

  async function handleSave() {
    if (!selectedCompanyId || !apiKey) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/onboarding/claude-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompanyId, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Errore nel salvataggio");
        setLoading(false);
        return;
      }
      setApiKey("");
      setSuccess(true);
      setHasKey(true);
      // Advance onboarding to step 1 (chat CEO) via context
      await advanceStep(1);
      // tooltip will guide user to chat
    } catch {
      setError("Errore di connessione");
    }
    setLoading(false);
  }

  const inputStyle = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "hsl(0 0% 98%)",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl flex items-center justify-center" style={{ background: "hsl(158 64% 42% / 0.15)" }}>
          <Key className="h-6 w-6" style={{ color: "hsl(158 64% 42%)" }} />
        </div>
        <div>
          <h1 className="text-lg font-semibold">API Claude</h1>
          <p className="text-sm text-muted-foreground">Configura la chiave API per attivare gli agenti AI</p>
        </div>
      </div>

      {/* Status */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-semibold">Stato connessione</h2>
        </div>
        {checking ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifica in corso...
          </div>
        ) : hasKey ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "hsl(158 64% 52%)" }}>
            <CheckCircle className="h-4 w-4" />
            API key configurata e attiva
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm" style={{ color: "hsl(38 92% 55%)" }}>
            <AlertCircle className="h-4 w-4" />
            Nessuna API key configurata — gli agenti non possono funzionare
          </div>
        )}
      </div>

      {/* Input */}
      <div className="glass-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">{hasKey ? "Aggiorna API key" : "Inserisci API key"}</h2>

        <div>
          <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>API Key *</label>
          {hasKey && !apiKey ? (
            <div
              className="w-full rounded-xl px-4 py-3 text-sm flex items-center justify-between cursor-pointer"
              style={{ ...inputStyle }}
              onClick={() => setHasKey(false)}
            >
              <span className="tracking-widest text-muted-foreground">••••••••••••••••••••</span>
              <span className="text-xs text-muted-foreground/50 ml-2">Clicca per aggiornare</span>
            </div>
          ) : (
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setError(null); }}
              placeholder="sk-ant-api03-..."
              className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
              style={{
                ...inputStyle,
                borderColor: apiKey && !apiKey.startsWith("sk-ant-") ? "hsl(0 65% 50% / 0.5)" : error ? "hsl(0 65% 50% / 0.5)" : "rgba(255,255,255,0.12)",
              }}
              autoComplete="off"
            />
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "hsl(0 65% 65%)" }}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 p-3 rounded-xl text-xs" style={{ background: "hsl(158 64% 42% / 0.08)", border: "1px solid hsl(158 64% 42% / 0.2)", color: "hsl(158 64% 52%)" }}>
            <CheckCircle className="w-4 h-4 shrink-0" />
            API key salvata e verificata con successo!
          </div>
        )}

        <p className="text-xs text-muted-foreground/50">
          La key viene verificata con una chiamata di test e salvata in modo sicuro. Non viene mai condivisa.
        </p>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={!apiKey || !apiKey.startsWith("sk-ant-") || loading}
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
              boxShadow: "0 4px 20px hsl(158 64% 42% / 0.3)",
            }}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifica in corso...
              </>
            ) : (
              <>
                <Key className="h-4 w-4" />
                {hasKey ? "Aggiorna API key" : "Salva e attiva"}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tutorial */}
      <div className="glass-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">Come ottenere la API key</h2>

        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0" style={{ background: "hsl(158 64% 42% / 0.2)", color: "hsl(158 64% 42%)" }}>1</span>
            <div>
              <p className="text-sm font-medium">Crea un account su Anthropic</p>
              <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-xs inline-flex items-center gap-1 mt-1" style={{ color: "hsl(158 64% 42%)" }}>
                console.anthropic.com <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0" style={{ background: "hsl(158 64% 42% / 0.2)", color: "hsl(158 64% 42%)" }}>2</span>
            <div>
              <p className="text-sm font-medium">Vai su "API Keys" nel menu</p>
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-xs inline-flex items-center gap-1 mt-1" style={{ color: "hsl(158 64% 42%)" }}>
                Vai alle API Keys <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0" style={{ background: "hsl(158 64% 42% / 0.2)", color: "hsl(158 64% 42%)" }}>3</span>
            <p className="text-sm font-medium">Clicca "Create Key", copia la chiave e incollala qui sopra</p>
          </div>
        </div>
      </div>
    </div>
  );
}
