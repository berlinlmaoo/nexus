/**
 * A month as a title: "October" in the current year, "January 2027" in any other (owner rule, run 19 decision 2:
 * the current year is hidden in month titles too, as in dates — "Sales · October", "Targets for October").
 * `timeZone` reads both the month and "this year" in that zone (UTC for "YYYY-MM-01T00:00:00Z" month keys).
 */
export function monthTitle(d: Date, locale: string, timeZone?: string): string {
  const yearOf = (x: Date) => new Intl.DateTimeFormat("en", { year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(x);
  const sameYear = yearOf(d) === yearOf(new Date());
  return new Intl.DateTimeFormat(locale, { month: "long", ...(sameYear ? {} : { year: "numeric" }), ...(timeZone ? { timeZone } : {}) }).format(d);
}
