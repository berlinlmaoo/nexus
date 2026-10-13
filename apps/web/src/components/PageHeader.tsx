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
    // Sticky on every width (UI tour run 5). On a phone it was left to scroll away (audit 12 Oct 2026), and
    // Safari then showed the page scrolling on behind its status bar. Phone only: an opaque surface (Safari
    // carries the colour of a sticky bar at the top edge into the status-bar area; a translucent one it does
    // not), padding for the top safe area, and a band of the same colour above the bar, so whatever Safari
    // draws above the page's top edge is header, not content. md and up: unchanged (translucent + blur).
    <div data-page-header className={cn("sticky top-0 z-30 border-b border-border bg-background pt-[env(safe-area-inset-top)] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-24 before:bg-background before:content-[''] md:z-40 md:bg-background/80 md:pt-0 md:backdrop-blur md:before:hidden", className)}>
      <div className={cn("px-4 md:px-8 md:pt-6 flex sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:pt-4 sm:pb-3", compact ? "flex-row items-center justify-between gap-2 pt-3 pb-1" : "flex-col gap-3 pt-4 pb-3")}>
        <div className={cn("flex items-start gap-3 min-w-0", compact && "max-sm:items-center max-sm:gap-2")}>
          {/* The identity mark shows on the phone too, as on the desktop and in the iPhone app (UI tour run 7:
              a project opened on the phone had no icon beside its name). */}
          {icon && <div className="shrink-0 text-2xl sm:mt-0.5">{icon}</div>}
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight truncate">{title}</h1>
            {/* Two lines on the phone too: one line cut most subtitles mid-sentence at 440 px ("Only the
                BoD…", UI tour 13 Oct 2026); the desktop shows them whole. */}
            {subtitle && <p className={cn("text-sm text-muted-foreground mt-0.5 line-clamp-2", compact && "max-sm:hidden")}>{subtitle}</p>}
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
