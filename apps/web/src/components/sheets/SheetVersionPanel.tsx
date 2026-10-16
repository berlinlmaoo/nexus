import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Loader2, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { NexusSheetRevision } from "@/lib/nexus-api";
import type { NamedVersion } from "@/lib/sheet-model";
import { groupVersions, type VersionEntry } from "@/lib/sheet-versions";
import { Floating } from "./sheet-float";
import { SidePanel, inputClass, primaryBtn, secondaryBtn } from "./sheet-shell";

/** A stable colour per editor, used for the dots here and (by the caller) for "Show changes". */
export const EDITOR_COLORS = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d93025", "#007b83", "#b06000", "#c5221f"];
export function editorColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EDITOR_COLORS[h % EDITOR_COLORS.length];
}

/**
 * File ▸ Version history (Ctrl+Alt+Shift+H): versions grouped by day (collapsible), each with its
 * time and editors; named versions in bold with ⋮ "Name this version"; "Show changes"; the selected
 * version gets "Restore this version". Selecting "Current version" (null) returns to the live sheet.
 */
export function VersionHistoryPanel({ revisions, loading, named, selectedAt, showChanges, onShowChanges, onSelect, onRestore, onName, onClose }: {
  /** Every revision of the sheet (any order). */
  revisions: NexusSheetRevision[];
  loading: boolean;
  named: NamedVersion[];
  /** The version being looked at, or null for the current one. */
  selectedAt: string | null;
  showChanges: boolean;
  onShowChanges: (b: boolean) => void;
  onSelect: (at: string | null) => void;
  onRestore: (at: string) => void;
  onName: (at: string, name: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useLang();
  const days = useMemo(() => groupVersions(revisions, named), [revisions, named]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ at: string; rect: DOMRect } | null>(null);
  const [naming, setNaming] = useState<{ at: string; name: string } | null>(null);

  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }), [locale]);
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }), [locale]);
  const dayLabel = (day: string) => dayFmt.format(new Date(`${day}T12:00:00+07:00`));
  const toggleDay = (day: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(day)) n.delete(day); else n.add(day); return n; });

  const commitName = () => {
    if (!naming) return;
    const name = naming.name.trim();
    if (name) onName(naming.at, name);
    setNaming(null);
  };

  const renderVersion = (v: VersionEntry) => {
    const isSel = v.current ? selectedAt === null || selectedAt === v.at : selectedAt === v.at;
    const people = v.authors.map((a) => a.name ?? t("deleted account"));
    return (
      <div key={v.at} className={cn("group relative rounded-lg transition", isSel ? "bg-accent text-accent-foreground" : "hover:bg-muted/60")}>
        <button type="button" onClick={() => onSelect(v.current ? null : v.at)} aria-current={isSel || undefined} className="block w-full px-2.5 py-2 pr-8 text-left">
          {naming?.at === v.at ? null : (
            <>
              {v.name && <div className="truncate text-xs font-bold">{v.name}</div>}
              <div className={cn("truncate text-xs", v.name ? "text-muted-foreground" : "font-semibold")}>{timeFmt.format(new Date(v.at))}</div>
              {v.current && <div className="text-[11px] italic text-muted-foreground">{t("Current version")}</div>}
              <div className="mt-1 space-y-0.5">
                {v.authors.slice(0, 4).map((a, i) => (
                  <div key={a.id || i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: editorColor(a.id) }} />
                    <span className="truncate">{people[i]}</span>
                  </div>
                ))}
                {v.authors.length > 4 && <div className="pl-3.5 text-[11px] text-muted-foreground">{t("+{n} more", { n: v.authors.length - 4 })}</div>}
              </div>
            </>
          )}
        </button>
        {naming?.at === v.at && (
          <div className="px-2.5 py-2">
            <input
              autoFocus
              aria-label={t("Name this version")}
              value={naming.name}
              onChange={(e) => setNaming({ ...naming, name: e.target.value })}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitName(); if (e.key === "Escape") setNaming(null); }}
              onBlur={commitName}
              className={inputClass}
            />
          </div>
        )}
        {naming?.at !== v.at && (
          <button
            type="button"
            aria-label={t("More actions")}
            aria-haspopup="menu"
            onClick={(e) => setMenu({ at: v.at, rect: e.currentTarget.getBoundingClientRect() })}
            className="absolute right-1 top-1.5 rounded p-1 text-muted-foreground opacity-0 pointer-coarse:opacity-100! transition hover:bg-background hover:text-foreground group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"
          ><MoreHorizontal className="h-3.5 w-3.5" /></button>
        )}
        {isSel && !v.current && (
          <div className="px-2.5 pb-2">
            <button type="button" onClick={() => onRestore(v.at)} className={cn(primaryBtn, "w-full")}>{t("Restore this version")}</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <SidePanel
      title={t("Version history")}
      onClose={onClose}
      footer={
        <label className="flex flex-1 items-center gap-2 px-1 text-xs">
          <input type="checkbox" checked={showChanges} onChange={(e) => onShowChanges(e.target.checked)} />
          {t("Show changes")}
        </label>
      }
    >
      <div className="p-2">
        {loading && <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("Loading history…")}</div>}
        {!loading && days.length === 0 && <p className="px-2 py-8 text-center text-xs leading-relaxed text-muted-foreground">{t("No versions yet. Every edit is recorded here, grouped into versions.")}</p>}
        {days.map((d) => {
          const open = !collapsed.has(d.day);
          return (
            <section key={d.day} className="mb-1">
              <button type="button" onClick={() => toggleDay(d.day)} aria-expanded={open} className="flex w-full items-center gap-1 rounded-md px-1 py-1.5 text-left text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <span className="capitalize">{dayLabel(d.day)}</span>
              </button>
              {open && <div className="space-y-0.5">{d.versions.map(renderVersion)}</div>}
            </section>
          );
        })}
      </div>
      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setMenu(null)} />
          <Floating anchor={{ rect: menu.rect }} role="menu" className="min-w-[180px] rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-pop">
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={() => {
                const v = days.flatMap((x) => x.versions).find((x) => x.at === menu.at);
                setNaming({ at: menu.at, name: v?.name ?? "" });
                setMenu(null);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
            >{t("Name this version")}</button>
            {menu.at !== days[0]?.versions[0]?.at && (
              <button type="button" role="menuitem" onClick={() => { onRestore(menu.at); setMenu(null); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted">{t("Restore this version")}</button>
            )}
          </Floating>
        </>,
        document.body,
      )}
      {selectedAt && (
        <div className="sticky bottom-0 border-t border-border bg-card p-2">
          <button type="button" onClick={() => onSelect(null)} className={cn(secondaryBtn, "w-full")}>{t("Back to current version")}</button>
        </div>
      )}
    </SidePanel>
  );
}
