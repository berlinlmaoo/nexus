import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { AlertCircle, Check, CornerDownRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, type Lang } from "@/lib/lang";
import { AvatarFace } from "@/components/Avatar";
import { overdueState, type CalIndex, type CalItem, type CalUnit } from "@/lib/calendar/core";
import { priorityTone, SLATE, STATUS, useLogoTone } from "@/lib/calendar/tone";

// Small building blocks shared by the Calendar's grid, day panel and People view.

// ── Shared classes ─────────────────────────────────────────────────────────────────────────────────
// One copy of each, imported everywhere: copies drifted apart before (Impeccable re-audit, Oct 2026: the
// switches kept the app's violet ring while every other control showed the navy outline).

/** Keyboard focus on a pill, a segment or a small button: a 2px accent outline just outside its edge. */
export const FOCUS_PILL = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cal-accent";
/** Keyboard focus on a full-width row: the same outline, drawn just inside its edge. */
export const FOCUS_ROW = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cal-accent";
/**
 * The calendar's switch (ui/switch): accent when on, and the calendar's focus outline, also where no
 * calendar root sets the ring token (Control Room › Calendar).
 */
export const CAL_SWITCH = `data-[state=checked]:bg-cal-accent ${FOCUS_PILL}`;
/** Touch: at least 44px. In px, because a finger sets it, not the text size; larger text still grows the control. */
export const TOUCH_ROW = "pointer-coarse:min-h-[44px]";
export const TOUCH_ICON = "pointer-coarse:size-[44px]";
/** The one style of a small uppercase label: card and ribbon names, column heads, badges. */
export const CAPS = "text-2xs font-semibold uppercase tracking-wider";
/** A project colour's edge: a very pale or very dark colour still shows on the card, in either theme. */
export const SWATCH_EDGE = "ring-1 ring-inset ring-foreground/20";

/** CSS variables for a unit colour pair, so `bg-[var(--c)] dark:bg-[var(--cd)]` follows the theme. */
export function unitVars(u?: { color: string; colorDark: string } | null): CSSProperties {
  // No unit ("Other"): the slate of an open task, a token that already follows the theme.
  return (u ? { "--c": u.color, "--cd": u.colorDark } : { "--c": "var(--cal-todo)", "--cd": "var(--cal-todo)" }) as CSSProperties;
}

/**
 * A unit's dot: filled = something still to do; a small tick = nothing left to do (only done or
 * status-less tasks). Owner, 8 Oct 2026: a ring read as "to do" next to the task list's ○, so the
 * all-done mark is a tick in the unit's colour, the same footprint as a dot.
 */
export function UnitDot({ unit, filled = true, size = 7, className }: { unit?: CalUnit | null; filled?: boolean; size?: number; className?: string }) {
  if (!filled) return <DoneTick unit={unit} size={size} className={className} />;
  return (
    <span
      aria-hidden
      style={{ ...unitVars(unit), width: size, height: size }}
      className={cn(
        "inline-block shrink-0 rounded-full border-[1.5px] border-[var(--c)] transition-opacity dark:border-[var(--cd)]",
        "bg-[var(--c)] dark:bg-[var(--cd)]",
        className,
      )}
    />
  );
}

