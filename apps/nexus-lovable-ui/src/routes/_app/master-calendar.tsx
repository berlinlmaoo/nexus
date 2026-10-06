import { createFileRoute, redirect } from "@tanstack/react-router";

// The Team Calendar page is gone: its job moved to /calendar (tasks, deadlines and holidays for the
// whole org) and room bookings live on /room-booking. The route stays as a redirect because old links
// still point here — bookmarks, and room-booking notifications that carry ?booking=<id>.
type Search = { booking?: string; date?: string };

export const Route = createFileRoute("/_app/master-calendar")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    booking: typeof s.booking === "string" && s.booking ? s.booking : undefined,
    date: typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.booking) throw redirect({ to: "/room-booking", search: { booking: search.booking } });
    throw redirect({ to: "/calendar", search: search.date ? { date: search.date } : {} });
  },
  component: () => null,
});
