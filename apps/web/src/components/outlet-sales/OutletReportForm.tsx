import { useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SelectPicker } from "@/components/SelectPicker";
import { DateField } from "@/components/DateField";
import { useLang, type Lang } from "@/lib/lang";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  outletApi, outletEventKey, outletKey, type OutletEvent, type OutletEventWrite, type OutletFieldKey, type OutletFormField,
  type OutletItem, type OutletMonthResponse, type OutletReportConfig,
} from "@/lib/outlet-sales-api";
import { StatusPill, count, dayShort, defaultOutletConfig, figureOf, pick, reportOpen, rupiah, sumOf, visibleItems, vsTarget, wibToday } from "./outlet-ui";

/** The form's sections the outlet's own breakdown replaces (owner, 14 Oct 2026). */
const BREAKDOWN_SECTIONS = new Set(["rsvp", "hosting"]);

/** What the form is open on: an existing event, or a new one (with a day already chosen). */
export type FormTarget = { eventId?: string; date?: string };

const NEW = "__new__";

function errorOf(error: unknown): { text: string | null; field: string | null; code: string | null } {
  const payload = (error as { payload?: { error?: unknown; field?: unknown; code?: unknown } } | null)?.payload;
  return {
    text: typeof payload?.error === "string" ? payload.error : null,
    field: typeof payload?.field === "string" ? payload.field : null,
    code: typeof payload?.code === "string" ? payload.code : null,
  };
}

/** The keys of the form that plan a night; every other one is its report, which opens on the night itself. */
const PLAN_KEYS = new Set(["name", "date", "salesTarget", "paxTarget"]);

/**
 * The default report form (the outlet team, 10 Oct 2026: "form dengan pertanyaan yang diatas, supaya team nya tinggal
 * isi form nya. Data nya otomatis masuk ke nexus"). One form for both jobs: a new event (name and date,
 * the rest when known) and the report of an existing one. The questions, their order and their labels
 * come from the server's `form` (lib/outlet-sales.ts OUTLET_FORM), in the outlet team's words. Totals and the
 * percentages are worked out as you type; the server keeps its own count.
 */
