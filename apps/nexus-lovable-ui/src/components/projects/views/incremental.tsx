import { Fragment, startTransition, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Long lists render in slices (perf pass, 12 Oct 2026). A board column, list group or table group shows its
 * first `first` items; an invisible marker after the last one loads the next `step` as it comes within
 * ~1.5 screens of the viewport, so scrolling never meets an empty end. A 350-task project paints its first
 * screen with ~100 cards instead of 350, and every later re-render (a realtime update, a drag hover) costs
 * the same fraction. Notion's board does the same ("Load more").
 *
 * Keys come from `keyOf`; items keep their React identity as the slice grows.
 */
export function Incremental<T>({ items, render, keyOf, first = 30, step = 20, markerClassName }: {
  items: readonly T[];
  render: (item: T, index: number) => ReactNode;
  keyOf: (item: T) => string;
  first?: number;
  step?: number;
  markerClassName?: string;
}) {
  const [limit, setLimit] = useState(first);
  const marker = useRef<HTMLDivElement | null>(null);
  const more = items.length > limit;
  useEffect(() => {
    const el = marker.current;
    if (!el || !more || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      // A transition: React renders the next slice in small pieces between frames, so scrolling never
      // stalls while it mounts.
      (entries) => { if (entries.some((e) => e.isIntersecting)) startTransition(() => setLimit((n) => n + step)); },
      { rootMargin: "1200px 600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, step, limit]);
  return (
    <>
      {items.slice(0, limit).map((item, i) => <Fragment key={keyOf(item)}>{render(item, i)}</Fragment>)}
      {more && <div ref={marker} aria-hidden className={markerClassName ?? "h-px w-full shrink-0"} />}
    </>
  );
}
