import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2, ShieldCheck, Eye, EyeOff, RotateCcw, ArrowLeft } from "lucide-react";
import nexusLogo from "@/assets/nexus-logo.png";
import { ApiError, nexusApi } from "@/lib/nexus-api";

export const Route = createFileRoute("/forgot-password")({ component: ForgotPasswordPage });

const errOf = (e: unknown, fb: string) => (e instanceof ApiError ? ((e.payload as { error?: string; message?: string } | null)?.error ?? (e.payload as { message?: string } | null)?.message ?? fb) : fb);

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
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
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null);
    const em = email.trim();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setError("Masukin email yang valid dulu ya."); return; }
    setLoading(true);
    try {
      const r = await nexusApi.passwordResetRequest(em);
      setStep("verify");
      setCooldown(r.resendCooldownSeconds ?? 60);
      setInfo(`Kalau akun ${em} terdaftar, kode 6 digit udah dikirim ke email itu.`);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "Kebanyakan percobaan. Tunggu beberapa menit ya." : errOf(err, "Gagal kirim kode. Coba lagi bentar."));
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) { setError("Kode harus 6 digit angka."); return; }
    if (password.length < 8) { setError("Password baru minimal 8 karakter."); return; }
    if (password !== confirm) { setError("Konfirmasi password belum sama."); return; }
    setLoading(true);
    try {
      await nexusApi.passwordResetVerify({ email: email.trim(), code, password });
      setError(null);
      setInfo("Password berhasil direset! Mengarahkan ke login…");
      setTimeout(() => navigate({ to: "/login" }), 1200);
    } catch (err) {
      setError(errOf(err, "Kode salah atau kedaluwarsa. Cek lagi / kirim ulang."));
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || loading) return;
    setError(null);
    try {
      const r = await nexusApi.passwordResetResend(email.trim());
      setCooldown(r.resendCooldownSeconds ?? 60);
      setInfo("Kode baru udah dikirim ulang.");
    } catch (err) {
      const retry = err instanceof ApiError ? (err.payload as { retryAfterSeconds?: number } | null)?.retryAfterSeconds : undefined;
      if (typeof retry === "number") setCooldown(retry);
      setError(errOf(err, "Belum bisa kirim ulang. Tunggu sebentar."));
    }
  };

  const inputCls = "w-full bg-white/60 border border-white/80 rounded-2xl px-5 py-4 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all shadow-sm disabled:opacity-50";

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 relative overflow-hidden bg-[#fdfcfb]" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[120px] animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-orange-200/40 blur-[120px] animate-pulse" style={{ animationDelay: "1s" }} />

      <div className="relative w-full max-w-md bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] rounded-[2.5rem] p-10 md:p-12">
        <div className="mb-6 flex justify-center">
          <img src={nexusLogo} alt="Nexus" className="block h-16 w-16 object-contain drop-shadow-[0_12px_24px_rgba(79,70,229,0.35)]" />
        </div>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" /></div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Reset Password</h1>
          <p className="mt-1 text-sm text-muted-foreground">{step === "request" ? "Masukin email kamu, kami kirim kode verifikasi." : `Masukin kode yang dikirim ke ${email} + password baru.`}</p>
        </div>

        {step === "request" ? (
          <form className="space-y-5" onSubmit={requestCode}>
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Email</label>
              <input type="email" required autoFocus disabled={loading} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kamu@patsgroup.id" autoComplete="username" className={inputCls} />
            </div>
            {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-bold text-primary-foreground shadow-xl shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-70">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim…</> : <>Kirim kode <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
        ) : (
          <form className="space-y-5" onSubmit={verify}>
            {info && <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{info}</div>}
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Kode verifikasi (6 digit)</label>
              <input inputMode="numeric" maxLength={6} required autoFocus disabled={loading} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className={`${inputCls} tracking-[0.5em] text-center text-lg font-black`} />
            </div>
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Password baru</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} required disabled={loading} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min. 8 karakter" autoComplete="new-password" className={`${inputCls} pr-12`} />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Toggle password">{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Ulangi password baru</label>
              <input type={showPw ? "text" : "password"} required disabled={loading} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" className={inputCls} />
            </div>
            {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-bold text-primary-foreground shadow-xl shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-70">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…</> : <>Reset password <ArrowRight className="h-4 w-4" /></>}
            </button>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button type="button" onClick={() => { setStep("request"); setError(null); setInfo(null); setCode(""); }} className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Ganti email</button>
              <button type="button" onClick={resend} disabled={cooldown > 0} className="inline-flex items-center gap-1 text-xs font-bold text-primary disabled:text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" /> {cooldown > 0 ? `Kirim ulang (${cooldown}s)` : "Kirim ulang kode"}</button>
            </div>
          </form>
        )}

        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">Inget passwordnya? <a href="/login" className="ml-1 font-bold text-primary underline-offset-4 hover:underline">Balik ke login</a></p>
        </div>
      </div>
    </div>
  );
}
