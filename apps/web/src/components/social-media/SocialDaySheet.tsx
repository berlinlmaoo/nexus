import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Target, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dayLong } from "@/components/outlet-sales/outlet-ui";
import {
  SOCIAL_METRICS, engagementOf, socialApi, socialKey, type SocialDay, type SocialMetric, type SocialMonthResponse,
  type SocialTargetsWrite,
} from "@/lib/social-media-api";
import { EngagementInfo, num, socialErrorText, viewsLabel } from "./social-ui";

const METRIC_LABEL: Record<SocialMetric, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  posts: "Posts published",
};

function digitsOf(v: string): number | null {
  const d = v.replace(/\D/g, "");
  return d ? Number(d) : null;
}
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : new Intl.NumberFormat("id-ID").format(Math.round(n)));

type Draft = { figures: Record<string, Record<SocialMetric, string>>; worked: string; didntWork: string };
type TargetDraft = Record<string, { engagementTarget: string; postsTarget: string }>;

function draftOf(day: SocialDay | undefined, platformIds: string[]): Draft {
  const figures: Draft["figures"] = {};
  for (const id of platformIds) {
    const p = day?.platforms[id];
    figures[id] = { views: fmt(p?.views), likes: fmt(p?.likes), comments: fmt(p?.comments), shares: fmt(p?.shares), posts: fmt(p?.posts) };
  }
  return { figures, worked: day?.worked ?? "", didntWork: day?.didntWork ?? "" };
}

/**
 * One day of the report (owner, 14 Oct 2026): per platform Views, Likes, Comments, Shares and Posts
 * published (engagement adds itself up as you type), the day's two notes, and — for Full access — the day's
 * own targets per platform. Edit access records; View / Comment read. Only what changed is sent, so two
 * people filling different platforms never undo each other.
 */
