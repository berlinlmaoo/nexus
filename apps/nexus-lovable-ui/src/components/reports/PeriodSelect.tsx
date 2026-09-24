import { CalendarRange } from "lucide-react";
import { currentPeriodKey, periodOptions } from "./report-format";

/** Attendance-period picker (28→27): the current period + the 5 before it. `undefined` = current. */
export function PeriodSelect({ value, onChange }: { value: string | undefined; onChange: (period: string | undefined) => void }) {
  const options = periodOptions();
  const current = currentPeriodKey();
  const selected = value ?? current;
  // A period from an old link that's no longer in the list still has to show as selected.
  const list = options.some((o) => o.key === selected) ? options : [...options, { key: selected, label: selected, isCurrent: false }];
  return (
    <label className="relative inline-flex items-center">
      <CalendarRange className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
      <span className="sr-only">Period</span>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value === current ? undefined : e.target.value)}
        className="h-9 rounded-lg border border-border bg-background pl-8 pr-2 text-sm font-semibold outline-none focus:border-primary"
      >
        {list.map((o) => (
          <option key={o.key} value={o.key}>{o.label}{o.isCurrent ? " (current)" : ""}</option>
        ))}
      </select>
    </label>
  );
}
