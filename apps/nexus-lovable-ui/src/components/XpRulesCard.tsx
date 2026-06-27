import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, TrendingDown, TrendingUp, Gift } from "lucide-react";
import { cn } from "@/lib/utils";

const PENALTIES = [
  { xp: "-1 XP/min", rule: "Late check-in", note: "Max 120 min. >120 → docks a day off", auto: true },
  { xp: "-25 XP", rule: "No check-out (forgot to log out)", note: "Per incident", auto: true },
  { xp: "-30 XP", rule: "Left the office without manager approval", note: "Per incident", auto: false },
  { xp: "-150 XP", rule: "No-show, no heads-up (absent)", note: "Per day", auto: true },
];
const BONUSES = [
  { xp: "+50 XP", rule: "Zero absences for a full month", note: "Showing up consistently", auto: true },
  { xp: "+30 XP", rule: "Finish a side quest from your Head", note: "Head's call", auto: false },
  { xp: "+50 XP", rule: "Performance beyond target", note: "Management's call", auto: false },
  { xp: "+20 XP", rule: "Feedback the company adopts", note: "HR's call", auto: false },
];
const TIERS = [
  { range: "1400 – 1500 XP", label: "Excellent", reward: "🎁 1 extra day off", box: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  { range: "1300 – 1400 XP", label: "Good", reward: "🍾 1 free bottle at a PATS outlet", box: "border-amber-200 bg-amber-50 text-amber-800" },
  { range: "< 800 XP", label: "Review", reward: "⚠️ Performance review by Head + HR", box: "border-rose-200 bg-rose-50 text-rose-800" },
];

function Row({ xp, rule, note, auto, tone }: { xp: string; rule: string; note: string; auto: boolean; tone: "red" | "green" }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className={cn("w-24 shrink-0 text-sm font-black tabular-nums", tone === "red" ? "text-rose-600" : "text-emerald-600")}>{xp}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{rule}</div>
        <div className="text-[11px] text-muted-foreground">{note}</div>
      </div>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", auto ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{auto ? "Automatic" : "Manual"}</span>
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
          <div className="text-sm font-black tracking-tight">XP / Points Rules</div>
          <div className="text-xs text-muted-foreground">Penalties, bonuses, & monthly tier rewards</div>
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
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600"><TrendingDown className="h-3.5 w-3.5" /> XP Penalties</div>
            <div className="divide-y divide-border/60">{PENALTIES.map((p) => <Row key={p.rule} {...p} tone="red" />)}</div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600"><TrendingUp className="h-3.5 w-3.5" /> XP Bonuses</div>
            <div className="divide-y divide-border/60">{BONUSES.map((b) => <Row key={b.rule} {...b} tone="green" />)}</div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tier rewards (end of period)</div>
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
          <p className="text-[11px] text-muted-foreground">"Automatic" is calculated by the system from attendance & end of period. "Manual" is awarded by Head/HR/management based on their judgment.</p>
        </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
