/** "Rab, 17 Sep 14:00–15:30" in WIB — the one line a booking push needs. Lives here rather than in
 *  the route file: Next.js refuses a route module that exports anything but handlers. */
export function formatBookingSlot(start: Date, end: Date) {
  const day = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "short", day: "numeric", month: "short" }).format(start)
  const hm = (d: Date) =>
    new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace(".", ":")
  return `${day} ${hm(start)}–${hm(end)}`
}
