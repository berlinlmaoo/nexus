import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";

/**
 * The Pipeline Dashboard's edit-in-place controls (owner, 9 Oct 2026). Each one keeps its own draft while
 * it has focus and saves once — on blur, Enter or a pick — like the GM's board did. While it does not have
 * focus it shows the latest value from the server, so a colleague's edit arriving live never overwrites
 * what someone is typing, and never leaves a stale value on screen either.
 */

export const FIELD =
  "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-control-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-[44px]";
/** Inside a table cell: no frame until hovered or focused. */
export const CELL =
  "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-foreground outline-none transition-colors hover:border-border focus-visible:border-primary focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed";

function useDraft<T>(value: T) {
  const [draft, setDraft] = useState<T>(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return { draft, setDraft, focused };
}

export function TextField({
  value, onCommit, placeholder, label, multiline = false, disabled, className, maxLength = 500, required = false,
}: {
  value: string; onCommit: (v: string) => void; placeholder?: string; label: string; multiline?: boolean;
  disabled?: boolean; className?: string; maxLength?: number; required?: boolean;
}) {
  const { draft, setDraft, focused } = useDraft(value);
  const commit = () => {
    focused.current = false;
    const v = draft.trim();
    if (required && !v) { setDraft(value); return; }
    if (v !== value) onCommit(v);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") { setDraft(value); focused.current = false; (e.target as HTMLElement).blur(); }
    if (e.key === "Enter" && !multiline) (e.target as HTMLElement).blur();
  };
  const common = {
    value: draft,
    "aria-label": label,
    placeholder,
    disabled,
    maxLength,
    onFocus: () => { focused.current = true; },
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: onKey,
  };
  return multiline
    ? <textarea {...common} rows={3} className={cn(FIELD, "min-h-20 resize-y leading-relaxed", className)} />
    : <input {...common} type="text" className={cn(FIELD, className)} />;
}

/** Rupiah, typed as digits; shown with thousands separators when not being edited. */
export function MoneyField({
  value, onCommit, label, allowNegative = false, disabled, className, cell = false,
}: {
  value: number; onCommit: (v: number) => void; label: string; allowNegative?: boolean; disabled?: boolean; className?: string; cell?: boolean;
}) {
  const { locale } = useLang();
  // Nothing typed yet reads as empty, not as a bold "0" on every row (owner, 9 Oct 2026); "0" stays the
  // placeholder, and a saved zero is still a zero.
  const show = (n: number) => (n ? new Intl.NumberFormat(locale).format(n) : "");
  const [draft, setDraft] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, locale]);
  const commit = () => {
    focused.current = false;
    const neg = allowNegative && /^\s*-/.test(draft);
    const digits = draft.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) * (neg ? -1 : 1) : 0;
    setDraft(show(n));
    if (n !== value) onCommit(n);
  };
  return (
    <div className={cn("relative", className)}>
      {/* In a table cell the "Rp" shows only next to an amount, so an empty column stays quiet. */}
      {(!cell || draft !== "") && (
        <span aria-hidden className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs text-muted-foreground", cell ? "left-1.5" : "left-2.5")}>Rp</span>
      )}
      <input
        type="text"
        inputMode={allowNegative ? "text" : "numeric"}
        aria-label={label}
        value={draft}
        placeholder={cell ? undefined : "0"}
        disabled={disabled}
        onFocus={(e) => { focused.current = true; setDraft(value ? String(value) : ""); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLElement).blur();
          if (e.key === "Escape") { focused.current = false; setDraft(show(value)); (e.target as HTMLElement).blur(); }
        }}
        className={cn(cell ? CELL : FIELD, "text-right tabular-nums", cell ? "pl-7" : "pl-8")}
      />
    </div>
  );
}

export function NumberField({
  value, onCommit, label, min = 0, max = 3650, disabled, className,
}: { value: number; onCommit: (v: number) => void; label: string; min?: number; max?: number; disabled?: boolean; className?: string }) {
  const { draft, setDraft, focused } = useDraft(String(value ?? 0));
  const commit = () => {
    focused.current = false;
    const n = Math.min(max, Math.max(min, Math.round(Number(draft) || 0)));
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLElement).blur(); }}
      className={cn(FIELD, "tabular-nums", className)}
    />
  );
}

