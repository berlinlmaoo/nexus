import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Archive, Check, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { monthLabel } from "@/components/outlet-sales/outlet-ui";
import {
  socialApi, socialConfigKey, socialKey, type SocialMonthResponse, type SocialPlatform, type SocialReportConfig, type SocialTargetsWrite,
} from "@/lib/social-media-api";
import { socialErrorText } from "./social-ui";

function digitsOf(v: string): number | null {
  const d = v.replace(/\D/g, "");
  return d ? Number(d) : null;
}
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : new Intl.NumberFormat("id-ID").format(Math.round(n)));

type TargetDraft = Record<string, { engagementTarget: string; postsTarget: string }>;

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/**
 * Platforms & targets (owner, 14 Oct 2026), Full access: the platforms tracked (add, rename, reorder,
 * archive, restore — a platform keeps its id, so no day loses a figure) and the shown month's targets per
 * platform (engagement and posts). The server checks again (SETTINGS_FORBIDDEN) and settles archiving itself.
 */
export function SocialSettings({
  projectId, data, open, onOpenChange,
}: { projectId: string; data: SocialMonthResponse; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: socialConfigKey(projectId), queryFn: () => socialApi.config(projectId), enabled: open, retry: false });
  const [draft, setDraft] = useState<SocialReportConfig | null>(null);
  const [targets, setTargets] = useState<TargetDraft | null>(null);
  const [adding, setAdding] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [archiveAsk, setArchiveAsk] = useState<null | { platform: SocialPlatform; uses: number }>(null);

  const initialTargets = (): TargetDraft =>
    Object.fromEntries(data.config.platforms.map((p) => {
      const x = data.targets.find((y) => y.platformId === p.id);
      return [p.id, { engagementTarget: fmt(x?.engagementTarget), postsTarget: fmt(x?.postsTarget) }];
    }));

  useEffect(() => {
    if (!open) { setDraft(null); setTargets(null); setAdding(""); return; }
    if (q.data && !draft) setDraft(structuredClone(q.data.config));
    if (!targets) setTargets(initialTargets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q.data, draft]);

  const usage = q.data?.usage ?? {};
  const configDirty = !!draft && !!q.data && JSON.stringify(draft) !== JSON.stringify(q.data.config);
  const targetsDirty = !!targets && JSON.stringify(targets) !== JSON.stringify(initialTargets());
  const dirty = configDirty || targetsDirty || adding.trim() !== "";

  const save = useMutation({
    mutationFn: async () => {
      let cfg = draft!;
      const pending = adding.trim();
      if (pending) cfg = { ...cfg, platforms: [...cfg.platforms.filter((p) => !p.archived), { id: "", name: pending }, ...cfg.platforms.filter((p) => p.archived)] };
      if (configDirty || pending) await socialApi.putConfig(projectId, cfg);
      if (targetsDirty) {
        const body: SocialTargetsWrite = {};
        const before = initialTargets();
        for (const [id, v] of Object.entries(targets!)) {
          if (!before[id] || (v.engagementTarget === before[id].engagementTarget && v.postsTarget === before[id].postsTarget)) continue;
          body[id] = { engagementTarget: digitsOf(v.engagementTarget), postsTarget: digitsOf(v.postsTarget) };
        }
        if (Object.keys(body).length) await socialApi.putTargets(projectId, data.month, body);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKey(projectId) });
      toast.success(t("Platforms and targets saved."));
      setDraft(null);
      setTargets(null);
      setAdding("");
      onOpenChange(false);
    },
    onError: (error) => {
      qc.invalidateQueries({ queryKey: socialKey(projectId) });
      toast.error(socialErrorText(error, t("The settings weren't saved. Try again.")));
    },
  });

  const close = (o: boolean) => {
    if (o) { onOpenChange(true); return; }
    if (dirty) { setConfirmClose(true); return; }
    onOpenChange(false);
  };

  const active = draft?.platforms.filter((p) => !p.archived) ?? [];
  const archived = draft?.platforms.filter((p) => p.archived) ?? [];
  const setActive = (next: SocialPlatform[]) => draft && setDraft({ ...draft, platforms: [...next, ...archived] });
  const add = () => {
    const name = adding.trim();
    if (!name || !draft) return;
    setActive([...active, { id: "", name, _key: `new-${Date.now()}` } as SocialPlatform]);
    setAdding("");
  };
  const archive = (p: SocialPlatform, i: number) => {
    if (!draft) return;
    if (p.id && (usage[p.id] ?? 0) > 0) setArchiveAsk({ platform: p, uses: usage[p.id] });
    else if (p.id) setDraft({ ...draft, platforms: [...active.filter((_, j) => j !== i), ...archived, { ...p, archived: true }] });
    else setActive(active.filter((_, j) => j !== i));
  };

  const iconBtn = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-10";
  const inputCls = "h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-colors hover:border-border focus-visible:border-primary focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:h-10";
  const numCls = "h-10 w-full rounded-lg border border-border bg-background px-3 text-right text-sm tabular-nums outline-none transition-colors hover:border-control-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:h-11";
  const savedActive = data.config.platforms.filter((p) => !p.archived);

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg [&>button:first-of-type]:hidden">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold">{t("Platforms & targets")}</SheetTitle>
            <SheetDescription className="mt-0.5 text-sm text-muted-foreground">{t("What this report tracks, and the month's goals per platform.")}</SheetDescription>
          </div>
          <button type="button" onClick={() => close(false)} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[44px]">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {!draft || !targets ? (
            q.isError
              ? <p className="py-10 text-center text-sm text-muted-foreground">{t("The settings didn't load. Check your connection, then try again.")}</p>
              : <div className="space-y-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
          ) : (
            <div className="flex flex-col gap-6">
              <section className="flex flex-col gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{t("Targets for {month}", { month: monthLabel(data.month, locale) })}</h3>
                  <p className="text-xs text-muted-foreground">{t("Each day's target is the month's split evenly, unless a day sets its own in the calendar. Leave a box empty for no target.")}</p>
                </div>
                {savedActive.map((p) => (
                  <fieldset key={p.id} className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3">
                    <legend className="px-1 text-xs font-semibold">{p.name}</legend>
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("Engagement target")}
                      <input inputMode="numeric" value={targets[p.id]?.engagementTarget ?? ""} placeholder={t("No target")} onChange={(e) => setTargets({ ...targets, [p.id]: { ...targets[p.id], engagementTarget: fmt(digitsOf(e.target.value)) } })} className={cn(numCls, "mt-1")} />
                    </label>
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("Posts target")}
                      <input inputMode="numeric" value={targets[p.id]?.postsTarget ?? ""} placeholder={t("No target")} onChange={(e) => setTargets({ ...targets, [p.id]: { ...targets[p.id], postsTarget: fmt(digitsOf(e.target.value)) } })} className={cn(numCls, "mt-1")} />
                    </label>
                  </fieldset>
                ))}
              </section>

              <section className="flex flex-col gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{t("Platforms")}</h3>
                  <p className="text-xs text-muted-foreground">{t("Renaming keeps every figure. Archiving hides a platform from the form; its past days keep their numbers.")}</p>
                </div>
                <div className="rounded-xl border border-border bg-card">
                  <ul className="divide-y divide-border">
                    {active.map((p, i) => (
                      <li key={p.id || (p as SocialPlatform & { _key?: string })._key} className="flex items-center gap-1 px-1.5 py-1">
                        <input aria-label={t("Platform name")} value={p.name} maxLength={40} onChange={(e) => setActive(active.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={inputCls} />
                        <button type="button" className={iconBtn} disabled={i === 0} onClick={() => setActive(move(active, i, i - 1))} aria-label={t("Move up")}><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" className={iconBtn} disabled={i === active.length - 1} onClick={() => setActive(move(active, i, i + 1))} aria-label={t("Move down")}><ArrowDown className="h-3.5 w-3.5" /></button>
                        <button type="button" className={iconBtn} disabled={active.length === 1} onClick={() => archive(p, i)} aria-label={t("Archive {name}", { name: p.name })}><Archive className="h-3.5 w-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-1 border-t border-border px-1.5 py-1">
                    <Plus aria-hidden className="ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      aria-label={t("Add platform")}
                      placeholder={t("Add platform, e.g. YouTube")}
                      value={adding}
                      maxLength={40}
                      onChange={(e) => setAdding(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                      onBlur={add}
                      className={cn(inputCls, "placeholder:text-muted-foreground/80")}
                    />
                  </div>
                  {archived.length > 0 && (
                    <div className="border-t border-border px-3 py-2">
                      <p className="text-xs font-medium text-muted-foreground">{t("Archived")}</p>
                      <ul className="mt-1">
                        {archived.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-2 py-0.5 text-sm text-muted-foreground">
                            <span className="min-w-0 truncate">{p.name}</span>
                            <button type="button" onClick={() => setDraft({ ...draft, platforms: [...active, { id: p.id, name: p.name }, ...archived.filter((x) => x.id !== p.id)] })} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted pointer-coarse:min-h-[40px]">
                              <RotateCcw aria-hidden className="h-3 w-3" /> {t("Restore")}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t("A new platform gets its targets after you save.")}</p>
              </section>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-background/95 px-5 py-3">
          <button type="button" onClick={() => close(false)} className="h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11">{t("Cancel")}</button>
          <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-50 pointer-coarse:h-11">
            {save.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
            {t("Save settings")}
          </button>
        </footer>

        <AlertDialog open={!!archiveAsk} onOpenChange={(o) => { if (!o) setArchiveAsk(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Archive {name}?", { name: archiveAsk?.platform.name ?? "" })}</AlertDialogTitle>
              <AlertDialogDescription>{t("It leaves the day form and the overview. Its past figures and targets stay, and you can restore it later.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                const p = archiveAsk?.platform;
                if (p && draft) setDraft({ ...draft, platforms: [...active.filter((x) => x.id !== p.id), ...archived, { ...p, archived: true }] });
                setArchiveAsk(null);
              }}>{t("Archive")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Discard the changes you haven't saved?")}</AlertDialogTitle>
              <AlertDialogDescription>{t("The platforms and targets stay as they were.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Keep editing")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmClose(false); setDraft(null); setTargets(null); setAdding(""); onOpenChange(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {t("Discard")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
