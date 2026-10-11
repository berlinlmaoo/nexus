import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Where a floating panel attaches: a point (right-click) or an element's box (a button, a cell). */
export type FloatAnchor =
  | { x: number; y: number }
  | { rect: { left: number; top: number; right: number; bottom: number } };

const MARGIN = 8;

/**
 * Position a fixed panel the way Sheets does: below/right of the anchor when it fits, flipped
 * above/left when it doesn't, clamped inside the viewport, and scrolling inside itself when it is
 * taller than the window. Measured after render (hidden for that one frame), and again on resize.
 */
export function useFloating(anchor: FloatAnchor) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const key = "rect" in anchor
    ? `${anchor.rect.left}|${anchor.rect.top}|${anchor.rect.right}|${anchor.rect.bottom}`
    : `${anchor.x}|${anchor.y}`;

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const maxHeight = vh - MARGIN * 2;
      const w = el.offsetWidth;
      const h = Math.min(el.scrollHeight, maxHeight);
      let left: number, top: number;
      if ("rect" in anchor) {
        const r = anchor.rect;
        left = r.left;
        top = r.bottom + 4;
        // Not enough room below: open above if that fits better, else pin to the bottom edge.
        if (top + h > vh - MARGIN) top = r.top - 4 - h >= MARGIN ? r.top - 4 - h : vh - MARGIN - h;
        if (left + w > vw - MARGIN) left = Math.max(MARGIN, Math.min(r.right - w, vw - MARGIN - w));
      } else {
        left = anchor.x;
        top = anchor.y;
        if (top + h > vh - MARGIN) top = anchor.y - h >= MARGIN ? anchor.y - h : vh - MARGIN - h;
        if (left + w > vw - MARGIN) left = anchor.x - w >= MARGIN ? anchor.x - w : vw - MARGIN - w;
      }
      setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top), maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const style: CSSProperties = pos
    ? { position: "fixed", left: pos.left, top: pos.top, maxHeight: pos.maxHeight }
    : { position: "fixed", left: 0, top: 0, visibility: "hidden" };
  return { ref, style };
}

/** A fixed panel placed by useFloating. Scrolls inside itself when taller than the window. */
export function Floating({ anchor, className, children, role, onKeyDown, style }: {
  anchor: FloatAnchor;
  className?: string;
  children: ReactNode;
  role?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  style?: CSSProperties;
}) {
  const f = useFloating(anchor);
  return (
    <div ref={f.ref} role={role} onKeyDown={onKeyDown} style={{ ...style, ...f.style }} className={cn("z-[61] overflow-y-auto overscroll-contain", className)}>
      {children}
    </div>
  );
}
