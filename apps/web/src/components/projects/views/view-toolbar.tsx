import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Lock, Plus, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import type { NexusProjectView } from "@/lib/nexus-api";
import { menuItemCls } from "./view-controls";
import { ViewTabMenu } from "./view-settings";
import { useProjectCanEdit } from "@/components/projects/project-access";

export type ToolbarTab = {
  key: string;
  label: string;
  icon: typeof Search;
  /** A saved view (draggable, renamable); absent for the project's other tabs (Overview, Chat, …). */
  view?: NexusProjectView;
  /** Icon only unless active (the project's other tabs after the views, to leave room for the tools). */
  compact?: boolean;
};

/**
 * The one toolbar row of a project (owner, 12 Oct 2026): view tabs on the left, the view's tools on the
 * right. Tabs are Notion's quiet pills; the active one carries a small menu. Saved views can be dragged
 * to reorder (shared ones by project members only).
 */
export function ViewTabsBar({ tabs, activeKey, onSelect, canEditView, onReorder, onRename, onSettings, onDuplicate, onCopyLink, onDelete, onHide, addView, divideAfter }: {
  tabs: ToolbarTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  canEditView: (v: NexusProjectView) => boolean;
  onReorder: (viewIds: string[]) => void;
  onRename: (v: NexusProjectView, name: string | null) => void;
  onSettings: () => void;
  onDuplicate: (v: NexusProjectView) => void;
  onCopyLink: (v: NexusProjectView) => void;
  onDelete: (v: NexusProjectView) => void;
  onHide: (v: NexusProjectView) => void;
  addView?: ReactNode;
  /** Draw a hairline before this tab key (between the views and the project's other tabs). */
  divideAfter?: string | null;
}) {
  const { t } = useLang();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // The active tab is brought into view with room on both sides (scroll-padding), never flush against a cut
  // edge (UI tour run 11, WM-15: the leading tab sat half under the fade on a phone).
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>("[data-active-tab='true']");
    if (!box || !el) return;
    const pad = 36;
    const l = el.offsetLeft - pad, r = el.offsetLeft + el.offsetWidth + pad;
    if (l < box.scrollLeft) box.scrollLeft = Math.max(0, l);
    else if (r > box.scrollLeft + box.clientWidth) box.scrollLeft = r - box.clientWidth;
  }, [activeKey]);
  // Tabs that don't fit scroll sideways. The cut edge gets an arrow on a solid fade (UI tour run 11, WD-13/WM-15):
  // a see-through mask alone left a half-visible ghost icon there, which read as a broken button.
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = () => setEdges((e) => {
      const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      return e.left === left && e.right === right ? e : { left, right };
    });
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", read); ro.disconnect(); };
  }, [tabs.length]);
  const nudge = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * Math.max(140, (scroller.current?.clientWidth ?? 0) * 0.6), behavior: "smooth" });
  const edgeBtn = "absolute inset-y-0 z-10 flex w-9 items-center text-muted-foreground transition-colors hover:text-foreground";
  const viewIds = tabs.filter((x) => x.view).map((x) => x.view!.id);
  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const order = viewIds.filter((id) => id !== dragId);
    order.splice(order.indexOf(targetId), 0, dragId);
    onReorder(order);
  };
  // `relative` makes this scroller the containing block of the compact tabs' sr-only labels (position:absolute);
  // without it they escaped to the sticky header and stretched the phone page to ~720px (audit 12 Oct 2026).
  return (
    <div className="relative flex min-w-0 flex-1">
    {edges.left && (
      <button type="button" tabIndex={-1} aria-label={t("Show earlier tabs")} onClick={() => nudge(-1)} className={cn(edgeBtn, "left-0 justify-start bg-gradient-to-r from-card from-60% to-transparent")}><ChevronLeft className="h-4 w-4" /></button>
    )}
    {edges.right && (
      <button type="button" tabIndex={-1} aria-label={t("Show more tabs")} onClick={() => nudge(1)} className={cn(edgeBtn, "right-0 justify-end bg-gradient-to-l from-card from-60% to-transparent")}><ChevronRight className="h-4 w-4" /></button>
    )}
    <div ref={scroller} role="tablist" aria-label={t("Views")} className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const v = tab.view;
        const editable = v ? canEditView(v) : false;
        return (
          <div key={tab.key} className="flex shrink-0 items-center">
            <div
              role="tab"
              aria-selected={active}
              tabIndex={0}
              data-active-tab={active}
              draggable={!!v && editable && renaming !== v.id}
              onDragStart={(e) => { if (!v) return; setDragId(v.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (v && dragId) { e.preventDefault(); setOverId(v.id); } }}
              onDragLeave={() => setOverId((x) => (x === v?.id ? null : x))}
              onDrop={(e) => { e.preventDefault(); if (v) drop(v.id); setDragId(null); setOverId(null); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onClick={() => !active && onSelect(tab.key)}
              title={tab.compact ? tab.label : undefined}
              onDoubleClick={() => v && editable && setRenaming(v.id)}
              // Keys typed in the rename field inside the tab are the field's (a space in a name, C-BUG-10).
              onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(tab.key); } }}
              className={cn(
                "group inline-flex h-8 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-foreground)]/30",
                active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                dragId === v?.id && "opacity-40",
                overId === v?.id && dragId !== v?.id && "ring-1 ring-[color:var(--accent-foreground)]/50",
              )}
            >
              <tab.icon className="h-3.5 w-3.5 shrink-0" />
              {v && renaming === v.id ? (
                <RenameInput initial={tab.label} onDone={(name) => { setRenaming(null); if (name !== null && name.trim() && name.trim() !== tab.label) onRename(v, name.trim()); }} />
              ) : (
                <span className={cn("max-w-48 truncate", tab.compact && !active && "sr-only")}>{tab.label}</span>
              )}
              {v && !v.shared && <Lock className="h-3 w-3 shrink-0 opacity-60" aria-label={t("Only you see this view")} />}
              {v && active && (
                <ViewTabMenu
                  view={v}
                  canEdit={editable}
                  onRename={() => setRenaming(v.id)}
                  onSettings={onSettings}
                  onDuplicate={() => onDuplicate(v)}
                  onCopyLink={() => onCopyLink(v)}
                  onDelete={() => onDelete(v)}
                  onHide={() => onHide(v)}
                />
              )}
            </div>
            {divideAfter === tab.key && (
              <>
                {addView}
                <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-border" />
              </>
            )}
          </div>
        );
      })}
      {!divideAfter && addView}
    </div>
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(v.trim())}
      onKeyDown={(e) => { if (e.key === "Enter") onDone(v.trim()); if (e.key === "Escape") onDone(null); }}
      className="h-6 w-32 rounded border border-[color:var(--accent-foreground)] bg-card px-1 text-sm outline-none"
    />
  );
}

