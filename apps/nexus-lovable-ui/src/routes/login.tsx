import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import nexusLogo from "@/assets/nexus-logo.png";
import { celebrate } from "@/components/Celebration";
import { ApiError, nexusApi } from "@/lib/nexus-api";

export const Route = createFileRoute("/login")({ component: LoginPage });

function getSafeCallbackUrl(value: unknown) {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { callbackUrl?: string; error?: string };
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(search.error ? "Access denied. Double-check your email/password." : null);
  const callbackUrl = getSafeCallbackUrl(search.callbackUrl);

  useEffect(() => {
    const t = setTimeout(() => setShowForm(true), 900);
    return () => clearTimeout(t);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const emailValue = email.trim();
    if (!emailValue || !password) {
      setError("Fill in your Access ID and Encryption Key first.");
      return;
    }

    setLoading(true);
    try {
      const result = await nexusApi.login(emailValue, password, callbackUrl);
      if (!result.ok) throw new Error(result.error || "Login failed");
      celebrate("Welcome back, Commander! 🚀");
      setPassword("");
      const target = getSafeCallbackUrl(result.redirectTo || callbackUrl);
      setTimeout(() => navigate({ to: target }), 250);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("That access code doesn't match. Give your email/password another look.");
      } else if (err instanceof ApiError && err.status === 403) {
        setError("The NEXUS core doesn't trust this login origin yet. Check the proxy/config.");
      } else {
        setError("Login uplink failed. Make sure the NEXUS core on port 3000 is up.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6 relative overflow-hidden bg-[#fdfcfb]"
      style={{ fontFamily: "Plus Jakarta Sans, sans-serif", perspective: "1400px" }}
    >
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[120px] animate-pulse will-change-[opacity]" />
      <div
        className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-orange-200/40 blur-[120px] animate-pulse will-change-[opacity]"
        style={{ animationDelay: "1s" }}
      />
      <div className="absolute top-[20%] right-[10%] w-[30%] h-[40%] rounded-full bg-purple-200/20 blur-[100px]" />

      <div
        className="fixed inset-0 z-30 flex items-center justify-center pointer-events-none"
        style={{ opacity: showForm ? 0 : 1, transition: "opacity 500ms ease-out" }}
      >
        <div className="relative">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-primary/30 blur-3xl" />
          <div style={{ transformStyle: "preserve-3d", willChange: "transform, opacity, filter", animation: "logoIntro 900ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
            <img src={nexusLogo} alt="Nexus" className="relative block w-40 h-40 object-contain drop-shadow-[0_20px_40px_rgba(79,70,229,0.4)]" />
          </div>
        </div>
      </div>

      <div
        className="relative w-full max-w-md bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] rounded-[2.5rem] p-10 md:p-12"
        style={{
          willChange: "transform, opacity",
          opacity: showForm ? undefined : 0,
          transform: showForm ? undefined : "translateY(24px) scale(0.96)",
          pointerEvents: showForm ? undefined : "none",
          animation: showForm ? "cardReveal 700ms cubic-bezier(0.22, 1, 0.36, 1) 100ms both" : undefined,
        }}
      >
        <div className="mb-6 flex justify-center">
          <img src={nexusLogo} alt="Nexus" className="block h-20 w-20 object-contain drop-shadow-[0_12px_24px_rgba(79,70,229,0.35)]" />
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-[0.2em] text-foreground uppercase">
            NEXUS{" "}
            {/* easter egg: clicking PHAËTHON opens the hidden /phaethon page */}
            <Link to="/phaethon" className="rounded transition-colors duration-300 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="Phaëthon">Phaëthon</Link>
          </h1>
        </div>

        <form className="space-y-6" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1 block">Access ID (Email)</label>
            <input
              type="email"
              required
              disabled={loading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="commander@nexus.app"
              autoComplete="username"
              className="w-full bg-white/60 border border-white/80 rounded-2xl px-5 py-4 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all shadow-sm disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1">Encryption Key</label>
              <a href="/forgot-password" className="text-[11px] font-bold uppercase tracking-wider text-primary hover:text-primary/80 transition-colors">Forgot?</a>
            </div>
            <input
              type="password"
              required
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full bg-white/60 border border-white/80 rounded-2xl px-5 py-4 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all shadow-sm disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
              {error}
            </div>
          )}

          {loading && (
            <div className="relative h-0.5 w-full overflow-hidden rounded-full bg-primary/15">
              <div className="absolute inset-y-1/2 left-0 h-full w-1/3 -translate-y-1/2 rounded-full bg-primary animate-[shimmer_1.2s_infinite]" />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-4 rounded-2xl shadow-xl shadow-primary/25 transition-all active:scale-[0.98] flex items-center justify-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Opening uplink...</span>
              </>
            ) : (
              <>
                <span>Enter Mission Control</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>
        </form>

        <div className="mt-10 text-center">
          <p className="text-sm text-muted-foreground">New operative? <a href="/register" className="text-primary font-bold hover:underline underline-offset-4 decoration-2 decoration-primary/30 transition-all ml-1">Request access</a></p>
        </div>

        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-[#FF7F50] text-white text-[10px] font-bold uppercase tracking-[0.2em] rounded-full shadow-lg border-2 border-white">Secure Uplink Ready</div>
      </div>

      <style>{`
        @keyframes logoIntro {
          0% { transform: rotateY(-540deg) rotateX(40deg) scale(0.2); opacity: 0; filter: blur(20px); }
          50% { opacity: 1; filter: blur(0); }
          100% { transform: rotateY(0deg) rotateX(0deg) scale(1); opacity: 1; filter: blur(0); }
        }
        @keyframes cardReveal {
          0% { opacity: 0; transform: translateY(24px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes shimmer {
          1% { left: -40%; }
          60% { left: 110%; }
          100% { left: 110%; }
        }
      `}</style>
    </div>
  );
}