export function OutletReportForm({
  projectId, data, target, onTarget, onCopyLink, onDone,
}: {
  projectId: string;
  data: OutletMonthResponse;
  target: FormTarget;
  onTarget: (t: FormTarget) => void;
  onCopyLink: (eventId?: string | null) => void;
  onDone: (e: OutletEvent) => void;
}) {
  const { t, locale } = useLang();
  const known = useMemo(() => [...data.waitingEarlier, ...data.events], [data]);
  const local = target.eventId ? known.find((e) => e.id === target.eventId) : undefined;
  // A link to an event of another month: fetch that one.
  const remote = useQuery({
    queryKey: outletEventKey(projectId, target.eventId ?? ""),
    queryFn: () => outletApi.event(projectId, target.eventId!),
    enabled: !!target.eventId && !local,
    retry: false,
  });
  const event = local ?? remote.data?.event ?? null;
  const [dirty, setDirty] = useState(false);

  const waiting = [...data.waitingEarlier, ...data.events.filter((e) => e.status === "WAITING_REPORT")].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = data.events.filter((e) => e.status === "UPCOMING");
  const reported = data.events.filter((e) => e.status === "REPORTED");
  const optionLabel = (e: OutletEvent) => `${dayShort(e.date, locale)} · ${e.name}`;

  const choose = (value: string) => {
    if (dirty && !window.confirm(t("Discard the changes you haven't saved?"))) return;
    setDirty(false);
    onTarget(value === NEW ? {} : { eventId: value });
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{t("Event report")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("Fill it after every night. It goes straight into Overview, Calendar and Board.")}</p>
          </div>
          <button
            type="button"
            onClick={() => onCopyLink(target.eventId)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
          >
            <Link2 aria-hidden className="h-4 w-4" /> <span className="hidden sm:inline">{t("Copy form link")}</span><span className="sr-only sm:hidden">{t("Copy form link")}</span>
          </button>
        </div>
        <label className="text-xs font-medium text-muted-foreground">
          {t("Which event?")}
          <SelectPicker
            variant="field"
            ariaLabel={t("Which event?")}
            value={target.eventId ?? NEW}
            onChange={choose}
            options={[
              { value: NEW, label: t("New event") },
              ...(event && !known.some((e) => e.id === event.id) ? [{ value: event.id, label: optionLabel(event) }] : []),
              ...waiting.map((e) => ({ value: e.id, label: optionLabel(e), group: t("Waiting for a report") })),
              ...upcoming.map((e) => ({ value: e.id, label: optionLabel(e), group: t("Upcoming") })),
              ...reported.map((e) => ({ value: e.id, label: optionLabel(e), group: t("Reported") })),
            ]}
            className="mt-1 h-10 w-full rounded-xl px-3 font-normal text-foreground pointer-coarse:h-11"
          />
        </label>
      </header>

      {target.eventId && !event ? (
        remote.isError ? (
          <p className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-6 text-center text-sm text-muted-foreground">
            {t("This event no longer exists. It may have been deleted; Control Room → Audit can restore it.")}
          </p>
        ) : (
          <div className="h-96 animate-pulse rounded-xl bg-muted" aria-busy="true" />
        )
      ) : (
        <FormBody
          key={event ? event.id : `new:${target.date ?? ""}`}
          projectId={projectId}
          data={data}
          event={event}
          defaultDate={target.date ?? data.today ?? wibToday()}
          onDirty={setDirty}
          onSaved={(saved, created) => {
            setDirty(false);
            if (created) onTarget({ eventId: saved.id });
          }}
          onDeleted={() => { setDirty(false); onTarget({}); }}
          onDone={onDone}
        />
      )}
    </div>
  );
}

type Draft = Record<string, string>;

function nfOf(lang: Lang) {
  // id-ID grouping in both languages (12 Oct 2026), like every Rupiah amount in NEXUS.
  void lang;
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
}

function toDraft(fields: OutletFormField[], event: OutletEvent | null, date: string, lang: Lang): Draft {
  const nf = nfOf(lang);
  const d: Draft = {};
  for (const f of fields) {
    const v = event ? (event as unknown as Record<string, unknown>)[f.key] : f.key === "date" ? date : null;
    if (f.type === "money" || f.type === "count") d[f.key] = typeof v === "number" ? nf.format(v) : "";
    else d[f.key] = typeof v === "string" ? v : "";
  }
  return d;
}

function numberOf(v: string): number | null {
  const digits = v.replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

function valueOf(f: OutletFormField, raw: string): string | number | null {
  if (f.type === "money" || f.type === "count") return numberOf(raw);
  return raw.trim();
}

function FormBody({
  projectId, data, event, defaultDate, onDirty, onSaved, onDeleted, onDone,
}: {
  projectId: string;
  data: OutletMonthResponse;
  event: OutletEvent | null;
  defaultDate: string;
  onDirty: (d: boolean) => void;
  onSaved: (e: OutletEvent, created: boolean) => void;
  onDeleted: () => void;
  onDone: (e: OutletEvent) => void;
}) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const fields = useMemo(() => data.form.sections.filter((s) => !BREAKDOWN_SECTIONS.has(s.key)).flatMap((s) => s.fields), [data.form]);
  const config: OutletReportConfig = data.config ?? defaultOutletConfig();
  const [draft, setDraft] = useState<Draft>(() => toDraft(fields, event, defaultDate, lang));
  // The breakdown figures by item id, as typed (grouped digits); "" = not filled.
  const [figures, setFigures] = useState<Draft>(() => {
    const nf = nfOf(lang);
    const out: Draft = {};
    const ids = [
      ...config.rsvp, ...config.hosting,
      ...config.communities.flatMap((c) => [{ id: c.id, label: c.name }, ...c.items]),
    ].map((i) => i.id);
    for (const id of ids) {
      const v = figureOf(event, id);
      out[id] = v === null ? "" : nf.format(v);
    }
    return out;
  });
  const [invalid, setInvalid] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const nf = nfOf(lang);
  // A night after today (WIB) is planned here (name, day, targets) but reported only from the night itself
  // (UI tour run 13, W-B5); the server refuses an earlier report too.
  const notYet = !!draft.date && !reportOpen(draft.date, data.today ?? wibToday());

  const set = (f: OutletFormField, raw: string) => {
    const v = f.type === "money" || f.type === "count" ? (numberOf(raw) === null ? "" : nf.format(numberOf(raw)!)) : raw;
    setDraft((d) => ({ ...d, [f.key]: v }));
    if (invalid === f.key) setInvalid(null);
    onDirty(true);
  };

  const setFigure = (id: string, raw: string) => {
    const n = numberOf(raw);
    setFigures((d) => ({ ...d, [id]: n === null ? "" : nf.format(n) }));
    onDirty(true);
  };

  /** New: every field with something in it. Edit: only what changed, so two people never undo each other. */
  const payload = (): OutletEventWrite => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const next = valueOf(f, draft[f.key] ?? "");
      // Not the night yet: its report waits (only clearing one made too early goes).
      if (notYet && !PLAN_KEYS.has(f.key) && next !== null && next !== "") continue;
      if (!event) {
        if (next !== null && next !== "") out[f.key] = next;
        continue;
      }
      const before = (event as unknown as Record<string, unknown>)[f.key] ?? (f.type === "money" || f.type === "count" ? null : "");
      if (before !== next) out[f.key] = next;
    }
    const values: Record<string, number | null> = {};
    for (const [id, raw] of Object.entries(figures)) {
      const next = numberOf(raw);
      if (notYet && next !== null) continue;
      if (!event) { if (next !== null) values[id] = next; continue; }
      if (figureOf(event, id) !== next) values[id] = next;
    }
    if (Object.keys(values).length > 0) out.values = values;
    return out as OutletEventWrite;
  };

  // One key for this form's "add night" (race audit 16 Oct 2026, M9): a double press or a retry after a
  // timeout stores the night once — the server answers the repeat with the night it already has.
  const createKey = useRef<string>(crypto.randomUUID());
  const save = useMutation({
    mutationFn: async () => {
      const body = payload();
      if (!event) return { saved: await outletApi.create(projectId, { ...body, clientRequestId: createKey.current }), created: true };
      if (Object.keys(body).length === 0) return { saved: event, created: false };
      return { saved: await outletApi.update(projectId, event.id, body), created: false };
    },
    onSuccess: ({ saved, created }) => {
      qc.invalidateQueries({ queryKey: outletKey(projectId) });
      toast.success(
        saved.status === "REPORTED"
          ? t("Report for {name} saved.", { name: saved.name })
          : created ? t("{name} added. Fill its report after the night.", { name: saved.name }) : t("{name} saved.", { name: saved.name }),
      );
      onSaved(saved, created);
      onDone(saved);
    },
    onError: (error) => {
      const { text, field, code } = errorOf(error);
      if (field) setInvalid(field);
      // The report settings changed meanwhile: fetch them, the typed figures stay.
      if (field?.startsWith("values.")) qc.invalidateQueries({ queryKey: outletKey(projectId) });
      toast.error(code === "REPORT_NOT_OPEN" ? t("Reports open on the night itself.") : text ?? t("That wasn't saved. Try again."));
    },
  });

  const remove = useMutation({
    mutationFn: () => outletApi.remove(projectId, event!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outletKey(projectId) });
      toast.success(t("{name} deleted. Control Room → Audit can restore it.", { name: event!.name }));
      onDeleted();
    },
    onError: (error) => toast.error(errorOf(error).text ?? t("The event wasn't deleted. Try again.")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.name?.trim()) { setInvalid("name"); toast.error(t("Give the event a name.")); return; }
    if (!draft.date) { setInvalid("date"); toast.error(t("Pick the day of the event.")); return; }
    save.mutate();
  };

  const n = (k: OutletFieldKey) => numberOf(draft[k] ?? "");
  const fig = (id: string) => numberOf(figures[id] ?? "");
  const shown = (items: OutletItem[]) => visibleItems(items, event);

  /** One breakdown section: its items as number boxes, the live total in the title. */
  const breakdown = (key: string, title: string, items: OutletItem[], extra?: { allIds?: string[]; legend?: string }) => {
    const list = shown(items);
    const total = sumOf((extra?.allIds ?? items.map((i) => i.id)).map(fig));
    return (
      <fieldset key={key} disabled={notYet} className="rounded-xl border border-border bg-card p-4 disabled:opacity-60">
        <legend className="sr-only">{extra?.legend ?? title}</legend>
        <div aria-hidden className="mb-3 flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">{title}: <span className="tabular-nums">{total === null ? "—" : count(total, lang)}</span></span>
        </div>
        {list.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("No items yet. Report settings sets them up.")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {list.map((i) => numberBox(i.id, i.archived ? `${i.label} · ${t("archived")}` : i.label))}
          </div>
        )}
      </fieldset>
    );
  };

  const numberBox = (id: string, label: string) => {
    const htmlId = `os-v-${id}`;
    return (
      <div key={id} className="min-w-0">
        <label htmlFor={htmlId} className="mb-1 block truncate text-xs font-medium text-muted-foreground">{label}</label>
        <input
          id={htmlId}
          inputMode="numeric"
          autoComplete="off"
          placeholder="—"
          value={figures[id] ?? ""}
          onChange={(e) => setFigure(id, e.target.value)}
          aria-invalid={invalid === `values.${id}` || undefined}
          className={cn(
            "h-10 w-full rounded-lg border bg-background px-3 text-right text-sm tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-control-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:h-11",
            invalid === `values.${id}` ? "border-destructive" : "border-border",
          )}
        />
      </div>
    );
  };

  /** Communities: per community one number (Total only) or its own items (Breakdown); the grand total on top. */
  const communities = () => {
    const list = config.communities.filter((c) => !c.archived || figureOf(event, c.id) !== null || c.items.some((i) => figureOf(event, i.id) !== null));
    if (list.length === 0) return null;
    const totalOf = (c: (typeof list)[number]) => sumOf([fig(c.id), ...c.items.map((i) => fig(i.id))]);
    const grand = sumOf(list.map(totalOf));
    return (
      <fieldset key="communities" disabled={notYet} className="rounded-xl border border-border bg-card p-4 disabled:opacity-60">
        <legend className="sr-only">{t("Communities")}</legend>
        <div aria-hidden className="mb-3 flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">{t("Communities total")}: <span className="tabular-nums">{grand === null ? "—" : count(grand, lang)}</span></span>
        </div>
        <div className="flex flex-col gap-3">
          {list.map((c) => {
            const subs = shown(c.items);
            const name = c.archived ? `${c.name} · ${t("archived")}` : c.name;
            const own = figureOf(event, c.id) !== null;
            if (c.mode === "total" || subs.length === 0) {
              return <div key={c.id} className="max-w-[16rem]">{numberBox(c.id, name)}</div>;
            }
            const tot = totalOf(c);
            return (
              <div key={c.id} className="rounded-lg border border-border/70 p-3">
                <p className="mb-2 flex items-baseline justify-between gap-2 text-xs font-semibold">
                  <span className="truncate">{name}</span>
                  <span className="tabular-nums text-muted-foreground">{tot === null ? "—" : count(tot, lang)}</span>
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {subs.map((i) => numberBox(i.id, i.archived ? `${i.label} · ${t("archived")}` : i.label))}
                  {/* Filled as one number before the community was split: still editable here. */}
                  {own && numberBox(c.id, t("Total only"))}
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>
    );
  };
  const pct = (a: number | null, b: number | null) => (a === null || !b ? null : Math.floor((a * 100) / b + 1e-9));
  const live: Record<string, string | null> = {
    sales: n("salesTarget") !== null || n("sales") !== null ? vsTarget(n("sales"), n("salesTarget"), pct(n("sales"), n("salesTarget")), (x) => rupiah(x, lang)) : null,
    pax: n("paxTarget") !== null || n("pax") !== null ? vsTarget(n("pax"), n("paxTarget"), pct(n("pax"), n("paxTarget")), (x) => count(x, lang)) : null,
  };

  const control = (f: OutletFormField) => {
    const base = cn(
      "w-full rounded-lg border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-control-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60",
      invalid === f.key ? "border-destructive" : "border-border",
    );
    const id = `os-f-${f.key}`;
    const hint = f.hint ? `${id}-hint` : undefined;
    const common = { id, "aria-describedby": hint, "aria-invalid": invalid === f.key || undefined, disabled: notYet && !PLAN_KEYS.has(f.key) };
    switch (f.type) {
      case "longtext":
        return <textarea {...common} rows={2} maxLength={f.max} value={draft[f.key] ?? ""} onChange={(e) => set(f, e.target.value)} className={cn(base, "min-h-[4.5rem] resize-y py-2 leading-relaxed")} />;
      case "date":
        // The app's date picker, not the browser's "mm/dd/yyyy" box (12 Oct 2026).
        return (
          <DateField
            value={draft[f.key] || null}
            ariaLabel={pick(f.label, lang)}
            placeholder={t("Pick a date")}
            onChange={(v) => set(f, v ?? "")}
            className={cn(base, "h-10 hover:bg-background pointer-coarse:h-11")}
          />
        );
      case "money":
        return (
          <span className="relative block">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
            {/* Empty: only the "Rp" mark, no grey "0" that reads like a real zero (UI tour run 14, R14-WB-1 / WB-11). */}
            <input {...common} inputMode="numeric" autoComplete="off" value={draft[f.key] ?? ""} onChange={(e) => set(f, e.target.value)} className={cn(base, "h-10 pl-9 tabular-nums pointer-coarse:h-11")} />
          </span>
        );
      case "count":
        return <input {...common} inputMode="numeric" autoComplete="off" placeholder="—" value={draft[f.key] ?? ""} onChange={(e) => set(f, e.target.value)} className={cn(base, "h-10 text-right tabular-nums pointer-coarse:h-11")} />;
      default:
        return <input {...common} type="text" required={f.required} maxLength={f.max} value={draft[f.key] ?? ""} onChange={(e) => set(f, e.target.value)} className={cn(base, "h-10 pointer-coarse:h-11")} />;
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      {event && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
          <StatusPill status={event.status} />
          {event.updatedBy && <span>{t("Last changed by {name}", { name: event.updatedBy.name ?? "?" })}</span>}
        </div>
      )}
      {notYet && (
        <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {t("Reports open on the night itself.")} {t("You can plan this night now: its name, day and targets.")}
        </p>
      )}
      {data.form.sections.map((s) => {
        // RSVP and Hosting come from the outlet's own items; Communities follow Hosting.
        // Sentence-case totals as everywhere else (UI tour run 13; the server's form says "RSVP – TOTAL").
        if (s.key === "rsvp") return breakdown("rsvp", t("RSVP total"), config.rsvp);
        if (s.key === "hosting") return [breakdown("hosting", t("Hosting total"), config.hosting), communities()];
        const grid = s.fields.every((f) => f.type === "count") ? "grid gap-3 grid-cols-2 sm:grid-cols-4" : s.fields.every((f) => f.type === "money" || f.type === "count") ? "grid gap-3 sm:grid-cols-2" : "grid gap-3";
        return (
          <fieldset key={s.key} className="rounded-xl border border-border bg-card p-4">
            <legend className="sr-only">{pick(s.title, lang)}</legend>
            <div aria-hidden className="mb-3 flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">{pick(s.title, lang)}</span>
              {(s.key === "sales" || s.key === "pax") && live[s.key] && <span className="text-sm tabular-nums text-muted-foreground">{live[s.key]}</span>}
            </div>
            <div className={grid}>
              {s.fields.map((f) => (
                <div key={f.key} className="min-w-0">
                  <label htmlFor={`os-f-${f.key}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                    {pick(f.label, lang)}{f.required && <span aria-hidden className="text-destructive"> *</span>}
                  </label>
                  {control(f)}
                  {f.hint && <p id={`os-f-${f.key}-hint`} className="mt-1 text-xs text-muted-foreground">{pick(f.hint, lang)}</p>}
                </div>
              ))}
            </div>
          </fieldset>
        );
      })}

      {/* On a phone it floats just above the app's tab bar (MobileTabBar: fixed, ~5.5rem tall with its gap). */}
      <div className="sticky bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-10 flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 shadow-soft md:bottom-0">
        {event ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring dark:text-red-300 pointer-coarse:min-h-[44px]"
          >
            <Trash2 aria-hidden className="h-4 w-4" /> <span className="hidden sm:inline">{t("Delete event")}</span><span className="sr-only sm:hidden">{t("Delete event")}</span>
          </button>
        ) : <span />}
        <button
          type="submit"
          disabled={save.isPending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
        >
          {save.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
          {save.isPending ? t("Saving…") : event ? t("Save report") : t("Add event")}
        </button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete {name}?", { name: event?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("The event and its report leave the calendar, the board and the month's totals. Control Room → Audit can restore it.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("Delete event")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
