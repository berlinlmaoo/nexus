/**
 * "Sep", never "Sept" (UI tour run 7, 14 Oct 2026: the desktop showed "8 Sept 2026" next to "Sep"
 * everywhere else, iOS included). English dates are formatted with en-GB, whose CLDR data abbreviates
 * September as "Sept" while every other month has three letters; no other English locale with day-month
 * order differs. Rather than patch ~70 call sites (and every new one), the formatters themselves are
 * wrapped once, before the app renders. Only the whole word "Sept" changes, so "September" and the
 * Indonesian "Sep" are untouched.
 */
const fix = (s: string) => s.replace(/\bSept\b/g, "Sep");

let installed = false;

export function installMonthAbbrFix() {
  if (installed || typeof Intl === "undefined") return;
  installed = true;
  try {
    const proto = Intl.DateTimeFormat.prototype;
    const formatDesc = Object.getOwnPropertyDescriptor(proto, "format");
    if (formatDesc?.get) {
      const get = formatDesc.get;
      Object.defineProperty(proto, "format", {
        configurable: true,
        enumerable: formatDesc.enumerable,
        get(this: Intl.DateTimeFormat) {
          const native = get.call(this) as (d?: Date | number) => string;
          return (d?: Date | number) => fix(native(d));
        },
      });
    }
    const parts = proto.formatToParts;
    proto.formatToParts = function (this: Intl.DateTimeFormat, d?: Date | number) {
      return parts.call(this, d).map((p) => (p.type === "month" && p.value === "Sept" ? { ...p, value: "Sep" } : p));
    };
    const range = (proto as { formatRange?: (a: Date | number, b: Date | number) => string }).formatRange;
    if (range) {
      (proto as { formatRange?: (a: Date | number, b: Date | number) => string }).formatRange = function (this: Intl.DateTimeFormat, a: Date | number, b: Date | number) {
        return fix(range.call(this, a, b));
      };
    }
    const dp = Date.prototype;
    const toDate = dp.toLocaleDateString;
    const toAll = dp.toLocaleString;
    dp.toLocaleDateString = function (this: Date, ...args: Parameters<Date["toLocaleDateString"]>) { return fix(toDate.apply(this, args)); };
    dp.toLocaleString = function (this: Date, ...args: Parameters<Date["toLocaleString"]>) { return fix(toAll.apply(this, args)); };
  } catch {
    /* an engine that refuses the patch keeps its own text */
  }
}
