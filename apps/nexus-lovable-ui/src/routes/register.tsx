import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, MailCheck } from "lucide-react";
import nexusLogo from "@/assets/nexus-logo.png";
import { celebrate } from "@/components/Celebration";
import { ApiError, nexusApi } from "@/lib/nexus-api";

export const Route = createFileRoute("/register")({ component: RegisterPage });

function errMsg(err: unknown, fallback: string) {
  if (err instanceof ApiError) {
    const p = err.payload as { error?: string } | null;
    return p?.error ?? err.message ?? fallback;
  }
  return fallback;
}

function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const input =
    "w-full bg-white/60 border border-white/80 rounded-2xl px-5 py-4 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all shadow-sm disabled:opacity-50";
  const labelCls = "text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1 block";

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError("Lengkapi nama, email, dan password minimal 8 karakter.");
      return;
    }
    setLoading(true);
    try {
      await nexusApi.register({ name: name.trim(), email: email.trim(), password });
      setInfo(`Kode verifikasi dikirim ke ${email.trim()}. Cek inbox (atau folder spam).`);
      setStep("otp");
    } catch (err) {
      setError(errMsg(err, "Gagal mendaftar. Coba lagi."));
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError("Masukin kode verifikasi dari email.");
      return;
    }
    setLoading(true);
    try {
      await nexusApi.verifyRegister({ email: email.trim(), code: code.trim() });
      const res = await nexusApi.login(email.trim(), password, "/dashboard").catch(() => ({ ok: false } as { ok: boolean }));
      celebrate("Akun dibuat — selamat datang! 🚀");
      setTimeout(() => navigate({ to: res.ok ? "/dashboard" : "/login" }), 300);
    } catch (err) {
      setError(errMsg(err, "Kode salah atau kadaluarsa."));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError(null);
    setInfo(null);
    try {
      await nexusApi.resendRegisterOtp(email.trim());
      setInfo("Kode baru udah dikirim ke email kamu.");
    } catch (err) {
      setError(errMsg(err, "Gagal kirim ulang kode."));
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#fdfcfb] p-6" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
      <div className="absolute left-[-10%] top-[-10%] h-[50%] w-[50%] animate-pulse rounded-full bg-primary/20 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[50%] w-[50%] animate-pulse rounded-full bg-orange-200/40 blur-[120px]" style={{ animationDelay: "1s" }} />

      <div className="relative w-full max-w-md rounded-[2.5rem] border border-white/60 bg-white/40 p-10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] backdrop-blur-2xl md:p-12">
        <div className="mb-6 flex justify-center">
          <img src={nexusLogo} alt="Nexus" className="block h-20 w-20 object-contain drop-shadow-[0_12px_24px_rgba(79,70,229,0.35)]" />
        </div>
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold uppercase tracking-[0.2em] text-foreground">Request Access</h1>
          <p className="mt-2 text-sm text-muted-foreground">{step === "form" ? "Bikin akun NEXUS baru." : "Masukin kode verifikasi dari email kamu."}</p>
        </div>

        {step === "form" ? (
          <form className="space-y-5" onSubmit={submitForm}>
            <div className="space-y-1.5">
              <label className={labelCls}>Nama Lengkap</label>
              <input type="text" required disabled={loading} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama kamu" className={input} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Email</label>
              <input type="email" required disabled={loading} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kamu@email.com" autoComplete="username" className={input} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Password</label>
              <input type="password" required disabled={loading} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 karakter" autoComplete="new-password" className={input} />
            </div>

            {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</div>}

            <button type="submit" disabled={loading} className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-bold text-primary-foreground shadow-xl shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-70">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim kode…</> : <>Lanjut <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></>}
            </button>
          </form>
        ) : (
          <form className="space-y-5" onSubmit={submitOtp}>
            {info && <div className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"><MailCheck className="mt-0.5 h-4 w-4 shrink-0" /> {info}</div>}
            <div className="space-y-1.5">
              <label className={labelCls}>Kode Verifikasi</label>
              <input type="text" inputMode="numeric" required disabled={loading} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 digit" className={`${input} text-center text-lg tracking-[0.5em]`} />
            </div>

            {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</div>}

            <button type="submit" disabled={loading} className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-bold text-primary-foreground shadow-xl shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-70">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Memverifikasi…</> : <>Verifikasi & Masuk <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></>}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={() => { setStep("form"); setError(null); }} className="inline-flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> Ubah data</button>
              <button type="button" onClick={resend} className="font-semibold text-primary hover:underline">Kirim ulang kode</button>
            </div>
          </form>
        )}

        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">Udah punya akun? <a href="/login" className="ml-1 font-bold text-primary underline-offset-4 hover:underline">Login</a></p>
        </div>
      </div>
    </div>
  );
}
