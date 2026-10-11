import {
  createContext, useContext, useEffect, useId, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Floating, type FloatAnchor } from "./sheet-float";

/**
 * Menus for the sheet chrome (toolbar, menu bar, context menus): a trigger button, a portaled panel,
 * items with a tick / icon / shortcut / grey example, and nested submenus that open to the right on
 * hover, click or ArrowRight (Sheets' "Number ▸", "Rotation ▸", "Functions ▸ Math"…).
 */

type RootCtx = { close: () => void };
const RootMenuCtx = createContext<RootCtx | null>(null);

/** One open panel (the root panel or a submenu): which of its items has its submenu open. */
type LevelCtx = { openKey: string | null; hover: (key: string | null) => void; hold: (key: string) => void; shut: () => void };
const LevelMenuCtx = createContext<LevelCtx | null>(null);

function useLevel(): LevelCtx {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    openKey,
    // A short delay, so moving diagonally from an item into its submenu doesn't flick it shut.
    hover: (key) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setOpenKey(key), key ? 90 : 220);
    },
    hold: (key) => { window.clearTimeout(timer.current); setOpenKey(key); },
    shut: () => { window.clearTimeout(timer.current); setOpenKey(null); },
  };
}

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled),[role="menuitemcheckbox"]:not(:disabled)';

/** Arrow-key movement among one panel's own items (submenus are separate portals, so not included). */
export function menuKeyNav(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
  if (!items.length) return;
  e.preventDefault();
  e.stopPropagation();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
    : e.key === "ArrowDown" ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1);
  items[next]?.focus();
}

/** A panel that belongs to a menu: provides its own submenu level and keyboard movement. */
export function MenuPanel({ anchor, className, children, onMouseEnter, onKeyDown, role = "menu" }: {
  anchor: FloatAnchor;
  className?: string;
  children: ReactNode;
  onMouseEnter?: () => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  role?: string;
}) {
  const level = useLevel();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <LevelMenuCtx.Provider value={level}>
      <Floating
        anchor={anchor}
        role={role}
        className={cn("min-w-40 rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-pop", className)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented) menuKeyNav(e);
        }}
      >
        <div ref={ref} onMouseEnter={onMouseEnter}>{children}</div>
      </Floating>
    </LevelMenuCtx.Provider>
  );
}