/** The all-done mark: a tick a little larger than a dot so it reads at 6-7 px. */
export function DoneTick({ unit, size = 7, className, accent = false }: { unit?: CalUnit | null; size?: number; className?: string; accent?: boolean }) {
  const box = size + 3;
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 10"
      width={box}
      height={box}
      style={accent ? undefined : unitVars(unit)}
      className={cn("inline-block shrink-0 transition-opacity", accent ? "text-cal-accent" : "text-[var(--c)] dark:text-[var(--cd)]", className)}
    >
      <path d="M1.6 5.4 4.1 7.8 8.6 2.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Logo for an IP, a coloured initial tile for anything else. */
export function UnitMark({ unit, size = 22, className }: { unit: CalUnit; size?: number; className?: string }) {
  const logo = unit.kind === "IP" ? unit.logoUrl : null;
  // A light logo sits on navy in both themes, a dark one (or one not read yet) on white.
  const tone = useLogoTone(logo);
  const [broken, setBroken] = useState(false);
  if (logo && !broken) {
    return (
      <img
        src={logo}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        // The edge follows the theme: black/5 vanished around the dark tile on a dark card.
        className={cn("shrink-0 rounded-md object-contain p-0.5 ring-1 ring-foreground/10", tone === "light" ? "bg-cal-accent dark:bg-cal-accent-foreground" : "bg-white", className)}
      />
    );
  }
  const initial = unit.name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1).toUpperCase() || "·";
  // The unit colour on a 15% tint of itself was 3.7–4.4:1 in light. The letter now takes 30% of the
  // text colour (≥4.99:1 for every Bagan colour, hover included); dark keeps the colour on a 15% tint
  // (≥4.55:1).
  return (
    <span
      aria-hidden
      style={{ ...unitVars(unit), width: size, height: size, fontSize: Math.round(size * 0.45) }}
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-[var(--c)]/15 font-bold text-[color:color-mix(in_oklab,var(--c)_70%,var(--foreground))] dark:bg-[var(--cd)]/15 dark:text-[var(--cd)]",
        className,
      )}
    >
      {initial}
    </span>
  );
}

/** "You" beside the viewer's own card or person row. */
export function YouTag({ className }: { className?: string }) {
  const { t } = useLang();
  return <span className={cn("shrink-0 rounded-md bg-cal-accent px-1.5 py-px text-cal-accent-foreground", CAPS, className)}>{t("You")}</span>;
}

/** The viewer first, everyone else in the order they came (the Bagan's). A display rule only: core.ts keeps its order. */
export function viewerFirst<T>(list: T[], isViewer: (x: T) => boolean): T[] {
  const i = list.findIndex(isViewer);
  return i <= 0 ? list : [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

/**
 * A heading whose level follows the nesting under the view's own h2 (h6 at most). Preflight resets
 * heading sizes, so it looks exactly like its classes say.
 */
export function Heading({ level, className, style, children }: { level: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const Tag = `h${Math.min(Math.max(level, 2), 6)}` as "h2" | "h3" | "h4" | "h5" | "h6";
  return <Tag className={className} style={style}>{children}</Tag>;
}

// ── What sticks over a scroller ────────────────────────────────────────────────────────────────────

/** The element that scrolls `el`: its nearest ancestor that scrolls on its own, else the page. */
export function scrollerOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === "auto" || y === "scroll") return p;
  }
  return document.documentElement;
}

/**
 * Room at the top of a scroller for a bar that sticks there (`--cal-sticky-room` + data-cal-sticky-room,
 * written straight onto the scroller, no re-render). While a control inside [data-cal-under-sticky] has
 * focus, styles.css turns it into the scroller's scroll-padding-top, so the keyboard never leaves that
 * control under the bar (WCAG 2.4.11). `set(scroller, px)` (null = no room); `release()` takes it off
 * again, also when `set` moves to another scroller.
 */
export function stickyRoom() {
  let target: HTMLElement | null = null;
  const release = () => {
    target?.removeAttribute("data-cal-sticky-room");
    target?.style.removeProperty("--cal-sticky-room");
    target = null;
  };
  const set = (scroller: HTMLElement, px: number | null) => {
    if (px === null || scroller !== target) release();
    if (px === null) return;
    target = scroller;
    scroller.setAttribute("data-cal-sticky-room", "");
    scroller.style.setProperty("--cal-sticky-room", `${Math.round(px)}px`);
  };
  return { set, release };
}

const COLLAPSE_KEY = "nexus.calendar.collapsed";
function readCollapsed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

/**
 * Cards the viewer folded away, remembered in this browser. The day panel and the phone People list
 * share one set: a division folded in one stays folded in the other.
 */
export function useCollapsed(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

// ── Dates ──────────────────────────────────────────────────────────────────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Format a WIB day string ("YYYY-MM-DD") without ever shifting it through the browser's time zone. */
export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions, locale: string): string {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" })));
  return f.format(new Date(`${day}T00:00:00.000Z`));
}

