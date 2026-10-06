import { useState, type CSSProperties, type ReactNode } from "react";
import { AlertCircle, Check, CornerDownRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, type Lang } from "@/lib/lang";
import { AvatarFace } from "@/components/Avatar";
import { overdueState, type CalIndex, type CalItem, type CalUnit } from "@/lib/calendar/core";
import { priorityTone, SLATE, STATUS, useLogoTone } from "@/lib/calendar/tone";

export { initialsOf } from "@/components/Avatar";

// Small building blocks shared by the Calendar's grid, day panel and People view.

/** Keyboard focus on a row or a plain button: a 2px accent outline drawn just inside its edge. */
export const FOCUS_ROW = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cal-accent";
/** Keyboard focus on a pill or segment that can be filled with the accent: the outline sits outside it. */
export const FOCUS_PILL = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cal-accent";

/** CSS variables for a unit colour pair, so `bg-[var(--c)] dark:bg-[var(--cd)]` follows the theme. */
export function unitVars(u?: { color: string; colorDark: string } | null): CSSProperties {
  return (u ? { "--c": u.color, "--cd": u.colorDark } : { "--c": "#75839A", "--cd": "#94A3B8" }) as CSSProperties;
}

/** A unit's dot: filled = something still to do, ring = only done / status-less tasks. */
export function UnitDot({ unit, filled = true, size = 7, className }: { unit?: CalUnit | null; filled?: boolean; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ ...unitVars(unit), width: size, height: size }}
      className={cn(
        "inline-block shrink-0 rounded-full border-[1.5px] border-[var(--c)] transition-opacity dark:border-[var(--cd)]",
        filled && "bg-[var(--c)] dark:bg-[var(--cd)]",
        className,
      )}
    />
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
        className={cn("shrink-0 rounded-md object-contain p-0.5 ring-1 ring-black/5", tone === "light" ? "bg-cal-accent dark:bg-cal-accent-foreground" : "bg-white", className)}
      />
    );
  }
  const initial = unit.name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1).toUpperCase() || "·";
  return (
    <span
      aria-hidden
      style={{ ...unitVars(unit), width: size, height: size, fontSize: Math.round(size * 0.45) }}
      className={cn("grid shrink-0 place-items-center rounded-md bg-[var(--c)]/15 font-bold text-[var(--c)] dark:bg-[var(--cd)]/20 dark:text-[var(--cd)]", className)}
    >
      {initial}
    </span>
  );
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
    <span className={cn("whitespace-nowrap rounded-md px-1.5 py-px text-2xs font-bold uppercase tracking-[0.02em]", priorityTone(priority))}>
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
 */
export function ItemRow({
  item, unitId, ix, people, today, nowMs, windowDays, onOpen, showPeople = true, trailing,
}: {
  item: CalItem; unitId: string | null; ix: CalIndex; people: PeopleLookup
  today: string; nowMs: number; windowDays: number; onOpen: (item: CalItem) => void
  showPeople?: boolean; trailing?: ReactNode
}) {
  const { t, lang } = useLang();
  const od = overdueState(item, today, nowMs, windowDays);
  const here = unitId ? (item.placements.find((p) => p.unitId === unitId)?.userIds ?? []) : item.assigneeIds;
  const others = item.assigneeIds.filter((id) => !here.includes(id));
  const unitOf = (userId: string) => {
    const p = item.placements.find((pl) => pl.userIds.includes(userId));
    return p ? ix.byId.get(p.unitId)?.name ?? null : null;
  };
  const sectionName = unitId ? ix.byId.get(ix.byId.get(unitId)?.sectionId ?? "")?.name ?? ix.byId.get(unitId)?.name : null;
  const clickable = !item.masked && !!item.id;
  const body = (
    <>
      <span className="mt-0.5"><StatusGlyph item={item} today={today} nowMs={nowMs} windowDays={windowDays} size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          {item.masked ? (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm italic text-muted-foreground">
              <Lock className="h-3 w-3 shrink-0" />
              <span className="truncate">{sectionName ? t("Internal task · {unit}", { unit: sectionName }) : t("Internal task")}</span>
            </span>
          ) : (
            <span className={cn(
              "line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug [overflow-wrap:anywhere]",
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
            <span className="inline-flex min-w-0 max-w-full items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: item.project.color }} />
              <span className="truncate">{item.project.name}</span>
              {item.linkedProjectIds.length > 0 && <span className="shrink-0">{t("+{n} project", { n: item.linkedProjectIds.length })}</span>}
            </span>
          )}
          <PriorityChip priority={item.priority} />
          {od === "recent" && <span className={cn("font-semibold", STATUS.overdueText)}>{t("Overdue")}</span>}
          {od === "stale" && <span>{t("Overdue for more than {n} days", { n: windowDays })}</span>}
          {item.parent && (
            <span className="inline-flex min-w-0 items-center gap-0.5"><CornerDownRight className="h-3 w-3 shrink-0" /><span className="truncate">{t("from {task}", { task: item.parent.title })}</span></span>
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
    "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left",
    clickable && cn("transition-colors hover:bg-muted/70 focus-visible:bg-muted/70", FOCUS_ROW),
  );
  return clickable ? (
    <button type="button" className={cls} onClick={() => onOpen(item)} data-cal-item={item.key}>{body}</button>
  ) : (
    <div className={cls} data-cal-item={item.key}>{body}</div>
  );
}
