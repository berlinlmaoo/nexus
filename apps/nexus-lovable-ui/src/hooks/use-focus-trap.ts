import { useEffect, type RefObject } from "react";

// Keep Tab / Shift+Tab inside a hand-made modal dialog, focus it on open and give focus back to whatever had
// it on close (QA B16, 13 Oct 2026: in the ticket thread Tab walked out into the page behind the scrim).
// Radix dialogs do this themselves; this is for the plain motion.div ones.
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const before = document.activeElement as HTMLElement | null;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = items();
      if (!list.length) { e.preventDefault(); root.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === root || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [ref, enabled]);
}
