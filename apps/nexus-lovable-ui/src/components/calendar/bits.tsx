import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AlertCircle, Check, CornerDownRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, type Lang } from "@/lib/lang";
import { overdueState, type CalIndex, type CalItem, type CalUnit } from "@/lib/calendar/core";

// Small building blocks shared by the Calendar's grid, day panel and People view.

/** CSS variables for a unit colour pair, so `bg-[var(--c)] dark:bg-[var(--cd)]` follows the theme. */
export function unitVars(u?: { color: string; colorDark: string } | null): CSSProperties {
  return (u ? { "--c": u.color, "--cd": u.colorDark } : { "--c": "#75839A", "--cd": "#94A3B8" }) as CSSProperties;
}

/** A unit's dot: filled = something still to do, ring = only done / status-less tasks. */
export function UnitDot({ unit, filled = true, size = 7, dim = false, className }: { unit?: CalUnit | null; filled?: boolean; size?: number; dim?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ ...unitVars(unit), width: size, height: size }}
      className={cn(
        "inline-block shrink-0 rounded-full border-[1.5px] border-[var(--c)] transition-opacity dark:border-[var(--cd)]",
        filled && "bg-[var(--c)] dark:bg-[var(--cd)]",
        dim && "opacity-25",
        className,
      )}
    />
  );
}

const toneCache = new Map<string, "light" | "dark">();
/** Whether a logo is mostly light (white text on a transparent PNG) — it then needs a dark tile. */
function useLogoTone(url: string | null): "light" | "dark" {
  const [tone, setTone] = useState<"light" | "dark">(() => (url && toneCache.get(url)) || "dark");
  useEffect(() => {
    if (!url || toneCache.has(url)) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 32;
        const g = c.getContext("2d");
        if (!g) return;
        g.drawImage(img, 0, 0, 32, 32);
        const d = g.getImageData(0, 0, 32, 32).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 40) continue;
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          n++;
        }
        const t: "light" | "dark" = n > 0 && sum / n > 0.72 ? "light" : "dark";
        toneCache.set(url, t);
        setTone(t);
      } catch { /* tainted canvas: keep dark */ }
    };
    img.src = url;
  }, [url]);
  return tone;
}

