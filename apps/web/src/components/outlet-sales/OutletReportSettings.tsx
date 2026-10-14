import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Loader2, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  outletApi, outletConfigKey, outletKey, type OutletCommunity, type OutletItem, type OutletReportConfig,
} from "@/lib/outlet-sales-api";

/**
 * Report settings / Pengaturan laporan (owner, 14 Oct 2026, after a meeting with Ryan): each outlet sets up
 * the breakdown its team reports — RSVP items, Hosting items and Communities (a community counts one
 * number, "Total only", or its own items, "Breakdown"). Add, rename, remove, reorder. An item keeps its id
 * when renamed, so no report loses a figure; removing one that holds figures archives it (asked first) and
 * past reports keep their numbers. For the people who manage the outlet (the targets' rule); the server
 * checks again (SETTINGS_FORBIDDEN) and settles removals itself (lib/outlet-sales.ts mergeReportConfig).
 */
export function OutletReportSettings({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: outletConfigKey(projectId), queryFn: () => outletApi.config(projectId), enabled: open, retry: false });
  const [draft, setDraft] = useState<OutletReportConfig | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [archive, setArchive] = useState<null | { name: string; reports: number; apply: () => void }>(null);

  useEffect(() => {
    if (!open) { setDraft(null); return; }
    if (q.data && !draft) setDraft(structuredClone(q.data.config));
  }, [open, q.data, draft]);

  const usage = q.data?.usage ?? {};
  const dirty = !!draft && !!q.data && JSON.stringify(draft) !== JSON.stringify(q.data.config);

  const save = useMutation({
    mutationFn: () => outletApi.putConfig(projectId, draft!),
    onSuccess: (r) => {
      qc.setQueryData(outletConfigKey(projectId), r);
      qc.invalidateQueries({ queryKey: outletKey(projectId) });
      toast.success(t("Report settings saved. The form uses them from now on."));
      setDraft(null);
      onOpenChange(false);
    },
    onError: (error) => {
      const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
      toast.error(typeof payload?.error === "string" ? payload.error : t("The settings weren't saved. Try again."));
    },
  });

  const close = (o: boolean) => {
    if (o) { onOpenChange(true); return; }
    if (dirty) { setConfirmClose(true); return; }
    onOpenChange(false);
  };

  /** Remove an item or a community: archived (after asking) when reports hold figures for it, else gone. */
  const remove = (name: string, ids: string[], archiveIt: () => void, dropIt: () => void) => {
    const reports = Math.max(0, ...ids.map((id) => usage[id] ?? 0));
    if (reports > 0) setArchive({ name, reports, apply: archiveIt });
    else dropIt();
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>button:first-of-type]:hidden">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold">{t("Report settings")}</SheetTitle>
            <SheetDescription className="mt-0.5 text-sm text-muted-foreground">
              {t("What this outlet's team reports after each night. Renaming keeps every figure; past reports never change.")}
            </SheetDescription>
          </div>
          <button type="button" onClick={() => close(false)} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[44px]">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {!draft ? (
            q.isError ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("The settings didn't load. Check your connection, then try again.")}</p>
            ) : (
              <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
            )
          ) : (
            <div className="flex flex-col gap-6">
              <Block title={t("RSVP items")} hint={t("RSVP total is the sum of these.")}>
                <ItemList
                  items={draft.rsvp}
                  onChange={(rsvp) => setDraft({ ...draft, rsvp })}
                  onRemove={(item, archiveIt, dropIt) => remove(item.label, [item.id], archiveIt, dropIt)}
                  addLabel={t("Add RSVP item")}
                />
              </Block>
              <Block title={t("Hosting items")} hint={t("Hosting total is the sum of these.")}>
                <ItemList
                  items={draft.hosting}
                  onChange={(hosting) => setDraft({ ...draft, hosting })}
                  onRemove={(item, archiveIt, dropIt) => remove(item.label, [item.id], archiveIt, dropIt)}
                  addLabel={t("Add hosting item")}
                />
              </Block>
              <Block title={t("Communities")} hint={t("The communities that came. Each counts one number, or its own items.")}>
                <CommunityList
                  communities={draft.communities}
                  onChange={(communities) => setDraft({ ...draft, communities })}
                  onRemove={remove}
                />
              </Block>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-background/95 px-5 py-3">
          <button type="button" onClick={() => close(false)} className="h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11">
            {t("Cancel")}
          </button>
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-50 pointer-coarse:h-11"
          >
            {save.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
            {t("Save settings")}
          </button>
        </footer>

        <AlertDialog open={!!archive} onOpenChange={(o) => { if (!o) setArchive(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Archive {name}?", { name: archive?.name ?? "" })}</AlertDialogTitle>
              <AlertDialogDescription>
                {archive && (archive.reports === 1
                  ? t("1 report has figures for it. It leaves the form, and that report keeps its numbers and totals. You can restore it later.")
                  : t("{n} reports have figures for it. It leaves the form, and those reports keep their numbers and totals. You can restore it later.", { n: archive.reports }))}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { archive?.apply(); setArchive(null); }}>{t("Archive")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Discard the changes you haven't saved?")}</AlertDialogTitle>
              <AlertDialogDescription>{t("The report settings stay as they were.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Keep editing")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmClose(false); setDraft(null); onOpenChange(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {t("Discard")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function Block({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

const iconBtn = "grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-10";
const inputCls = "h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-colors hover:border-border focus-visible:border-primary focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:h-10";

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/**
 * The active items as editable rows (rename in place, ↑ ↓ to reorder, remove), an "Add" row, and the
 * archived ones under them with Restore. Order among active items is what the form shows.
 */
function ItemList({
  items, onChange, onRemove, addLabel,
}: {
  items: OutletItem[];
  onChange: (items: OutletItem[]) => void;
  onRemove: (item: OutletItem, archiveIt: () => void, dropIt: () => void) => void;
  addLabel: string;
}) {
  const { t } = useLang();
  const [adding, setAdding] = useState("");
  const active = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);
  const setActive = (next: OutletItem[]) => onChange([...next, ...archived]);
  const add = () => {
    const label = adding.trim();
    if (!label) return;
    // No id: the server gives one (lib/outlet-sales.ts newItemId). A temporary key keeps React steady.
    setActive([...active, { id: "", label, _key: `new-${Date.now()}` } as OutletItem]);
    setAdding("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); add(); }
  };
  return (
    <div className="rounded-xl border border-border bg-card">
      {active.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">{t("No items yet.")}</p>}
      <ul className="divide-y divide-border">
        {active.map((item, i) => (
          <li key={item.id || (item as OutletItem & { _key?: string })._key} className="group flex items-center gap-1 px-1.5 py-1">
            <input
              aria-label={t("Item name")}
              value={item.label}
              maxLength={60}
              onChange={(e) => setActive(active.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              className={inputCls}
            />
            <div className="flex items-center opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
              <button type="button" className={iconBtn} disabled={i === 0} onClick={() => setActive(move(active, i, i - 1))} aria-label={t("Move up")}>
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" className={iconBtn} disabled={i === active.length - 1} onClick={() => setActive(move(active, i, i + 1))} aria-label={t("Move down")}>
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(iconBtn, "hover:text-destructive")}
                aria-label={t("Remove {name}", { name: item.label })}
                onClick={() => onRemove(
                  item,
                  () => onChange([...active.filter((_, j) => j !== i), ...archived, { ...item, archived: true }]),
                  () => setActive(active.filter((_, j) => j !== i)),
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-1 border-t border-border px-1.5 py-1">
        <Plus aria-hidden className="ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          aria-label={addLabel}
          placeholder={addLabel}
          value={adding}
          maxLength={60}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          className={cn(inputCls, "placeholder:text-muted-foreground/80")}
        />
      </div>
      {archived.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">{t("Archived")}</p>
          <ul className="mt-1 flex flex-col">
            {archived.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 py-0.5 text-sm text-muted-foreground">
                <span className="min-w-0 truncate">{item.label}</span>
                <button
                  type="button"
                  onClick={() => onChange([...active, { id: item.id, label: item.label }, ...archived.filter((x) => x.id !== item.id)])}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted pointer-coarse:min-h-[40px]"
                >
                  <RotateCcw aria-hidden className="h-3 w-3" /> {t("Restore")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CommunityList({
  communities, onChange, onRemove,
}: {
  communities: OutletCommunity[];
  onChange: (c: OutletCommunity[]) => void;
  onRemove: (name: string, ids: string[], archiveIt: () => void, dropIt: () => void) => void;
}) {
  const { t } = useLang();
  const [adding, setAdding] = useState("");
  const active = communities.filter((c) => !c.archived);
  const archived = communities.filter((c) => c.archived);
  const setActive = (next: OutletCommunity[]) => onChange([...next, ...archived]);
  const add = () => {
    const name = adding.trim();
    if (!name) return;
    setActive([...active, { id: "", name, mode: "total", items: [], _key: `new-${Date.now()}` } as OutletCommunity]);
    setAdding("");
  };
  const keyOf = (c: OutletCommunity) => c.id || (c as OutletCommunity & { _key?: string })._key;
  const modes = useMemo(() => [
    { value: "total" as const, label: t("Total only") },
    { value: "breakdown" as const, label: t("Breakdown") },
  ], [t]);
  return (
    <div className="flex flex-col gap-2">
      {active.map((c, i) => (
        <div key={keyOf(c)} className="group rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-1 px-1.5 py-1.5">
            <input
              aria-label={t("Community name")}
              value={c.name}
              maxLength={60}
              onChange={(e) => setActive(active.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              className={cn(inputCls, "font-medium")}
            />
            <div role="radiogroup" aria-label={t("How it is counted")} className="flex rounded-lg bg-muted p-0.5">
              {modes.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={c.mode === m.value}
                  onClick={() => setActive(active.map((x, j) => (j === i ? { ...x, mode: m.value } : x)))}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[36px]",
                    c.mode === m.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex items-center">
              <button type="button" className={iconBtn} disabled={i === 0} onClick={() => setActive(move(active, i, i - 1))} aria-label={t("Move up")}>
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" className={iconBtn} disabled={i === active.length - 1} onClick={() => setActive(move(active, i, i + 1))} aria-label={t("Move down")}>
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(iconBtn, "hover:text-destructive")}
                aria-label={t("Remove {name}", { name: c.name })}
                onClick={() => onRemove(
                  c.name,
                  [c.id, ...c.items.map((x) => x.id)].filter(Boolean),
                  () => onChange([...active.filter((_, j) => j !== i), ...archived, { ...c, archived: true }]),
                  () => setActive(active.filter((_, j) => j !== i)),
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {c.mode === "breakdown" && (
            <div className="border-t border-border p-2 pl-4">
              <ItemList
                items={c.items}
                onChange={(items) => setActive(active.map((x, j) => (j === i ? { ...x, items } : x)))}
                onRemove={(item, archiveIt, dropIt) => onRemove(item.label, [item.id], archiveIt, dropIt)}
                addLabel={t("Add item to {name}", { name: c.name || t("this community") })}
              />
            </div>
          )}
        </div>
      ))}
      <div className="flex items-center gap-1 rounded-xl border border-dashed border-border px-1.5 py-1">
        <Plus aria-hidden className="ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          aria-label={t("Add community")}
          placeholder={t("Add community")}
          value={adding}
          maxLength={60}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onBlur={add}
          className={cn(inputCls, "placeholder:text-muted-foreground/80")}
        />
      </div>
      {archived.length > 0 && (
        <div className="px-1">
          <p className="text-xs font-medium text-muted-foreground">{t("Archived")}</p>
          <ul className="mt-1 flex flex-col">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-0.5 text-sm text-muted-foreground">
                <span className="min-w-0 truncate">{c.name}</span>
                <button
                  type="button"
                  onClick={() => onChange([...active, { ...c, archived: undefined }, ...archived.filter((x) => x.id !== c.id)])}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted pointer-coarse:min-h-[40px]"
                >
                  <RotateCcw aria-hidden className="h-3 w-3" /> {t("Restore")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
