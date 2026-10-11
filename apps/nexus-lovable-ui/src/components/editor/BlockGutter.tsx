import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Copy, GripVertical, Link2, Paintbrush, Plus, Repeat2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import {
  BLOCK_COLORS, TURN_TARGETS, blockAt, canTurn, copyBlockLink, deleteBlock, duplicateBlock, moveBlock, setBlockColor, turnInto, typeLabel,
} from "./block-actions";

type Target = { node: PMNode; pos: number };

/** "+" and "⋮⋮" to the left of the hovered block (Notion's gutter): add below, drag, or open the block menu. */
export function BlockGutter({ editor }: { editor: Editor }) {
  const { t } = useLang();
  const hover = useRef<Target | null>(null);
  const [menu, setMenu] = useState<{ target: Target; rect: DOMRect } | null>(null);
  const menuOpen = useRef(false);
  menuOpen.current = !!menu;

  const addBelow = () => {
    const h = hover.current;
    if (!h) return;
    const node = blockAt(editor, h.pos);
    if (!node) return;
    if (node.type.name === "paragraph" && node.content.size === 0) {
      editor.chain().focus().setTextSelection(h.pos + 1).insertContent("/").run();
      return;
    }
    const end = h.pos + node.nodeSize;
    editor.chain().focus().insertContentAt(end, { type: "paragraph", content: [{ type: "text", text: "/" }] }).setTextSelection(end + 2).run();
  };

  const openMenu = (el: HTMLElement) => {
    const h = hover.current;
    if (!h) return;
    const node = blockAt(editor, h.pos);
    if (!node) return;
    editor.commands.lockDragHandle();
    // Select the block, as Notion highlights it while its menu is open.
    if (node.isAtom) editor.commands.setNodeSelection(h.pos);
    setMenu({ target: { node, pos: h.pos }, rect: el.getBoundingClientRect() });
  };

  const close = () => {
    setMenu(null);
    editor.commands.unlockDragHandle();
  };

  return (
    <>
      <DragHandle editor={editor} className="nx-gutter" onNodeChange={({ node, pos }) => { if (!menuOpen.current) hover.current = node ? { node, pos } : null; }}>
        <div className="flex items-center gap-0.5">
          <button type="button" className="nx-gutter-btn" onClick={addBelow} aria-label={t("Add a block below")} title={t("Click to add below")}>
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className="nx-gutter-btn cursor-grab active:cursor-grabbing" onClick={(e) => openMenu(e.currentTarget)} aria-label={t("Drag to move, click for the block menu")} title={t("Drag to move · Click to open menu")}>
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
      </DragHandle>
      {menu && <BlockMenu editor={editor} target={menu.target} anchor={menu.rect} onClose={close} />}
    </>
  );
}

type Action = { id: string; label: string; icon?: typeof Copy; hint?: string; run: () => void; danger?: boolean; swatch?: string };

