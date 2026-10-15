/**
 * "Sep", never "Sept" (UI tour run 7, 14 Oct 2026: the desktop showed "8 Sept 2026" next to "Sep"
 * everywhere else, iOS included). English dates are formatted with en-GB, whose CLDR data abbreviates
 * September as "Sept" while every other month has three letters; no other English locale with day-month
 * order differs. Rather than patch ~70 call sites (and every new one), the formatters themselves are
 * wrapped once, before the app renders. Only the whole word "Sept" changes, so "September" and the
 * Indonesian "Sep" are untouched.
 *
 * And no comma between a date and its time: "16 Sep 11:27", not "16 Sep, 11:27" (UI tour run 15, shared
 * decision 16; the apps write it that way). Only a comma right after a day-month(-year) or a numeric date and
 * right before a clock time is dropped, so "Rabu, 16 Sep" keeps its own.
 */
const DATE_TIME_COMMA = /(\d{1,2} \p{L}{3,9}\.?(?: \d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}), (?=\d{1,2}[.:]\d{2})/gu;
const fix = (s: string) => s.replace(/\bSept\b/g, "Sep").replace(DATE_TIME_COMMA, "$1 ");

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
      const out = parts.call(this, d).map((p) => (p.type === "month" && p.value === "Sept" ? { ...p, value: "Sep" } : p));
      // The literal ", " between the date and the time becomes a space (see DATE_TIME_COMMA).
      return out.map((p, i) => (p.type === "literal" && /^,\s*$/.test(p.value) && out[i + 1]?.type === "hour" && /^(day|month|year)$/.test(out[i - 1]?.type ?? "") ? { ...p, value: " " } : p));
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
