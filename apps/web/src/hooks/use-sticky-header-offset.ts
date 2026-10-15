import { useEffect, useState } from "react";

/**
 * Where the page's sticky header ends, so a sticky row sits right under it. From md up the whole header sticks;
 * on a phone only its pinned parts do (title bar + tab strip, `data-page-header-sticky`), the header box itself
 * being `display: contents` there.
 */
export function useStickyHeaderOffset(): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-page-header]");
    if (!header) return;
    const measure = () => {
      const cs = getComputedStyle(header);
      if (cs.position === "sticky") { setTop(Math.round(header.getBoundingClientRect().height)); return; }
      if (cs.display !== "contents") { setTop(0); return; }
      const pinned = [...header.querySelectorAll<HTMLElement>("[data-page-header-sticky]")].filter((el) => getComputedStyle(el).position === "sticky");
      setTop(Math.round(pinned.reduce((h, el) => h + el.getBoundingClientRect().height, 0)));
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const watch = () => {
      ro?.disconnect();
      ro?.observe(header);
      header.querySelectorAll<HTMLElement>("[data-page-header-sticky]").forEach((el) => ro?.observe(el));
      measure();
    };
    watch();
    // A pinned part can mount later: the tab strip of a page that shows tabs once its data has loaded
    // (Notifications, Tickets). On a phone the header box is `display: contents` and gets no resize callback,
    // so the strip was never counted and rows snapped under it, half-cut (UI tour run 16, R16-WB-1).
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(watch);
    mo?.observe(header, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); mo?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return top;
}
