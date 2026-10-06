import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FOCUS_PILL, TOUCH_ROW } from "./bits";

export type SegmentedOption<T extends string> = { value: T; label: string; icon?: ReactNode };

/**
 * The Calendar's one-of-n switch (Month / People, Everyone / Mine / My division, By division / By person),
 * the one build for all of them so focus, sizing and touch are fixed in one place. A radio group, as the
 * APG radio pattern has it: Tab reaches the chosen option, the arrow keys and Home / End move the choice.
 * Content-sized by default; given `w-full` it fills the row in equal columns. On a touch screen every
 * option is at least 44px tall (a finger, not the text size, sets it); a larger text size still grows it,
 * and a label wraps rather than being cut off.
 */
export function Segmented<T extends string>({ value, options, onChange, label, size = "sm", className, disabled = false }: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
  /** The group's accessible name ("View", "Show", "Group by"). */
  label: string
  size?: "sm" | "md"
  className?: string
  disabled?: boolean
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = options.findIndex((o) => o.value === value);
  const tabStop = chosen >= 0 ? chosen : 0;
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = options.length;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n
      : e.key === "Home" ? 0
      : e.key === "End" ? n - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    if (options[next].value !== value) onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        "inline-grid max-w-full grid-flow-col auto-cols-auto gap-0.5 rounded-lg border border-border bg-background p-0.5 [&.w-full]:auto-cols-fr",
        className,
      )}
    >
      {options.map((o, i) => {
        const on = i === chosen;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => { if (!on) onChange(o.value); }}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md text-center text-xs font-semibold leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              size === "md" ? "min-h-8 px-3 py-1.5" : "min-h-7 px-2.5 py-1",
              TOUCH_ROW,
              FOCUS_PILL,
              on ? "bg-cal-accent text-cal-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
