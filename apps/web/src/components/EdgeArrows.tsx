import { useEffect, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * The "more this way" affordance of a sideways scroller, as the tab strips have it: an arrow on a solid fade at
 * each edge that has more content, which scrolls on by most of a screen. The parent must be positioned (relative
 * or sticky); `className` places the arrows (default: the full height of the parent). UI tour run 20, R20-WM-6:
 * the phone board's column chips and the table's header ended hard at the screen edge, with nothing saying more
 * lay that way.
 */
export function EdgeArrows({ target, className, sides = "both" }: { target: RefObject<HTMLElement | null>; className?: string; sides?: "both" | "right" }) {
  const { t } = useLang();
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const read = () => setEdges((e) => {
      const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      return e.left === left && e.right === right ? e : { left, right };
    });
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", read); ro?.disconnect(); };
  }, [target]);
  const nudge = (dir: 1 | -1) => {
    const el = target.current;
    el?.scrollBy({ left: dir * Math.max(140, el.clientWidth * 0.6), behavior: "smooth" });
  };
  const btn = "absolute z-30 flex w-9 items-center text-muted-foreground transition-colors hover:text-foreground";
  return (
    <>
      {sides === "both" && edges.left && (
        <button type="button" tabIndex={-1} aria-label={t("Show earlier")} onClick={() => nudge(-1)}
          className={cn(btn, "left-0 justify-start bg-gradient-to-r from-card from-60% to-transparent pl-1", className ?? "inset-y-0")}>
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {edges.right && (
        <button type="button" tabIndex={-1} aria-label={t("Show more")} onClick={() => nudge(1)}
          className={cn(btn, "right-0 justify-end bg-gradient-to-l from-card from-60% to-transparent pr-1", className ?? "inset-y-0")}>
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </>
  );
}
