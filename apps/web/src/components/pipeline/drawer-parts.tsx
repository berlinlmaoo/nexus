import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A titled group of the deal drawer, with the division that owns it on the right. */
export function Section({ title, owner, children }: { title: string; owner: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{owner}</span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  // The control inside carries its own aria-label; this label is what a sighted reader scans for.
  return (
    <div className={cn("min-w-0 space-y-1", wide && "sm:col-span-2")}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
