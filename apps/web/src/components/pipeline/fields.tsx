import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { SelectPicker } from "@/components/SelectPicker";
import { DateField as AppDateField } from "@/components/DateField";
import { groupIdrDigits, normalizeNumberFieldValue } from "@/lib/custom-field-number";

/**
 * The Pipeline Dashboard's edit-in-place controls (owner, 9 Oct 2026). Each one keeps its own draft while
 * it has focus and saves once — on blur, Enter or a pick — like the GM's board did. While it does not have
 * focus it shows the latest value from the server, so a colleague's edit arriving live never overwrites
 * what someone is typing, and never leaves a stale value on screen either.
 */

export const FIELD =
  "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-control-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-[44px]";
/** Inside a table cell: no frame until hovered or focused. */
export const CELL =
  "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-foreground outline-none transition-colors hover:border-border focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed";

function useDraft<T>(value: T) {
  const [draft, setDraft] = useState<T>(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return { draft, setDraft, focused };
}

export function TextField({
  value, onCommit, placeholder, label, multiline = false, autoGrow = false, disabled, className, maxLength = 500, required = false,
}: {
  value: string; onCommit: (v: string) => void; placeholder?: string; label: string; multiline?: boolean;
  /** One line of text that wraps instead of scrolling sideways (a long deal name on a phone); Enter saves. */
  autoGrow?: boolean;
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
    if (e.key === "Enter" && !multiline) { e.preventDefault(); (e.target as HTMLElement).blur(); }
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
  if (autoGrow) {
    return <textarea {...common} rows={1} onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))} className={cn(FIELD, "resize-none overflow-hidden [field-sizing:content]", className)} />;
  }
  return multiline
    ? <textarea {...common} rows={3} className={cn(FIELD, "min-h-20 resize-y leading-relaxed", className)} />
    : <input {...common} type="text" className={cn(FIELD, className)} />;
}

/**
 * Rupiah (pipeline UI pass, 12 Oct 2026): grouped the Indonesian way while typing and at rest —
 * "Rp 15.096.000" in both languages, the "Rp" right next to the amount (it used to sit at the far left of
 * the box with the number at the far right, and English showed "15,096,000"). Typed separators are
 * swallowed; a paste ("Rp 1.500.000,00", "17jt") is read whole, like the app's RupiahInput. Saves on blur
 * or Enter; Esc puts the saved value back.
 */
export function MoneyField({
  value, onCommit, label, allowNegative = false, disabled, className, cell = false,
}: {
  value: number; onCommit: (v: number) => void; label: string; allowNegative?: boolean; disabled?: boolean; className?: string; cell?: boolean;
}) {
  // The draft is plain digits (with a leading "-" for a negative amount); nothing typed reads as empty,
  // not as a bold "0" on every row (owner, 9 Oct 2026). A saved zero is still a zero.
  const raw = (n: number) => (n ? String(Math.round(n)) : "");
  const [draft, setDraft] = useState(raw(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(raw(value));
  }, [value]);
  const clean = (text: string) => {
    const neg = allowNegative && text.includes("-");
    const digits = text.replace(/\D+/g, "").replace(/^0+(?=\d)/, "");
    return digits ? `${neg ? "-" : ""}${digits}` : neg ? "-" : "";
  };
  const commit = () => {
    focused.current = false;
    const digits = draft.replace(/\D+/g, "");
    const n = digits ? Number(digits) * (draft.startsWith("-") ? -1 : 1) : 0;
    setDraft(raw(n));
    if (n !== value) onCommit(n);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.trim()) return;
    e.preventDefault();
    const n = normalizeNumberFieldValue(text, "currency-idr");
    setDraft(clean(allowNegative ? n : n.replace("-", "")));
  };
  const grouped = draft === "-" ? "-" : groupIdrDigits(draft);
  return (
    <div className={cn("relative", className)}>
      <input
        type="text"
        inputMode={allowNegative ? "text" : "numeric"}
        autoComplete="off"
        aria-label={label}
        // In a table cell the "Rp" shows only next to an amount, so an empty column stays quiet.
        value={grouped ? `Rp ${grouped}` : ""}
        placeholder={cell ? undefined : "Rp 0"}
        disabled={disabled}
        onFocus={(e) => { focused.current = true; requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setDraft(clean(e.target.value))}
        onPaste={onPaste}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLElement).blur();
          if (e.key === "Escape") { focused.current = false; setDraft(raw(value)); (e.target as HTMLElement).blur(); }
        }}
        className={cn(cell ? CELL : FIELD, "tabular-nums", cell && "text-right")}
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

/**
 * A single-choice field: the app's picker (owner audit, 12 Oct 2026 — no browser-native lists). Touch rows
 * are 44 px, arrow keys / Enter / type-ahead work, and the cell variant reads as text with its chevron on
 * hover. Saves on pick.
 */
export function SelectField<T extends string | number>({
  value, options, onCommit, label, labelOf, disabled, className, cell = false,
}: {
  value: T; options: readonly T[]; onCommit: (v: T) => void; label: string; labelOf?: (v: T) => string;
  disabled?: boolean; className?: string; cell?: boolean;
}) {
  // A value the list does not know (a newer option, an import) still shows, as itself.
  const all = options.includes(value) ? options : [value, ...options];
  return (
    <SelectPicker
      variant={cell ? "ghost" : "field"}
      ariaLabel={label}
      value={String(value)}
      disabled={disabled}
      onChange={(raw) => {
        const picked = all.find((o) => String(o) === raw);
        if (picked !== undefined && picked !== value) onCommit(picked);
      }}
      options={all.map((o) => ({ value: String(o), label: labelOf ? labelOf(o) : String(o) }))}
      className={cn("w-full", cell ? "rounded-md px-1.5" : "rounded-lg px-2.5 py-1.5", className)}
    />
  );
}

/**
 * A date: the app's DateField (calendar popover with Today / Clear, "14 Oct 2026" in the interface
 * language) instead of the browser's "mm/dd/yyyy" box (pipeline UI pass, 12 Oct 2026). Saves on pick.
 * The field variant keeps the bordered box of the drawer's other fields.
 */
export function DateField({
  value, onCommit, label, disabled, className, cell = false,
}: { value: string | null; onCommit: (v: string | null) => void; label: string; disabled?: boolean; className?: string; cell?: boolean }) {
  const { t } = useLang();
  return (
    <AppDateField
      value={value}
      ariaLabel={label}
      disabled={disabled}
      placeholder={cell ? "" : t("Pick a date")}
      onChange={(v) => { if ((v ?? null) !== (value ?? null)) onCommit(v); }}
      className={cn(
        cell
          ? "min-h-0 rounded-md border border-transparent px-1.5 py-1 hover:border-border hover:bg-transparent"
          : "min-h-[34px] rounded-lg border border-border bg-background px-2.5 py-1.5 hover:border-control-border hover:bg-background disabled:opacity-60 pointer-coarse:min-h-[44px]",
        className,
      )}
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
      <SelectPicker
        id={id}
        variant="field"
        ariaLabel={label}
        value={value}
        disabled={disabled}
        onChange={(v) => {
          if (v === OTHER) { setTyping(true); return; }
          setTyping(false);
          onCommit({ userId: v || null, name: null });
        }}
        options={[
          { value: NOBODY, label: t("Not assigned") },
          ...[...known, ...people].map((p) => ({ value: p.id, label: p.name })),
          { value: OTHER, label: t("Someone outside NEXUS…") },
        ]}
        className="w-full rounded-lg px-2.5 py-1.5"
      />
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
