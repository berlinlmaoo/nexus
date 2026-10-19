import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { COLOR_PRESETS, normalizeColor } from "@/lib/project-views";

export type PickerOption = {
  value: string;
  label: string;
  /** A palette key (COLOR_PRESETS) — the option then draws as a tinted chip. */
  color?: string | null;
  icon?: ReactNode;
  /** A muted second line / trailing hint in the list. */
  hint?: string;
  disabled?: boolean;
  /** Group heading this option sits under (consecutive options with the same group share one heading). */
  group?: string;
};

/** A palette chip: tinted background, coloured dot, the label. */
export function OptionChip({ label, color, className }: { label: string; color: string; className?: string }) {
  const c = COLOR_PRESETS[normalizeColor(color) ?? "gray"];
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2 text-xs font-medium leading-5", className)} style={{ backgroundColor: c.bg, color: c.text }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.dot }} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * The app's single-choice picker (owner audit, 12 Oct 2026: the browser's own <select> list looked
 * foreign next to the Notion-style status/date pickers). A trigger that reads as text (or a field / a
 * pill), a list in a popover with a check on the chosen item, a search box once there are more than 8
 * options, and the usual keys: ↑/↓, Home/End, Enter, Esc, and type-ahead. Values and onChange behave
 * like the <select> it replaces: `onChange` gets the option's value string ("" for the clear row).
 */
