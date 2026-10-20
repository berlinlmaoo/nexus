import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Brain, Check, ChevronLeft, ChevronRight, Loader2, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/lib/lang";
import { toastFailure } from "@/lib/failure";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  GIDEON_MEMORY_KEY, addGideonMemory, deleteGideonMemory, forgetAllGideonMemory, getGideonMemory, setGideonMemoryPaused,
  setGideonMemoryProfile, updateGideonMemory, type GideonMemoryProfile, type GideonMemoryState,
} from "@/lib/gideon-ai";
import type { GideonMemory } from "@/lib/gideon";

/**
 * Settings › GIDEON Memory (owner, 19 Oct 2026): what GIDEON remembers about you. Only you see it (not the Board,
 * not One Above All). U-2 (same day, "buat mirip kaya ChatGPT aja"): the main page is grouped rows — the switch,
 * "Memory summary ›", and three fixed fields saved as ordinary memories (no AI writes them). The summary is its own
 * view: a dot-grid shimmer while loading, then the sections slide up in order; each memory has one ⋯ menu; the
 * composer at the bottom adds one directly (same rules as before: no secrets, at most 40). R-2: the composer is one
 * soft rounded capsule with the send button inside it (no hard border), like the iOS one.
 */

type Kind = GideonMemory["kind"];
const KINDS: Array<{ kind: Kind; label: string }> = [
  { kind: "PREFERENCE", label: "Preferences" },
  { kind: "PERSON", label: "About you" },
  { kind: "DATE", label: "Dates" },
  { kind: "FACT", label: "Notes" },
];

