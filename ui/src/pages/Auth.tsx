import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session) {
      navigate(nextPath, { replace: true });
    }
  }, [session, navigate, nextPath]);

  const mutation = useMutation({
    mutationFn: async () => {
      await authApi.signInEmail({ email: email.trim(), password });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Autenticazione fallita");
    },
  });

  const canSubmit = email.trim().length > 0 && password.trim().length > 0;

  if (isSessionLoading) {
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
          <div className="text-center mb-8">
            <h1 className="text-2xl font-black tracking-tight">
              <span style={{ color: "hsl(0 65% 50%)" }}>GO</span>{" "}
              <span className="text-white">ITAL</span>{" "}
              <span style={{ color: "hsl(158 64% 42%)" }}>IA</span>
            </h1>
            <p className="text-xs mt-2" style={{ color: "hsl(215 20% 55%)" }}>
              La tua impresa, potenziata dall'AI
            </p>
          </div>

          {/* Title */}
          <h2 className="text-lg font-semibold text-center mb-1" style={{ color: "hsl(0 0% 98%)" }}>
            "Accedi"
          </h2>
          <p className="text-xs text-center mb-6" style={{ color: "hsl(215 20% 55%)" }}>
            "Inserisci le tue credenziali per accedere"
          </p>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (mutation.isPending || !canSubmit) return;
              mutation.mutate();
            }}
          >

            <div>
              <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Email</label>
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
              <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Password</label>
              <input
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                style={inputStyle}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="La tua password"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "hsl(0 65% 65%)" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={mutation.isPending || !canSubmit}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
                boxShadow: "0 4px 20px hsl(158 64% 42% / 0.3)",
              }}
            >
              {mutation.isPending ? "Caricamento..." : "Accedi"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm" style={{ color: "hsl(215 20% 55%)" }}>
            Non hai un account?{" "}
            <a
              href="/start"
              className="font-medium underline underline-offset-2 transition-colors"
              style={{ color: "hsl(158 64% 52%)" }}
            >
              Crea la tua impresa AI
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
