import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, CopyPlus, Menu as MenuIcon, Palette, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { NexusSheetColumnColor } from "@/lib/nexus-api";
import { COLUMN_COLOR_LABEL } from "./sheet-types";
import { MenuItem } from "./SheetToolbar";

export type SheetTab = { id: string; name: string; position: number; tabColor?: NexusSheetColumnColor | null };

/** Tab underline colours (the six header tints). */
const TAB_COLOR: Record<NexusSheetColumnColor, string> = {
  rose: "bg-rose-500", amber: "bg-amber-400", green: "bg-emerald-500", blue: "bg-sky-500", violet: "bg-violet-500", slate: "bg-slate-400",
};

/**
 * Sheet tabs at the bottom, like Sheets: "+" adds a sheet, "≡" lists every sheet, a tab's right-click
 * (or its caret) renames, duplicates, colours, moves or deletes it. Double-click renames in place.
 * The first tab is the project's default sheet and can't be deleted (the server refuses too).
 */
export function SheetTabs({ sheets, activeId, canEdit, canManage, onSelect, onAdd, onRename, onDuplicate, onDelete, onColor, onMove }: {
  sheets: SheetTab[];
  activeId: string | null;
  canEdit: boolean;
  canManage: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onColor: (id: string, color: NexusSheetColumnColor | null) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const { t } = useLang();
  const [menu, setMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const [list, setList] = useState<{ left: number; top: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [activeId]);

  const openMenu = (id: string, at: { left: number; top: number }) => setMenu({ id, ...at });
  const tab = menu ? sheets.find((s) => s.id === menu.id) : null;
  const index = tab ? sheets.indexOf(tab) : -1;

  return (
    <div className="flex min-w-0 items-center gap-1">
      {canEdit && (
        <button onClick={onAdd} title={t("Add sheet")} aria-label={t("Add sheet")}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground">
          <Plus className="h-4 w-4" />
        </button>
      )}
      <button
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setList(list ? null : { left: r.left, top: r.top }); }}
        title={t("All sheets")} aria-label={t("All sheets")}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground"
      >
        <MenuIcon className="h-4 w-4" />
      </button>
      <div role="tablist" aria-label={t("Sheets")} className="flex min-w-0 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {sheets.map((s) => {
          const active = s.id === activeId;
          return (
            <div
              key={s.id}
              ref={active ? activeRef : undefined}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(s.id); } }}
              onDoubleClick={() => canEdit && setRenaming(s.id)}
              onContextMenu={(e) => { e.preventDefault(); if (canEdit) openMenu(s.id, { left: e.clientX, top: e.clientY }); }}
              className={cn(
                "group relative flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-3 text-xs transition-colors",
                active ? "bg-card font-semibold text-foreground shadow-soft" : "text-muted-foreground hover:bg-background hover:text-foreground",
              )}
            >
              {renaming === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.name}
                  maxLength={80}
                  aria-label={t("Sheet name")}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) onRename(s.id, v); setRenaming(null); }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-28 rounded border border-ring bg-background px-1 text-xs outline-none"
                />
              ) : (
                <span className="max-w-[160px] truncate">{s.name}</span>
              )}
              {canEdit && active && renaming !== s.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu(s.id, { left: r.left, top: r.top }); }}
                  aria-label={t("Sheet menu")}
                  className="-mr-1 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <svg viewBox="0 0 10 6" className="h-1.5 w-2.5" aria-hidden><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              )}
              {s.tabColor && <span aria-hidden className={cn("absolute inset-x-2 bottom-0 h-[3px] rounded-full", TAB_COLOR[s.tabColor])} />}
            </div>
          );
        })}
      </div>

      {/* All sheets */}
      {list && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setList(null)} />
          <div role="menu" style={{ left: list.left, top: Math.max(8, list.top - Math.min(320, 34 * sheets.length + 12)) }}
            className="fixed z-[61] max-h-80 w-56 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-pop">
            {sheets.map((s) => (
              <MenuItem key={s.id} active={s.id === activeId} onClick={() => { onSelect(s.id); setList(null); }}>
                <span className="flex items-center gap-2">
                  {s.tabColor && <span className={cn("h-2 w-2 rounded-full", TAB_COLOR[s.tabColor])} />}
                  {s.name}
                </span>
              </MenuItem>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* One tab's menu */}
      {menu && tab && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div role="menu" style={{ left: Math.min(menu.left, window.innerWidth - 230), top: Math.max(8, menu.top - 290) }}
            className="fixed z-[61] w-56 rounded-xl border border-border bg-popover py-1 shadow-pop">
            <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setRenaming(tab.id); setMenu(null); }}>{t("Rename")}</MenuItem>
            <MenuItem icon={<CopyPlus className="h-3.5 w-3.5" />} onClick={() => { onDuplicate(tab.id); setMenu(null); }}>{t("Duplicate")}</MenuItem>
            <div className="px-3 py-1.5">
              <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><Palette className="h-3.5 w-3.5" /> {t("Tab colour")}</div>
              <div className="flex flex-wrap gap-1.5 pl-5">
                {(Object.keys(TAB_COLOR) as NexusSheetColumnColor[]).map((c) => (
                  <button key={c} title={t(COLUMN_COLOR_LABEL[c])} aria-label={t(COLUMN_COLOR_LABEL[c])}
                    onClick={() => { onColor(tab.id, c); setMenu(null); }}
                    className={cn("grid h-5 w-5 place-items-center rounded-full", TAB_COLOR[c])}>
                    {tab.tabColor === c && <Check className="h-3 w-3 text-white" />}
                  </button>
                ))}
                <button onClick={() => { onColor(tab.id, null); setMenu(null); }}
                  className="rounded-full border border-dashed border-border px-1.5 text-2xs text-muted-foreground hover:text-foreground">{t("None")}</button>
              </div>
            </div>
            <MenuItem icon={<ArrowLeft className="h-3.5 w-3.5" />} disabled={index <= 0} onClick={() => { onMove(tab.id, -1); setMenu(null); }}>{t("Move left")}</MenuItem>
            <MenuItem icon={<ArrowRight className="h-3.5 w-3.5" />} disabled={index >= sheets.length - 1} onClick={() => { onMove(tab.id, 1); setMenu(null); }}>{t("Move right")}</MenuItem>
            {canManage && sheets.length > 1 && index > 0 && (
              <>
                <div className="my-1 border-t border-border" />
                <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { onDelete(tab.id); setMenu(null); }}>{t("Delete")}</MenuItem>
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
