import { useLayoutEffect, useRef, useState } from "react";

/**
 * Room at the end of a snapping scroller, so its END is a snap point too (UI tour run 18, R18-WB-1, decision 5).
 *
 * A page whose rows snap under the pinned header (styles.css, data-snap-rows / data-snap-row / data-snap-top)
 * still stopped mid-card at full scroll: the end of the content decides where the last screen starts, so it
 * began with the tail of a card or a sliver of the row before (outlet day, Legal companies, the calendar day
 * panel, the phone's tickets). This spacer grows by just enough that the scroller's furthest position is the
 * first snap point from which the end of the content is still in view: scrolled to the end, the screen starts
 * on a whole row or card, and the last of the content is still on it. The extra blank space is less than one
 * row/card, and nothing is added when the end already lands on a snap point or no snap point can show it.
 *
 * `scroller`: "document" for the page (place it after the page content, before the phone's tab bar room), or
 * "parent" when its parent element is the scroll box (place it last inside that box).
 */
export function SnapTail({ scroller }: { scroller: "document" | "parent" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const doc = document.scrollingElement ?? document.documentElement;
    const box: HTMLElement | null = scroller === "document" ? null : el.parentElement;
    if (scroller === "parent" && !box) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Left out of the content's height as rendered now, so a pending update cannot make it oscillate.
      const current = el.offsetHeight;
      const next = tailFor(el, box, doc, current);
      if (Math.abs(next - current) < 1) return;
      setH(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    // The content's height (the tail itself is left out of the sum, so this settles), the viewport, and the
    // pinned header's height (published on <html> as --page-sticky-top, --page-snap-extra).
    if (box) { ro?.observe(box); for (const c of box.children) if (c !== el) ro?.observe(c); }
    else ro?.observe(document.body);
    ro?.observe(el);
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    if (box) mo?.observe(box, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [scroller]);
  // flexShrink 0: inside a flex column that scrolls (the phone board's lane) an empty spacer was shrunk back to 0
  // by the overflowing cards, so the lane's end never became a snap point (UI tour run 19, R19-WB-1 wm
  // project-board-2: the last screen began under the lane head, the first card's title hidden).
  return <div ref={ref} aria-hidden data-snap-tail="" style={{ height: h, flexShrink: 0 }} />;
}

const SNAP_POINTS = "[data-snap-row], [data-snap-rows] > *, [data-snap-top]";

/** The nearest ancestor that is a scroll container (what a snap area belongs to), or null for the document. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let a = node.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (/(auto|scroll|hidden)/.test(cs.overflowY) || /(auto|scroll|hidden)/.test(cs.overflowX)) return a;
  }
  return null;
}

/**
 * How far transforms move `node` down from where layout puts it (it and its ancestors up to `stop`). A card that
 * fades in from below (Reveal: translateY 16px until it is in view) would otherwise be measured 16px too low, and
 * the end would rest 16px into the card before it once it had moved into place (UI tour run 19, R19-WB-1, wm
 * dashboard-3: the page ended inside the profile card). Translations only; the app's snapping cards don't scale.
 */
function translateYOf(node: HTMLElement, stop: Element | null): number {
  let y = 0;
  for (let a: HTMLElement | null = node; a && a !== stop && a !== document.body; a = a.parentElement) {
    const tf = getComputedStyle(a).transform;
    if (tf && tf !== "none") {
      try { y += new DOMMatrixReadOnly(tf).m42; } catch { /* an unparsable value moves nothing we can measure */ }
    }
  }
  return y;
}

/** The tail's height: how far the furthest scroll position must move to reach the next snap point. */
function tailFor(tail: HTMLElement, box: HTMLElement | null, doc: Element, current: number): number {
  const target: Element = box ?? document.documentElement;
  const cs = getComputedStyle(target);
  if (cs.scrollSnapType === "none" || !cs.scrollSnapType) return 0;
  const clientH = box ? box.clientHeight : window.innerHeight;
  const scrollH = (box ? box.scrollHeight : doc.scrollHeight) - current;
  const maxScroll = scrollH - clientH;
  if (maxScroll <= 0) return 0;
  const padTop = parseFloat(cs.scrollPaddingTop) || 0;
  const scrollTop = box ? box.scrollTop : window.scrollY;
  const top0 = box ? box.getBoundingClientRect().top : 0;
  let best = Infinity;
  for (const p of (box ?? document.body).querySelectorAll<HTMLElement>(SNAP_POINTS)) {
    if (p === tail || p.closest("[data-snap-off]") && !p.hasAttribute("data-snap-top")) continue;
    if (!box && p.closest("[role='dialog']")) continue;
    if (scrollParent(p) !== box) continue;
    const r = p.getBoundingClientRect();
    if (!r.height) continue;
    const at = r.top - translateYOf(p, box) - top0 + scrollTop - padTop - (parseFloat(getComputedStyle(p).scrollMarginTop) || 0);
    // The first snap point at or past the end position: from there the end of the content is still in view.
    if (at >= maxScroll - 0.5 && at < best) best = at;
  }
  if (!Number.isFinite(best)) return 0;
  // Rounded down: at most a sub-pixel of the row before shows, rather than the snapped row's top edge being cut.
  const need = Math.floor(best - maxScroll);
  // Never more than most of a screen of blank space.
  return need > 0 && need <= clientH * 0.75 ? need : 0;
}
