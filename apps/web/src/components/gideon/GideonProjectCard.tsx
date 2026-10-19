import { useState } from "react";
import { SelectPicker } from "@/components/SelectPicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AtSign, CalendarClock, History, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { GideonMark } from "./GideonMark";
import { GideonRunList } from "./GideonInsights";
import {
  createGideonSchedule, deleteGideonSchedule, gideonRuns, gideonSchedules, runGideonScheduleNow, updateGideonSchedule,
  type GideonSchedule,
} from "@/lib/gideon";
import { useLang, type LangApi } from "@/lib/lang";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * GIDEON's triggers for one project (12 Oct 2026, Notion's agent "Triggers"): a weekly digest on a
 * schedule (posted as a status update signed by GIDEON), @GIDEON in task comments, and — for leads — the
 * run log of everything GIDEON did in this project. Sits above the project's Automations.
 */

/** Monday first, the way the team reads a week. Values are JS weekdays (0 = Sunday). */
const WEEK = [
  { v: 1, short: "Mo", long: "Monday" }, { v: 2, short: "Tu", long: "Tuesday" }, { v: 3, short: "We", long: "Wednesday" },
  { v: 4, short: "Th", long: "Thursday" }, { v: 5, short: "Fr", long: "Friday" }, { v: 6, short: "Sa", long: "Saturday" },
  { v: 0, short: "Su", long: "Sunday" },
];
const ZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "UTC"];

function when(iso: string | null, L: LangApi) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(L.locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
}

function scheduleText(s: Pick<GideonSchedule, "weekdays" | "time" | "timezone">, L: LangApi) {
  const { t } = L;
  const days = [...s.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const daily = days.length === 7;
  const weekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d));
  const list = daily ? t("Every day") : weekdays ? t("Every weekday") : t("Every {days}", { days: days.map((d) => t(WEEK.find((w) => w.v === d)?.long ?? "")).join(", ") });
  return t("{when} at {time} ({zone})", { when: list, time: s.time, zone: s.timezone });
}

type Draft = { weekdays: number[]; time: string; timezone: string; language: string; instructions: string };

