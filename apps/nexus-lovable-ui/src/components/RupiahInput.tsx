import type { ClipboardEvent } from "react";
import { groupIdrDigits, normalizeNumberFieldValue } from "@/lib/custom-field-number";
import { cn } from "@/lib/utils";

/**
 * A Rupiah amount box: shows "Rp 369.000" while typing and hands back integer digits ("369000") —
 * never decimals, so a typed "369.000" can no longer reach the server as 369. Typed separators are
 * swallowed (the grouping comes back by itself); a paste ("Rp 1.500.000,00", "17jt") is read whole.
 * A legacy stored value ("369.000") shows as Rp 369.000.
 */
export function RupiahInput({
  value,
  onChange,
  onBlur,
  className,
  wrapperClassName,
  required,
  placeholder = "0",
  ariaLabel,
}: {
  value: string;
  onChange: (digits: string) => void;
  onBlur?: () => void;
  className?: string;
  wrapperClassName?: string;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.trim()) return;
    e.preventDefault();
    onChange(normalizeNumberFieldValue(text, "currency-idr").replace("-", ""));
  };
  return (
    <div className={cn("relative", wrapperClassName)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">Rp</span>
      <input
        inputMode="numeric"
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={groupIdrDigits(normalizeNumberFieldValue(value, "currency-idr"))}
        onChange={(e) => onChange(e.target.value.replace(/\D+/g, ""))}
        onPaste={onPaste}
        onBlur={onBlur}
        className={cn(className, "pl-8")}
      />
    </div>
  );
}
