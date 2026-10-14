import { useCallback, useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode, type WheelEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";

/**
 * The page layout primitives every list page shares (UI sweep, 12 Oct 2026).
 *
 * The owner's complaint was always the same shape: a page whose header runs the full width while its
 * content sits in a 640–900px column on the left (or centred), leaving half the screen dead, and every
 * page drawing its own tab bar. These three pieces make "the same as Projects / My Tasks" the default:
 *
 * - `PageBody`: the content area under `PageHeader`. Full width, the header's own gutters
 *   (px-4 / md:px-8), so the content's left and right edges line up with the title and the actions.
 * - `PageTabs`: page-level tabs (a status queue, a view, a section) as a light underline row. Meant
 *   for `PageHeader`'s `tabs` slot, where the underline sits on the header's bottom border.
 * - `Segmented`: a small light toggle for switching how ONE block shows (board / log, 1 / 2 columns).
 *   The selected option is a raised white chip on a muted track, never a black pill.
 */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-4 md:p-8", className)}>{children}</div>;
}

export type PageTab<K extends string> = {
  key: K;
  label: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** Shown after the label. `undefined` hides it; 0 is shown (a queue with nothing in it is information). */
  count?: number;
  /** Tints the count (something is waiting there). */
  attention?: boolean;
};

export function PageTabs<K extends string>({ tabs, value, onChange, label, className }: {
  tabs: PageTab<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t: tr } = useLang();
  // The row scrolls on its own when the tabs don't fit (Control Room has 11 sections: at 1440 "GIDEON" was
  // cut to "GI…" and "App" sat off-screen with nothing saying there was more; on a phone/iPad the row could
  // not be swiped). A fade + an arrow on the side that has more, a wheel that scrolls sideways, and the
  // selected tab is brought into view (QA 13 Oct 2026).
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, tabs.length]);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);
  const nudge = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(160, (ref.current?.clientWidth ?? 0) * 0.6), behavior: "smooth" });
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    el.scrollLeft += e.deltaY;
  };
  // Arrow keys move between tabs, as a tablist should (one Tab stop for the whole row).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === value);
    const n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[n].key);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${tabs[n].key}"]`)?.focus());
  };
  // The arrow shows on touch screens too (UI tour run 11, WM-5): the fade alone read as a cut-off "Compani".
  const arrow = "absolute top-0 bottom-[2px] z-10 flex w-10 items-center text-muted-foreground transition hover:text-foreground";
  return (
    <div className={cn("relative min-w-0", className)}>
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKey} onScroll={measure} onWheel={onWheel} className="flex items-end gap-5 overflow-x-auto overscroll-x-contain whitespace-nowrap [scrollbar-width:none] [touch-action:pan-x_pan-y] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const on = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            data-tab={t.key}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 pt-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-t-sm pointer-coarse:min-h-11",
              on ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {t.label}
            {t.count !== undefined && (
              <span className={cn(
                "min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-medium leading-[1.125rem] tabular-nums",
                t.attention && t.count > 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "bg-muted text-muted-foreground",
              )}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
      {edge.left && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-14 bg-gradient-to-r from-background from-40% to-transparent" />
          <button type="button" tabIndex={-1} aria-label={tr("Show earlier tabs")} onClick={() => nudge(-1)} className={cn(arrow, "left-0 justify-start")}><ChevronLeft className="h-4 w-4" /></button>
        </>
      )}
      {edge.right && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-background from-40% to-transparent" />
          <button type="button" tabIndex={-1} aria-label={tr("Show more tabs")} onClick={() => nudge(1)} className={cn(arrow, "right-0 justify-end")}><ChevronRight className="h-4 w-4" /></button>
        </>
      )}
    </div>
  );
}

export function Segmented<K extends string>({ options, value, onChange, label, size = "sm", className }: {
  options: { key: K; label: ReactNode; icon?: ComponentType<{ className?: string }> }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}>
      {options.map((o) => {
        const on = o.key === value;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "xs" ? "px-2.5 py-1 text-xs" : "px-3 py-1 text-sm",
              on ? "bg-background text-foreground shadow-sm dark:bg-accent" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
