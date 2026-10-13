import { useEffect } from "react";

// App-wide companion of use-focus-trap.ts (which a dialog opts into with a ref): Tab and Shift+Tab stay
// inside the top-most modal dialog (QA BoD round 2, N06: focus walked out of the
// task popup and the attendance request onto the page behind). One listener for the whole app, installed
// by the shell: every hand-made dialog marks itself role="dialog" aria-modal="true", and that is all it
// needs. Radix dialogs trap focus themselves; doing the same here for them is harmless.

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])", "select:not([disabled])",
  "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])", "[contenteditable='true']", "[contenteditable='']",
].join(",");

function visible(el: Element): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

/** The dialog on top: the last visible aria-modal element in document order (portals land at the end). */
export function topModal(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter(visible);
  return all.length ? all[all.length - 1] : null;
}

function onKey(e: KeyboardEvent) {
  if (e.key !== "Tab" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const modal = topModal();
  if (!modal) return;
  const items = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => visible(el) && !el.closest("[inert], [aria-hidden='true']"));
  const active = document.activeElement as HTMLElement | null;
  if (!items.length) { e.preventDefault(); modal.focus?.(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  const inside = !!active && modal.contains(active);
  if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
  if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
}

export function useModalFocusTrap() {
  useEffect(() => {
    // Bubble phase: an editor's own Tab (indent a list item) or the sheet grid's runs first and marks
    // the key handled; only a Tab nobody used moves focus, and then it stays in the dialog.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
