import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { useFloating, type FloatAnchor } from "./sheet-float";

/**
 * The spreadsheet's menus as DATA: the menu bar (File · Edit · View · Insert · Format · Data · Tools ·
 * Help), the right-click menus (cell, column header, row header) and "Search the menus" (Alt+/) are
 * all drawn from the same trees, so an item can't exist in one place and be missing in another.
 *
 * Labels are English source text translated at render (Indonesian = the labels Google Sheets shows
 * in id-ID, see lib/i18n/id-sheets-menus.ts). `vars` fill selection-aware labels ("Insert {n} rows above").
 */
export type MenuNode =
  | {
    id: string;
    label: string;
    vars?: Record<string, string | number>;
    /** Keyboard shortcut shown on the right ("Ctrl+B"); ⌘ replaces Ctrl on a Mac. */
    shortcut?: string;
    /** Right-aligned grey sample (number formats). */
    hint?: string;
    icon?: ReactNode;
    disabled?: boolean;
    checked?: boolean;
    badge?: "new";
    danger?: boolean;
    /** Font preview etc. */
    style?: React.CSSProperties;
    run?: () => void;
    children?: MenuNode[];
    /** A custom submenu body (colour pickers): opens like `children`. */
    panel?: (close: () => void) => ReactNode;
  }
  | { sep: true }
  | { header: string };

export type MenuItemNode = Extract<MenuNode, { id: string }>;
export const SEP: MenuNode = { sep: true };
const isItem = (n: MenuNode): n is MenuItemNode => "id" in n;

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export function keyLabel(shortcut: string): string {
  return IS_MAC ? shortcut.replace(/Ctrl\+/g, "⌘").replace(/Alt\+/g, "⌥").replace(/Shift\+/g, "⇧") : shortcut;
}

/** Drop leading/trailing/double separators left behind by items that were filtered out. */
export function tidy(nodes: (MenuNode | null | false | undefined)[]): MenuNode[] {
  const out: MenuNode[] = [];
  for (const n of nodes) {
    if (!n) continue;
    if ("sep" in n && (!out.length || "sep" in out[out.length - 1])) continue;
    out.push(n);
  }
  while (out.length && "sep" in out[out.length - 1]) out.pop();
  return out;
}

/** Where the keyboard goes back to when a menu closes (the grid, usually). Shared by every top-level menu. */
let menuReturnFocus: HTMLElement | null = null;

/**
 * One menu panel at a fixed position. Submenus open to the right on hover, click or ArrowRight;
 * the keyboard walks items with ↑/↓, Enter runs, ← / Escape close a level.
 */
