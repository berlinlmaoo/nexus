import type { ClipboardEvent, KeyboardEvent, Ref } from "react";
import { groupIdrDigits, normalizeNumberFieldValue } from "@/lib/custom-field-number";
import { cn } from "@/lib/utils";

/**
 * A Rupiah amount box: shows "Rp 369.000" while typing and hands back integer digits ("369000") —
 * never decimals, so a typed "369.000" can no longer reach the server as 369. Typed separators are
 * swallowed (the grouping comes back by itself); a paste ("Rp 1.500.000,00", "17jt") is read whole.
 * A legacy stored value ("369.000") shows as Rp 369.000. Empty, the box shows only its "Rp" mark: a grey
 * "0" read like a real zero (UI tour run 14, R14-WB-1 / R14-WB-11).
 */
export function RupiahInput({
  value,
  onChange,
  onBlur,
  className,
  wrapperClassName,
  required,
  placeholder = "",
  ariaLabel,
  inputRef,
  onKeyDown,
}: {
  value: string;
  onChange: (digits: string) => void;
  onBlur?: () => void;
  className?: string;
  wrapperClassName?: string;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.trim()) return;
    e.preventDefault();
    onChange(normalizeNumberFieldValue(text, "currency-idr").replace("-", ""));
  };
  return (
    <div className={cn("relative", wrapperClassName)}>
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm font-semibold text-muted-foreground">Rp</span>
      <input
        ref={inputRef}
        onKeyDown={onKeyDown}
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
