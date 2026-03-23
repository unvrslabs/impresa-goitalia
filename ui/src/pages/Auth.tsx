import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";

type Mode = "login" | "register";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const { data: session, isLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session) navigate(nextPath, { replace: true });
  }, [session, navigate, nextPath]);

  const loginMutation = useMutation({
    mutationFn: () => authApi.signInEmail({ email: email.trim(), password }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Credenziali non valide"),
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      // Call activate which does signup + company creation in one step
      const res = await fetch("/api/onboarding/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          email: email.trim(),
          password,
          members: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Errore nella registrazione");
      }
      // Now sign in to get session
      await authApi.signInEmail({ email: email.trim(), password });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      // After registration, redirect to home - app routes to company dashboard
      // Then user can go to API Claude from there
      window.location.href = "/";
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("422") || msg.includes("409")) {
        setError("Questa email è già registrata. Prova ad accedere.");
      } else {
        setError(msg || "Registrazione fallita. Riprova.");
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "login") {
      if (!email.trim() || !password) { setError("Inserisci email e password"); return; }
      loginMutation.mutate();
    } else {
      if (!companyName.trim()) { setError("Il nome dell'impresa è obbligatorio"); return; }
      if (!email.trim()) { setError("L'email è obbligatoria"); return; }
      if (password.length < 8) { setError("La password deve avere almeno 8 caratteri"); return; }
      if (password !== confirmPassword) { setError("Le password non corrispondono"); return; }
      registerMutation.mutate();
    }
  }

  const isPending = loginMutation.isPending || registerMutation.isPending;

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      </div>
    );
  }

  const inputStyle = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "hsl(0 0% 98%)",
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{
      background: `
        radial-gradient(ellipse at 20% 20%, rgba(39, 176, 125, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 10%, rgba(64, 191, 170, 0.08) 0%, transparent 40%),
        radial-gradient(ellipse at 50% 60%, rgba(39, 176, 125, 0.06) 0%, transparent 50%),
        linear-gradient(rgb(15, 22, 36), rgb(12, 16, 24), rgb(9, 11, 17))
      `,
    }}>
      <div
        className="w-full max-w-md overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.01) 100%)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
          borderRadius: "2rem",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}
      >
        {/* Green accent top */}
        <div className="h-1" style={{ background: "linear-gradient(90deg, hsl(158 64% 42%), hsl(170 50% 50%), hsl(158 64% 42%))" }} />

        <div className="p-8">
          {/* Logo */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-black tracking-tight">
              <span style={{ color: "hsl(0 65% 50%)" }}>GO</span>{" "}
              <span className="text-white">ITAL</span>{" "}
              <span style={{ color: "hsl(158 64% 42%)" }}>IA</span>
            </h1>
            <p className="text-xs mt-2" style={{ color: "hsl(215 20% 55%)" }}>
              La tua impresa, potenziata dall'AI
            </p>
          </div>

          {/* Tab switch */}
          <div className="flex gap-1 p-1 rounded-xl mb-6" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
              style={mode === "login" ? {
                background: "linear-gradient(135deg, hsl(158 64% 42% / 0.25), hsl(158 64% 42% / 0.15))",
                color: "white",
              } : { color: "hsl(215 20% 55%)" }}
              onClick={() => { setMode("login"); setError(null); }}
            >
              Accedi
            </button>
            <button
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
              style={mode === "register" ? {
                background: "linear-gradient(135deg, hsl(158 64% 42% / 0.25), hsl(158 64% 42% / 0.15))",
                color: "white",
              } : { color: "hsl(215 20% 55%)" }}
              onClick={() => { setMode("register"); setError(null); }}
            >
              Registrati
            </button>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "register" && (
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Nome impresa *</label>
                <input
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                  style={inputStyle}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="es. Rossi & Partners S.r.l."
                  autoComplete="organization"
                />
              </div>
            )}
            <div>
              <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Email *</label>
              <input
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                style={inputStyle}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="la-tua@email.it"
                autoComplete="email"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Password *</label>
              <input
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                style={inputStyle}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "Minimo 8 caratteri" : "La tua password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Conferma password *</label>
                <input
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                  style={inputStyle}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ripeti la password"
                  autoComplete="new-password"
                />
              </div>
            )}

            {error && (
              <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "hsl(0 65% 65%)" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
                boxShadow: "0 4px 20px hsl(158 64% 42% / 0.3)",
              }}
            >
              {isPending
                ? "Caricamento..."
                : mode === "login"
                  ? "Accedi"
                  : "Crea la tua impresa AI"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
