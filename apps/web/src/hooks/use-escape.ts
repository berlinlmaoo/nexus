import { useEffect, useRef } from "react";

// Esc closes the top-most hand-made dialog (QA 13 Oct 2026: New chat, Add people, New ticket, the ticket
// thread, the attendance request, dashboard cards… stayed open). Radix dialogs/menus handle Esc themselves;
// this is for the ones built from a plain fixed overlay.
//
// Stacked: a dialog opened from another one closes first, then the one under it on the next Esc. A key
// already handled closer to the focus (a Radix menu or popover inside the dialog, an editor's own Esc,
// an inline rename field) calls preventDefault and is left alone.

type Entry = { id: number; close: () => void };
const stack: Entry[] = [];
let seq = 0;
let bound = false;

function radixLayerOpen(): boolean {
  // A Radix popover / dropdown / select is open: its own Esc closes it, not the dialog under it.
  // A Radix dialog / alert dialog on top of a hand-made one closes on its own as well.
  return !!document.querySelector("[data-radix-popper-content-wrapper], [role='menu'][data-state='open'], [role='listbox'][data-state='open'], [role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']");
}

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || stack.length === 0) return;
  if (radixLayerOpen()) return;
  const top = stack[stack.length - 1];
  e.preventDefault();
  top.close();
}

/** Close on Esc while `enabled` (default true). The latest `close` is always the one called. */
export function useEscape(close: () => void, enabled = true) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!enabled) return;
    if (!bound) { window.addEventListener("keydown", onKey); bound = true; }
    const entry: Entry = { id: ++seq, close: () => ref.current() };
    stack.push(entry);
    return () => {
      const i = stack.findIndex((x) => x.id === entry.id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [enabled]);
}

/** The same as a component, for a dialog written inline in JSX: `{open && <><EscClose onClose={…} />…</>}`. */
export function EscClose({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  return null;
}
