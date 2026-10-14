import { useEffect, useState, type RefObject } from "react";

/**
 * A soft fade on the cut edge(s) of a sideways-scrolling strip, so it reads as "there is more" instead of
 * a hard clip (chips, tab strips on a phone). Returns a mask-image class for the scroller; "" when it fits.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>, deps: unknown[] = [], wide = false): string {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setEdges((e) => {
      const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      return e.left === left && e.right === right ? e : { left, right };
    });
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", read); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  // `wide`: a strip with side padding (a tab row bleeding to the screen edge) needs a longer fade, or the
  // 28 px lands mostly on the padding and the cut word still ends hard (UI tour run 9, Settings tabs).
  if (wide) {
    return edges.left && edges.right
      ? "[mask-image:linear-gradient(to_right,transparent,black_56px,black_calc(100%-56px),transparent)]"
      : edges.right ? "[mask-image:linear-gradient(to_right,black_calc(100%-56px),transparent)]"
      : edges.left ? "[mask-image:linear-gradient(to_right,transparent,black_56px)]"
      : "";
  }
  return edges.left && edges.right
    ? "[mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-28px),transparent)]"
    : edges.right ? "[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]"
    : edges.left ? "[mask-image:linear-gradient(to_right,transparent,black_28px)]"
    : "";
}