export function SelectPicker({
  value,
  onChange,
  options,
  clearable,
  placeholder,
  ariaLabel,
  disabled,
  variant = "ghost",
  size = "md",
  className,
  contentClassName,
  align = "start",
  searchable,
  searchPlaceholder,
  renderValue,
  id,
  wrapLabels = false,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: PickerOption[];
  /** Adds a first row that sets "" — `true` labels it "Not set", a string labels it with that text. */
  clearable?: boolean | string;
  /** Trigger text when nothing (or an unknown value) is chosen. */
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** ghost = plain text, chevron on hover (table cells, toolbars); field = bordered like an input (forms); pill = rounded-full bordered. */
  variant?: "ghost" | "field" | "pill";
  size?: "sm" | "md";
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  /** Defaults to on when there are more than 8 options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Custom trigger content for the chosen option. */
  renderValue?: (option: PickerOption | null) => ReactNode;
  id?: string;
  /** Option labels wrap to two lines instead of one cut-off line (long project names that differ only at the end). */
  wrapLabels?: boolean;
}) {
  const { t } = useLang();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ buf: "", at: 0 });

  const clearLabel = clearable ? (typeof clearable === "string" ? clearable : t("Not set")) : null;
  const all = useMemo<PickerOption[]>(() => (clearLabel != null && !options.some((o) => o.value === "") ? [{ value: "", label: clearLabel }, ...options] : options), [options, clearLabel]);
  const canSearch = searchable ?? options.length > 8;
  const query = q.trim().toLowerCase();
  const shown = useMemo(() => (query ? all.filter((o) => o.label.toLowerCase().includes(query) || (o.hint ?? "").toLowerCase().includes(query)) : all), [all, query]);
  const current = all.find((o) => o.value === (value ?? "")) ?? null;
  const isEmpty = !current || (current.value === "" && clearLabel != null);

  // Opening puts the cursor on the chosen option (or the first one).
  useEffect(() => {
    if (!open) return;
    const i = all.findIndex((o) => o.value === (value ?? ""));
    setActive(i >= 0 ? i : 0);
    // Focus after Radix mounts the content.
    requestAnimationFrame(() => (canSearch ? searchRef.current : listRef.current)?.focus({ preventScroll: true }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (o: PickerOption | undefined) => {
    if (!o || o.disabled) return;
    setOpen(false);
    if (o.value !== (value ?? "")) onChange(o.value);
  };
  const step = (from: number, dir: 1 | -1) => {
    if (!shown.length) return from;
    let i = from;
    for (let n = 0; n < shown.length; n++) {
      i = (i + dir + shown.length) % shown.length;
      if (!shown[i].disabled) return i;
    }
    return from;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => step(i, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => step(i, -1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(step(-1, 1)); }
    else if (e.key === "End") { e.preventDefault(); setActive(step(0, -1)); }
    else if (e.key === "Enter" || (e.key === " " && !canSearch)) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === "Tab") { setOpen(false); }
    else if (!canSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Type-ahead: letters typed within 600 ms jump to the next option that starts with them.
      const now = Date.now();
      const ta = typeahead.current;
      ta.buf = now - ta.at > 600 ? e.key.toLowerCase() : ta.buf + e.key.toLowerCase();
      ta.at = now;
      const start = ta.buf.length === 1 ? active + 1 : active;
      for (let n = 0; n < shown.length; n++) {
        const i = (start + n) % shown.length;
        if (!shown[i].disabled && shown[i].label.toLowerCase().startsWith(ta.buf)) { setActive(i); break; }
      }
    }
  };

  const triggerCls = {
    ghost: "rounded-md border border-transparent px-1.5 hover:bg-muted data-[state=open]:bg-muted",
    field: "rounded-lg border border-border bg-background px-2.5 hover:border-primary/40 data-[state=open]:border-primary",
    pill: "rounded-full border border-border bg-card px-3 hover:bg-muted data-[state=open]:bg-muted",
  }[variant];
  const chosen = renderValue ? renderValue(isEmpty ? null : current) : isEmpty ? (
    <span className="truncate text-muted-foreground/80">{placeholder ?? clearLabel ?? ""}</span>
  ) : current!.color ? (
    <OptionChip label={current!.label} color={current!.color} />
  ) : (
    <span className="flex min-w-0 items-center gap-1.5">{current!.icon}<span className="truncate">{current!.label}</span></span>
  );
  const activeId = shown[active] ? `${listId}-o${active}` : undefined;

  return (
    <Popover open={open} onOpenChange={(v) => { if (!disabled) { setOpen(v); if (!v) setQ(""); } }}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel ? (isEmpty ? ariaLabel : `${ariaLabel}: ${current!.label}`) : undefined}
          onKeyDown={(e) => { if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) { e.preventDefault(); setOpen(true); } }}
          className={cn(
            "group/sp inline-flex min-w-0 max-w-full items-center gap-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60",
            // Touch: a full-size trigger gets a 44px target; compact (sm) ones sit in dense toolbars and stay small.
            size === "sm" ? "h-7 text-xs" : "min-h-8 py-1 text-sm pointer-coarse:min-h-[44px]",
            triggerCls,
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 items-center">{chosen}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-opacity",
              variant === "ghost" && "opacity-0 group-hover/sp:opacity-100 group-focus-visible/sp:opacity-100 group-data-[state=open]/sp:opacity-100 pointer-coarse:opacity-100",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={16}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{ minWidth: "max(var(--radix-popover-trigger-width), 11rem)" }}
        // z above the app's custom modals (z-[70]…z-[110]) so the list never opens behind one.
        className={cn("z-[150] flex w-auto max-w-[min(22rem,calc(100vw-32px))] flex-col overflow-hidden p-0", "max-h-[min(22rem,var(--radix-popover-content-available-height))]", contentClassName)}
      >
        {canSearch && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label={searchPlaceholder ?? t("Search…")}
              placeholder={searchPlaceholder ?? t("Search…")}
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground pointer-coarse:h-11"
            />
          </div>
        )}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={canSearch ? -1 : 0}
          aria-activedescendant={canSearch ? undefined : activeId}
          onKeyDown={canSearch ? undefined : onKey}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 outline-none"
        >
          {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("No matches")}</p>}
          {shown.map((o, i) => {
            const selected = o.value === (value ?? "");
            const heading = o.group && o.group !== shown[i - 1]?.group ? o.group : null;
            return (
              <div key={`${o.value}-${i}`}>
                {heading && <div className="px-2 pb-0.5 pt-2 text-[11px] font-medium text-muted-foreground first:pt-1">{heading}</div>}
                <div
                  id={`${listId}-o${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled || undefined}
                  onMouseMove={() => { if (active !== i && !o.disabled) setActive(i); }}
                  onClick={() => pick(o)}
                  className={cn(
                    "flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm pointer-coarse:min-h-[44px]",
                    i === active && "bg-muted",
                    o.disabled && "cursor-default opacity-50",
                  )}
                >
                  {o.value === "" && clearLabel != null ? (
                    <span className="truncate text-muted-foreground">{o.label}</span>
                  ) : o.color ? (
                    <OptionChip label={o.label} color={o.color} />
                  ) : (
                    <span className="flex min-w-0 items-center gap-2">{o.icon}<span className={wrapLabels ? "line-clamp-2 break-words" : "truncate"} title={wrapLabels ? o.label : undefined}>{o.label}</span></span>
                  )}
                  {o.hint && <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{o.hint}</span>}
                  <Check className={cn("h-3.5 w-3.5 shrink-0", !o.hint && "ml-auto", selected ? "opacity-100" : "opacity-0")} aria-hidden />
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
