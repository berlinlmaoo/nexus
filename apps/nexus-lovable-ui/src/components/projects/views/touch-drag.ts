import { useEffect } from "react";

/**
 * Touch drag for the views' HTML5 drag-and-drop (QA B03/B39/S-11, 13 Oct 2026).
 *
 * The Board, List and Table move cards with HTML5 drag events (group-move.tsx, the lane handlers in
 * projects/$projectId.tsx). Touch screens don't send those: on iPad/iPhone nothing moved, and in Chromium's
 * touch mode the browser's own touch drag dropped the card's text on the page and the tab went to
 * about:blank. This turns a finger into the same events, so every drop rule, multi-drag, reorder slot and
 * Undo is the code the mouse already uses:
 *
 *   press and hold ARM_MS on a draggable element inside [data-touch-drag-root] → the card lifts (haptic tick);
 *   move more than SLOP px → `dragstart` on the card, then `dragenter`/`dragover`/`dragleave` on whatever
 *   is under the finger, a ghost of the card follows it, the board scrolls at its edges;
 *   lift → `drop` on the target and `dragend` on the card.
 *
 * A finger that moves before ARM_MS is a scroll and is left alone. Holding still keeps the long-press menu
 * (task-bulk.tsx, 480 ms); moving after it opened starts the drag and the menu closes. The browser's own
 * touch drag is cancelled (trusted `dragstart` right after a touch), so it can never navigate away.
 */
const ARM_MS = 280;
const SLOP = 6;
const SCROLL_TOL = 10;
const EDGE = 48;

type State = {
  el: HTMLElement;
  root: HTMLElement;
  id: number;
  x0: number; y0: number; x: number; y: number;
  armed: boolean;
  dragging: boolean;
  timer: number;
  dt: DataTransfer | null;
  over: Element | null;
  ghost: HTMLElement | null;
  dx: number; dy: number;
  raf: number;
};

let users = 0;
let st: State | null = null;
let lastTouch = 0;

function makeDT(): DataTransfer | null {
  try { return new DataTransfer(); } catch { return null; }
}

function fire(target: Element | null, type: string, s: State, related: Element | null = null): boolean {
  if (!target) return false;
  const init = { bubbles: true, cancelable: true, composed: true, clientX: s.x, clientY: s.y, screenX: s.x, screenY: s.y, relatedTarget: related };
  let ev: Event;
  try {
    ev = new DragEvent(type, { ...init, dataTransfer: s.dt });
  } catch {
    ev = new MouseEvent(type, init);
    Object.defineProperty(ev, "dataTransfer", { value: s.dt });
  }
  // Some engines drop `dataTransfer` from the init dict: the handlers read it, so make sure it is there.
  if (!(ev as DragEvent).dataTransfer && s.dt) Object.defineProperty(ev, "dataTransfer", { value: s.dt });
  return target.dispatchEvent(ev);
}

function findTouch(list: TouchList, id: number): Touch | null {
  for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
  return null;
}

/** The scroll box the board/list sits in (the nearest ancestor that scrolls sideways, then the page). */
function scrollers(el: HTMLElement): { x: HTMLElement | null; y: HTMLElement | null } {
  let x: HTMLElement | null = null, y: HTMLElement | null = null;
  for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (!x && /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth) x = n;
    if (!y && /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) y = n;
    if (x && y) break;
  }
  return { x, y: y ?? (document.scrollingElement as HTMLElement | null) };
}

function autoScroll() {
  const s = st;
  if (!s || !s.dragging) return;
  const { x: sx, y: sy } = scrollers(s.root);
  let moved = false;
  if (sx) {
    const r = sx.getBoundingClientRect();
    const v = s.x < r.left + EDGE ? -Math.ceil((r.left + EDGE - s.x) / 4) : s.x > r.right - EDGE ? Math.ceil((s.x - (r.right - EDGE)) / 4) : 0;
    if (v) { sx.scrollLeft += v; moved = true; }
  }
  if (sy) {
    const top = sy === document.scrollingElement ? 0 : sy.getBoundingClientRect().top;
    const bottom = sy === document.scrollingElement ? window.innerHeight : sy.getBoundingClientRect().bottom;
    const v = s.y < top + EDGE ? -Math.ceil((top + EDGE - s.y) / 4) : s.y > bottom - EDGE ? Math.ceil((s.y - (bottom - EDGE)) / 4) : 0;
    if (v) { sy.scrollTop += v; moved = true; }
  }
  if (moved) hover();
  s.raf = requestAnimationFrame(autoScroll);
}

function hover() {
  const s = st;
  if (!s) return;
  const target = document.elementFromPoint(s.x, s.y);
  if (target !== s.over) {
    fire(s.over, "dragleave", s, target);
    fire(target, "dragenter", s, s.over);
    s.over = target;
  }
  fire(target, "dragover", s);
}

