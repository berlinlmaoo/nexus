import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2, ShieldCheck, Eye, EyeOff, RotateCcw, ArrowLeft } from "lucide-react";
import nexusLogo from "@/assets/nexus-logo.png";
import { ApiError, nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
  // Invite emails link here as ?email=…&invited=1. The default search parser JSON-decodes values,
  // so `invited=1` arrives as the number 1 — accept every spelling.
  validateSearch: (s: Record<string, unknown>): { email?: string; invited?: boolean } => ({
    ...(typeof s.email === "string" && s.email.trim() ? { email: s.email.trim() } : {}),
    ...(s.invited === 1 || s.invited === "1" || s.invited === true ? { invited: true } : {}),
  }),
});

const errOf = (e: unknown, fb: string) => (e instanceof ApiError ? ((e.payload as { error?: string; message?: string } | null)?.error ?? (e.payload as { message?: string } | null)?.message ?? fb) : fb);

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { t } = useLang();
  const search = Route.useSearch();
  const invited = search.invited === true;
  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState(search.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null);
    const em = email.trim();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setError(t("Enter a valid email first.")); return; }
    setLoading(true);
    try {
      const r = await nexusApi.passwordResetRequest(em);
      setStep("verify");
      setCooldown(r.resendCooldownSeconds ?? 60);
      setInfo(t("If {email} is registered, a 6-digit code is on its way to that inbox.", { email: em }));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t("Too many tries. Wait a few minutes.") : errOf(err, t("Couldn't send the code. Try again in a moment.")));
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) { setError(t("The code has to be 6 digits.")); return; }
    if (password.length < 8) { setError(t("The new password needs at least 8 characters.")); return; }
    if (password !== confirm) { setError(t("The passwords don't match.")); return; }
    setLoading(true);
    try {
      await nexusApi.passwordResetVerify({ email: email.trim(), code, password });
      setError(null);
      setInfo(invited ? t("Password set. Taking you to sign in…") : t("Password reset. Taking you to sign in…"));
      setTimeout(() => navigate({ to: "/login" }), 1200);
    } catch (err) {
      setError(errOf(err, t("Wrong or expired code. Check it or send a new one.")));
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || loading) return;
    setError(null);
    try {
      const r = await nexusApi.passwordResetResend(email.trim());
      setCooldown(r.resendCooldownSeconds ?? 60);
      setInfo(t("A new code is on its way."));
    } catch (err) {
      const retry = err instanceof ApiError ? (err.payload as { retryAfterSeconds?: number } | null)?.retryAfterSeconds : undefined;
      if (typeof retry === "number") setCooldown(retry);
      setError(errOf(err, t("Can't resend yet. Wait a moment.")));
    }
  };

  const inputCls = "w-full bg-white/60 dark:bg-card/90 border border-white/80 dark:border-border rounded-2xl px-5 py-4 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-ring/50 transition-all shadow-sm disabled:opacity-50";

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 relative overflow-hidden bg-[#fdfcfb] dark:bg-background" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[120px] animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-orange-200/40 blur-[120px] animate-pulse" style={{ animationDelay: "1s" }} />

      <div className="relative w-full max-w-md bg-white/40 dark:bg-card/80 backdrop-blur-2xl border border-white/60 dark:border-border shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] rounded-[2.5rem] p-10 md:p-12">
        <div className="mb-6 flex justify-center">
          <img src={nexusLogo} alt="NEXUS" className="block h-16 w-16 object-contain drop-shadow-[0_12px_24px_rgba(79,70,229,0.35)]" />
        </div>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" /></div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{invited ? t("Set your password") : t("Reset password")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{step === "request" ? (invited ? t("You've been invited to NEXUS. We'll email you a code to set your password.") : t("Enter your email and we'll send you a verification code.")) : t("Enter the code we sent to {email}, plus a new password.", { email })}</p>
        </div>

        {step === "request" ? (
          <form className="space-y-5" onSubmit={requestCode}>
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Email")}</label>
              <input type="email" required autoFocus disabled={loading} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("name@company.com")} autoComplete="username" className={inputCls} />
            </div>
            {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-bold text-primary-foreground shadow-xl shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-70">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Sending…")}</> : <>{t("Send code")} <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
        ) : (
          <form className="space-y-5" onSubmit={verify}>
            {info && <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{info}</div>}
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Verification code (6 digits)")}</label>
              <input inputMode="numeric" maxLength={6} required autoFocus disabled={loading} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className={`${inputCls} tracking-[0.5em] text-center text-lg font-black`} />
            </div>
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("New password")}</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} required disabled={loading} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("At least 8 characters")} autoComplete="new-password" className={`${inputCls} pr-12`} />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={showPw ? t("Hide password") : t("Show password")}>{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Repeat new password")}</label>
              <input type={showPw ? "text" : "password"} required disabled={loading} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" className={inputCls} />
            </div>
            {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-bold text-primary-foreground shadow-xl shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-70">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Saving…")}</> : <>{invited ? t("Set password") : t("Reset password")} <ArrowRight className="h-4 w-4" /></>}
            </button>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button type="button" onClick={() => { setStep("request"); setError(null); setInfo(null); setCode(""); }} className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> {t("Change email")}</button>
              <button type="button" onClick={resend} disabled={cooldown > 0} className="inline-flex items-center gap-1 text-xs font-bold text-primary disabled:text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" /> {cooldown > 0 ? t("Resend ({n}s)", { n: cooldown }) : t("Resend code")}</button>
            </div>
          </form>
        )}

        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">{t("Remembered your password?")} <a href="/login" className="ml-1 font-bold text-primary underline-offset-4 hover:underline">{t("Back to sign in")}</a></p>
        </div>
      </div>
    </div>
  );
}