function MenuPanel({ nodes, anchor, onDone, onBack, depth = 0, width = 260 }: {
  nodes: MenuNode[];
  anchor: FloatAnchor;
  onDone: () => void;
  onBack?: () => void;
  depth?: number;
  width?: number;
}) {
  const { t } = useLang();
  const f = useFloating(anchor);
  const [open, setOpen] = useState<{ index: number; rect: DOMRect } | null>(null);
  const [focus, setFocus] = useState(-1);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  useEffect(() => { if (depth > 0) setFocus(nodes.findIndex((n) => isItem(n) && !n.disabled)); }, [depth, nodes]);
  useEffect(() => { if (focus >= 0) itemRefs.current[focus]?.focus(); }, [focus]);
  // A top-level menu takes the keyboard while open (so Esc and the arrows reach it: a right-click menu
  // used to ignore Esc, bughunt S-BUG-18) and hands it back to whoever had it when it closes.
  useEffect(() => {
    if (depth > 0) return;
    const prev = document.activeElement as HTMLElement | null;
    if (prev && prev !== document.body && !prev.closest("[role=menu]")) menuReturnFocus = prev;
    f.ref.current?.focus({ preventScroll: true });
    return () => {
      requestAnimationFrame(() => {
        const a = document.activeElement;
        const back = menuReturnFocus;
        if ((!a || a === document.body) && back?.isConnected) back.focus({ preventScroll: true });
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSub = (i: number) => {
    const el = itemRefs.current[i];
    if (el) setOpen({ index: i, rect: el.getBoundingClientRect() });
  };
  const step = (dir: 1 | -1) => {
    if (!nodes.length) return;
    let i = focus;
    for (let k = 0; k < nodes.length; k += 1) {
      i = (i + dir + nodes.length) % nodes.length;
      const n = nodes[i];
      if (isItem(n) && !n.disabled) { setFocus(i); return; }
    }
  };
  const activate = (i: number) => {
    const n = nodes[i];
    if (!n || !isItem(n) || n.disabled) return;
    if (n.children || n.panel) { openSub(i); return; }
    onDone();
    n.run?.();
  };

  return (
    <>
      <div
        ref={f.ref}
        role="menu"
        tabIndex={-1}
        style={{ ...f.style, width }}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); step(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); step(-1); }
          else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); const n = nodes[focus]; if (n && isItem(n) && (n.children || n.panel)) openSub(focus); }
          else if (e.key === "ArrowLeft" && onBack) { e.preventDefault(); e.stopPropagation(); onBack(); }
          else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); activate(focus); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); (onBack ?? onDone)(); }
        }}
        className="z-[61] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-pop outline-none"
      >
        {nodes.map((n, i) => {
          if ("sep" in n) return <div key={`s${i}`} className="my-1 border-t border-border" />;
          if ("header" in n) return <div key={`h${i}`} className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t(n.header)}</div>;
          const sub = Boolean(n.children || n.panel);
          const label = t(n.label, n.vars);
          return (
            <button
              key={n.id}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              aria-haspopup={sub ? "menu" : undefined}
              aria-expanded={sub ? open?.index === i : undefined}
              aria-checked={n.checked}
              disabled={n.disabled}
              title={label.length > 34 ? label : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => {
                setFocus(i);
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
                hoverTimer.current = setTimeout(() => { if (sub && !n.disabled) openSub(i); else setOpen(null); }, sub ? 80 : 120);
              }}
              onClick={() => activate(i)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs outline-none transition-colors disabled:opacity-40",
                n.danger ? "text-destructive hover:bg-destructive/10 focus:bg-destructive/10" : "hover:bg-muted focus:bg-muted",
                open?.index === i && "bg-muted",
              )}
            >
              <span className="grid w-3.5 shrink-0 place-items-center text-muted-foreground">
                {n.checked ? <Check className="h-3.5 w-3.5 text-foreground" /> : n.icon}
              </span>
              <span className="min-w-0 flex-1 truncate" style={n.style}>{label}</span>
              {n.badge === "new" && <span className="shrink-0 rounded-full bg-success/15 px-1.5 text-[9px] font-bold uppercase text-success">{t("New")}</span>}
              {n.hint && <span className="shrink-0 pl-3 text-[11px] text-muted-foreground tabular-nums">{n.hint}</span>}
              {n.shortcut && <span className="shrink-0 pl-3 text-[11px] text-muted-foreground tabular-nums">{keyLabel(n.shortcut)}</span>}
              {sub && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </button>
          );
        })}
      </div>
      {open && (() => {
        const n = nodes[open.index];
        if (!n || !isItem(n)) return null;
        if (n.panel) return <PanelFloat key={n.id} anchor={{ x: open.rect.right - 2, y: open.rect.top - 5 }}>{n.panel(onDone)}</PanelFloat>;
        if (!n.children) return null;
        return (
          <MenuPanel
            key={n.id}
            nodes={n.children}
            depth={depth + 1}
            anchor={{ x: open.rect.right - 2, y: open.rect.top - 5 }}
            onDone={onDone}
            onBack={() => { setOpen(null); itemRefs.current[open.index]?.focus(); }}
          />
        );
      })()}
    </>
  );
}

function PanelFloat({ anchor, children }: { anchor: FloatAnchor; children: ReactNode }) {
  const f = useFloating(anchor);
  return <div ref={f.ref} style={f.style} className="z-[61] overflow-y-auto rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-pop">{children}</div>;
}

