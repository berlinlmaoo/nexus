import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, TrendingDown, TrendingUp, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";

const PENALTIES = [
  { xp: "-1 XP/min", rule: "Late check-in", note: "Max 120 min. >120 → docks a day off", auto: true },
  { xp: "-25 XP", rule: "No check-out (forgot to log out)", note: "Per incident", auto: true },
  // Server rule (offsite-checkouts/[recordId]: −25 on reject). "−30, left without approval" existed nowhere but here.
  { xp: "-25 XP", rule: "Offsite check-out rejected by your approver", note: "Per incident", auto: true },
  { xp: "-150 XP", rule: "No-show, no heads-up (absent)", note: "Per day", auto: true },
];
// No automatic bonus and no end-of-period tiers: both were retired on the server (src/lib/period-rewards.ts).
// XP goes up only through quests and BoD adjustments (owner, 16 Oct 2026: the old "+30 quest / +50 beyond
// target / +20 adopted feedback" lines were promises the server never kept).
const BONUSES = [
  { xp: "Per quest", rule: "Finish a quest", note: "Made by BoD and up, for everyone, one person, chosen divisions or a set of tasks. You get the XP the quest sets when you claim it.", auto: false },
  { xp: "± XP", rule: "Adjustment by BoD", note: "Up to 1.000 XP up or down each time, with who made it", auto: false },
];

function Row({ xp, rule, note, auto, tone }: { xp: string; rule: string; note: string; auto: boolean; tone: "red" | "green" }) {
  const { t: tr } = useLang();
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className={cn("w-24 shrink-0 text-sm font-black tabular-nums", tone === "red" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{xp}</span>
      <div className="min-w-0 flex-1">
        {/* text-pretty: no one-word last line in the narrow phone column (audit 12 Oct 2026). */}
        <div className="text-sm font-semibold text-pretty text-foreground">{tr(rule)}</div>
        <div className="text-[11px] text-pretty text-muted-foreground">{tr(note)}</div>
      </div>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", auto ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{auto ? tr("Automatic") : tr("Manual")}</span>
    </div>
  );
}

export function XpRulesCard() {
  const { t: tr } = useLang();
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <motion.span whileTap={reduce ? undefined : { scale: 0.9 }} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Gift className="h-5 w-5" /></motion.span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black tracking-tight">{tr("XP rules")}</div>
          {/* text-balance: the Indonesian line wrapped to leave "XP" alone on the second line (audit 12 Oct 2026). */}
          <div className="text-balance text-xs text-muted-foreground">{tr("What takes XP away and what adds it")}</div>
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
            <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground"><TrendingDown className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden /> {tr("XP penalties")}</h4>
            <div className="divide-y divide-border/60">{PENALTIES.map((p) => <Row key={p.rule} {...p} tone="red" />)}</div>
          </div>
          <div>
            <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground"><TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> {tr("XP bonuses")}</h4>
            <div className="divide-y divide-border/60">{BONUSES.map((b) => <Row key={b.rule} {...b} tone="green" />)}</div>
          </div>
          <p className="text-[11px] text-muted-foreground">{tr("“Automatic” is worked out by the system from attendance. “Manual” comes from a quest or from BoD.")} {tr("Your level is this period's level: everyone starts at 1.000 XP on the 28th.")}</p>
        </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