/** A toolbar button that opens a small menu (portaled: the toolbar sits above overflow containers). */
export function Menu({ label, title, trigger, disabled, children, bare, className, panelClassName, active, onOpen }: {
  /** aria-label (and the tooltip unless `title` is given). */
  label: string;
  title?: string;
  trigger: ReactNode;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
  /** Menu-bar style: a word, no caret. */
  bare?: boolean;
  className?: string;
  panelClassName?: string;
  /** Show the trigger pressed (e.g. a filter view is open). */
  active?: boolean;
  onOpen?: () => void;
}) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const [focusFirst, setFocusFirst] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const panelHost = useRef<HTMLDivElement>(null);
  const close = () => setAt(null);
  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); ref.current?.focus({ preventScroll: true }); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at]);
  // Opened from the keyboard: move focus into the menu so the arrows work.
  useEffect(() => {
    if (!at || !focusFirst) return;
    const id = window.requestAnimationFrame(() => {
      panelHost.current?.parentElement?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [at, focusFirst]);
  return (
    <>
      <button
        ref={ref}
        type="button"
        title={title ?? label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        disabled={disabled}
        onClick={(e) => {
          const r = ref.current?.getBoundingClientRect();
          setFocusFirst(e.detail === 0);
          if (!at && r) onOpen?.();
          setAt(at || !r ? null : r);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !at) {
            e.preventDefault();
            const r = ref.current?.getBoundingClientRect();
            if (r) { setFocusFirst(true); onOpen?.(); setAt(r); }
          }
        }}
        className={cn(
          "flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-foreground/80 transition-colors",
          "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35",
          (at || active) && "bg-muted text-foreground",
          active && "bg-accent text-accent-foreground",
          className,
        )}
      >
        {trigger}
        {!bare && <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />}
      </button>
      {at && createPortal(
        <RootMenuCtx.Provider value={{ close }}>
          <div className="fixed inset-0 z-[60]" onMouseDown={close} />
          <MenuPanel anchor={{ rect: at }} className={panelClassName}>
            <div ref={panelHost} className="contents" />
            {children(close)}
          </MenuPanel>
        </RootMenuCtx.Provider>,
        document.body,
      )}
    </>
  );
}

/** The root menu's close(), for content that isn't a MenuItem (pickers, inputs). */
export function useMenuClose(): () => void {
  return useContext(RootMenuCtx)?.close ?? (() => {});
}

/** A small heading inside a menu (Sheets groups long menus this way). */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>;
}
export function MenuSep() {
  return <div role="separator" className="my-1 border-t border-border" />;
}

export function MenuItem({
  children, onClick, active, checked, hint, shortcut, icon, danger, disabled, submenu, badge, isNew, title, style,
}: {
  children: ReactNode;
  onClick?: () => void;
  /** Show a tick (same as `checked`). */
  active?: boolean;
  checked?: boolean;
  /** A right-aligned grey example ("1.000,12"). */
  hint?: string;
  /** A right-aligned keyboard shortcut ("Ctrl+B"). */
  shortcut?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Content of a nested panel that opens to the right; `close` closes the whole menu. */
  submenu?: (close: () => void) => ReactNode;
  /** A small pill after the label (e.g. "Beta"). */
  badge?: ReactNode;
  /** Shorthand for the "New" badge. */
  isNew?: boolean;
  title?: string;
  /** Inline style for the label (e.g. a font name shown in its own face). */
  style?: CSSProperties;
}) {
  const { t } = useLang();
  const key = useId();
  const level = useContext(LevelMenuCtx);
  const root = useContext(RootMenuCtx);
  const ref = useRef<HTMLButtonElement>(null);
  const open = Boolean(submenu) && level?.openKey === key;
  const ticked = active ?? checked;
  const pill = badge ?? (isNew ? t("New") : null);
  const closeAll = root?.close ?? (() => {});
  return (
    <>
      <button
        ref={ref}
        type="button"
        role={ticked === undefined || submenu ? "menuitem" : "menuitemcheckbox"}
        title={title}
        aria-haspopup={submenu ? "menu" : undefined}
        aria-expanded={submenu ? open : undefined}
        aria-checked={ticked === undefined || submenu ? undefined : ticked}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => level?.hover(submenu ? key : null)}
        onClick={() => {
          if (submenu) { level?.hold(key); return; }
          onClick?.();
        }}
        onKeyDown={(e) => {
          if (submenu && (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            e.stopPropagation();
            level?.hold(key);
          }
        }}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors outline-none disabled:opacity-40",
          danger ? "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10" : "hover:bg-muted focus-visible:bg-muted",
          open && "bg-muted",
        )}
      >
        <span className="grid w-3.5 shrink-0 place-items-center text-muted-foreground">
          {ticked ? <Check className="h-3.5 w-3.5 text-foreground" /> : icon}
        </span>
        <span className="min-w-0 flex-1 truncate" style={style}>{children}</span>
        {pill && <span className="shrink-0 rounded-full bg-info/15 px-1.5 text-[10px] font-semibold leading-4 text-info">{pill}</span>}
        {hint && <span className="shrink-0 pl-3 text-2xs text-muted-foreground tabular-nums">{hint}</span>}
        {shortcut && <span className="shrink-0 pl-4 text-2xs text-muted-foreground">{shortcut}</span>}
        {submenu && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>
      {open && submenu && ref.current && (
        <SubPanel anchorEl={ref.current} onEnter={() => level?.hold(key)} onBack={() => { level?.shut(); ref.current?.focus({ preventScroll: true }); }}>
          {submenu(closeAll)}
        </SubPanel>
      )}
    </>
  );
}

/** A submenu: placed right of its item (flipped left when there's no room), level of its own. */
function SubPanel({ anchorEl, children, onEnter, onBack }: { anchorEl: HTMLElement; children: ReactNode; onEnter: () => void; onBack: () => void }) {
  const r = anchorEl.getBoundingClientRect();
  // Floating opens below-left of `rect`: give it the item's right edge as "left" and its top as
  // "bottom", and its left edge as "right" so a flip lands on the item's left side.
  const anchor = { rect: { left: r.right - 2, right: r.left + 2, top: r.top + 4, bottom: r.top - 8 } };
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Opened by keyboard (focus is on the parent item): focus the first item of the submenu.
    if (document.activeElement !== anchorEl) return;
    const id = window.requestAnimationFrame(() => {
      host.current?.parentElement?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [anchorEl]);
  return createPortal(
    <MenuPanel
      anchor={anchor}
      onMouseEnter={onEnter}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); onBack(); }
      }}
    >
      <div ref={host} className="contents" />
      {children}
    </MenuPanel>,
    document.body,
  );
}
