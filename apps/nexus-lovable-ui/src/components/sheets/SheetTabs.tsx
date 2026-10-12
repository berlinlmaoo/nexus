import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Menu as MenuIcon, Plus, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { ColorPicker } from "./ColorPicker";
import { MenuPopup, SEP, tidy, type MenuNode } from "./sheet-menus";
import { SheetDialog, primaryBtn, secondaryBtn } from "./sheet-shell";
import { toHex } from "@/lib/sheet-palette";

export type SheetTab = { id: string; name: string; position: number; tabColor?: string | null; hidden?: boolean; pivot?: boolean };

/**
 * Sheet bar at the bottom, like Sheets: "+" adds a sheet, "≡" lists every sheet (hidden ones greyed,
 * the active one ticked), and a tab's right-click or caret opens Sheets' tab menu in Sheets' order:
 * Delete · Duplicate · Rename · Change colour ▸ · Protect sheet · Hide sheet · View comments · Move
 * right · Move left. Double-click renames in place. The first tab is the project's default sheet and
 * can't be deleted (the server refuses too); a hidden sheet comes back from View › Hidden sheets.
 */
export function SheetTabs({ sheets, activeId, canEdit, canManage, onSelect, onAdd, onRename, onDuplicate, onDelete, onColor, onMove, onHide, onProtect, onComments }: {
  sheets: SheetTab[];
  activeId: string | null;
  canEdit: boolean;
  canManage: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onColor: (id: string, color: string | null) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onHide: (id: string, hidden: boolean) => void;
  onProtect: (id: string) => void;
  onComments: (id: string) => void;
}) {
  const { t } = useLang();
  const [menu, setMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const [list, setList] = useState<{ left: number; top: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [cantDelete, setCantDelete] = useState<string | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [activeId]);

  const visible = sheets.filter((s) => !s.hidden || s.id === activeId);
  const shownCount = sheets.filter((s) => !s.hidden).length;
  const tab = menu ? sheets.find((s) => s.id === menu.id) : null;
  const index = tab ? visible.indexOf(tab) : -1;

  const tabMenu = (s: SheetTab): MenuNode[] => tidy([
    // The first tab is the project's main sheet (the server refuses to delete it). The item stays
    // clickable so it can SAY why, instead of just being grey (bughunt S-BUG-19).
    {
      id: "tab-delete", label: "Delete", disabled: !canManage,
      run: () => {
        if (sheets.length < 2) setCantDelete(t("A spreadsheet needs at least one sheet. Add another sheet first."));
        else if (s.position === 0) setCantDelete(t("This is the project's main sheet, so it can't be deleted. Move another sheet to the first position if you want to delete this one."));
        else setConfirmDelete(s.id);
      },
    },
    { id: "tab-dup", label: "Duplicate", disabled: !canEdit, run: () => onDuplicate(s.id) },
    { id: "tab-rename", label: "Rename", disabled: !canEdit, run: () => setRenaming(s.id) },
    {
      id: "tab-colour", label: "Change colour", disabled: !canEdit,
      panel: (close) => <ColorPicker value={s.tabColor ? toHex(s.tabColor) ?? undefined : undefined} onPick={(c) => { onColor(s.id, c); close(); }} />,
    },
    { id: "tab-protect", label: "Protect sheet", disabled: !canEdit, run: () => onProtect(s.id) },
    { id: "tab-hide", label: "Hide sheet", disabled: !canEdit || shownCount < 2, run: () => onHide(s.id, true) },
    { id: "tab-comments", label: "View comments", run: () => onComments(s.id) },
    SEP,
    { id: "tab-right", label: "Move right", disabled: !canEdit || index < 0 || index >= visible.length - 1, run: () => onMove(s.id, 1) },
    { id: "tab-left", label: "Move left", disabled: !canEdit || index <= 0, run: () => onMove(s.id, -1) },
  ]);

  const allSheets: MenuNode[] = sheets.map((s) => ({
    id: `all-${s.id}`, label: "{name}", vars: { name: s.name }, checked: s.id === activeId,
    icon: s.tabColor ? <span className="h-2 w-2 rounded-full" style={{ background: toHex(s.tabColor) ?? undefined }} /> : undefined,
    style: s.hidden ? { opacity: 0.55 } : undefined,
    run: () => { if (s.hidden && canEdit) onHide(s.id, false); onSelect(s.id); },
  }));

  const scroll = (dx: number) => stripRef.current?.scrollBy({ left: dx, behavior: "smooth" });

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
      <div ref={stripRef} role="tablist" aria-label={t("Sheets")} className="flex min-w-0 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {visible.map((s) => {
          const active = s.id === activeId;
          const color = s.tabColor ? toHex(s.tabColor) : null;
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
              onContextMenu={(e) => { e.preventDefault(); setMenu({ id: s.id, left: e.clientX, top: e.clientY }); }}
              className={cn(
                "group relative flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-3 text-xs transition-colors",
                active ? "bg-card font-semibold text-foreground shadow-soft" : "text-muted-foreground hover:bg-background hover:text-foreground",
              )}
            >
              {s.pivot && <Table2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
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
              {active && renaming !== s.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ id: s.id, left: r.left, top: r.top }); }}
                  aria-label={t("Sheet menu")}
                  className="-mr-1 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <svg viewBox="0 0 10 6" className="h-1.5 w-2.5" aria-hidden><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              )}
              {color && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] rounded-full" style={{ background: color }} />}
            </div>
          );
        })}
      </div>
      <button onClick={() => scroll(-160)} aria-label={t("Scroll sheets left")} className="hidden h-7 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground sm:grid"><ChevronLeft className="h-3.5 w-3.5" /></button>
      <button onClick={() => scroll(160)} aria-label={t("Scroll sheets right")} className="hidden h-7 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground sm:grid"><ChevronRight className="h-3.5 w-3.5" /></button>

      {list && <MenuPopup nodes={allSheets} anchor={{ x: list.left, y: list.top }} onClose={() => setList(null)} />}
      {menu && tab && <MenuPopup nodes={tabMenu(tab)} anchor={{ x: menu.left, y: menu.top }} onClose={() => setMenu(null)} width={220} />}

      {cantDelete && (
        <SheetDialog title={t("Can't delete this sheet")} onClose={() => setCantDelete(null)} footer={<button className={primaryBtn} onClick={() => setCantDelete(null)}>{t("OK")}</button>}>
          <p className="text-sm">{cantDelete}</p>
        </SheetDialog>
      )}
      {confirmDelete && (
        <SheetDialog
          title={t("Heads up!")}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className={secondaryBtn} onClick={() => setConfirmDelete(null)}>{t("Cancel")}</button>
              <button className={primaryBtn} onClick={() => { const id = confirmDelete; setConfirmDelete(null); onDelete(id); }}>{t("OK")}</button>
            </>
          }
        >
          <p className="text-sm">{t("Are you sure you want to delete this sheet?")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("Its rows can be restored from Audit.")}</p>
        </SheetDialog>
      )}
    </div>
  );
}
