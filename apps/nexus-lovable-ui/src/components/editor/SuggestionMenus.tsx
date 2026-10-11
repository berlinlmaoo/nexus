import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bell, CalendarDays, CheckSquare, FileText, FolderKanban } from "lucide-react";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { AvatarFace } from "@/components/Avatar";
import { useMenu, type MenuStore } from "./menu-store";
import { SLASH_GROUPS, type SlashItem } from "./slash-items";
import type { MentionItem } from "./extensions";

const MENU_W = 320;

/** Fixed position under (or above) the caret, kept inside the viewport. */
function usePlacement(rect: DOMRect | null, open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !rect) { setPos(null); return; }
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const w = Math.min(MENU_W, vw - 16);
    const below = vh - rect.bottom - 12;
    const above = rect.top - 12;
    const wantH = Math.min(380, ref.current?.scrollHeight ?? 380);
    const placeBelow = below >= Math.min(wantH, 240) || below >= above;
    const maxH = Math.max(160, Math.min(380, placeBelow ? below : above));
    const top = placeBelow ? rect.bottom + 6 : Math.max(8, rect.top - 6 - Math.min(wantH, maxH));
    const left = Math.min(Math.max(8, rect.left), vw - w - 8);
    setPos({ top, left, maxH });
  }, [rect, open]);
  return { ref, pos };
}

function Shell({ open, rect, children, label }: { open: boolean; rect: DOMRect | null; children: ReactNode; label: string }) {
  const { ref, pos } = usePlacement(rect, open);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      className="nx-menu fixed z-[130] flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-pop"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: Math.min(MENU_W, typeof window !== "undefined" ? window.innerWidth - 16 : MENU_W), maxHeight: pos?.maxH ?? 380 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

function useScrollActive(index: number) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);
  return list;
}

export function SlashMenu({ store }: { store: MenuStore<SlashItem> }) {
  const { t } = useLang();
  const s = useMenu(store);
  const list = useScrollActive(s.index);
  const filtering = s.query.trim().length > 0;
  const row = (item: SlashItem, i: number) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        role="option"
        aria-selected={i === s.index}
        data-index={i}
        onMouseEnter={() => store.set({ index: i })}
        onClick={() => s.pick?.(item)}
        className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors", i === s.index ? "bg-muted" : "hover:bg-muted/60")}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {t(item.label)}
          {filtering && <span className="text-muted-foreground"> · {t(item.group)}</span>}
        </span>
        {item.hint && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.hint}</span>}
      </button>
    );
  };
  return (
    <Shell open={s.open} rect={s.rect} label={t("Insert a block")}>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1">
        {s.items.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">{t("No results")}</div>}
        {filtering ? (
          s.items.length > 0 && (
            <>
              <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">{t("Filtered results")}</div>
              {s.items.map(row)}
            </>
          )
        ) : (
          SLASH_GROUPS.map((g) => {
            const items = s.items.map((item, i) => ({ item, i })).filter((x) => x.item.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{t(g)}</div>
                {items.map((x) => row(x.item, x.i))}
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>{t("↑↓ to move, Enter to insert")}</span>
        <button type="button" onClick={() => store.set({ open: false })} className="hover:text-foreground">{t("Close")} <span className="font-mono">esc</span></button>
      </div>
    </Shell>
  );
}

const KIND_LABEL: Record<string, string> = { user: "People", task: "Tasks", doc: "Docs", project: "Projects", date: "Date" };

export function MentionMenu({ store }: { store: MenuStore<MentionItem> }) {
  const { t } = useLang();
  const s = useMenu(store);
  const list = useScrollActive(s.index);
  let lastKind = "";
  return (
    <Shell open={s.open} rect={s.rect} label={t("Mention")}>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1">
        {s.items.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">{s.query ? t("No matches for “{q}”", { q: s.query }) : t("Type a name, task, doc or project")}</div>}
        {s.items.map((item, i) => {
          const header = item.kind !== lastKind ? <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{t(KIND_LABEL[item.kind] ?? item.kind)}</div> : null;
          lastKind = item.kind;
          let icon: ReactNode;
          if (item.kind === "user") icon = <AvatarFace name={item.label} avatar={item.avatar ?? null} seed={item.id} size={20} decorative />;
          else if (item.kind === "task") icon = <CheckSquare className="h-4 w-4 text-muted-foreground" />;
          else if (item.kind === "doc") icon = <FileText className="h-4 w-4 text-muted-foreground" />;
          else if (item.kind === "project") icon = <FolderKanban className="h-4 w-4" style={{ color: item.color ?? undefined }} />;
          else icon = "remind" in item && item.remind ? <Bell className="h-4 w-4 text-muted-foreground" /> : <CalendarDays className="h-4 w-4 text-muted-foreground" />;
          return (
            <div key={`${item.kind}:${item.id}`}>
              {header}
              <button
                type="button"
                role="option"
                aria-selected={i === s.index}
                data-index={i}
                onMouseEnter={() => store.set({ index: i })}
                onClick={() => s.pick?.(item)}
                className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors", i === s.index ? "bg-muted" : "hover:bg-muted/60")}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center">{icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {"sub" in item && item.sub && <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{item.sub}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
