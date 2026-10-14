/**
 * Tab strips that scroll sideways show an arrow on a fade at the edge that has more. A tab that sits partly
 * under that arrow left glyph fragments beside it ("ri", "'able", a half icon) that read as broken text
 * (UI tour run 12, WM1). So a tab is shown whole or not at all: any tab not fully inside the strip minus the
 * arrow zones is hidden (it is behind the overflow; the arrow or a swipe brings it in).
 *
 * Called on every scroll and resize of the strip. `zone` is the arrow's width in px.
 */
export function hidePartialTabs(box: HTMLElement, selector: string, edge: { left: boolean; right: boolean }, zone: number) {
  const r = box.getBoundingClientRect();
  const lo = r.left + (edge.left ? zone : 0);
  const hi = r.right - (edge.right ? zone : 0);
  box.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const b = el.getBoundingClientRect();
    const partial = b.width > 0 && (b.left < lo - 0.5 || b.right > hi + 0.5);
    el.style.opacity = partial ? "0" : "";
    el.style.pointerEvents = partial ? "none" : "";
  });
}

/**
 * Brings the selected tab into view clear of the arrows, with a tab's start right after the left arrow zone
 * (as much context before it as fits), so the strip does not open on a gap left by a hidden half tab.
 * No scroll when the tab is already clear.
 */
export function revealTab(box: HTMLElement, el: HTMLElement, selector: string, zone: number) {
  const b = box.getBoundingClientRect();
  const pos = (t: HTMLElement) => t.getBoundingClientRect().left - b.left + box.scrollLeft;
  const aL = pos(el), aR = aL + el.getBoundingClientRect().width;
  const view = box.clientWidth;
  const leftClear = box.scrollLeft === 0 ? aL >= 0 : aL - zone >= box.scrollLeft;
  const rightClear = box.scrollLeft + view >= box.scrollWidth - 1 ? aR <= box.scrollLeft + view : aR + zone <= box.scrollLeft + view;
  if (leftClear && rightClear) return;
  let start = aL;
  for (const t of box.querySelectorAll<HTMLElement>(selector)) {
    const s = pos(t);
    if (s > aL) break;
    // From the first tab no left arrow shows; elsewhere the tab starts after the arrow zone.
    const left = s <= 0.5 ? 0 : s - zone;
    if (aR + zone <= left + view) { start = s; break; }
  }
  box.scrollLeft = start <= 0.5 ? 0 : Math.max(0, start - zone);
}