/** The toolbar's search: an icon that opens into a field (Notion), kept in the address as `q`. */
export function ToolbarSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(!!value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open && !value) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label={t("Search")} title={t("Search")} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <Search className="h-4 w-4" />
      </button>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { if (!value) setOpen(false); }}
        onKeyDown={(e) => { if (e.key === "Escape") { onChange(""); setOpen(false); } }}
        placeholder={t("Search tasks…")}
        aria-label={t("Search tasks")}
        className="h-8 w-40 rounded-md border border-border bg-card pl-7 pr-7 text-sm outline-none transition-colors focus:border-[color:var(--accent-foreground)] sm:w-52"
      />
      {value && (
        <button type="button" onClick={() => { onChange(""); setOpen(false); }} aria-label={t("Clear search")} className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
}

/** "Add task ▾": the main part adds to the first section, the arrow picks the section (or a template). */
export function AddTaskSplit({ sections, onAdd, extra }: { sections: Array<{ id: string; name: string }>; onAdd: (sectionId?: string) => void; extra?: ReactNode }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  // Can view / Can comment: no Add task (QA round 2, N-02).
  if (!useProjectCanEdit()) return null;
  return (
    <div className="inline-flex h-8 shrink-0 items-stretch overflow-hidden rounded-md bg-primary text-primary-foreground">
      <button type="button" onClick={() => onAdd()} className="inline-flex items-center gap-1.5 pl-2.5 pr-2 text-sm font-medium transition-colors hover:bg-white/10">
        <Plus className="h-4 w-4" /><span>{t("Add task")}</span>
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("More ways to add")} className="grid w-7 place-items-center border-l border-white/20 transition-colors hover:bg-white/10"><ChevronDown className="h-3.5 w-3.5" /></button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-1">
          <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">{t("Add a task to")}</div>
          <div className="max-h-64 overflow-y-auto">
            {sections.map((s) => (
              <button key={s.id} type="button" onClick={() => { setOpen(false); onAdd(s.id); }} className={menuItemCls}><Plus className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{s.name}</span></button>
            ))}
          </div>
          {extra && <div className="mt-1 border-t border-border pt-1" onClick={() => setOpen(false)}>{extra}</div>}
        </PopoverContent>
      </Popover>
    </div>
  );
}
