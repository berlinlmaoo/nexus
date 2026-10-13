// App-wide keyboard helpers (QA 13 Oct 2026, K-series): one answer to "is the person typing?", the
// platform's modifier label, and the list every shortcut help reads from.
//
// Rule for global shortcuts (⌘K search, ⌘B / ⌘\ sidebar, ⌘O GIDEON, ? help): they never fire while focus is
// in an editable element (the editor owns ⌘B = bold, ⌘K = link, ⌘I…), and never when something closer
// to the focus already handled the key (event.defaultPrevented: the sheet grid, a Radix menu, the editor).

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

/** "⌘" on Apple devices, "Ctrl" elsewhere. */
export const MOD = IS_MAC ? "⌘" : "Ctrl";

/** "⌘K" / "Ctrl K": the label of a ⌘/Ctrl shortcut on this platform. */
export function modKey(key: string): string {
  return IS_MAC ? `⌘${key}` : `Ctrl ${key}`;
}

/** Focus is in a text field, a select or a rich-text editor (TipTap/ProseMirror, contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true'], [contenteditable=''], .ProseMirror")) return true;
  if (target instanceof HTMLInputElement) {
    // Buttons that happen to be inputs do not take typing.
    return !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(target.type);
  }
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** A modal dialog of the app is on screen. */
export function modalOpen(): boolean {
  for (const el of document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="alertdialog"]')) {
    if (el.getClientRects().length) return true;
  }
  return false;
}

/** The global shortcut a ⌘/Ctrl key event should run, or null when it belongs to the focused element. */
export function globalModShortcut(e: KeyboardEvent): boolean {
  return !e.defaultPrevented && (e.metaKey || e.ctrlKey) && !e.altKey && !isEditableTarget(e.target);
}

export type ShortcutRow = { label: string; keys: string[] };
export type ShortcutSection = { title: string; where?: string; rows: ShortcutRow[] };

/**
 * Everything the web app answers to, for the "?" / ⌘/ sheet. Labels are English keys for t(); "Mod" is
 * written out per platform by the sheet. Keep it in step with the handlers it names.
 */
export const APP_SHORTCUTS: ShortcutSection[] = [
  {
    title: "Anywhere",
    rows: [
      { label: "Search NEXUS", keys: ["Mod+K"] },
      { label: "Show or hide the sidebar", keys: ["Mod+B", "Mod+\\"] },
      { label: "New GIDEON chat", keys: ["Mod+O"] },
      { label: "Keyboard shortcuts", keys: ["?", "Mod+/"] },
      { label: "Close the dialog or menu", keys: ["Esc"] },
    ],
  },
  {
    title: "Search",
    rows: [
      { label: "Move through results", keys: ["↑", "↓"] },
      { label: "Open the result", keys: ["Enter"] },
    ],
  },
  {
    title: "Text editor",
    where: "Pages, task descriptions, comments",
    rows: [
      { label: "Bold", keys: ["Mod+B"] },
      { label: "Italic", keys: ["Mod+I"] },
      { label: "Underline", keys: ["Mod+U"] },
      { label: "Strikethrough", keys: ["Mod+Shift+S"] },
      { label: "Inline code", keys: ["Mod+E"] },
      { label: "Add a link", keys: ["Mod+K"] },
      { label: "Ask AI", keys: ["Mod+J"] },
      { label: "Block menu", keys: ["/"] },
      { label: "Duplicate block", keys: ["Mod+D"] },
      { label: "Move block up / down", keys: ["Mod+Shift+↑", "Mod+Shift+↓"] },
      { label: "Undo / redo", keys: ["Mod+Z", "Mod+Shift+Z"] },
    ],
  },
  {
    title: "Tasks",
    where: "Board, list, table",
    rows: [
      { label: "Select every task on screen", keys: ["Mod+A"] },
      { label: "Add to the selection", keys: ["Mod+Click", "Shift+Click"] },
      { label: "Undo the last task change", keys: ["Mod+Z"] },
      { label: "Clear the selection", keys: ["Esc"] },
    ],
  },
  {
    title: "Calendar",
    rows: [
      { label: "Today", keys: ["T"] },
      { label: "Previous / next month (week in People)", keys: ["J", "K"] },
      { label: "Month / People", keys: ["M", "P"] },
      { label: "Switch by division / by person", keys: ["L"] },
      { label: "Filters", keys: ["F"] },
    ],
  },
  {
    title: "Chat",
    rows: [
      { label: "Send", keys: ["Enter"] },
      { label: "New line", keys: ["Shift+Enter"] },
    ],
  },
  {
    title: "Spreadsheet",
    rows: [
      { label: "All spreadsheet shortcuts", keys: ["Mod+/"] },
    ],
  },
];

/** "Mod+Shift+S" → ["⌘", "⇧", "S"] on a Mac, ["Ctrl", "Shift", "S"] elsewhere. */
export function keyParts(combo: string): string[] {
  if (combo === "+") return ["+"];
  return combo.split("+").map((p) => {
    if (p === "Mod") return IS_MAC ? "⌘" : "Ctrl";
    if (IS_MAC && p === "Shift") return "⇧";
    if (IS_MAC && p === "Alt") return "⌥";
    return p;
  });
}
