import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, TrendingDown, TrendingUp, Gift } from "lucide-react";
import { cn } from "@/lib/utils";

const PENALTIES = [
  { xp: "-1 XP/menit", rule: "Telat absen masuk", note: "Maks 120 menit. >120 → potong day off", auto: true },
  { xp: "-25 XP", rule: "Tidak absen keluar (lupa logout)", note: "Per kejadian", auto: true },
  { xp: "-30 XP", rule: "Keluar kantor tanpa izin atasan", note: "Per kejadian", auto: false },
  { xp: "-150 XP", rule: "Absen tanpa kabar (alpha)", note: "Per hari", auto: true },
];
const BONUSES = [
  { xp: "+50 XP", rule: "Zero alpha satu bulan penuh", note: "Konsistensi hadir", auto: true },
  { xp: "+30 XP", rule: "Selesaikan side quest dari Head", note: "Penilaian Head", auto: false },
  { xp: "+50 XP", rule: "Kinerja melampaui target", note: "Penilaian manajemen", auto: false },
  { xp: "+20 XP", rule: "Feedback diadopsi perusahaan", note: "Penilaian HR", auto: false },
];
const TIERS = [
  { range: "1400 – 1500 XP", label: "Excellent", reward: "🎁 Day off tambahan 1 hari", box: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  { range: "1300 – 1400 XP", label: "Good", reward: "🍾 Free 1 botol di outlet PATS", box: "border-amber-200 bg-amber-50 text-amber-800" },
  { range: "< 800 XP", label: "Review", reward: "⚠️ Evaluasi performa oleh Head + HR", box: "border-rose-200 bg-rose-50 text-rose-800" },
];

function Row({ xp, rule, note, auto, tone }: { xp: string; rule: string; note: string; auto: boolean; tone: "red" | "green" }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className={cn("w-24 shrink-0 text-sm font-black tabular-nums", tone === "red" ? "text-rose-600" : "text-emerald-600")}>{xp}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{rule}</div>
        <div className="text-[11px] text-muted-foreground">{note}</div>
      </div>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", auto ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{auto ? "Otomatis" : "Manual"}</span>
    </div>
  );
}

export function XpRulesCard() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <motion.span whileTap={reduce ? undefined : { scale: 0.9 }} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Gift className="h-5 w-5" /></motion.span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black tracking-tight">Aturan XP / Poin</div>
          <div className="text-xs text-muted-foreground">Potongan, bonus, & reward tier bulanan</div>
        </div>
        <motion.span animate={reduce ? undefined : { rotate: open ? 180 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 22 }} className="shrink-0 text-muted-foreground">
          <ChevronDown className="h-5 w-5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ height: { type: "spring", stiffness: 220, damping: 30 }, opacity: { duration: 0.2 } }}
            className="overflow-hidden"
          >
        <div className="space-y-5 border-t border-border px-5 py-4">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600"><TrendingDown className="h-3.5 w-3.5" /> Potongan XP</div>
            <div className="divide-y divide-border/60">{PENALTIES.map((p) => <Row key={p.rule} {...p} tone="red" />)}</div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600"><TrendingUp className="h-3.5 w-3.5" /> Tambahan XP</div>
            <div className="divide-y divide-border/60">{BONUSES.map((b) => <Row key={b.rule} {...b} tone="green" />)}</div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Reward tier (akhir periode)</div>
            <div className="space-y-1.5">
              {TIERS.map((t) => (
                <div key={t.label} className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl border px-3 py-2", t.box)}>
                  <span className="text-sm font-black tabular-nums">{t.range}</span>
                  <span className="text-xs font-bold uppercase tracking-wide">{t.label}</span>
                  <span className="text-sm font-semibold">{t.reward}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">"Otomatis" dihitung sistem dari absen & akhir periode. "Manual" diberikan Head/HR/manajemen sesuai penilaian.</p>
        </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
