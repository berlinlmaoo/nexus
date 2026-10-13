import { CalendarRange } from "lucide-react";
import { useLang } from "@/lib/lang";
import { SelectPicker } from "@/components/SelectPicker";
import { currentPeriodKey, periodOptions } from "./report-format";

/** Attendance-period picker (28→27): the current period + the 5 before it. `undefined` = current. */
export function PeriodSelect({ value, onChange }: { value: string | undefined; onChange: (period: string | undefined) => void }) {
  const { t } = useLang();
  const options = periodOptions();
  const current = currentPeriodKey();
  const selected = value ?? current;
  // A period from an old link that's no longer in the list still has to show as selected.
  const list = options.some((o) => o.key === selected) ? options : [...options, { key: selected, label: selected, isCurrent: false }];
  return (
    <SelectPicker
      variant="field"
      ariaLabel={t("Attendance period")}
      value={selected}
      onChange={(v) => onChange(v === current ? undefined : v)}
      options={list.map((o) => ({ value: o.key, label: `${o.label}${o.isCurrent ? ` (${t("current")})` : ""}` }))}
      renderValue={(o) => (
        <span className="flex min-w-0 items-center gap-2">
          <CalendarRange aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{o?.label ?? selected}</span>
        </span>
      )}
      className="h-9 px-2.5 font-semibold"
    />
  );
}
