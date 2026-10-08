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
  const tint = tone === "success" ? "text-emerald-600 bg-emerald-500" : tone === "muted" ? "text-muted-foreground bg-muted-foreground" : "text-primary bg-primary";
  const [fg, bg] = tint.split(" ");
  return (
    <div className={cn("rounded-2xl border border-dashed border-border bg-card/60 text-center", compact ? "px-6 py-8" : "px-6 py-14", className)}>
      <div className="relative mx-auto mb-4 h-20 w-20" aria-hidden>
        <div className={cn("absolute inset-0 rounded-2xl opacity-[.08] -rotate-[9deg] -translate-x-3 translate-y-1", bg)} />
        <div className={cn("absolute inset-0 rounded-2xl opacity-[.13] rotate-[7deg] translate-x-2.5 translate-y-0.5", bg)} />
        <div className={cn("absolute inset-0 rounded-2xl opacity-[.18]", bg)} />
        <div className={cn("absolute inset-0 grid place-items-center", fg)}><Icon className="h-8 w-8" /></div>
      </div>
      <div className={cn("font-black", compact ? "text-base" : "text-lg")}>{title}</div>
      {message && <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{message}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
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
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold shadow-soft transition-all active:scale-[0.98] pointer-coarse:min-h-[44px]",
    "bg-[color:var(--action,var(--primary))] text-[color:var(--action-foreground,var(--primary-foreground))] hover:bg-[color:var(--action,var(--primary))]/90",
  );
  if (to) return <Link to={to} className={cls}>{children}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{children}</button>;
}
