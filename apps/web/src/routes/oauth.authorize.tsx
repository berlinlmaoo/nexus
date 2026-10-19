import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck, Check, X, Loader2, ListChecks, Eye, AlertTriangle } from "lucide-react";
import nexusLogo from "@/assets/nexus-logo.png";
import { ApiError, nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";

export const Route = createFileRoute("/oauth/authorize")({ component: OAuthAuthorizePage });

type Search = {
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  response_type?: string;
  resource?: string;
};

type Info = { clientName: string; redirectHost?: string; user: { name: string | null; email: string | null }; scopes: string[] };

// Hosts we recognise as the real Claude apps — anything else gets an "unverified" warning.
const TRUSTED_HOSTS = ["claude.ai", "claude.com", "anthropic.com", "localhost", "127.0.0.1"];
function isTrustedHost(host?: string) {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  return TRUSTED_HOSTS.some((d) => h === d || h.endsWith("." + d));
}
type Phase = "loading" | "login" | "consent" | "submitting" | "error";

function OAuthAuthorizePage() {
  const s = useSearch({ strict: false }) as Search;
  const { t } = useLang();
  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  // login form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const missing = !s.client_id || !s.redirect_uri || !s.code_challenge;

  const loadInfo = async () => {
    if (!s.client_id || !s.redirect_uri) return;
    try {
      const data = await nexusApi.oauthAuthorizeInfo({ client_id: s.client_id, redirect_uri: s.redirect_uri });
      setInfo(data);
      setPhase("consent");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPhase("login");
      } else {
        setError(err instanceof ApiError ? String((err.payload as { error_description?: string })?.error_description || err.message) : t("Couldn't load the connection request."));
        setPhase("error");
      }
    }
  };

  useEffect(() => {
    if (missing) {
      setError(t("This connection request is incomplete (missing OAuth parameters). Try starting over from the Claude app."));
      setPhase("error");
      return;
    }
    loadInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr(null);
    if (!email.trim() || !password) {
      setLoginErr(t("Enter your email and password first."));
      return;
    }
    setLoggingIn(true);
    try {
      const res = await nexusApi.login(email.trim(), password, "/dashboard");
      if (!res.ok) throw new Error(res.error || "Login failed");
      setPassword("");
      setPhase("loading");
      await loadInfo();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setLoginErr(t("Wrong email or password. Check them and try again."));
      else setLoginErr(t("Couldn't sign in. Check your connection and try again."));
    } finally {
      setLoggingIn(false);
    }
  };

  const decide = async (approve: boolean) => {
    if (!s.client_id || !s.redirect_uri) return;
    setPhase("submitting");
    try {
      const res = await nexusApi.oauthAuthorizeDecision({
        client_id: s.client_id,
        redirect_uri: s.redirect_uri,
        code_challenge: s.code_challenge,
        code_challenge_method: s.code_challenge_method || "S256",
        state: s.state,
        resource: s.resource,
        approve,
      });
      // Hard-navigate back to the client (Claude). redirectTo is server-built from the *registered* uri.
      window.location.href = res.redirectTo;
    } catch (err) {
      setError(err instanceof ApiError ? String((err.payload as { error_description?: string })?.error_description || err.message) : t("Couldn't process your decision."));
      setPhase("error");
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 relative overflow-hidden bg-[#fdfcfb] dark:bg-background" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-orange-200/40 blur-[120px]" />

      <div className="relative w-full max-w-md bg-white/50 dark:bg-card/80 backdrop-blur-2xl border border-white/60 dark:border-border shadow-[0_32px_64px_-16px_rgba(0,0,0,0.12)] rounded-[2rem] p-8 md:p-10">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src={nexusLogo} alt="NEXUS" className="block h-12 w-12 object-contain" />
          <div className="h-8 w-px bg-border" />
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10"><ShieldCheck className="h-6 w-6 text-primary" /></div>
        </div>

        {phase === "loading" && (
          <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm">{t("Loading connection request…")}</p>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50"><AlertTriangle className="h-6 w-6 text-red-500" /></div>
            <h1 className="text-lg font-bold">{t("Can't continue")}</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {phase === "login" && (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="text-lg font-bold">{t("Sign in to NEXUS")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("Sign in first to connect your account to Claude.")}</p>
            </div>
            <form className="space-y-3" onSubmit={onLogin}>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("Email")} autoComplete="username"
                className="w-full rounded-xl border border-border bg-white/70 dark:bg-card/90 px-4 py-3 text-sm outline-none focus:border-ring/50 focus:ring-2 focus:ring-primary/20" />
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("Password")} autoComplete="current-password"
                className="w-full rounded-xl border border-border bg-white/70 dark:bg-card/90 px-4 py-3 text-sm outline-none focus:border-ring/50 focus:ring-2 focus:ring-primary/20" />
              {loginErr && <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{loginErr}</p>}
              <button type="submit" disabled={loggingIn} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 transition active:scale-[0.98] disabled:opacity-60">
                {loggingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("Sign in")}
              </button>
            </form>
          </div>
        )}

        {(phase === "consent" || phase === "submitting") && info && (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="text-lg font-bold"><span className="text-primary">{info.clientName}</span> {t("wants to connect to NEXUS")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("Signed in as")} <span className="font-semibold text-foreground">{info.user.email ?? info.user.name ?? t("you")}</span></p>
            </div>

            <div className="rounded-2xl border border-border bg-white/60 dark:bg-card/90 p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("It will be allowed to:")}</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2"><Eye className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {t("View the projects and tasks you have access to")}</li>
                <li className="flex items-start gap-2"><ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {t("Create and edit tasks (move section, status, assignee and so on)")}</li>
              </ul>
              <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{t("Claude acts as you, with exactly the same access you have. It can't touch XP, day off, attendance or admin settings.")}</p>
            </div>

            {info.redirectHost && (
              <div className={`rounded-xl border px-3 py-2 text-xs ${isTrustedHost(info.redirectHost) ? "border-border bg-white/60 dark:bg-card/90 text-muted-foreground" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                {!isTrustedHost(info.redirectHost) && <span className="mb-0.5 flex items-center gap-1 font-bold"><AlertTriangle className="h-3.5 w-3.5" /> {t("This app isn't verified by NEXUS")}</span>}
                {t("Authorization code sent to:")} <span className="font-mono font-semibold">{info.redirectHost}</span>
                {!isTrustedHost(info.redirectHost) && <span className="mt-0.5 block">{t("If you don't recognize this host, don't allow it.")}</span>}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => decide(false)} disabled={phase === "submitting"} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-white/70 dark:bg-card/90 py-3 text-sm font-semibold transition hover:bg-accent active:scale-[0.98] disabled:opacity-60">
                <X className="h-4 w-4" /> {t("Deny")}
              </button>
              <button onClick={() => decide(true)} disabled={phase === "submitting"} className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 transition active:scale-[0.98] disabled:opacity-60">
                {phase === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("Allow")}
              </button>
            </div>
          </div>
        )}

        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full border-2 border-white dark:border-background bg-[#FF7F50] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white shadow-lg">{t("Secure connection")}</div>
      </div>
    </div>
  );
}