export function GideonProjectCard({ projectId, projectName }: { projectId: string; projectName: string }) {
  const L = useLang();
  const { t } = L;
  const qc = useQueryClient();
  const key = ["nexus", "gideon-schedules", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => gideonSchedules(projectId), retry: false });
  const [draft, setDraft] = useState<{ id: string | null; d: Draft } | null>(null);
  const [deleting, setDeleting] = useState<GideonSchedule | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const canManage = !!q.data?.canManage;
  const runs = useQuery({ queryKey: ["nexus", "gideon-runs", projectId], queryFn: () => gideonRuns({ projectId, limit: 15 }), enabled: canManage && showRuns, retry: false });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: async (x: { id: string | null; d: Draft }) => {
      const body = { weekdays: x.d.weekdays, time: x.d.time, timezone: x.d.timezone, language: x.d.language, instructions: x.d.instructions.trim() || null };
      return x.id ? updateGideonSchedule(x.id, body) : createGideonSchedule({ projectId, ...body, enabled: true });
    },
    onSuccess: () => { setDraft(null); invalidate(); toast.success(t("Digest schedule saved")); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't save it.")),
  });
  const toggle = useMutation({
    mutationFn: (s: GideonSchedule) => updateGideonSchedule(s.id, { enabled: !s.enabled }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't change it.")),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteGideonSchedule(id),
    onSuccess: () => { invalidate(); toast.success(t("Digest schedule deleted")); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't delete it.")),
  });
  const runNow = useMutation({
    mutationFn: (id: string) => runGideonScheduleNow(id),
    onSuccess: () => toast.success(t("GIDEON is writing the digest. It appears in the Overview's status updates in a minute or two.")),
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't start it.")),
  });

  const schedules = q.data?.schedules ?? [];
  const newDraft = (): Draft => ({ weekdays: [1], time: "09:00", timezone: "Asia/Jakarta", language: L.lang === "en" ? "en" : "id", instructions: "" });

  return (
    <div className="mx-auto max-w-4xl px-4 pt-4 md:px-8 md:pt-8">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight"><GideonMark className="h-4 w-4" /> GIDEON</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("What GIDEON does for {name} on its own.", { name: projectName })}</p>
          </div>
          {canManage && (
            <button type="button" onClick={() => setShowRuns((v) => !v)} className={cn("inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent", showRuns && "bg-accent")}>
              <History className="h-3.5 w-3.5" /> {t("Run log")}
            </button>
          )}
        </div>

        {q.data && !q.data.configured && (
          <p className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{t("GIDEON isn't connected on this server, so schedules and mentions don't run here.")}</p>
        )}

        <div className="mt-3 divide-y divide-border rounded-xl border border-border">
          {/* On a schedule */}
          <div className="p-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> {t("Weekly digest")}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("GIDEON reads the project and posts a short digest as a status update: done, in progress, overdue, next 7 days, what needs attention.")}</p>
            {q.isLoading && <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Loading…")}</div>}
            {q.isError && <p className="mt-2 text-xs text-muted-foreground">{t("Couldn't load GIDEON's schedules.")}</p>}
            {schedules.map((s) => draft?.id === s.id ? null : (
              <div key={s.id} className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-3 py-2">
                <button type="button" role="switch" aria-checked={s.enabled} aria-label={t("Turn the digest on or off")} disabled={!canManage || toggle.isPending} onClick={() => toggle.mutate(s)} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed", s.enabled ? "bg-switch-on" : "bg-muted dark:bg-control-border", !canManage && "opacity-70")}>
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all dark:bg-background", s.enabled ? "left-[18px]" : "left-0.5")} />
                </button>
                <div className="min-w-0 flex-1 text-xs">
                  <div className={cn("font-semibold", !s.enabled && "text-muted-foreground")}>{scheduleText(s, L)}</div>
                  <div className="text-muted-foreground">
                    {[
                      s.enabled && s.nextRunAt ? t("Next: {when}", { when: when(s.nextRunAt, L) ?? "" }) : !s.enabled ? t("Off") : null,
                      s.lastRunAt ? t("Last: {when} ({status})", { when: when(s.lastRunAt, L) ?? "", status: t(s.lastStatus === "SUCCEEDED" ? "Posted" : s.lastStatus === "FAILED" ? "Failed" : s.lastStatus === "SKIPPED" ? "Skipped" : "—") }) : null,
                      s.runsAs?.name ? t("Runs as {name}", { name: s.runsAs.name }) : null,
                      s.language === "en" ? "English" : "Bahasa Indonesia",
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => runNow.mutate(s.id)} disabled={runNow.isPending || !q.data?.configured} title={t("Run now")} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50">{runNow.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t("Run now")}</button>
                    <button type="button" onClick={() => setDraft({ id: s.id, d: { weekdays: s.weekdays, time: s.time, timezone: s.timezone, language: s.language, instructions: s.instructions ?? "" } })} aria-label={t("Edit")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => setDeleting(s)} aria-label={t("Delete")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
            {draft && <ScheduleEditor draft={draft.d} onChange={(d) => setDraft({ ...draft, d })} onCancel={() => setDraft(null)} onSave={() => save.mutate(draft)} saving={save.isPending} />}
            {!draft && canManage && schedules.length < 3 && (
              <button type="button" onClick={() => setDraft({ id: null, d: newDraft() })} className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10">
                <Plus className="h-3.5 w-3.5" /> {schedules.length ? t("Add another time") : t("Set up a weekly digest")}
              </button>
            )}
            {!q.isLoading && !schedules.length && !canManage && <p className="mt-2 text-xs text-muted-foreground">{t("People with Full access can set up a weekly digest here.")}</p>}
          </div>

          {/* When mentioned */}
          <div className="p-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><AtSign className="h-4 w-4 text-primary" /> {t("When mentioned")}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("Write @GIDEON in a task comment: GIDEON answers in the same thread, with the access of whoever asked. Changes it suggests wait for that person's approval.")}</p>
          </div>
        </div>

        {canManage && showRuns && (
          <div className="mt-3">
            {runs.isLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Loading…")}</div>}
            {runs.isError && <p className="text-xs text-muted-foreground">{t("Couldn't load the run log.")}</p>}
            {runs.data && <GideonRunList runs={runs.data.runs} compact />}
          </div>
        )}
      </section>

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this digest schedule?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("GIDEON stops posting the weekly digest. Digests already posted stay in the status updates.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleting) del.mutate(deleting.id); setDeleting(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ScheduleEditor({ draft, onChange, onCancel, onSave, saving }: { draft: Draft; onChange: (d: Draft) => void; onCancel: () => void; onSave: () => void; saving: boolean }) {
  const L = useLang();
  const { t } = L;
  const toggleDay = (v: number) => onChange({ ...draft, weekdays: draft.weekdays.includes(v) ? draft.weekdays.filter((x) => x !== v) : [...draft.weekdays, v] });
  const zones = ZONES.includes(draft.timezone) ? ZONES : [draft.timezone, ...ZONES];
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border bg-background p-3">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t("On these days")}</div>
        <div className="flex flex-wrap gap-1">
          {WEEK.map((w) => (
            <button key={w.v} type="button" aria-pressed={draft.weekdays.includes(w.v)} title={t(w.long)} onClick={() => toggleDay(w.v)} className={cn("h-8 w-9 rounded-lg border text-xs font-semibold transition-colors", draft.weekdays.includes(w.v) ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}>
              {t(w.short)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs font-semibold text-muted-foreground">
          {t("At")}
          <input type="time" value={draft.time} onChange={(e) => onChange({ ...draft, time: e.target.value })} className="mt-1 block rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground outline-none focus:border-ring" />
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {t("Time zone")}
          <SelectPicker variant="field" value={draft.timezone} onChange={(v) => onChange({ ...draft, timezone: v })} ariaLabel={t("Time zone")} options={zones.map((z) => ({ value: z, label: z }))} className="mt-1 flex px-2 font-normal text-foreground" />
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {t("Written in")}
          <SelectPicker variant="field" value={draft.language} onChange={(v) => onChange({ ...draft, language: v })} ariaLabel={t("Written in")} options={[{ value: "id", label: "Bahasa Indonesia" }, { value: "en", label: "English" }]} className="mt-1 flex px-2 font-normal text-foreground" />
        </label>
      </div>
      <label className="block text-xs font-semibold text-muted-foreground">
        {t("Extra focus (optional)")}
        <textarea value={draft.instructions} onChange={(e) => onChange({ ...draft, instructions: e.target.value })} maxLength={500} rows={2} placeholder={t("e.g. Call out anything that blocks the launch on the 30th.")} className="mt-1 block w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground outline-none placeholder:text-muted-foreground focus:border-ring" />
      </label>
      <p className="text-[11px] text-muted-foreground">{t("It runs as you: GIDEON only reads what you can see. Saving makes you the person it runs as.")}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent">{t("Cancel")}</button>
        <button type="button" onClick={onSave} disabled={saving || draft.weekdays.length === 0 || !/^\d{2}:\d{2}$/.test(draft.time)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("Save")}
        </button>
      </div>
    </div>
  );
}