/** "19.00" in Indonesian, "19:00" in English. */
export function fmtTime(time: string | null, lang: Lang): string {
  if (!time) return "";
  return lang === "id" ? time.replace(":", ".") : time;
}

/** Today's WIB day from this device's clock. */
export function wibToday(nowMs = Date.now()): string {
  return new Date(nowMs + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Short weekday names Monday…Sunday in the current language. */
export function weekdayNames(locale: string): string[] {
  // 2026-10-05 is a Monday.
  return Array.from({ length: 7 }, (_, i) => fmtDay(`2026-10-${String(5 + i).padStart(2, "0")}`, { weekday: "short" }, locale));
}

// ── Status ─────────────────────────────────────────────────────────────────────────────────────────

/** ○ to do, ✓ done, ! overdue (red within the window, a dashed grey ring after it), ▫ project without status. */
export function StatusGlyph({ item, today, nowMs, windowDays, size = 16 }: { item: CalItem; today: string; nowMs: number; windowDays: number; size?: number }) {
  const { t } = useLang();
  const od = overdueState(item, today, nowMs, windowDays);
  const box = { width: size, height: size };
  if (item.done) {
    return (
      <span title={t("Done")} style={box} className={cn("grid shrink-0 place-items-center rounded-full", STATUS.doneFill)}>
        <Check className="h-[70%] w-[70%]" strokeWidth={3} />
      </span>
    );
  }
  if (item.noStatus) {
    return <span title={t("No status")} style={box} className="grid shrink-0 place-items-center"><span className={cn("h-[45%] w-[45%] rotate-45 rounded-[2px]", SLATE.bg)} /></span>;
  }
  if (od === "recent") {
    return <AlertCircle style={box} className={cn("shrink-0", STATUS.overdueIcon)} strokeWidth={2.4} aria-label={t("Overdue")} />;
  }
  return (
    <span
      title={od === "stale" ? t("Overdue for more than {n} days", { n: windowDays }) : t("To do")}
      style={box}
      className={cn("block shrink-0 rounded-full border-2", od === "stale" ? STATUS.staleRing : STATUS.todoRing)}
    />
  );
}

export function PriorityChip({ priority }: { priority: string | null }) {
  const { t } = useLang();
  if (priority !== "URGENT" && priority !== "HIGH") return null;
  return (
    <span className={cn("whitespace-nowrap rounded-md px-1.5 py-px", CAPS, priorityTone(priority))}>
      {priority === "URGENT" ? t("Urgent") : t("High")}
    </span>
  );
}

// ── People ─────────────────────────────────────────────────────────────────────────────────────────

export type PeopleLookup = (userId: string) => { name: string; avatar: string | null; inChart: boolean };

/**
 * A person's photo or initials. In the Calendar the name is always printed right beside it, so it is
 * hidden from assistive tech; the colour is the one Avatar gives the same person everywhere else.
 */
export function Face({ name, avatar, size = 22, className }: { name: string; avatar: string | null; size?: number; className?: string }) {
  return <AvatarFace name={name} avatar={avatar} seed={name} size={size} decorative className={cn("font-bold ring-card", className)} />;
}

// ── A task row ─────────────────────────────────────────────────────────────────────────────────────

/**
 * One task in the day panel. `unitId` = the card it is shown under: its PICs there come first, the
 * others are "with …" (with their card). A masked row (private project) shows "Internal task · <card>"
 * and cannot be opened.
 *
 * Its gutters are in px: they nest inside the panel's and the card's, and in rem they doubled with a 200%
 * text size until a phone had ~175px left for the title. Names wrap instead of being cut.
 */
export function ItemRow({
  item, unitId, ix, people, today, nowMs, windowDays, onOpen, showPeople = true, trailing,
}: {
  item: CalItem; unitId: string | null; ix: CalIndex; people: PeopleLookup
  today: string; nowMs: number; windowDays: number; onOpen: (item: CalItem) => void
  showPeople?: boolean; trailing?: ReactNode
}) {
  const { t, tn, lang } = useLang();
  const od = overdueState(item, today, nowMs, windowDays);
  const here = unitId ? (item.placements.find((p) => p.unitId === unitId)?.userIds ?? []) : item.assigneeIds;
  const others = item.assigneeIds.filter((id) => !here.includes(id));
  const unitOf = (userId: string) => {
    const p = item.placements.find((pl) => pl.userIds.includes(userId));
    return p ? ix.byId.get(p.unitId)?.name ?? null : null;
  };
  const sectionName = unitId ? ix.byId.get(ix.byId.get(unitId)?.sectionId ?? "")?.name ?? ix.byId.get(unitId)?.name : null;
  const clickable = !item.masked && !!item.id;
  const linked = item.linkedProjectIds.length;
  const body = (
    <>
      <span className="mt-0.5"><StatusGlyph item={item} today={today} nowMs={nowMs} windowDays={windowDays} size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          {item.masked ? (
            <span className="flex min-w-0 flex-1 items-start gap-1.5 text-sm italic text-muted-foreground">
              <Lock aria-hidden className="mt-1 h-3 w-3 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{sectionName ? t("Internal task · {unit}", { unit: sectionName }) : t("Internal task")}</span>
            </span>
          ) : (
            <span className={cn(
              // Four lines before the clamp: a title often differs from its neighbour only at the end
              // ("— revisi kedua setelah feedback"), and two lines cut that off even at 1x on a phone.
              "line-clamp-4 min-w-0 flex-1 text-sm font-medium leading-snug [overflow-wrap:anywhere]",
              // Done and long-overdue titles step back to the muted colour (5.3:1), never below it.
              (item.done || od === "stale") && "text-muted-foreground",
              item.done && "line-through decoration-muted-foreground/50",
            )}>
              {item.title}
            </span>
          )}
          {item.time && <span className="shrink-0 pt-px text-xs font-semibold tabular-nums text-muted-foreground">{fmtTime(item.time, lang)}</span>}
          {trailing}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          {item.project && (
            <span className="inline-flex min-w-0 max-w-full items-start gap-1">
              <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-sm", SWATCH_EDGE)} style={{ background: item.project.color }} />
              <span className="min-w-0 [overflow-wrap:anywhere]">{item.project.name}</span>
              {linked > 0 && <span className="shrink-0">{tn(linked, "+{n} project", "+{n} projects")}</span>}
            </span>
          )}
          <PriorityChip priority={item.priority} />
          {od === "recent" && <span className={cn("font-semibold", STATUS.overdueText)}>{t("Overdue")}</span>}
          {od === "stale" && <span>{t("Overdue for more than {n} days", { n: windowDays })}</span>}
          {item.parent && (
            <span className="inline-flex min-w-0 max-w-full items-start gap-0.5">
              <CornerDownRight aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{t("from {task}", { task: item.parent.title })}</span>
            </span>
          )}
        </span>
        {showPeople && item.assigneeIds.length > 0 && (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            {here.map((id) => {
              const p = people(id);
              return (
                <span key={id} className="inline-flex items-center gap-1 font-medium text-foreground/90">
                  <Face name={p.name} avatar={p.avatar} size={18} />
                  {p.name}
                </span>
              );
            })}
            {others.length > 0 && (
              <span className="text-muted-foreground">
                {here.length > 0 ? t("with") : ""}{" "}
                {others.map((id, i) => {
                  const p = people(id);
                  const u = p.inChart ? unitOf(id) : null;
                  return (
                    <span key={id}>
                      {i > 0 && ", "}
                      {p.name}
                      <span> ({u ?? t("not in the chart")})</span>
                    </span>
                  );
                })}
              </span>
            )}
          </span>
        )}
      </span>
    </>
  );
  // A long-overdue row is not faded: its dashed ring, muted title and "Overdue for more than…" line
  // already mark it, and fading took the text below 4.5:1.
  const cls = cn(
    "flex w-full items-start gap-[10px] rounded-xl px-[10px] py-2 text-left",
    clickable && cn("transition-colors hover:bg-muted/70 focus-visible:bg-muted/70", FOCUS_ROW),
  );
  return clickable ? (
    <button type="button" className={cls} onClick={() => onOpen(item)} data-cal-item={item.key}>{body}</button>
  ) : (
    <div className={cls} data-cal-item={item.key}>{body}</div>
  );
}
