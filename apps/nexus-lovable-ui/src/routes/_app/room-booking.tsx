import { useMemo, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { fmtTime, nexusApi, ROOM_BOOKING_ROOMS, roomLabel, type NexusRoomBooking } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/room-booking")({ component: RoomBooking });

const ROOM_STYLE: Record<string, { dot: string; chip: string }> = {
  "Ruang Meeting VIP": { dot: "bg-amber-500", chip: "bg-amber-100 text-amber-700" },
  "Ruang Meeting": { dot: "bg-sky-500", chip: "bg-sky-100 text-sky-700" },
  "Studio": { dot: "bg-violet-500", chip: "bg-violet-100 text-violet-700" },
};
const roomStyle = (room: string) => ROOM_STYLE[room] ?? { dot: "bg-muted-foreground/40", chip: "bg-muted text-muted-foreground" };

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ini(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function RoomBooking() {
  const [viewMonth, setViewMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [roomFilter, setRoomFilter] = useState<string>("");
  const [composer, setComposer] = useState<{ booking?: NexusRoomBooking; date?: string } | null>(null);

  const rangeStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).toISOString();
  const rangeEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const bookingsQ = useQuery({
    queryKey: ["room-bookings", rangeStart, rangeEnd, roomFilter],
    queryFn: () => nexusApi.roomBookings(rangeStart, rangeEnd, roomFilter || undefined),
    retry: 1,
  });

  const todayKey = dayKey(new Date());
  // Only the current-month view hides elapsed days (so the agenda starts at today); navigating to a past
  // month still shows its full history, and future months have no past days anyway.
  const now = new Date();
  const hidePast = viewMonth.getFullYear() === now.getFullYear() && viewMonth.getMonth() === now.getMonth();
  const agenda = useMemo(() => {
    const map = new Map<string, NexusRoomBooking[]>();
    for (const b of bookingsQ.data?.bookings ?? []) {
      const k = dayKey(new Date(b.startsAt));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    return Array.from(map.entries())
      .filter(([k]) => !hidePast || k >= todayKey)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, items]) => [k, items.sort((x, y) => new Date(x.startsAt).getTime() - new Date(y.startsAt).getTime())] as const);
  }, [bookingsQ.data, hidePast, todayKey]);

  const shiftMonth = (delta: number) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div>
      <PageHeader
        title="Room Booking"
        subtitle="Book a room — VIP, Meeting, Studio. Live agenda per workspace."
        actions={
          <>
            <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold outline-none focus:border-primary">
              <option value="">All rooms</option>
              {ROOM_BOOKING_ROOMS.map((r) => <option key={r} value={r}>{roomLabel(r)}</option>)}
            </select>
            <button onClick={() => setComposer({ date: todayKey })} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> New booking</button>
          </>
        }
      />
      <div className="p-4 md:p-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight">{viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setViewMonth(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })} className="rounded-md border border-border px-3 py-1 text-xs font-semibold transition-colors hover:bg-accent">Today</button>
            <button onClick={() => shiftMonth(1)} aria-label="Next month" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        {bookingsQ.isLoading && <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {bookingsQ.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><div className="text-lg font-black">Bookings locked</div><p className="mt-2 text-sm text-muted-foreground">Login/session required. If the bookings table hasn't been pushed to the DB yet, run <code>npm run db:push</code> on the backend first.</p></div>}
        {!bookingsQ.isLoading && !bookingsQ.isError && agenda.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center shadow-soft">
            <CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <div className="text-lg font-black">Nothing booked</div>
            <p className="mt-1 text-sm text-muted-foreground">Nothing booked in {viewMonth.toLocaleDateString("en-US", { month: "long" })} yet. Add one with New booking.</p>
          </div>
        )}

        {agenda.length > 0 && (
          <div className="space-y-6">
            {agenda.map(([k, items]) => {
              const d = new Date(k);
              const isToday = k === todayKey;
              return (
                <div key={k} className="flex gap-4">
                  <div className="w-12 shrink-0 text-center">
                    <div className={cn("flex flex-col items-center justify-center rounded-2xl py-2", isToday ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-foreground")}>
                      <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                      <span className="font-display text-xl font-bold leading-none">{d.getDate()}</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-baseline gap-2 pt-1">
                      <span className="text-sm font-bold">{d.toLocaleDateString("en-US", { weekday: "long" })}</span>
                      {isToday && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Today</span>}
                      <span className="text-xs text-muted-foreground">· {items.length} booking{items.length === 1 ? "" : "s"}</span>
                    </div>
                    {items.map((b) => {
                      const s = roomStyle(b.room);
                      return (
                        <button key={b.id} onClick={() => setComposer({ booking: b })} className="group flex w-full items-stretch gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-soft transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-pop active:scale-[0.98] motion-reduce:transform-none">
                          <span className="w-16 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                            {fmtTime(b.startsAt)}
                            <span className="block font-normal text-muted-foreground/70">{fmtTime(b.endsAt)}</span>
                          </span>
                          <span className={cn("w-1 shrink-0 rounded-full", s.dot)} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold group-hover:text-primary">{b.title}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-bold", s.chip)}><MapPin className="h-3 w-3" />{roomLabel(b.room)}</span>
                              {b.createdBy?.name && <span>by {b.createdBy.name}</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {composer && <BookingComposer key="composer" booking={composer.booking} initialDate={composer.date} onClose={() => setComposer(null)} />}
      </AnimatePresence>
    </div>
  );
}

function toLocalInputs(iso?: string) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function BookingComposer({ booking, initialDate, onClose }: { booking?: NexusRoomBooking; initialDate?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!booking;
  const startInit = toLocalInputs(booking?.startsAt);
  const endInit = toLocalInputs(booking?.endsAt);
  const [room, setRoom] = useState<string>(booking?.room ?? ROOM_BOOKING_ROOMS[0]);
  const [title, setTitle] = useState(booking?.title ?? "");
  const [date, setDate] = useState(startInit.date || initialDate || dayKey(new Date()));
  const [startTime, setStartTime] = useState(startInit.time || "09:00");
  const [endTime, setEndTime] = useState(endInit.time || "10:00");
  const [description, setDescription] = useState(booking?.description ?? "");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const invalidate = () => qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("room-bookings") });
  const buildPayload = () => ({
    room,
    title: title.trim(),
    startsAt: new Date(`${date}T${startTime}`).toISOString(),
    endsAt: new Date(`${date}T${endTime}`).toISOString(),
    description: description || null,
  });

  const save = useMutation({
    mutationFn: () => editing ? nexusApi.updateRoomBooking(booking!.id, buildPayload()) : nexusApi.createRoomBooking(buildPayload()),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Couldn't save the booking."),
  });
  const del = useMutation({
    mutationFn: () => nexusApi.deleteRoomBooking(booking!.id),
    onSuccess: () => { invalidate(); onClose(); },
  });

  const canSave = title.trim() && date && startTime && endTime && endTime > startTime && !save.isPending;
  const field = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary";

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-0 sm:p-4">
      <motion.div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        role="dialog" aria-modal="true"
        initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className="relative z-10 flex max-h-[100dvh] w-full max-w-lg flex-col overflow-y-auto bg-card shadow-pop sm:max-h-[92dvh] sm:rounded-3xl sm:border sm:border-border"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
          <h2 className="font-display text-lg font-bold tracking-tight">{editing ? "Edit booking" : "New booking"}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 p-5">
          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Room</span>
            <select value={room} onChange={(e) => setRoom(e.target.value)} className={field}>
              {ROOM_BOOKING_ROOMS.map((r) => <option key={r} value={r}>{roomLabel(r)}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diageo client meeting" className={field} />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Start</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={field} />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">End</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={field} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Notes (optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={cn(field, "resize-y")} />
          </label>

          {endTime <= startTime && <p className="text-xs font-semibold text-destructive">End time has to be after the start time.</p>}
          {err && <p className="text-xs font-semibold text-destructive">{err}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button disabled={!canSave} onClick={() => { setErr(null); save.mutate(); }} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? <><Pencil className="h-4 w-4" /> Update</> : "Book room"}
            </button>
            {editing && (
              <button onClick={() => { if (confirm("Delete this booking?")) del.mutate(); }} disabled={del.isPending} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 active:scale-[0.98] disabled:opacity-50">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
