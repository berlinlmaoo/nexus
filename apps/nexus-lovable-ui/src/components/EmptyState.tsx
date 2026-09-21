import type { ComponentType, ReactNode } from "react";
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

/** The button most empty states carry: same look as the page's primary action. */
export function EmptyAction({ onClick, children, to }: { onClick?: () => void; children: ReactNode; to?: string }) {
  const cls = "inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.98]";
  if (to) return <a href={to} className={cls}>{children}</a>;
  return <button type="button" onClick={onClick} className={cls}>{children}</button>;
}
