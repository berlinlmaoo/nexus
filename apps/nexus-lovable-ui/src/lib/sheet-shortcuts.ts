// The keyboard shortcuts the NEXUS spreadsheet supports, grouped like Sheets' "Keyboard shortcuts"
// dialog (Help ▸ Keyboard shortcuts, Ctrl+/). Labels and group names are English keys for t().
// Keys are written the Windows way ("Ctrl+Shift+V"); displayKeys() turns them into ⌘/⌥/⇧ on a Mac.

export type ShortcutItem = { label: string; keys: string[] };
export type ShortcutGroup = { group: string; items: ShortcutItem[] };

/** localStorage key of the "Enable compatible spreadsheet shortcuts" switch. */
export const COMPAT_SHORTCUTS_KEY = "nexus-sheet-compat-shortcuts";

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    group: "Editing",
    items: [
      { label: "Undo", keys: ["Ctrl+Z"] },
      { label: "Redo", keys: ["Ctrl+Y", "Ctrl+Shift+Z"] },
      { label: "Cut", keys: ["Ctrl+X"] },
      { label: "Copy", keys: ["Ctrl+C"] },
      { label: "Paste", keys: ["Ctrl+V"] },
      { label: "Paste values only", keys: ["Ctrl+Shift+V"] },
      { label: "Paste format only", keys: ["Ctrl+Alt+V"] },
      { label: "Insert link", keys: ["Ctrl+K"] },
      { label: "Insert or edit note", keys: ["Shift+F2"] },
      { label: "Insert rows above", keys: ["Ctrl+Alt+Shift+="] },
      { label: "Insert columns left", keys: ["Ctrl+Alt+="] },
      { label: "Delete rows", keys: ["Ctrl+Alt+-"] },
      { label: "Delete columns", keys: ["Ctrl+-"] },
      { label: "Fill down", keys: ["Ctrl+D"] },
      { label: "Fill right", keys: ["Ctrl+R"] },
      { label: "Insert current date", keys: ["Ctrl+;"] },
      { label: "Insert current time", keys: ["Ctrl+Shift+;"] },
      { label: "Insert current date and time", keys: ["Ctrl+Alt+Shift+;"] },
      { label: "Group rows or columns", keys: ["Alt+Shift+→"] },
      { label: "Ungroup rows or columns", keys: ["Alt+Shift+←"] },
      { label: "Insert new sheet", keys: ["Shift+F11"] },
    ],
  },
  {
    group: "Formatting",
    items: [
      { label: "Bold", keys: ["Ctrl+B"] },
      { label: "Italic", keys: ["Ctrl+I"] },
      { label: "Underline", keys: ["Ctrl+U"] },
      { label: "Strikethrough", keys: ["Alt+Shift+5"] },
      { label: "Align left", keys: ["Ctrl+Shift+L"] },
      { label: "Align centre", keys: ["Ctrl+Shift+E"] },
      { label: "Align right", keys: ["Ctrl+Shift+R"] },
      { label: "Clear formatting", keys: ["Ctrl+\\"] },
      { label: "Apply top border", keys: ["Alt+Shift+1"] },
      { label: "Apply right border", keys: ["Alt+Shift+2"] },
      { label: "Apply bottom border", keys: ["Alt+Shift+3"] },
      { label: "Apply left border", keys: ["Alt+Shift+4"] },
      { label: "Remove borders", keys: ["Alt+Shift+6"] },
      { label: "Apply outer border", keys: ["Alt+Shift+7", "Ctrl+Shift+7"] },
      { label: "Format as decimal", keys: ["Ctrl+Shift+1"] },
      { label: "Format as time", keys: ["Ctrl+Shift+2"] },
      { label: "Format as date", keys: ["Ctrl+Shift+3"] },
      { label: "Format as currency", keys: ["Ctrl+Shift+4"] },
      { label: "Format as percentage", keys: ["Ctrl+Shift+5"] },
      { label: "Format as exponent", keys: ["Ctrl+Shift+6"] },
    ],
  },
  {
    group: "Data",
    items: [
      { label: "Insert chart", keys: ["Alt+F1"] },
      { label: "Open filter menu", keys: ["Ctrl+Alt+R"] },
      { label: "Quick sum", keys: ["Alt+Shift+Q"] },
    ],
  },
  {
    group: "Comments",
    items: [
      { label: "Insert comment", keys: ["Ctrl+Alt+M"] },
    ],
  },
  {
    group: "Selection",
    items: [
      { label: "Select row", keys: ["Shift+Space"] },
      { label: "Select column", keys: ["Ctrl+Space"] },
      { label: "Select all", keys: ["Ctrl+A", "Ctrl+Shift+Space"] },
    ],
  },
  {
    group: "View",
    items: [
      { label: "Hide rows", keys: ["Ctrl+Alt+9"] },
      { label: "Hide columns", keys: ["Ctrl+Alt+0"] },
      { label: "Unhide rows", keys: ["Ctrl+Shift+9"] },
      { label: "Unhide columns", keys: ["Ctrl+Shift+0"] },
    ],
  },
  {
    group: "Navigation",
    items: [
      { label: "Find", keys: ["Ctrl+F"] },
      { label: "Find and replace", keys: ["Ctrl+H"] },
      { label: "Go to name box", keys: ["Ctrl+J"] },
      { label: "Move to beginning of sheet", keys: ["Ctrl+Home"] },
      { label: "Move to end of sheet", keys: ["Ctrl+End"] },
      { label: "Scroll to active cell", keys: ["Ctrl+Backspace"] },
      { label: "Open version history", keys: ["Ctrl+Alt+Shift+H"] },
      { label: "Search the menus", keys: ["Alt+/"] },
    ],
  },
  {
    group: "Help",
    items: [
      { label: "Show keyboard shortcuts", keys: ["Ctrl+/"] },
    ],
  },
];

/** Running on a Mac (⌘ instead of Ctrl)? False outside a browser. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(p) || /Mac OS X/.test(navigator.userAgent ?? "");
}

const MAC_KEY: Record<string, string> = { Ctrl: "⌘", Alt: "⌥", Shift: "⇧", Enter: "↩", Backspace: "⌫" };

/** One combo as key caps: "Ctrl+Shift+V" → ["Ctrl","Shift","V"] (Windows) or ["⌘","⇧","V"] (Mac). */
export function keyCaps(combo: string, mac = isMac()): string[] {
  // "Ctrl++" style combos never occur; "+" only separates, except a trailing "=" or "-".
  const parts = combo.split("+").filter((p) => p !== "");
  return mac ? parts.map((p) => MAC_KEY[p] ?? p) : parts;
}

/** Does an item match a search (label as shown, or any of its keys)? */
export function matchesShortcut(item: ShortcutItem, shownLabel: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return shownLabel.toLowerCase().includes(q) || item.label.toLowerCase().includes(q) || item.keys.some((k) => k.toLowerCase().includes(q));
}