/** A plain <select>: native on every phone, and a keyboard user already knows it. Saves on pick. */
export function SelectField<T extends string | number>({
  value, options, onCommit, label, labelOf, disabled, className, cell = false,
}: {
  value: T; options: readonly T[]; onCommit: (v: T) => void; label: string; labelOf?: (v: T) => string;
  disabled?: boolean; className?: string; cell?: boolean;
}) {
  // A value the list does not know (a newer option, an import) still shows, as itself.
  const all = options.includes(value) ? options : [value, ...options];
  const select = (
    <select
      aria-label={label}
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        const picked = all.find((o) => String(o) === raw);
        if (picked !== undefined && picked !== value) onCommit(picked);
      }}
      className={cn(cell ? CELL : FIELD, "cursor-pointer", cell ? "appearance-none pr-6" : "pr-7", className)}
    >
      {all.map((o) => (
        <option key={String(o)} value={String(o)}>{labelOf ? labelOf(o) : String(o)}</option>
      ))}
    </select>
  );
  if (!cell) return select;
  // A table cell reads as text; its arrow shows on hover or focus, not on all 40 rows at once.
  return (
    <div className="group/cell relative">
      {select}
      {!disabled && (
        <ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/cell:opacity-100 group-focus-within/cell:opacity-100" />
      )}
    </div>
  );
}

export function DateField({
  value, onCommit, label, disabled, className, cell = false,
}: { value: string | null; onCommit: (v: string | null) => void; label: string; disabled?: boolean; className?: string; cell?: boolean }) {
  const { draft, setDraft, focused } = useDraft(value ?? "");
  return (
    <input
      type="date"
      aria-label={label}
      value={draft}
      disabled={disabled}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        const v = draft || null;
        if (v !== (value ?? null)) onCommit(v);
      }}
      className={cn(cell ? CELL : FIELD, "tabular-nums", className)}
    />
  );
}

export type PersonOption = { id: string; name: string; avatar: string | null };

const OTHER = "__other__";
const NOBODY = "";

/**
 * BD / PM: one of the project's members (owner, 9 Oct 2026: the board's people are its members — add
 * someone to the project first), or — only when the person is not in NEXUS — a
 * name typed by hand ("Someone outside NEXUS…"). Picking a user clears the typed name and vice versa.
 */
export function PersonField({
  userId, name, people, onCommit, label, disabled, userName,
}: {
  userId: string | null; name: string | null; people: PersonOption[]; label: string; disabled?: boolean;
  /** The picked user's name, for someone who is no longer (or never was) a project member. */
  userName?: string | null;
  onCommit: (v: { userId: string | null; name: string | null }) => void;
}) {
  const { t } = useLang();
  const id = useId();
  const [typing, setTyping] = useState(!userId && !!name);
  useEffect(() => { setTyping(!userId && !!name); }, [userId, name]);
  const known = userId && !people.some((p) => p.id === userId)
    ? [{ id: userId, name: userName ? `${userName} ${t("(not a project member)")}` : t("(not a project member)"), avatar: null }]
    : [];
  const value = typing ? OTHER : userId ?? NOBODY;
  return (
    <div className="space-y-1.5">
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) { setTyping(true); return; }
          setTyping(false);
          onCommit({ userId: v || null, name: null });
        }}
        className={cn(FIELD, "cursor-pointer")}
      >
        <option value={NOBODY}>{t("Not assigned")}</option>
        {[...known, ...people].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value={OTHER}>{t("Someone outside NEXUS…")}</option>
      </select>
      {typing && (
        <TextField
          label={t("{label} name", { label })}
          value={name ?? ""}
          placeholder={t("Their name")}
          maxLength={120}
          disabled={disabled}
          onCommit={(v) => onCommit({ userId: null, name: v || null })}
        />
      )}
    </div>
  );
}
