import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";

/**
 * Shared chrome for the spreadsheet's right-hand sidebars (data validation, conditional formatting,
 * alternating colours, named/protected ranges, charts, pivots, slicers, column stats, theme, version
 * history) and its dialogs, so every one of them reads the same: title row with a close button, a
 * scrolling body, and the action buttons at the bottom (secondary left, primary right — Sheets' order).
 */
export function SidePanel({ title, onClose, children, footer, className, label }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Accessible name when `title` is not plain text. */
  label?: string;
}) {
  const { t } = useLang();
  return (
    <aside
      data-sheet-panel=""
      aria-label={label ?? (typeof title === "string" ? title : undefined)}
      className={cn("flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card max-md:fixed max-md:inset-x-2 max-md:bottom-2 max-md:top-24 max-md:z-[55] max-md:w-auto max-md:shadow-pop", className)}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        <button onClick={onClose} aria-label={t("Close")} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <footer className="flex items-center gap-2 border-t border-border p-2">{footer}</footer>}
    </aside>
  );
}

/** Small field label used inside panels and dialogs. */
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block text-[11px] font-semibold text-muted-foreground">{children}</label>;
}

export const inputClass = "h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50";
export const selectClass = "h-8 w-full rounded-md border border-border bg-background px-1.5 text-xs outline-none focus:border-ring";
export const primaryBtn = "rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40";
export const secondaryBtn = "rounded-lg px-3 py-1.5 text-xs font-semibold text-foreground/80 transition hover:bg-muted disabled:opacity-40";
export const dangerBtn = "rounded-lg px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-40";

/**
 * A centred modal dialog (Sort range, Remove duplicates, Find and replace, custom formats, keyboard
 * shortcuts, spreadsheet settings…). Escape and the backdrop close it; focus moves into it on open.
 */
export function SheetDialog({ title, onClose, children, footer, width = 440, label }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  label?: string;
}) {
  const { t } = useLang();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A picker open inside the dialog (SelectPicker's popover) closes first, not the whole dialog.
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    const first = ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[70] grid grid-cols-1 place-items-center bg-black/30 dark:bg-scrim p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        onKeyDown={(e) => e.stopPropagation()}
        style={{ width, maxWidth: "100%" }}
        className="flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-pop"
      >
        <header className="flex items-center gap-2 px-5 pb-2 pt-4">
          <h2 className="min-w-0 flex-1 text-base font-semibold">{title}</h2>
          <button data-close onClick={onClose} aria-label={t("Close")} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 text-sm">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 px-5 pb-4 pt-1">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