/** Logo for an IP, a coloured initial tile for anything else. */
export function UnitMark({ unit, size = 22, className }: { unit: CalUnit; size?: number; className?: string }) {
  const logo = unit.kind === "IP" ? unit.logoUrl : null;
  const tone = useLogoTone(logo);
  const [broken, setBroken] = useState(false);
  if (logo && !broken) {
    return (
      <img
        src={logo}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className={cn("shrink-0 rounded-md object-contain p-0.5 ring-1 ring-black/5", tone === "light" ? "bg-[#0f1b2d]" : "bg-white", className)}
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

/** Weekday names Monday…Sunday in the current language. */
export function weekdayNames(locale: string, style: "short" | "narrow" = "short"): string[] {
  // 2026-10-05 is a Monday.
  return Array.from({ length: 7 }, (_, i) => fmtDay(`2026-10-${String(5 + i).padStart(2, "0")}`, { weekday: style }, locale));
}

// ── Status ─────────────────────────────────────────────────────────────────────────────────────────

/** ○ to do, ✓ done, ! overdue (red within the window, grey after it), ▫ project without status. */
export function StatusGlyph({ item, today, nowMs, windowDays, size = 16 }: { item: CalItem; today: string; nowMs: number; windowDays: number; size?: number }) {
  const { t } = useLang();
  const od = overdueState(item, today, nowMs, windowDays);
  const box = { width: size, height: size };
  if (item.done) {
    return (
      <span title={t("Done")} style={box} className="grid shrink-0 place-items-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500">
        <Check className="h-[70%] w-[70%]" strokeWidth={3} />
      </span>
    );
  }
  if (item.noStatus) {
    return <span title={t("No status")} style={box} className="grid shrink-0 place-items-center"><span className="h-[45%] w-[45%] rotate-45 rounded-[2px] bg-[#5a6b83] dark:bg-[#9fb0c8]" /></span>;
  }
  if (od === "recent") {
    return <AlertCircle style={box} className="shrink-0 text-rose-600 dark:text-rose-400" strokeWidth={2.4} aria-label={t("Overdue")} />;
  }
  return (
    <span
      title={od === "stale" ? t("Overdue for more than {n} days", { n: windowDays }) : t("To do")}
      style={box}
      className={cn("block shrink-0 rounded-full border-2", od === "stale" ? "border-[#9aa6b8] dark:border-[#5d6878]" : "border-[#5a6b83] dark:border-[#9fb0c8]")}
    />
  );
}

export function PriorityChip({ priority }: { priority: string | null }) {
  const { t } = useLang();
  if (priority !== "URGENT" && priority !== "HIGH") return null;
  return (
    <span className={cn(
      "whitespace-nowrap rounded-md px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.02em]",
      priority === "URGENT" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    )}>
      {priority === "URGENT" ? t("Urgent") : t("High")}
    </span>
  );
}

// ── People ─────────────────────────────────────────────────────────────────────────────────────────

export type PeopleLookup = (userId: string) => { name: string; avatar: string | null; inChart: boolean };

export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const FACE = ["#1e3a5f", "#0B6FB8", "#B35A00", "#00805E", "#B03A86", "#5B4BD6", "#00838F", "#8D5B3B"];
export function Face({ name, avatar, size = 22, className }: { name: string; avatar: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (avatar && !broken) {
    return <img src={avatar} alt="" title={name} onError={() => setBroken(true)} style={{ width: size, height: size, minWidth: size }} className={cn("rounded-full object-cover ring-2 ring-card", className)} />;
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span title={name} style={{ width: size, height: size, minWidth: size, fontSize: Math.round(size * 0.4), background: FACE[h % FACE.length] }} className={cn("inline-grid place-items-center rounded-full font-bold text-white ring-2 ring-card", className)}>
      {initialsOf(name)}
    </span>
  );
}

// ── A task row ─────────────────────────────────────────────────────────────────────────────────────

/**
 * One task in the day panel. `unitId` = the card it is shown under: its PICs there come first, the
 * others are "with …" (with their card). A masked row (private project) shows "Internal task · <card>"
 * and cannot be opened.
 */
export function ItemRow({
  item, unitId, ix, people, today, nowMs, windowDays, onOpen, showPeople = true, compact = false, trailing,
}: {
  item: CalItem; unitId: string | null; ix: CalIndex; people: PeopleLookup
  today: string; nowMs: number; windowDays: number; onOpen: (item: CalItem) => void
  showPeople?: boolean; compact?: boolean; trailing?: ReactNode
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
      <span className="mt-0.5"><StatusGlyph item={item} today={today} nowMs={nowMs} windowDays={windowDays} size={compact ? 14 : 16} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          {item.masked ? (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] italic text-muted-foreground">
              <Lock className="h-3 w-3 shrink-0" />
              <span className="truncate">{sectionName ? t("Internal task · {unit}", { unit: sectionName }) : t("Internal task")}</span>
            </span>
          ) : (
            <span className={cn(
              "min-w-0 flex-1 font-medium leading-snug [overflow-wrap:anywhere]",
              compact ? "line-clamp-1 text-[12.5px]" : "line-clamp-2 text-[13px]",
              item.done && "text-muted-foreground line-through decoration-muted-foreground/50",
              od === "stale" && "text-muted-foreground",
            )}>
              {item.title}
            </span>
          )}
          {item.time && <span className="shrink-0 pt-px text-[11.5px] font-semibold tabular-nums text-muted-foreground">{fmtTime(item.time, lang)}</span>}
          {trailing}
        </span>
        {!compact && (
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {item.project && (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: item.project.color }} />
                <span className="truncate">{item.project.name}</span>
                {item.linkedProjectIds.length > 0 && <span className="shrink-0">{t("+{n} project", { n: item.linkedProjectIds.length })}</span>}
              </span>
            )}
            <PriorityChip priority={item.priority} />
            {od === "recent" && <span className="font-semibold text-rose-600 dark:text-rose-400">{t("Overdue")}</span>}
            {od === "stale" && <span>{t("Overdue for more than {n} days", { n: windowDays })}</span>}
            {item.parent && (
              <span className="inline-flex min-w-0 items-center gap-0.5"><CornerDownRight className="h-3 w-3 shrink-0" /><span className="truncate">{t("from {task}", { task: item.parent.title })}</span></span>
            )}
          </span>
        )}
        {showPeople && !compact && item.assigneeIds.length > 0 && (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px]">
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
                      <span className="text-muted-foreground/80"> ({u ?? t("not in the chart")})</span>
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
  const cls = cn(
    "flex w-full items-start gap-2.5 rounded-xl px-2.5 text-left",
    compact ? "py-1.5" : "py-2",
    clickable && "transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none",
    od === "stale" && "opacity-75",
  );
  return clickable ? (
    <button type="button" className={cls} onClick={() => onOpen(item)} data-cal-item={item.key}>{body}</button>
  ) : (
    <div className={cls} data-cal-item={item.key}>{body}</div>
  );
}
