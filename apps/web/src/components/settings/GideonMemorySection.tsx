import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/lib/lang";
import { toastFailure } from "@/lib/failure";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { SelectPicker } from "@/components/SelectPicker";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  GIDEON_MEMORY_KEY, addGideonMemory, deleteGideonMemory, forgetAllGideonMemory, getGideonMemory, setGideonMemoryPaused,
  updateGideonMemory, type GideonMemoryState,
} from "@/lib/gideon-ai";
import type { GideonMemory } from "@/lib/gideon";

/**
 * Settings › GIDEON Memory (owner, 19 Oct 2026): what GIDEON remembers about you. Only you see it (not the Board,
 * not One Above All). List, add, edit, delete one, delete all, pause.
 */

type Kind = GideonMemory["kind"];
const KINDS: Array<{ kind: Kind; label: string }> = [
  { kind: "PREFERENCE", label: "Preferences" },
  { kind: "PERSON", label: "About you" },
  { kind: "DATE", label: "Dates" },
  { kind: "FACT", label: "Notes" },
];
const KIND_ONE: Record<Kind, string> = { PREFERENCE: "Preference", PERSON: "About you", DATE: "Date", FACT: "Note" };

/** "14 Mar" in the interface language from "03-14". */
function dayLabel(md: string | null, locale: string) {
  if (!md) return null;
  const [m, d] = md.split("-").map(Number);
  return new Date(Date.UTC(2000, m - 1, d)).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

export function GideonMemorySection() {
  const L = useLang();
  const { t } = L;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: GIDEON_MEMORY_KEY, queryFn: getGideonMemory, retry: false });
  const put = (s: GideonMemoryState) => qc.setQueryData(GIDEON_MEMORY_KEY, s);
  const refresh = () => qc.invalidateQueries({ queryKey: GIDEON_MEMORY_KEY });

  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("FACT");
  const [confirmAll, setConfirmAll] = useState(false);

  const pause = useMutation({ mutationFn: (paused: boolean) => setGideonMemoryPaused(paused), onSuccess: put, onError: (e) => toastFailure(t("Couldn't save that setting"), e) });
  const add = useMutation({
    mutationFn: () => addGideonMemory({ text: text.trim(), kind }),
    onSuccess: () => { setText(""); void refresh(); },
    onError: (e) => toastFailure(t("Couldn't save to GIDEON Memory"), e),
  });
  const wipe = useMutation({
    mutationFn: forgetAllGideonMemory,
    onSuccess: (r) => { void refresh(); toast.success(L.tn(r.deleted, "GIDEON forgot 1 thing.", "GIDEON forgot {n} things.")); },
    onError: (e) => toastFailure(t("Something went wrong."), e),
  });

  const data = q.data;
  const items = data?.memories ?? [];
  const paused = !!data?.paused;
  const atMax = !!data && items.length >= data.max;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-5">
        <div>
          <h2 className="font-semibold">{t("GIDEON Memory")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("What GIDEON remembers about you, so its answers fit you. Only you can see this.")}</p>
        </div>

        <label className="flex items-start justify-between gap-4 rounded-lg border border-border p-3 cursor-pointer hover:bg-accent/30">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("Use GIDEON Memory")}</div>
            <div className="text-xs text-muted-foreground">{t("Off: GIDEON doesn't remember anything new and doesn't use what's here.")}</div>
          </div>
          <Switch checked={!paused} disabled={!data || pause.isPending} onCheckedChange={(on) => pause.mutate(!on)} aria-label={t("Use GIDEON Memory")} className="mt-0.5 shrink-0" />
        </label>

        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !add.isPending) add.mutate(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={data?.textMax ?? 200} disabled={paused || atMax}
            placeholder={t("e.g. Call me by my first name. Keep answers short.")}
            aria-label={t("Something for GIDEON to remember")}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
          <div className="flex gap-2">
            <SelectPicker value={kind} onChange={(v) => setKind((v || "FACT") as Kind)} variant="field" ariaLabel={t("Type")} disabled={paused || atMax}
              options={KINDS.map((k) => ({ value: k.kind, label: t(KIND_ONE[k.kind]) }))} className="min-w-[8.5rem] flex-1 sm:flex-none" />
            <button type="submit" disabled={!text.trim() || add.isPending || paused || atMax}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
              {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t("Add")}
            </button>
          </div>
        </form>
        {paused && <p className="text-xs text-muted-foreground">{t("GIDEON Memory is off. Turn it on to add or use memories.")}</p>}
        {atMax && !paused && <p className="text-xs text-muted-foreground">{t("GIDEON Memory is full ({n}). Delete something to add more.", { n: data?.max ?? 0 })}</p>}

        {q.isLoading && <p className="text-sm text-muted-foreground">{t("Loading…")}</p>}
        {q.isError && <LoadError error={q.error} onRetry={() => void q.refetch()} />}
        {data && items.length === 0 && (
          <EmptyState compact icon={Brain} tone="muted" title={t("Nothing remembered yet")}
            message={t("Tell GIDEON in a chat, e.g. “remember that I prefer short answers”, or add something here.")} />
        )}
        {items.length > 0 && (
          <div className="space-y-5">
            {KINDS.map((k) => {
              const rows = items.filter((m) => m.kind === k.kind);
              if (!rows.length) return null;
              return (
                <section key={k.kind} className="space-y-1.5">
                  <h3 className="text-xs font-semibold text-muted-foreground">{t(k.label)}</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {rows.map((m) => <MemoryRow key={m.id} memory={m} locale={L.lang === "id" ? "id-ID" : "en-GB"} paused={paused} onDone={() => void refresh()} />)}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-soft flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("Forget everything")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("GIDEON stops using all of it right away. Your chats stay.")}</p>
          </div>
          <button onClick={() => setConfirmAll(true)} disabled={wipe.isPending}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-destructive/40 px-4 py-1.5 text-sm font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50">
            {wipe.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{t("Forget everything")}
          </button>
        </div>
      )}

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Forget everything?")}</AlertDialogTitle>
            <AlertDialogDescription>{L.tn(items.length, "GIDEON stops using the 1 thing it remembers about you. It's deleted for good after 30 days.", "GIDEON stops using the {n} things it remembers about you. They're deleted for good after 30 days.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => wipe.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("Forget everything")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MemoryRow({ memory, locale, paused, onDone }: { memory: GideonMemory; locale: string; paused: boolean; onDone: () => void }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memory.text);
  const save = useMutation({
    mutationFn: (p: { text?: string; status?: "ACTIVE" }) => updateGideonMemory(memory.id, p),
    onSuccess: () => { setEditing(false); onDone(); },
    onError: (e) => toastFailure(t("Couldn't save to GIDEON Memory"), e),
  });
  const del = useMutation({
    mutationFn: () => deleteGideonMemory(memory.id),
    onSuccess: () => { onDone(); toast.success(t("Forgotten.")); },
    onError: (e) => { if ((e as { status?: number }).status === 404) onDone(); else toastFailure(t("Something went wrong."), e); },
  });
  const pending = memory.status === "PENDING";
  const day = dayLabel(memory.monthDay, locale);
  const iconBtn = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50";

  if (editing) {
    return (
      <li className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center">
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} aria-label={t("Edit memory")}
          onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setValue(memory.text); } if (e.key === "Enter" && value.trim()) save.mutate({ text: value.trim() }); }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
        <div className="flex justify-end gap-1">
          <button type="button" onClick={() => { setEditing(false); setValue(memory.text); }} className={iconBtn} aria-label={t("Cancel")} title={t("Cancel")}><X className="h-4 w-4" /></button>
          <button type="button" onClick={() => value.trim() && save.mutate({ text: value.trim() })} disabled={!value.trim() || save.isPending} className={iconBtn} aria-label={t("Save")} title={t("Save")}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 p-2.5">
      <div className="min-w-0 flex-1 py-1">
        <p className="break-words text-sm">{memory.text}</p>
        {(pending || day) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {day && <span>{day}</span>}
            {pending && <span className="rounded bg-accent px-1.5 py-px font-medium text-accent-foreground">{t("Suggested, not saved yet")}</span>}
          </p>
        )}
      </div>
      {pending && (
        <button type="button" onClick={() => save.mutate({ status: "ACTIVE" })} disabled={save.isPending || paused}
          className="mt-0.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />}{t("Save")}
        </button>
      )}
      <button type="button" onClick={() => setEditing(true)} className={iconBtn} aria-label={t("Edit")} title={t("Edit")}><Pencil className="h-4 w-4" /></button>
      <button type="button" onClick={() => del.mutate()} disabled={del.isPending} className={`${iconBtn} hover:text-destructive`} aria-label={t("Delete")} title={t("Delete")}>
        {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </li>
  );
}
