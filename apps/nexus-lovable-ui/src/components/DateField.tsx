import { useState } from "react";
import { enGB, id as idLocale } from "date-fns/locale";
import { CalendarDays, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * A date property in the Notion style (owner audit, 12 Oct 2026: raw <input type="date"> painted
 * "mm/dd/yyyy" and "--:--" into every empty table cell and the task popup). Shows the value as text in
 * the interface language ("14 Oct 2026"), nothing when empty; a click opens a calendar with Today and
 * Clear. With `withTime` a time row sits under the calendar.
 *
 * Values: date only → "YYYY-MM-DD" (the local day); with time → an ISO string. `null` = cleared.
 */
export function DateField({
  value,
  onChange,
  withTime = false,
  placeholder,
  ariaLabel,
  disabled,
  className,
  emptyClassName,
  align = "start",
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  withTime?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  emptyClassName?: string;
  align?: "start" | "center" | "end";
}) {
  const { t, lang, locale } = useLang();
  const [open, setOpen] = useState(false);
  const date = parseValue(value);
  const text = date ? formatDateText(date, locale, withTime && hasTime(value)) : "";
  const emit = (d: Date | null, time?: string) => {
    if (!d) { onChange(null); return; }
    if (!withTime) { onChange(ymd(d)); return; }
    const [h, m] = (time ?? (date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : "")).split(":").map(Number);
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0);
    onChange(out.toISOString());
  };
  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel ? (text ? `${ariaLabel}: ${text}` : ariaLabel) : undefined}
          className={cn(
            "group/date inline-flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-default disabled:hover:bg-transparent",
            className,
          )}
        >
          {text ? <span className="truncate">{text}</span> : <span className={cn("truncate text-muted-foreground/70", emptyClassName)}>{placeholder ?? ""}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Calendar
          mode="single"
          selected={date ?? undefined}
          defaultMonth={date ?? undefined}
          locale={lang === "id" ? idLocale : enGB}
          weekStartsOn={1}
          onSelect={(d) => { emit(d ?? null); if (!withTime) setOpen(false); }}
        />
        {withTime && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <label className="text-xs text-muted-foreground" htmlFor="date-field-time">{t("Time")}</label>
            <input
              id="date-field-time"
              type="time"
              value={date && hasTime(value) ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : ""}
              onChange={(e) => emit(date ?? new Date(), e.target.value || "00:00")}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
          <button type="button" onClick={() => { emit(new Date()); if (!withTime) setOpen(false); }} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground hover:bg-muted">
            <CalendarDays className="h-3.5 w-3.5" />{t("Today")}
          </button>
          <button type="button" disabled={!date} onClick={() => { onChange(null); setOpen(false); }} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
            <X className="h-3.5 w-3.5" />{t("Clear")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseValue(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** An ISO value with a time other than local midnight. */
function hasTime(v: string | null | undefined): boolean {
  if (!v || /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim())) return false;
  const d = new Date(String(v));
  return !Number.isNaN(d.getTime()) && (d.getHours() !== 0 || d.getMinutes() !== 0);
}

/** "14 Oct 2026" / "14 Okt 2026" (+ time). The year is dropped in the current year. en-GB's "Sept" reads "Sep". */
export function formatDateText(d: Date, locale: string, withTime = false): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const s = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(d);
  return s.replace(/\bSept\b/, "Sep");
}
