import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  tabs,
  className,
  compact,
}: {
  title: string;
  subtitle?: string;
  /** Only for an identity mark (a project or folder icon). Pages get no decorative glyph: one header style
   *  everywhere (audit 12 Oct 2026). */
  icon?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  /** Overrides the surface (the project page sits on a white canvas, owner 12 Oct 2026). */
  className?: string;
  /** Phone: title and actions share one row (actions must be icon-sized there) and the subtitle is hidden,
   *  so the header stays within ~15% of the screen (project page, audit 12 Oct 2026). Desktop unchanged. */
  compact?: boolean;
}) {
  return (
    // Sticky from md up only: on a phone a sticky header took a fifth of the screen (audit 12 Oct 2026).
    <div className={cn("border-b border-border bg-background/80 backdrop-blur md:sticky md:top-0 md:z-40", className)}>
      <div className={cn("px-4 md:px-8 md:pt-6 flex sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:pt-4 sm:pb-3", compact ? "flex-row items-center justify-between gap-2 pt-3 pb-1" : "flex-col gap-3 pt-4 pb-3")}>
        <div className="flex items-start gap-3 min-w-0">
          {icon && <div className="hidden sm:block text-2xl mt-0.5 shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight truncate">{title}</h1>
            {subtitle && <p className={cn("text-sm text-muted-foreground mt-0.5 line-clamp-1 sm:line-clamp-2", compact && "max-sm:hidden")}>{subtitle}</p>}
          </div>
        </div>
        {/* Touch: every control in the actions row is one height (44px), so a picker never stands taller than the
            button beside it (audit 12 Oct 2026). The compact (project) header keeps its icon-sized buttons. */}
        {actions && <div className={cn("flex items-center gap-2 sm:flex-nowrap sm:shrink-0", compact ? "shrink-0 flex-nowrap max-sm:gap-1.5" : "flex-wrap pointer-coarse:[&>a]:min-h-11 pointer-coarse:[&>button]:min-h-11")}>{actions}</div>}
      </div>
      {tabs && <div className="relative px-4 md:px-8 overflow-x-auto">{tabs}</div>}
    </div>
  );
}