function begin() {
  const s = st;
  if (!s) return;
  s.dragging = true;
  s.dt = makeDT();
  fire(s.el, "dragstart", s);
  // A small grip (List/Table rows) drags its whole row: the ghost shows the row, not the grip.
  const look = s.el.offsetWidth < 48 ? (s.el.closest<HTMLElement>("[data-bulk-task]") ?? s.el) : s.el;
  const r = look.getBoundingClientRect();
  s.dx = s.x0 - r.left;
  s.dy = s.y0 - r.top;
  const g = look.cloneNode(true) as HTMLElement;
  g.setAttribute("aria-hidden", "true");
  g.removeAttribute("id");
  g.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  g.style.cssText = `position:fixed;left:0;top:0;width:${r.width}px;margin:0;pointer-events:none;z-index:9999;opacity:0.92;box-shadow:0 10px 28px rgba(15,15,15,0.22);transform:translate(${s.x - s.dx}px,${s.y - s.dy}px) rotate(1.5deg);transition:none;`;
  document.body.appendChild(g);
  s.ghost = g;
  s.el.style.opacity = "0.4";
  s.raf = requestAnimationFrame(autoScroll);
}

function cleanup() {
  const s = st;
  st = null;
  document.removeEventListener("touchmove", onMove);
  document.removeEventListener("touchend", onEnd);
  document.removeEventListener("touchcancel", onCancel);
  if (!s) return;
  window.clearTimeout(s.timer);
  cancelAnimationFrame(s.raf);
  s.ghost?.remove();
  s.el.style.opacity = "";
  s.el.removeAttribute("data-touch-lifted");
}

function onStart(e: TouchEvent) {
  lastTouch = Date.now();
  if (st) { if (st.dragging) fire(st.el, "dragend", st); cleanup(); }
  if (e.touches.length !== 1) return;
  const target = e.target as Element | null;
  const root = target?.closest<HTMLElement>("[data-touch-drag-root]");
  const el = target?.closest<HTMLElement>('[draggable="true"]');
  if (!root || !el || !root.contains(el)) return;
  // Text fields and the inline editors keep their own touch behaviour.
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
  const t = e.touches[0];
  st = { el, root, id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, armed: false, dragging: false, timer: 0, dt: null, over: null, ghost: null, dx: 0, dy: 0, raf: 0 };
  st.timer = window.setTimeout(() => {
    if (!st) return;
    st.armed = true;
    st.el.setAttribute("data-touch-lifted", "");
    try { navigator.vibrate?.(8); } catch { /* not allowed */ }
  }, ARM_MS);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onEnd, { passive: false });
  document.addEventListener("touchcancel", onCancel);
}

function onMove(e: TouchEvent) {
  const s = st;
  if (!s) return;
  const t = findTouch(e.changedTouches, s.id);
  if (!t) return;
  s.x = t.clientX;
  s.y = t.clientY;
  const dist = Math.hypot(s.x - s.x0, s.y - s.y0);
  if (!s.armed) {
    if (dist > SCROLL_TOL) cleanup(); // a scroll
    return;
  }
  if (e.cancelable) e.preventDefault(); // the page must not scroll under the card
  if (!s.dragging) {
    if (dist < SLOP) return;
    begin();
  }
  if (s.ghost) s.ghost.style.transform = `translate(${s.x - s.dx}px,${s.y - s.dy}px) rotate(1.5deg)`;
  hover();
}

function onEnd(e: TouchEvent) {
  const s = st;
  if (!s) return;
  if (!findTouch(e.changedTouches, s.id)) return;
  if (s.dragging) {
    if (e.cancelable) e.preventDefault(); // no click on the card after a drop
    const target = document.elementFromPoint(s.x, s.y);
    const ok = target ? !fire(target, "dragover", s) : false; // a drop zone cancels dragover
    if (ok) fire(target, "drop", s);
    else fire(s.over, "dragleave", s, null);
    fire(s.el, "dragend", s);
  }
  cleanup();
}

function onCancel() {
  const s = st;
  if (s?.dragging) { fire(s.over, "dragleave", s, null); fire(s.el, "dragend", s); }
  cleanup();
}

/** The browser's own touch drag (Chromium) would carry the card's text out and navigate: never let it start. */
function onNativeDragStart(e: DragEvent) {
  if (!e.isTrusted) return;
  if (Date.now() - lastTouch > 1500) return;
  const el = (e.target as Element | null)?.closest?.("[data-touch-drag-root]");
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
}
/** A trusted drop of the browser's own touch drag anywhere on the page: nothing to open. */
function onNativeDrop(e: DragEvent) {
  if (e.isTrusted && Date.now() - lastTouch < 1500 && !e.defaultPrevented) e.preventDefault();
}

/** Turn on touch drag for every [data-touch-drag-root] on the page while the calling view is mounted. */
export function useTouchDrag() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (users++ === 0) {
      document.addEventListener("touchstart", onStart, { passive: true, capture: true });
      document.addEventListener("dragstart", onNativeDragStart, true);
      window.addEventListener("drop", onNativeDrop);
      window.addEventListener("dragover", onNativeDrop);
    }
    return () => {
      if (--users === 0) {
        document.removeEventListener("touchstart", onStart, { capture: true } as EventListenerOptions);
        document.removeEventListener("dragstart", onNativeDragStart, true);
        window.removeEventListener("drop", onNativeDrop);
        window.removeEventListener("dragover", onNativeDrop);
        cleanup();
      }
    };
  }, []);
}