/** The block menu: Turn into, Color, Copy link, Duplicate, Move up/down, Delete — searchable, keyboard-driven. */
export function BlockMenu({ editor, target, anchor, onClose }: { editor: Editor; target: Target; anchor: DOMRect; onClose: () => void }) {
  const { t } = useLang();
  const [view, setView] = useState<"main" | "turn" | "color">("main");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const node = target.node;
  const pos = target.pos;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl";

  const done = (fn: () => void) => () => { fn(); onClose(); };

  const turnActions: Action[] = TURN_TARGETS.map((x) => ({ id: `turn-${x.id}`, label: t(x.label), run: done(() => turnInto(editor, pos, x.id)) }));
  const colorActions: Action[] = [
    { id: "color-default", label: t("Default"), swatch: "default", run: done(() => setBlockColor(editor, pos, null)) },
    ...BLOCK_COLORS.map((c) => ({ id: `color-${c}`, label: t(c[0].toUpperCase() + c.slice(1)), swatch: c, run: done(() => setBlockColor(editor, pos, c)) })),
    ...BLOCK_COLORS.map((c) => ({ id: `bg-${c}`, label: t("{color} background", { color: t(c[0].toUpperCase() + c.slice(1)) }), swatch: `${c}_bg`, run: done(() => setBlockColor(editor, pos, `${c}_bg`)) })),
  ];
  const mainActions: Action[] = [
    ...(canTurn(node) ? [{ id: "turn", label: t("Turn into"), icon: Repeat2, run: () => { setView("turn"); setIndex(0); } }] : []),
    ...("blockColor" in node.attrs ? [{ id: "color", label: t("Color"), icon: Paintbrush, run: () => { setView("color"); setIndex(0); } }] : []),
    { id: "link", label: t("Copy link to block"), icon: Link2, run: done(() => { void copyBlockLink(editor, pos).then((url) => { if (url) toast.success(t("Link to block copied")); }); }) },
    { id: "dup", label: t("Duplicate"), icon: Copy, hint: `${mod}+D`, run: done(() => duplicateBlock(editor, pos)) },
    { id: "up", label: t("Move up"), icon: ArrowUp, hint: `${mod}+⇧+↑`, run: done(() => { moveBlock(editor, pos, -1); }) },
    { id: "down", label: t("Move down"), icon: ArrowDown, hint: `${mod}+⇧+↓`, run: done(() => { moveBlock(editor, pos, 1); }) },
    { id: "delete", label: t("Delete"), icon: Trash2, hint: "Del", danger: true, run: done(() => deleteBlock(editor, pos)) },
  ];

  const q = query.trim().toLowerCase();
  const list: Action[] = useMemo(() => {
    if (q) {
      const all = [
        ...mainActions.filter((a) => a.id !== "turn" && a.id !== "color"),
        ...(canTurn(node) ? turnActions.map((a) => ({ ...a, label: `${t("Turn into")} · ${a.label}` })) : []),
        ...("blockColor" in node.attrs ? colorActions.map((a) => ({ ...a, label: `${t("Color")} · ${a.label}` })) : []),
      ];
      return all.filter((a) => a.label.toLowerCase().includes(q));
    }
    return view === "turn" ? turnActions : view === "color" ? colorActions : mainActions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, view, t]);

  useEffect(() => { input.current?.focus(); }, [view]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (panel.current && !panel.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  const [style, setStyle] = useState<{ top: number; left: number }>({ top: anchor.bottom + 4, left: anchor.left });
  useLayoutEffect(() => {
    const h = panel.current?.offsetHeight ?? 360;
    const w = panel.current?.offsetWidth ?? 260;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    let left = anchor.left - w - 6;
    if (left < 8) left = Math.min(anchor.right + 6, window.innerWidth - w - 8);
    let top = anchor.top - 8;
    if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    setStyle({ top, left: Math.max(8, left) });
  }, [anchor, view]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (list.length ? (i + 1) % list.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (list.length ? (i - 1 + list.length) % list.length : 0)); }
    else if (e.key === "Enter") { e.preventDefault(); list[index]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); if (view !== "main" && !q) { setView("main"); setIndex(0); } else onClose(); }
    else if ((e.key === "ArrowLeft" || e.key === "Backspace") && view !== "main" && !query) { e.preventDefault(); setView("main"); setIndex(0); }
  };

  return createPortal(
    <div ref={panel} className="nx-menu fixed z-[130] w-64 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-pop" style={style} role="menu" aria-label={t("Block menu")}>
      <div className="border-b border-border p-1.5">
        <input
          ref={input}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={onKey}
          placeholder={t("Search actions…")}
          className="w-full rounded-md border border-transparent bg-muted/60 px-2 py-1 text-sm outline-none focus:border-primary/40"
        />
      </div>
      <div className="max-h-[min(60vh,360px)] overflow-y-auto p-1">
        {!q && (
          <div className="flex items-center gap-1 px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">
            {view !== "main" && (
              <button type="button" onClick={() => { setView("main"); setIndex(0); }} className="-ml-1 rounded p-0.5 hover:bg-muted" aria-label={t("Back")}><ArrowLeft className="h-3.5 w-3.5" /></button>
            )}
            {view === "main" ? t(typeLabel(node)) : view === "turn" ? t("Turn into") : t("Color")}
          </div>
        )}
        {list.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">{t("No results")}</div>}
        {list.map((a, i) => {
          const Icon = a.icon;
          const sub = a.id === "turn" || a.id === "color";
          return (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              onMouseEnter={() => setIndex(i)}
              onClick={a.run}
              className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm", i === index ? "bg-muted" : "hover:bg-muted/60", a.danger && "text-destructive")}
            >
              {a.swatch ? <span className="nx-swatch" data-swatch={a.swatch}>A</span> : Icon ? <Icon className="h-4 w-4 shrink-0 opacity-70" /> : <span className="w-4" />}
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              {a.hint && <span className="shrink-0 text-[11px] text-muted-foreground">{a.hint}</span>}
              {sub && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
