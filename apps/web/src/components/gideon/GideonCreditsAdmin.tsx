import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Gift, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { HScroll } from "@/components/HScroll";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang, type LangApi } from "@/lib/lang";
import { formatCount } from "@/lib/number-format";
import { ORG_ROLE_TONE } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import {
  CREDIT_TIER_NAME, fetchCreditAdmin, fetchCreditBonuses, grantCreditBonus, saveCreditOverride, saveCreditPolicy,
  type CreditAdminPerson, type CreditPolicy, type CreditRole,
} from "@/lib/gideon-credits";

/**
 * Control Room › GIDEON › Credits (owner, 18 Oct 2026). BoD / One Above All: what each person and role spent
 * this period, the role defaults, one person's own limits, and one-off bonus credits. Every change is audited
 * on the server. Credits only, never questions.
 */

const ROLES: CreditRole[] = ["STAFF", "MANAGER", "BOD", "ONE_ABOVE_ALL"];
const TIER_ORDER = ["astra", "luna", "terra", "experimental"] as const;
/** Role names as the company says them, the same in both languages ("Board" would translate to "Papan"). */
const ROLE_NAME: Record<CreditRole, string> = { ONE_ABOVE_ALL: "One Above All", BOD: "BoD", MANAGER: "Manager", STAFF: "Staff" };