/** A floating menu at a point (right-click) or under an element; closes on outside click. */
export function MenuPopup({ nodes, anchor, onClose, width }: { nodes: MenuNode[]; anchor: FloatAnchor; onClose: () => void; width?: number }) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <MenuPanel nodes={nodes} anchor={anchor} onDone={onClose} width={width} />
    </>,
    document.body,
  );
}

/**
 * The menu bar. Clicking a word opens its menu; while one is open, hovering another word switches to
 * it (like every desktop menu bar). Alt+Shift+<letter> opens a menu from the keyboard (handled by the
 * grid through `openMenu`).
 */
export function MenuBar({ menus, openId, onOpen, className }: {
  menus: { id: string; label: string; nodes: MenuNode[] }[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  className?: string;
}) {
  const { t } = useLang();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = menus.find((m) => m.id === openId);
  const rect = openId ? refs.current[openId]?.getBoundingClientRect() : null;
  return (
    <nav aria-label={t("Menu")} className={cn("flex flex-wrap items-center gap-0.5 text-[13px]", className)}>
      {menus.map((m) => (
        <button
          key={m.id}
          ref={(el) => { refs.current[m.id] = el; }}
          type="button"
          aria-haspopup="menu"
          aria-expanded={openId === m.id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onOpen(openId === m.id ? null : m.id)}
          onMouseEnter={() => { if (openId && openId !== m.id) onOpen(m.id); }}
          className={cn("rounded-md px-2 py-0.5 text-foreground/85 transition-colors hover:bg-muted", openId === m.id && "bg-muted text-foreground")}
        >
          {t(m.label)}
        </button>
      ))}
      {current && rect && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => onOpen(null)} />
          <MenuPanel key={current.id} nodes={current.nodes} anchor={{ rect }} onDone={() => onOpen(null)} width={300} />
        </>,
        document.body,
      )}
    </nav>
  );
}

/** Every runnable leaf with its path ("Format › Number › Percent"), for "Search the menus". */
export function flattenMenus(menus: { label: string; nodes: MenuNode[] }[], t: (s: string, v?: Record<string, string | number>) => string) {
  const out: { path: string; node: MenuItemNode }[] = [];
  const walk = (nodes: MenuNode[], trail: string[]) => {
    for (const n of nodes) {
      if (!isItem(n)) continue;
      const here = [...trail, t(n.label, n.vars)];
      if (n.children) walk(n.children, here);
      else if (n.run) out.push({ path: here.join(" › "), node: n });
    }
  };
  for (const m of menus) walk(m.nodes, [t(m.label)]);
  return out;
}

/** "Search the menus" (Alt+/): type, pick with ↑/↓, Enter runs the item. */
export function MenuSearch({ menus, onClose }: { menus: { label: string; nodes: MenuNode[] }[]; onClose: () => void }) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const all = useMemo(() => flattenMenus(menus, t), [menus, t]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const words = s.split(/\s+/);
    return all.filter((x) => words.every((w) => x.path.toLowerCase().includes(w))).slice(0, 12);
  }, [all, q]);
  const run = (k: number) => {
    const hit = hits[k];
    if (!hit || hit.node.disabled) return;
    onClose();
    hit.node.run?.();
  };
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/10 pt-24" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={t("Search the menus")} className="h-fit w-[440px] max-w-[calc(100%-1rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-pop">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              if (e.key === "Enter") run(i);
            }}
            placeholder={t("Search the menus (Alt+/)")}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        {q.trim() && (
          <div role="listbox" className="max-h-80 overflow-y-auto py-1">
            {hits.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">{t("No menu item matches.")}</p>}
            {hits.map((h, k) => (
              <button
                key={`${h.path}${k}`}
                role="option"
                aria-selected={k === i}
                disabled={h.node.disabled}
                onMouseEnter={() => setI(k)}
                onClick={() => run(k)}
                className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs disabled:opacity-40", k === i && "bg-muted")}
              >
                <span className="min-w-0 flex-1 truncate">{h.path}</span>
                {h.node.shortcut && <span className="shrink-0 text-[11px] text-muted-foreground">{keyLabel(h.node.shortcut)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