/** "14 Mar" in the interface language from "03-14". */
function dayLabel(md: string | null, locale: string) {
  if (!md) return null;
  const [m, d] = md.split("-").map(Number);
  return new Date(Date.UTC(2000, m - 1, d)).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "just now", "5 minutes ago", "yesterday", "12 Oct". */
function relTime(iso: string, locale: string, justNow: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return justNow;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (min < 60) return rtf.format(-min, "minute");
  if (min < 60 * 24) return rtf.format(-Math.round(min / 60), "hour");
  if (min < 60 * 24 * 30) return rtf.format(-Math.round(min / 1440), "day");
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

const group = "overflow-hidden rounded-xl border border-border bg-card shadow-soft divide-y divide-border";
// Memory summary (Q-7, 20 Oct 2026): the same grouped card, without the hairline border, like iOS.
const summaryGroup = "overflow-hidden rounded-xl bg-card shadow-soft divide-y divide-border";
const caption = "px-1 pt-1.5 text-xs leading-relaxed text-muted-foreground";

export function GideonMemorySection() {
  const L = useLang();
  const { t } = L;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: GIDEON_MEMORY_KEY, queryFn: getGideonMemory, retry: false });
  const put = (s: GideonMemoryState) => qc.setQueryData(GIDEON_MEMORY_KEY, s);
  const [view, setView] = useState<"main" | "summary">("main");
  const [confirmAll, setConfirmAll] = useState(false);

  const pause = useMutation({ mutationFn: (paused: boolean) => setGideonMemoryPaused(paused), onSuccess: put, onError: (e) => toastFailure(t("Couldn't save that setting"), e) });
  const wipe = useMutation({
    mutationFn: forgetAllGideonMemory,
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: GIDEON_MEMORY_KEY }); toast.success(L.tn(r.deleted, "GIDEON forgot 1 thing.", "GIDEON forgot {n} things.")); },
    onError: (e) => toastFailure(t("Something went wrong."), e),
  });

  const data = q.data;
  const items = data?.memories ?? [];
  // The remote-config kill switch (available=false) behaves like paused here, with its own line.
  const unavailable = data?.available === false;
  const paused = !!data?.paused || unavailable;

  if (view === "summary") return <MemorySummary onBack={() => setView("main")} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold">{t("GIDEON Memory")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("What GIDEON remembers about you, so its answers fit you. Only you can see this.")}</p>
      </div>

      {q.isError && <LoadError error={q.error} onRetry={() => void q.refetch()} />}

      <div>
        <div className={group}>
          <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 py-3 hover:bg-accent/30">
            <span className="text-sm font-medium">{t("Use GIDEON Memory")}</span>
            <Switch checked={!paused} disabled={!data || pause.isPending || unavailable} onCheckedChange={(on) => pause.mutate(!on)} aria-label={t("Use GIDEON Memory")} className="shrink-0" />
          </label>
        </div>
        <p className={caption}>
          {unavailable ? t("GIDEON Memory is not available right now.") : t("Off: GIDEON doesn't remember anything new and doesn't use what's here.")}
        </p>
      </div>

      <div>
        <div className={group}>
          <button type="button" onClick={() => setView("summary")} className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30">
            <span className="min-w-0 flex-1 text-sm font-medium">{t("Memory summary")}</span>
            {data && <span className="text-xs tabular-nums text-muted-foreground">{items.length}/{data.max}</span>}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </div>
        <p className={caption}>{t("See what GIDEON has learned about you. Add things here or tell it in a chat.")}</p>
      </div>

      <ProfileFields profile={data?.profile} disabled={!data || paused} loading={q.isLoading} />
      {paused && !unavailable && <p className="px-1 text-xs text-muted-foreground">{t("GIDEON Memory is off. Turn it on to add or use memories.")}</p>}

      {items.length > 0 && (
        <div>
          <div className={group}>
            <button type="button" onClick={() => setConfirmAll(true)} disabled={wipe.isPending}
              className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50">
              {wipe.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{t("Forget everything")}
            </button>
          </div>
          <p className={caption}>{t("GIDEON stops using all of it right away. Your chats stay.")}</p>
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

/** "Your nickname", "Your role / occupation", "More about you": each one an ordinary memory (PUT …/memory/profile). */
function ProfileFields({ profile, disabled, loading }: { profile?: GideonMemoryProfile; disabled: boolean; loading: boolean }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const empty = { nickname: "", role: "", about: "" };
  const [draft, setDraft] = useState(empty);
  const saved = { nickname: profile?.nickname ?? "", role: profile?.role ?? "", about: profile?.about ?? "" };
  // Follow the server until the person starts typing (and again after a save).
  const touched = useRef(false);
  useEffect(() => { if (!touched.current) setDraft(saved); }, [profile?.nickname, profile?.role, profile?.about]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = (Object.keys(saved) as Array<keyof typeof saved>).filter((k) => draft[k].trim() !== saved[k]);
  const save = useMutation({
    mutationFn: () => setGideonMemoryProfile(Object.fromEntries(dirty.map((k) => [k, draft[k].trim()]))),
    onSuccess: (s) => { touched.current = false; qc.setQueryData(GIDEON_MEMORY_KEY, s); toast.success(t("Saved to GIDEON Memory")); },
    onError: (e) => toastFailure(t("Couldn't save to GIDEON Memory"), e),
  });
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { touched.current = true; setDraft((d) => ({ ...d, [k]: e.target.value })); };
  const field = "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60";
  return (
    <div>
      <div className={group}>
        <label className="flex min-h-12 flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="w-44 shrink-0 text-sm font-medium">{t("Your nickname")}</span>
          <input value={draft.nickname} onChange={set("nickname")} disabled={disabled} maxLength={60} placeholder={loading ? t("Loading…") : t("What should GIDEON call you?")} className={field} />
        </label>
        <label className="flex min-h-12 flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="w-44 shrink-0 text-sm font-medium">{t("Your role / occupation")}</span>
          <input value={draft.role} onChange={set("role")} disabled={disabled} maxLength={120} placeholder={t("e.g. Social media lead")} className={field} />
        </label>
        <label className="flex flex-col gap-1 px-4 py-2.5">
          <span className="text-sm font-medium">{t("More about you")}</span>
          <textarea value={draft.about} onChange={set("about")} disabled={disabled} maxLength={170} rows={3}
            placeholder={t("Interests, values or preferences GIDEON should keep in mind")} className={cn(field, "resize-none py-1")} />
        </label>
      </div>
      <div className="flex items-start justify-between gap-3">
        <p className={caption}>{t("Saved as memories. GIDEON uses them in your chats.")}</p>
        {dirty.length > 0 && (
          <div className="flex shrink-0 gap-2 pt-1.5">
            <button type="button" onClick={() => { touched.current = false; setDraft(saved); }} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">{t("Cancel")}</button>
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending || disabled}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-soft hover:bg-primary/90 disabled:opacity-50">
              {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("Save")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The pushed "Memory summary" view. */
function MemorySummary({ onBack }: { onBack: () => void }) {
  const L = useLang();
  const { t } = L;
  const locale = L.lang === "id" ? "id-ID" : "en-GB";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: GIDEON_MEMORY_KEY, queryFn: getGideonMemory, retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: GIDEON_MEMORY_KEY });
  // Data already here (or back within ~150 ms): everything shows at once. Slower: the sections slide up in order.
  const mountedAt = useRef(Date.now());
  const [animate, setAnimate] = useState<boolean | null>(q.data ? false : null);
  useEffect(() => { if (q.data && animate === null) setAnimate(Date.now() - mountedAt.current > 150); }, [q.data, animate]);

  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => addGideonMemory({ text: text.trim() }),
    onSuccess: (r) => { setText(""); void refresh(); toast.success(r.created === false ? t("Already in GIDEON Memory") : t("Saved to GIDEON Memory")); },
    onError: (e) => toastFailure(t("Couldn't save to GIDEON Memory"), e),
  });

  const data = q.data;
  const items = data?.memories ?? [];
  const unavailable = data?.available === false;
  const paused = !!data?.paused || unavailable;
  const atMax = !!data && items.length >= data.max;
  const sections = KINDS.map((k) => ({ ...k, rows: items.filter((m) => m.kind === k.kind) })).filter((s) => s.rows.length);

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="mb-4 flex items-start gap-2">
        <button type="button" onClick={onBack} aria-label={t("Back")} title={t("Back")} className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h2 className="font-semibold">{t("Memory summary")}</h2>
          {!data && !q.isError ? (
            <p className="gideon-shimmer text-xs font-medium" aria-live="polite">{t("Loading…")}</p>
          ) : data?.updatedAt ? (
            <p className="text-xs text-muted-foreground">{t("Updated {time}", { time: relTime(data.updatedAt, locale, t("just now")) })}</p>
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-6">
        {q.isError && <LoadError error={q.error} onRetry={() => void q.refetch()} />}
        {!data && !q.isError && <div aria-hidden className="gmem-dots h-72 rounded-xl" />}
        {data && items.length === 0 && (
          <EmptyState compact icon={Brain} tone="muted" title={t("Nothing remembered yet")}
            message={t("Tell GIDEON in a chat, e.g. “remember that I prefer short answers”, or add something below.")} />
        )}
        {sections.map((s, i) => (
          <section key={s.kind} className={cn("space-y-1.5", animate && "gmem-reveal")} style={animate ? ({ "--i": i } as React.CSSProperties) : undefined}>
            <h3 className="px-1 text-xs font-semibold text-muted-foreground">{t(s.label)}</h3>
            <ul className={summaryGroup}>
              {s.rows.map((m) => <MemoryRow key={m.id} memory={m} locale={locale} paused={paused} onDone={() => void refresh()} />)}
            </ul>
          </section>
        ))}
      </div>

      <div className="sticky bottom-0 mt-6 bg-background/95 pb-2 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <form className="flex items-center gap-2 rounded-full bg-muted/70 py-1 pl-4 pr-1 transition-shadow focus-within:ring-2 focus-within:ring-ring/30"
          onSubmit={(e) => { e.preventDefault(); if (text.trim() && !add.isPending) add.mutate(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={data?.textMax ?? 200} disabled={!data || paused || atMax}
            placeholder={t("Add or update…")} aria-label={t("Something for GIDEON to remember")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60" />
          <button type="submit" disabled={!text.trim() || add.isPending || paused || atMax} aria-label={t("Add")} title={t("Add")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground transition hover:bg-sidebar-primary/90 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/70 disabled:hover:bg-muted">
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </form>
        {unavailable ? <p className={caption}>{t("GIDEON Memory is not available right now.")}</p>
          : paused ? <p className={caption}>{t("GIDEON Memory is off. Turn it on to add or use memories.")}</p>
          : atMax ? <p className={caption}>{t("GIDEON Memory is full ({n}). Delete something to add more.", { n: data?.max ?? 0 })}</p>
          : <p className={caption}>{t("Never passwords, PINs or codes. Up to {n} memories.", { n: data?.max ?? 40 })}</p>}
      </div>
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
      <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} aria-label={t("Edit memory")}
          onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setValue(memory.text); } if (e.key === "Enter" && value.trim()) save.mutate({ text: value.trim() }); }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring" />
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
    <li className="flex items-start gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1 py-1">
        <p className="break-words text-sm">{memory.text}</p>
        {(pending || day) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
            {day && <span>{day}</span>}
            {pending && <span className="whitespace-nowrap rounded bg-accent px-1.5 py-px font-medium text-accent-foreground">{t("Suggested, not saved yet")}</span>}
            {pending && (
              <button type="button" onClick={() => save.mutate({ status: "ACTIVE" })} disabled={save.isPending || paused}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />}{t("Save")}
              </button>
            )}
          </div>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={iconBtn} aria-label={t("More")} title={t("More")} disabled={del.isPending}>
            {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil className="mr-2 h-4 w-4" />{t("Edit")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => del.mutate()} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />{t("Delete")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
