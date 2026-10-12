import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A wide table (or any row) that scrolls sideways inside its card, with a fade and an arrow on the side that
 * has more. On a phone the GIDEON runs, App versions, Reports team and Users tables cut their last columns
 * with nothing saying the rest was a swipe away (QA BoD B30, 13 Oct 2026). `className` styles the card (border,
 * radius, background); the scroller inside it is what moves.
 */
export function HScroll({ children, className, innerClassName }: { children: ReactNode; className?: string; innerClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);
  const nudge = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(160, (ref.current?.clientWidth ?? 0) * 0.6), behavior: "smooth" });
  return (
    <div className={cn("relative", className)}>
      <div ref={ref} onScroll={measure} data-hscroll="" className={cn("overflow-x-auto overscroll-x-contain", innerClassName)}>{children}</div>
      {edge.left && (
        <button type="button" tabIndex={-1} aria-hidden onClick={() => nudge(-1)} className="absolute inset-y-0 left-0 z-10 flex w-8 items-center justify-start bg-gradient-to-r from-card to-transparent pl-0.5 text-muted-foreground">
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {edge.right && (
        <button type="button" tabIndex={-1} aria-hidden onClick={() => nudge(1)} className="absolute inset-y-0 right-0 z-10 flex w-8 items-center justify-end bg-gradient-to-l from-card to-transparent pr-0.5 text-muted-foreground">
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
