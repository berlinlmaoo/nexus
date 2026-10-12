import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * The one empty state on the web, mirroring the iOS `EmptyState`.
 *
 * An empty screen has to answer three things or it reads as broken: WHY there is nothing here
 * (what this place is for and where its content comes from), WHAT to do next, and a way to do it
 * right there. `action` takes any node — usually a button that opens the same composer the page
 * header does — so the empty state never invents a second way of creating things.
 */
export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
  tone = "primary",
  compact = false,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  message?: string;
  action?: ReactNode;
  tone?: "primary" | "success" | "muted";
  compact?: boolean;
  className?: string;
}) {
  // Calm, Notion-like (owner, 12 Oct 2026): no dashed box and no stacked, blurred icon tiles. One quiet
  // glyph in a soft circle, a plain title, the reason, the next step. It sits on whatever surface is
  // around it (the page, or a card), so a card holding an empty state no longer draws a box in a box.
  const fg = tone === "success" ? "text-emerald-600 dark:text-success" : "text-muted-foreground";
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "px-4 py-6" : "px-6 py-12 md:py-16", className)}>
      <div className={cn("mb-3 grid place-items-center rounded-full bg-muted", compact ? "h-9 w-9" : "h-11 w-11", fg)} aria-hidden>
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </div>
      <div className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>{title}</div>
      {message && <p className={cn("mx-auto mt-1 max-w-md text-muted-foreground text-pretty", compact ? "text-xs" : "text-sm")}>{message}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * The button most empty states carry: same look as the page's primary action. Its colour is the
 * `--action` token where a screen sets one (the Calendar: its navy, see styles.css), else the app's
 * primary. `to` moves within the app through the router, without reloading it. At least 44px tall on a
 * touch screen.
 */
export function EmptyAction({ onClick, children, to }: { onClick?: () => void; children: ReactNode; to?: string }) {
  // Same shape as the page header's primary button (rounded-md, px-3 py-1.5), so an empty state never
  // carries a second, bigger version of the action that already sits in the header.
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium shadow-soft transition-all duration-150 active:scale-[0.98] pointer-coarse:min-h-[44px]",
    "bg-[color:var(--action,var(--primary))] text-[color:var(--action-foreground,var(--primary-foreground))] hover:bg-[color:var(--action,var(--primary))]/90",
  );
  if (to) return <Link to={to} className={cls}>{children}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{children}</button>;
}
