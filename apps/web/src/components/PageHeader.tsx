import { type CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStickyHeaderOffset } from "@/hooks/use-sticky-header-offset";
import { cn } from "@/lib/utils";

/**
 * The page header. From md up the whole header is one sticky block, as it always was.
 *
 * Phone (owner, 14 Oct 2026): only the title row and the tab strip stay pinned, about 90 px; the subtitle and
 * the page's secondary row (non-compact actions) scroll away with the content. The header's outer box and its
 * row become `display: contents` below md, so its parts are laid out as children of the page itself: the
 * title bar sticks at the top, the tab strip sticks right under it (at the bar's measured height),
 * and the rows between them scroll. Every pinned part is opaque (UI tour run 11, WM-13/WD-8: the translucent
 * bar let rows and chips show through). Pinned parts carry `data-page-header-sticky`, for pages that put a
 * sticky row of their own under the header.
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  tabs,
  className,
  compact,
  hero,
}: {
  title: string;
  subtitle?: string;
  /** Only for an identity mark (a project or folder icon). Pages get no decorative glyph: one header style
   *  everywhere (audit 12 Oct 2026). */
  icon?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  /** Overrides the surface (the project page sits on a white canvas, owner 12 Oct 2026). Applied to every part,
   *  since on a phone the parts are separate boxes. */
  className?: string;
  /** Phone: title and actions share one row (actions must be icon-sized there) and the subtitle is hidden,
   *  so the header stays small (project page, audit 12 Oct 2026). Desktop unchanged. */
  compact?: boolean;
  /** Desktop: a page-sized title (Notion's database page, 32px bold, more air above), for the project page. */
  hero?: boolean;
}) {
  // Height of the pinned title bar on a phone, so the tab strip sticks right under it.
  const barRef = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(0);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const read = () => setBarH(Math.round(el.getBoundingClientRect().height));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Phone only: the pinned bar's surface. z-40 like the desktop header: page content uses z-30 for its own
  // sticky heads and edge fades, and at an equal z-index the later element (the content) paints over the header
  // (UI tour run 17, R17-WM-1: the attendance board's fade cut the title "Attendance" in half).
  // Phone only: the pinned bar's surface. An opaque colour also carries into Safari's status-bar area (it
  // takes the colour of a sticky bar at the top edge), with a band of the same colour above the bar and
  // padding for the top safe area, so whatever Safari draws above the page's top edge is header, not content.
  const pinnedBar = "max-md:sticky max-md:top-0 max-md:z-40 max-md:bg-background max-md:pt-[env(safe-area-inset-top)] max-md:before:pointer-events-none max-md:before:absolute max-md:before:inset-x-0 max-md:before:bottom-full max-md:before:h-24 max-md:before:bg-background max-md:before:content-['']";
  // Without tabs the bar is the header's last pinned part. It draws its dividing line once the page has
  // scrolled (content then runs under it); at rest the subtitle and actions sit under it, and a line between
  // the title and its own subtitle would cut the header in two.
  // Also drives the desktop fade under the sticky header (below).
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const read = () => setScrolled(window.scrollY > 4);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  const barEdge = !tabs && cn("max-md:border-b", scrolled ? "max-md:border-border" : "max-md:border-transparent");

  // Where the pinned header ends, for the page's own scroll snapping: a list marked `data-snap-rows` stops
  // with its top row whole right under the header, not cut through the middle (UI tour run 15, R15-WB-1).
  const stickyTop = useStickyHeaderOffset();
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--page-sticky-top", `${stickyTop}px`);
    return () => { root.style.removeProperty("--page-sticky-top"); };
  }, [stickyTop]);

  const titleBlock = (
    <div
      ref={compact ? undefined : barRef}
      data-page-header-sticky={compact ? undefined : ""}
      className={cn("flex items-start gap-3 min-w-0", compact && "max-sm:items-center max-sm:gap-2", !compact && cn(pinnedBar, barEdge, "max-md:px-4 max-md:pb-2 max-md:pt-[calc(env(safe-area-inset-top)+1rem)]", className))}
    >
      {/* The identity mark shows on the phone too, as on the desktop and in the iPhone app (UI tour run 7:
          a project opened on the phone had no icon beside its name). */}
      {icon && <div className={cn("shrink-0 text-2xl sm:mt-0.5", hero && "md:mt-0")}>{icon}</div>}
      <div className="min-w-0">
        {/* Compact (project) header on a phone: a long name takes two lines instead of being cut beside the
            icon buttons (UI tour run 13, W-M15), balanced, so the second line is never one orphaned word (UI tour
            run 20, R20-WM-12: "ZZ QA Social Media / Report"). */}
        <h1 className={cn("text-xl md:text-2xl font-semibold tracking-tight truncate", hero && "md:text-[32px] md:font-bold md:leading-[1.25]", compact && "max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:break-words max-sm:text-lg max-sm:leading-snug max-sm:[text-wrap:balance]")}>{title}</h1>
        {subtitle && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground max-md:hidden">{subtitle}</p>}
      </div>
    </div>
  );

  return (
    <div data-page-header className={cn("max-md:contents md:sticky md:top-0 md:z-40 md:border-b md:border-border md:bg-background", className)}>
      <div
        ref={compact ? barRef : undefined}
        data-page-header-sticky={compact ? "" : undefined}
        className={cn(
          "px-4 md:px-8 md:pt-6 md:flex md:flex-row md:items-start md:justify-between md:gap-6 md:pb-3", hero && "md:pt-10 md:pb-2 md:items-center",
          // The top padding comes after pinnedBar's safe-area padding, which otherwise replaced it and left the
          // icon buttons touching the top edge (UI tour run 13, W-M6).
          compact ? cn("flex flex-row items-center justify-between gap-2 pt-3 pb-1", pinnedBar, "max-md:pt-[calc(env(safe-area-inset-top)+0.75rem)]", barEdge, className) : "max-md:contents",
        )}
      >
        {titleBlock}
        {/* Phone: the subtitle scrolls away under the pinned title (two lines; compact headers hide it). */}
        {subtitle && !compact && <p className={cn("line-clamp-2 px-4 pb-2 text-sm text-muted-foreground md:hidden", className)}>{subtitle}</p>}
        {/* Touch: every control in the actions row is one height (44px), so a picker never stands taller than the
            button beside it (audit 12 Oct 2026). The compact (project) header keeps its icon-sized buttons; the
            others are the page's secondary row on a phone and scroll away. */}
        {actions && (
          <div className={cn("flex items-center gap-2 md:flex-nowrap md:shrink-0", compact ? "shrink-0 flex-nowrap max-sm:gap-1.5" : cn("flex-wrap pointer-coarse:[&>a]:min-h-11 pointer-coarse:[&>button]:min-h-11 max-md:px-4 max-md:pb-3 max-md:pt-1", className))}>
            {actions}
          </div>
        )}
      </div>
      {tabs && (
        <div
          data-page-header-sticky=""
          // A variable, not `top` itself: from md up the strip is `relative`, where a `top` would shift it down.
          style={{ "--page-header-bar-h": `${barH}px` } as CSSProperties}
          // Phone: an opaque band of the header's colour (a shadow, which the strip's own overflow does not clip)
          // reaches up from the strip to the title bar, so no sliver of a scrolled row shows between the two
          // pinned parts (UI tour run 13, W-M2: an avatar and cut text showed under the title). Over the bar
          // itself it is the same colour. A header on another surface sets --page-header-bg.
          // 2px is enough for the sub-pixel seam between the two pinned parts. It must stay inside the bottom
          // padding of whatever sits right above the strip: at 0.75rem it painted over the bottom of the project
          // icon and buttons, a two-line project name and a two-line page subtitle (UI tour run 14, R14-WM-1,
          // R14-WM-2, R14-WM-5).
          className={cn("relative overflow-x-auto px-4 md:px-8 max-md:sticky max-md:top-[var(--page-header-bar-h)] max-md:z-40 max-md:border-b max-md:border-border max-md:bg-background max-md:shadow-[0_-2px_0_0_var(--page-header-bg,var(--background))]", className)}
        >
          {tabs}
        </div>
      )}
      {/* Desktop: once the page has scrolled, a 1rem band of the header's colour under it, so rows snapped 1rem
          under the header stand clear of it (UI tour run 14, R14-WD-10). At rest it is hidden, so nothing right
          under the header is covered. Sticky bars that sit right under the header (legal chips, pipeline chips,
          the legal table head) stack above it (z-41). */}
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0 top-full hidden h-4 transition-opacity duration-150 md:block", scrolled ? "opacity-100" : "opacity-0")}
        // Solid over its whole 1rem: a row snapped 1rem under the header leaves the tail of the row before in this
        // band. A plain fade let an avatar or a strikethrough sliver show (R16-WB-1), and at 65% solid its fading
        // part still showed a ~10px sliver of the row before (UI tour run 17, R17-WB-1: legal series rows, the
        // outlet month grid).
        style={{ background: "var(--page-header-bg, var(--background))" }}
      />
    </div>
  );
}
