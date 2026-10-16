import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowRight, KeyRound, Loader2 } from "lucide-react";
import nexusLogo from "@/assets/nexus-logo.png";
import { celebrate } from "@/components/Celebration";
import { ApiError, nexusApi } from "@/lib/nexus-api";
import { passkeysSupported, signInWithPasskey } from "@/lib/passkey";
import { useLang } from "@/lib/lang";

export const Route = createFileRoute("/login")({ component: LoginPage });

function getSafeCallbackUrl(value: unknown) {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function LoginPage() {
  const navigate = useNavigate();
  const lang = useLang();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as { callbackUrl?: string; error?: string };
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  // Resolved after mount: the render that runs on the server has no `window` to ask.
  const [passkeyReady, setPasskeyReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(search.error ? lang.t("Access denied. Check your email and password.") : null);
  const callbackUrl = getSafeCallbackUrl(search.callbackUrl);

  useEffect(() => {
    const t = setTimeout(() => setShowForm(true), 900);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setPasskeyReady(passkeysSupported());
  }, []);

  // Already signed in (QA R2 Manager B29: /login showed the form): go where they were heading. A plain fetch,
  // not the shared query cache, so a stale cached 401 can't send them back here.
  useEffect(() => {
    let alive = true;
    fetch("/api/user/profile", { credentials: "include", headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { user?: { id?: string } } | null) => { if (alive && j?.user?.id) { queryClient.clear(); void navigate({ to: callbackUrl, replace: true }); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared landing for both sign-in paths. Drop every cached query before leaving /login: the
  // QueryClient outlives this route, so the 401 that bounced the user here is still cached, and
  // navigating back in would hand `_app` that stale error and it would redirect straight to /login
  // again — an unbreakable loop that only a full page reload could clear. Clearing the cache makes
  // the next screen refetch clean.
  const enterMissionControl = (target: string) => {
    queryClient.clear();
    celebrate(lang.t("Welcome back!"));
    setTimeout(() => navigate({ to: target }), 250);
  };

  const onPasskey = async () => {
    setError(null);
    setPasskeyLoading(true);
    try {
      const result = await signInWithPasskey();
      // Dismissed the system prompt — that's a choice, not a failure. Leave the form as it was.
      if (!result.ok) return;
      // The server already set the session cookie; there's no token for us to keep.
      enterMissionControl(callbackUrl);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(lang.t("This device's passkey isn't registered. Sign in with your password, then add it in Settings."));
      } else {
        setError(lang.t("Passkey sign-in failed. Use your email and password instead."));
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const emailValue = email.trim();
    if (!emailValue || !password) {
      setError(lang.t("Enter your email and password first."));
      return;
    }

    setLoading(true);
    try {
      const result = await nexusApi.login(emailValue, password, callbackUrl);
      if (!result.ok) throw new Error(result.error || "Login failed");
      setPassword("");
      enterMissionControl(getSafeCallbackUrl(result.redirectTo || callbackUrl));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && (err.payload as { error?: string } | null)?.error === "AccountDeactivated") {
        // Offboarded (left the company): the right password, refused on purpose. Say so, not "wrong password".
        setError(lang.t("This account has been deactivated. Ask the board if you think this is a mistake."));
      } else if (err instanceof ApiError && err.status === 401) {
        setError(lang.t("Wrong email or password. Check them and try again."));
      } else if (err instanceof ApiError && err.status === 403) {
        setError(lang.t("Sign-in from this address isn't allowed. Contact your IT admin."));
      } else {
        setError(lang.t("Couldn't sign in. Check your connection and try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6 relative overflow-hidden bg-[#fdfcfb] dark:bg-background"
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
            <img src={nexusLogo} alt="NEXUS" className="relative block w-40 h-40 object-contain drop-shadow-[0_20px_40px_rgba(79,70,229,0.4)]" />
          </div>
        </div>
      </div>

      <div
        className="relative w-full max-w-md bg-white/40 dark:bg-card/80 backdrop-blur-2xl border border-white/60 dark:border-border shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] rounded-[2.5rem] p-10 md:p-12"
        style={{
          willChange: "transform, opacity",
          opacity: showForm ? undefined : 0,
          transform: showForm ? undefined : "translateY(24px) scale(0.96)",
          pointerEvents: showForm ? undefined : "none",
          animation: showForm ? "cardReveal 700ms cubic-bezier(0.22, 1, 0.36, 1) 100ms both" : undefined,
        }}
      >
        <div className="mb-6 flex justify-center">
          <img src={nexusLogo} alt="NEXUS" className="block h-20 w-20 object-contain drop-shadow-[0_12px_24px_rgba(79,70,229,0.35)]" />
        </div>

        <div className="mb-8 text-center">
          {/* Phone: smaller and tighter, so "NEXUS PHAËTHON" stays on one line in the padded card. */}
          <h1 className="whitespace-nowrap text-xl font-bold tracking-[0.12em] text-foreground uppercase sm:text-2xl sm:tracking-[0.2em]">
            NEXUS{" "}
            {/* easter egg: clicking PHAËTHON opens the hidden /phaethon page */}
            <Link to="/phaethon" className="rounded transition-colors duration-300 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="Phaëthon">Phaëthon</Link>
          </h1>
        </div>

        <form className="space-y-6" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground ml-1 block">{lang.t("Email")}</label>
            <input
              type="email"
              required
              disabled={loading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={lang.t("name@company.com")}
              autoComplete="username"
              className="w-full bg-white/60 dark:bg-card/90 border border-white/80 dark:border-border rounded-2xl px-5 py-4 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all shadow-sm disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium text-muted-foreground ml-1">{lang.t("Password")}</label>
              <a href="/forgot-password" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">{lang.t("Forgot password?")}</a>
            </div>
            <input
              type="password"
              required
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full bg-white/60 dark:bg-card/90 border border-white/80 dark:border-border rounded-2xl px-5 py-4 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all shadow-sm disabled:opacity-50"
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
            disabled={loading || passkeyLoading}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-4 rounded-2xl shadow-xl shadow-primary/25 transition-all active:scale-[0.98] flex items-center justify-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{lang.t("Signing in…")}</span>
              </>
            ) : (
              <>
                <span>{lang.t("Sign in")}</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>
        </form>

        {passkeyReady && (
          <>
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-foreground/10" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{lang.t("or")}</span>
              <div className="h-px flex-1 bg-foreground/10" />
            </div>

            <button
              type="button"
              onClick={onPasskey}
              disabled={loading || passkeyLoading}
              className="w-full bg-white/60 dark:bg-card/90 hover:bg-white/80 dark:hover:bg-accent border border-white/80 dark:border-border text-foreground font-bold py-4 rounded-2xl shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {passkeyLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{lang.t("Waiting for your device…")}</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>{lang.t("Sign in with a passkey")}</span>
                </>
              )}
            </button>
          </>
        )}

        <div className="mt-10 text-center">
          <p className="text-sm text-muted-foreground">{lang.t("New here?")} <a href="/register" className="text-primary font-bold hover:underline underline-offset-4 decoration-2 decoration-primary/30 transition-all ml-1">{lang.t("Request access")}</a></p>
        </div>

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