export function SocialDaySheet({
  projectId, data, date, onClose, onMonth,
}: {
  projectId: string;
  data: SocialMonthResponse;
  date: string | null;
  onClose: () => void;
  onMonth: (month: string) => void;
}) {
  const { t, tn, lang, locale } = useLang();
  const qc = useQueryClient();
  useEffect(() => { if (date) onMonth(date.slice(0, 7)); }, [date, onMonth]);
  const loaded = !!date && data.month === date.slice(0, 7);
  const day = loaded ? data.days.find((d) => d.date === date) : undefined;
  // The platforms on the sheet: the active ones, and an archived one when this day has its figures.
  const platforms = useMemo(
    () => data.config.platforms.filter((p) => !p.archived || (day && SOCIAL_METRICS.some((m) => day.platforms[p.id]?.[m] != null))),
    [data.config.platforms, day],
  );
  const ids = platforms.map((p) => p.id);
  const future = !!date && date > data.today;
  const editable = data.canRecord && !future;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState<Draft | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);

  // A new day (or the day's data arriving) starts a fresh draft; a refetch after someone else's save does
  // not overwrite what is being typed.
  useEffect(() => {
    if (!date) { setDraft(null); setInitial(null); setTargetsOpen(false); return; }
    if (!loaded) return;
    if (initial && draft && JSON.stringify(draft) !== JSON.stringify(initial)) return;
    const d = draftOf(day, ids);
    setDraft(d);
    setInitial(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loaded, day]);

  const dirty = !!draft && !!initial && JSON.stringify(draft) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: () => {
      const platformsBody: Record<string, Partial<Record<SocialMetric, number | null>>> = {};
      for (const id of ids) {
        for (const m of SOCIAL_METRICS) {
          if (draft!.figures[id]?.[m] === initial!.figures[id]?.[m]) continue;
          (platformsBody[id] ??= {})[m] = digitsOf(draft!.figures[id][m]);
        }
      }
      return socialApi.putDay(projectId, date!, {
        ...(Object.keys(platformsBody).length ? { platforms: platformsBody } : {}),
        ...(draft!.worked !== initial!.worked ? { worked: draft!.worked } : {}),
        ...(draft!.didntWork !== initial!.didntWork ? { didntWork: draft!.didntWork } : {}),
      });
    },
    onSuccess: () => {
      setInitial(draft);
      qc.invalidateQueries({ queryKey: socialKey(projectId) });
      toast.success(t("{day} saved.", { day: dayLong(date!, locale, data.today.slice(0, 4)) }));
      onClose();
    },
    onError: (error) => toast.error(socialErrorText(error, t("The day wasn't saved. Try again."))),
  });

  const close = (o: boolean) => {
    if (o) return;
    if (dirty) { setConfirmClose(true); return; }
    onClose();
  };

  const set = (id: string, m: SocialMetric, v: string) =>
    setDraft((d) => (d ? { ...d, figures: { ...d.figures, [id]: { ...d.figures[id], [m]: fmt(digitsOf(v)) } } } : d));

  const input = "h-10 w-full rounded-lg border border-border bg-background px-3 text-right text-sm tabular-nums outline-none transition-colors hover:border-control-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 disabled:bg-muted/40 disabled:text-foreground pointer-coarse:h-11";
  const area = "min-h-[5.5rem] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors hover:border-control-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 disabled:bg-muted/40";

  return (
    <Sheet open={!!date} onOpenChange={close}>
      {/* Opens with the sheet itself focused, not its close button (UI tour run 13, W-B17: a heavy ring on the X). */}
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 outline-none sm:max-w-xl [&>button:first-of-type]:hidden" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus(); }}>
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <SheetTitle className="truncate text-base font-semibold">{date ? dayLong(date, locale, data.today.slice(0, 4)) : ""}</SheetTitle>
            <SheetDescription className="mt-0.5 text-xs text-muted-foreground">
              {future
                ? t("This day hasn't come yet. Record it once it's over.")
                : !data.canRecord
                  ? t("You can view this report. Recording needs Can edit access.")
                  : t("Fill what you have. An empty box stays empty, 0 is a real zero.")}
            </SheetDescription>
          </div>
          <button type="button" onClick={() => close(false)} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[44px]">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {!draft ? (
            <div className="space-y-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div>
          ) : (
            <div className="flex flex-col gap-4">
              {platforms.map((p) => {
                const f = draft.figures[p.id];
                const eng = engagementOf({ likes: digitsOf(f.likes), comments: digitsOf(f.comments), shares: digitsOf(f.shares) });
                const info = day?.platforms[p.id];
                return (
                  <section key={p.id} aria-labelledby={`sm-p-${p.id}`} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 id={`sm-p-${p.id}`} className="text-sm font-semibold">{p.name}{p.archived && <span className="font-normal text-muted-foreground"> · {t("archived")}</span>}</h3>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {t("Engagement")}: <span className="font-semibold text-foreground">{num(eng, lang)}</span>
                          {info?.engagementTarget != null && <> / {num(info.engagementTarget, lang)}</>}
                        </span>
                        <EngagementInfo />
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {SOCIAL_METRICS.map((m) => (
                        <label key={m} className={cn("text-xs font-medium text-muted-foreground", m === "views" && "col-span-2 sm:col-span-1")}>
                          {m === "views" ? viewsLabel(lang) : t(METRIC_LABEL[m])}
                          <input
                            inputMode="numeric"
                            value={f[m]}
                            disabled={!editable}
                            onChange={(e) => set(p.id, m, e.target.value)}
                            placeholder={editable ? "0" : "—"}
                            className={cn(input, "mt-1")}
                          />
                        </label>
                      ))}
                    </div>
                    {info && (info.engagementTarget !== null || info.postsTarget !== null) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t("Day target")}: {[
                          info.engagementTarget !== null ? t("{n} engagement", { n: num(info.engagementTarget, lang) }) : null,
                          info.postsTarget !== null ? tn(info.postsTarget, "1 post", "{n} posts", { n: num(info.postsTarget, lang) }) : null,
                        ].filter(Boolean).join(" · ")}
                        {" · "}
                        <span className="whitespace-nowrap">{info.engagementTargetSource === "day" || info.postsTargetSource === "day" ? t("Own target") : t("Month's target ÷ days")}</span>
                      </p>
                    )}
                  </section>
                );
              })}

              <section className="grid gap-3 rounded-xl border border-border bg-card p-4">
                <label className="text-sm font-semibold">
                  {t("What worked")}
                  <textarea value={draft.worked} disabled={!editable} maxLength={2000} onChange={(e) => setDraft({ ...draft, worked: e.target.value })} placeholder={editable ? t("e.g. the 7 pm reel, a trending sound") : ""} className={cn(area, "mt-1 font-normal")} />
                </label>
                <label className="text-sm font-semibold">
                  {t("What didn't work")}
                  <textarea value={draft.didntWork} disabled={!editable} maxLength={2000} onChange={(e) => setDraft({ ...draft, didntWork: e.target.value })} placeholder={editable ? t("e.g. carousel posted too late") : ""} className={cn(area, "mt-1 font-normal")} />
                </label>
              </section>

              {data.canManage && date && (
                targetsOpen
                  ? <DayTargets projectId={projectId} data={data} date={date} platformIds={platforms.filter((p) => !p.archived).map((p) => p.id)} onDone={() => setTargetsOpen(false)} />
                  : (
                    <button type="button" onClick={() => setTargetsOpen(true)} className="inline-flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]">
                      <Target aria-hidden className="h-4 w-4" /> {t("Set this day's targets")}
                    </button>
                  )
              )}

              {day?.updatedBy && day.updatedAt && (
                <p className="text-xs text-muted-foreground">
                  {t("Last changed by {name}", { name: day.updatedBy.name ?? "?" })} · {new Date(day.updatedAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          )}
        </div>

        {editable && (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-background/95 px-5 py-3">
            <button type="button" onClick={() => close(false)} className="h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11">{t("Cancel")}</button>
            <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-50 pointer-coarse:h-11">
              {save.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
              {t("Save day")}
            </button>
          </footer>
        )}

        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Discard the changes you haven't saved?")}</AlertDialogTitle>
              <AlertDialogDescription>{t("This day stays as it was.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Keep editing")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmClose(false); setDraft(initial); onClose(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {t("Discard")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

/** The day's own targets per platform (Full access). An empty box = the month's target split over its days. */
function DayTargets({
  projectId, data, date, platformIds, onDone,
}: { projectId: string; data: SocialMonthResponse; date: string; platformIds: string[]; onDone: () => void }) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const own = (id: string) => data.dayTargets.find((x) => x.date === date && x.platformId === id);
  const monthly = (id: string) => data.targets.find((x) => x.platformId === id);
  const days = data.days.length || 30;
  const [draft, setDraft] = useState<TargetDraft>(() =>
    Object.fromEntries(platformIds.map((id) => [id, { engagementTarget: fmt(own(id)?.engagementTarget), postsTarget: fmt(own(id)?.postsTarget) }])),
  );
  const save = useMutation({
    mutationFn: () => {
      const body: SocialTargetsWrite = {};
      for (const id of platformIds) body[id] = { engagementTarget: digitsOf(draft[id].engagementTarget), postsTarget: digitsOf(draft[id].postsTarget) };
      return socialApi.putDayTargets(projectId, date, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKey(projectId) });
      toast.success(t("Day targets saved."));
      onDone();
    },
    onError: (error) => toast.error(socialErrorText(error, t("The target wasn't saved. Try again."))),
  });
  const input = "h-10 w-full rounded-lg border border-border bg-background px-3 text-right text-sm tabular-nums outline-none transition-colors hover:border-control-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:h-11";
  const share = (v: number | null | undefined) => (v == null ? t("No target") : num(v / days, lang));
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Target aria-hidden className="h-4 w-4 text-primary" /> {t("This day's targets")}</h3>
      <div className="mt-3 flex flex-col gap-3">
        {platformIds.map((id) => {
          const name = data.config.platforms.find((p) => p.id === id)?.name ?? id;
          return (
            <fieldset key={id} className="grid grid-cols-2 gap-3">
              <legend className="mb-1 text-xs font-semibold">{name}</legend>
              <label className="text-xs font-medium text-muted-foreground">
                {t("Engagement target")}
                <input inputMode="numeric" value={draft[id].engagementTarget} placeholder={share(monthly(id)?.engagementTarget)} onChange={(e) => setDraft({ ...draft, [id]: { ...draft[id], engagementTarget: fmt(digitsOf(e.target.value)) } })} className={cn(input, "mt-1")} />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                {t("Posts target")}
                <input inputMode="numeric" value={draft[id].postsTarget} placeholder={share(monthly(id)?.postsTarget)} onChange={(e) => setDraft({ ...draft, [id]: { ...draft[id], postsTarget: fmt(digitsOf(e.target.value)) } })} className={cn(input, "mt-1")} />
              </label>
            </fieldset>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("Fill either, both or none. An empty box uses the month's target split over its days.")}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11">{t("Cancel")}</button>
        <button type="submit" disabled={save.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-60 pointer-coarse:h-11">
          {save.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
          {t("Save targets")}
        </button>
      </div>
    </form>
  );
}