function shiftPeriod(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const fmtDay = (key: string, L: LangApi) =>
  new Date(`${key}T00:00:00+07:00`).toLocaleDateString(L.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

const input = "h-8 w-full rounded-md border border-border bg-background px-2 text-sm tabular-nums outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50";
const primaryBtn = "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";
const ghostBtn = "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function StatBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="font-display text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function GideonCreditsAdmin() {
  const L = useLang();
  const { t } = L;
  const qc = useQueryClient();
  const [period, setPeriod] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CreditAdminPerson | null>(null);
  const q = useQuery({ queryKey: ["gideon-credits-admin", period], queryFn: () => fetchCreditAdmin(period), retry: false });
  const d = q.data;

  const people = useMemo(() => {
    const s = search.trim().toLowerCase();
    const all = d?.people ?? [];
    return s ? all.filter((p) => `${p.name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(s)) : all;
  }, [d, search]);

  if (q.isLoading) return <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">{t("Loading…")}</div>;
  if (q.isError || !d) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
        <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <div className="text-sm font-semibold">{t("Couldn't load GIDEON credits.")}</div>
      </div>
    );
  }

  const roleName = (r: CreditRole | null) => (r ? ROLE_NAME[r] ?? r : t("Not a member"));

  return (
    <div lang={L.lang} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t("Previous period")} onClick={() => setPeriod(shiftPeriod(d.periodKey, -1))} className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-0 px-1 text-sm font-semibold tabular-nums">{fmtDay(d.period.startKey, L)} – {fmtDay(d.period.endKey, L)}</div>
          <button type="button" aria-label={t("Next period")} disabled={d.isCurrent} onClick={() => setPeriod(shiftPeriod(d.periodKey, 1))} className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          {!d.isCurrent && <button type="button" onClick={() => setPeriod(null)} className="ml-1 rounded-md px-2 py-1 text-xs font-medium text-sidebar-primary hover:bg-accent">{t("This period")}</button>}
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", d.enforced ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-accent text-accent-foreground")}>
          {d.enforced ? t("Limits enforced: out of credits → Aphrodite") : t("Recording only: nobody is blocked")}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label={t("Credits used")} value={formatCount(d.totals.used)} hint={t("1 credit = US$0.001 of model cost")} />
        <StatBox label={t("Answers")} value={formatCount(d.totals.answers)} />
        <StatBox label={t("Staff")} value={formatCount(d.byRole.STAFF?.used ?? 0)} hint={t("{n} people", { n: formatCount(d.byRole.STAFF?.people ?? 0) })} />
        <StatBox label={t("Managers")} value={formatCount(d.byRole.MANAGER?.used ?? 0)} hint={t("{n} people", { n: formatCount(d.byRole.MANAGER?.people ?? 0) })} />
      </div>

      <RoleDefaults policy={d.policy} onSaved={() => void qc.invalidateQueries({ queryKey: ["gideon-credits-admin"] })} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-semibold">{t("People")}</h3>
          <label className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-background px-2 sm:w-64">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search people")} aria-label={t("Search people")} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </label>
        </div>
        {people.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{search ? t("No one matches “{q}”.", { q: search }) : t("No one in the workspace yet.")}</div>
        ) : (
          <HScroll className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{t("Person")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("Role")}</th>
                  {d.isCurrent && <th className="px-3 py-2.5 text-right font-medium">{t("Today")}</th>}
                  <th className="px-3 py-2.5 text-right font-medium">{t("This period")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("By tier")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("Limits")}</th>
                  <th className="px-3 py-2.5" aria-label={t("Actions")} />
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const lim = p.limits;
                  const poolLimit = lim.monthly + lim.bonus;
                  return (
                    <tr key={p.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar userId={p.id} name={p.name} avatar={p.avatar} size={26} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{p.name || p.email}</div>
                            {p.email && <div className="truncate text-xs text-muted-foreground">{p.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5"><span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", p.role ? ORG_ROLE_TONE[p.role] : "bg-muted text-muted-foreground")}>{roleName(p.role)}</span></td>
                      {d.isCurrent && (
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          {formatCount(p.today?.used ?? 0)}{!lim.unlimited && <span className="text-muted-foreground"> / {formatCount(lim.daily)}</span>}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                        <span className="font-semibold">{formatCount(p.period.used)}</span>
                        {!lim.unlimited && <span className="text-muted-foreground"> · {t("pool")} {formatCount(p.period.pool)}/{formatCount(poolLimit)}</span>}
                        {p.period.over > 0 && <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{t("{n} over", { n: formatCount(p.period.over) })}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {TIER_ORDER.filter((k) => p.tiers[k]).map((k) => (
                            <span key={k} title={t("{n} answers", { n: formatCount(p.tiers[k].answers) })} className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                              {CREDIT_TIER_NAME[k]} {formatCount(p.tiers[k].credits)}
                            </span>
                          ))}
                          {Object.keys(p.tiers).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                        {lim.unlimited ? <span className="font-medium">{t("Unlimited")}</span> : <span className="tabular-nums">{formatCount(lim.daily)}/{t("day")} · {formatCount(lim.monthly)}/{t("period")}</span>}
                        <div className="text-[11px] text-muted-foreground">
                          {lim.overridden ? t("Custom") : t("Role default")}
                          {lim.bonus > 0 && <> · +{formatCount(lim.bonus)} {t("bonus")}</>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button type="button" onClick={() => setEditing(p)} className="rounded-md px-2 py-1 text-xs font-semibold text-sidebar-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("Edit")}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HScroll>
        )}
      </section>
      {editing && <PersonDialog person={editing} policy={d.policy} onClose={() => setEditing(null)} onSaved={() => void qc.invalidateQueries({ queryKey: ["gideon-credits-admin"] })} />}
    </div>
  );
}

function RoleDefaults({ policy, onSaved }: { policy: CreditPolicy; onSaved: () => void }) {
  const L = useLang();
  const { t } = L;
  const [draft, setDraft] = useState(policy);
  useEffect(() => setDraft(policy), [policy]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);
  const save = useMutation({
    mutationFn: () => saveCreditPolicy(draft),
    onSuccess: () => { toast.success(t("Role defaults saved")); onSaved(); },
    onError: (e: Error) => toast.error(e.message || t("Couldn't save.")),
  });
  const set = (r: CreditRole, patch: Partial<CreditPolicy["roles"][CreditRole]>) => setDraft((cur) => ({ ...cur, roles: { ...cur.roles, [r]: { ...cur.roles[r], ...patch } } }));
  const num = (v: string) => Math.max(0, Math.min(10_000_000, Math.floor(Number(v.replace(/\D/g, "")) || 0)));
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-semibold">{t("Role defaults")}</h3>
          <p className="text-xs text-muted-foreground">{t("Daily credits reset at 00:00 WIB; the monthly pool is used after them and renews on the 28th.")}</p>
        </div>
        <div className="flex gap-2">
          {dirty && <button type="button" className={ghostBtn} onClick={() => setDraft(policy)}>{t("Cancel")}</button>}
          <button type="button" className={primaryBtn} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("Save")}</button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {ROLES.map((r) => {
          const v = draft.roles[r];
          const id = `credit-role-${r}`;
          return (
            <div key={r} className="rounded-xl border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ORG_ROLE_TONE[r])}>{ROLE_NAME[r]}</span>
                <label htmlFor={`${id}-u`} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {t("Unlimited")}
                  <Switch id={`${id}-u`} checked={v.unlimited} onCheckedChange={(c) => set(r, { unlimited: c })} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-muted-foreground">{t("Per day")}
                  <input inputMode="numeric" disabled={v.unlimited} value={v.unlimited ? "" : String(v.daily)} onChange={(e) => set(r, { daily: num(e.target.value) })} className={cn(input, "mt-0.5")} />
                </label>
                <label className="text-[11px] text-muted-foreground">{t("Per period")}
                  <input inputMode="numeric" disabled={v.unlimited} value={v.unlimited ? "" : String(v.monthly)} onChange={(e) => set(r, { monthly: num(e.target.value) })} className={cn(input, "mt-0.5")} />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PersonDialog({ person, policy, onClose, onSaved }: { person: CreditAdminPerson; policy: CreditPolicy; onClose: () => void; onSaved: () => void }) {
  const L = useLang();
  const { t } = L;
  const base = policy.roles[person.role ?? "STAFF"];
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent lang={L.lang} className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display">{person.name || person.email}</DialogTitle>
          <DialogDescription>
            {t("Role default: {d}", { d: base.unlimited ? t("Unlimited") : `${formatCount(base.daily)}/${t("day")} · ${formatCount(base.monthly)}/${t("period")}` })}
          </DialogDescription>
        </DialogHeader>
        <PersonCreditsForm person={person} policy={policy} onSaved={() => { onSaved(); }} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * One person's limits and bonus credits: the body of the Credits dialog, also the Credits tab of Control Room ›
 * GIDEON › People › person (18 Oct 2026). onClose = the dialog's Cancel / close after saving limits; absent, the
 * form stays put.
 */
export function PersonCreditsForm({ person, policy, onClose, onSaved }: { person: CreditAdminPerson; policy: CreditPolicy; onClose?: () => void; onSaved: () => void }) {
  const L = useLang();
  const { t } = L;
  const base = policy.roles[person.role ?? "STAFF"];
  const o = person.override;
  const [mode, setMode] = useState<"default" | "custom" | "unlimited">(o?.unlimited ? "unlimited" : o && (o.dailyLimit !== null || o.monthlyLimit !== null || o.unlimited === false) ? "custom" : "default");
  const [daily, setDaily] = useState(String(o?.dailyLimit ?? base.daily));
  const [monthly, setMonthly] = useState(String(o?.monthlyLimit ?? base.monthly));
  const [note, setNote] = useState(o?.note ?? "");
  const [bonus, setBonus] = useState("");
  const [reason, setReason] = useState("");
  const bonuses = useQuery({ queryKey: ["gideon-credit-bonuses", person.id], queryFn: () => fetchCreditBonuses(person.id) });
  const toInt = (s: string) => { const n = Math.floor(Number(s.replace(/\D/g, ""))); return Number.isFinite(n) ? n : 0; };

  const saveLimits = useMutation({
    mutationFn: () => saveCreditOverride({
      userId: person.id,
      unlimited: mode === "unlimited" ? true : mode === "custom" ? false : null,
      dailyLimit: mode === "custom" ? toInt(daily) : null,
      monthlyLimit: mode === "custom" ? toInt(monthly) : null,
      note: mode === "default" ? null : note || null,
    }),
    onSuccess: () => { toast.success(t("Limits saved")); onSaved(); onClose?.(); },
    onError: (e: Error) => toast.error(e.message || t("Couldn't save.")),
  });
  const grant = useMutation({
    mutationFn: () => grantCreditBonus({ userId: person.id, credits: toInt(bonus), reason: reason || null }),
    onSuccess: () => { toast.success(t("Bonus added")); setBonus(""); setReason(""); void bonuses.refetch(); onSaved(); },
    onError: (e: Error) => toast.error(e.message || t("Couldn't save.")),
  });
  const opt = (on: boolean) => cn("flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors", on ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-accent");

  return (
      <div>
        <div className="space-y-3">
          <div className="text-sm font-semibold">{t("GIDEON credit limits")}</div>
          <div className="flex gap-1 rounded-lg border border-border bg-background p-0.5" role="radiogroup" aria-label={t("GIDEON credit limits")}>
            <button type="button" role="radio" aria-checked={mode === "default"} className={opt(mode === "default")} onClick={() => setMode("default")}>{t("Role default")}</button>
            <button type="button" role="radio" aria-checked={mode === "custom"} className={opt(mode === "custom")} onClick={() => setMode("custom")}>{t("Custom")}</button>
            <button type="button" role="radio" aria-checked={mode === "unlimited"} className={opt(mode === "unlimited")} onClick={() => setMode("unlimited")}>{t("Unlimited")}</button>
          </div>
          {mode === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">{t("Per day")}<input inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value.replace(/\D/g, ""))} className={cn(input, "mt-0.5")} /></label>
              <label className="text-xs text-muted-foreground">{t("Per period")}<input inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value.replace(/\D/g, ""))} className={cn(input, "mt-0.5")} /></label>
            </div>
          )}
          {mode !== "default" && (
            <label className="block text-xs text-muted-foreground">{t("Note (optional)")}
              <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className={cn(input, "mt-0.5")} />
            </label>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {onClose && <button type="button" className={ghostBtn} onClick={onClose}>{t("Cancel")}</button>}
            <button type="button" className={primaryBtn} disabled={saveLimits.isPending || (mode === "custom" && (daily === "" || monthly === ""))} onClick={() => saveLimits.mutate()}>
              {saveLimits.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("Save limits")}
            </button>
          </DialogFooter>
        </div>

        <div className="mt-2 space-y-3 border-t border-border pt-4">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold"><Gift className="h-4 w-4 text-sidebar-primary" />{t("Bonus credits")}</div>
            <p className="text-xs text-muted-foreground">{t("Added to this period's monthly pool. They lapse when the period ends.")}</p>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <label className="text-xs text-muted-foreground">{t("Credits")}<input inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/\D/g, ""))} className={cn(input, "mt-0.5")} /></label>
            <label className="text-xs text-muted-foreground">{t("Reason (optional)")}<input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={cn(input, "mt-0.5")} /></label>
          </div>
          <button type="button" className={cn(primaryBtn, "w-full")} disabled={grant.isPending || toInt(bonus) < 1} onClick={() => grant.mutate()}>
            {grant.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{toInt(bonus) >= 1 ? t("Give {n} credits", { n: formatCount(toInt(bonus)) }) : t("Give bonus")}
          </button>
          {(bonuses.data?.bonuses.length ?? 0) > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border text-xs">
              {bonuses.data!.bonuses.slice(0, 6).map((b) => (
                <li key={b.id} className="flex items-start justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{b.reason || t("No reason given")}</span>
                    <span className="text-muted-foreground">{new Date(b.createdAt).toLocaleDateString(L.locale, { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })}{b.grantedByName ? ` · ${b.grantedByName}` : ""}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">+{formatCount(b.credits)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
  );
}
