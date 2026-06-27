import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/room-display/$room")({ component: RoomDisplay });

// Canonical rooms + friendly slugs so a TV URL can be simple: /room-display/studio, /vip, /meeting.
const ROOMS = [
  { name: "Ruang Meeting VIP", short: "VIP Meeting Room", slugs: ["vip", "ruang-meeting-vip", "meeting-vip"] },
  { name: "Ruang Meeting", short: "Meeting Room", slugs: ["meeting", "ruang-meeting"] },
  { name: "Studio", short: "Studio", slugs: ["studio"] },
] as const;

function resolveRoom(param: string) {
  const p = decodeURIComponent(param).trim().toLowerCase();
  return ROOMS.find((r) => r.name.toLowerCase() === p || (r.slugs as readonly string[]).includes(p)) ?? null;
}

type RawBooking = { id: string; title: string; startsAt: string; endsAt: string };
type Booking = { id: string; title: string; start: Date; end: Date };

const TZ = "Asia/Jakarta";
const fmtTime = (d: Date) => d.toLocaleTimeString("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDayLong = (d: Date) => d.toLocaleDateString("id-ID", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const fmtClock = (d: Date) => d.toLocaleTimeString("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDateTop = (d: Date) => d.toLocaleDateString("id-ID", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const relMins = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60000);

function RoomChooser() {
  return (
    <div style={{ minHeight: "100vh" }} className="flex flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <div className="text-2xl font-bold text-muted-foreground">Pick a room to show on the TV</div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        {ROOMS.map((r) => (
          <Link key={r.name} to="/room-display/$room" params={{ room: r.slugs[0] }} className="rounded-2xl border border-border bg-card px-8 py-6 text-2xl font-black text-foreground shadow-soft transition hover:bg-accent hover:scale-[1.03]">
            {r.short}
          </Link>
        ))}
      </div>
      <div className="text-sm text-muted-foreground">URL: nexus.patsgroup.id/room-display/studio · /vip · /meeting</div>
    </div>
  );
}

function RoomDisplay() {
  const { room: roomParam } = Route.useParams();
  const matched = resolveRoom(roomParam);

  const [raw, setRaw] = useState<RawBooking[]>([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());

  const roomName = matched?.name ?? "";

  // Poll the public endpoint every 30s.
  useEffect(() => {
    if (!roomName) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/room-bookings/public?room=${encodeURIComponent(roomName)}`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { bookings?: RawBooking[] };
        if (alive) { setRaw(data.bookings ?? []); setError(false); setUpdatedAt(new Date()); }
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoaded(true);
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [roomName]);

  // Tick the clock every second.
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);

  const bookings: Booking[] = useMemo(
    () => raw.map((b) => ({ id: b.id, title: b.title, start: new Date(b.startsAt), end: new Date(b.endsAt) })).sort((a, b) => a.start.getTime() - b.start.getTime()),
    [raw],
  );

  if (!matched) return <RoomChooser />;

  const current = bookings.find((b) => b.start.getTime() <= now.getTime() && b.end.getTime() > now.getTime()) ?? null;
  const upcoming = bookings.filter((b) => b.start.getTime() > now.getTime());
  const next = upcoming[0] ?? null;

  // Group upcoming into days for the agenda strip.
  const byDay = new Map<string, Booking[]>();
  for (const b of upcoming) { const k = dayKey(b.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(b); }
  const days = Array.from(byDay.entries()).slice(0, 5);
  const todayK = dayKey(now);

  const occupied = Boolean(current);

  return (
    <div style={{ minHeight: "100vh" }} className="flex flex-col bg-background text-foreground">
      {/* header */}
      <header className="flex items-start justify-between gap-6 px-10 pt-8">
        <div>
          <div className="font-black leading-none tracking-tight" style={{ fontSize: "clamp(2.5rem, 6vw, 5rem)" }}>{matched.short}</div>
        </div>
        <div className="text-right">
          <div className="font-black tabular-nums leading-none" style={{ fontSize: "clamp(2.5rem, 6vw, 5rem)" }}>{fmtClock(now)}</div>
          <div className="mt-1 text-lg font-semibold text-muted-foreground">{fmtDateTop(now)}</div>
        </div>
      </header>

      {/* status hero */}
      <section className="px-10 py-6">
        <div className={cn("rounded-3xl p-8 ring-1 shadow-soft", occupied ? "bg-destructive/10 ring-destructive/30" : "bg-success/10 ring-success/30")}>
          {occupied && current ? (
            <>
              <div className="flex items-center gap-3 text-lg font-black uppercase tracking-widest text-destructive">
                <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-destructive" /> In use
              </div>
              <div className="mt-3 font-black leading-tight text-foreground" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>{current.title}</div>
              <div className="mt-2 text-2xl font-semibold text-muted-foreground">{fmtTime(current.start)} – {fmtTime(current.end)} · ends in {Math.max(0, relMins(now, current.end))} min</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 text-lg font-black uppercase tracking-widest text-success">
                <span className="inline-block h-3 w-3 rounded-full bg-success" /> Available
              </div>
              <div className="mt-3 font-black leading-tight text-foreground" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
                {next && dayKey(next.start) === todayK ? <>Free until {fmtTime(next.start)}</> : <>Free to use</>}
              </div>
              <div className="mt-2 text-2xl font-semibold text-muted-foreground">
                {next ? (dayKey(next.start) === todayK ? <>Up next: {next.title} · starts in {Math.max(0, relMins(now, next.start))} min</> : <>Next booking {fmtDayLong(next.start)}, {fmtTime(next.start)}</>) : <>No bookings coming up</>}
              </div>
            </>
          )}
        </div>
      </section>

      {/* upcoming agenda */}
      <section className="flex-1 overflow-hidden px-10 pb-6">
        <div className="mb-3 text-sm font-black uppercase tracking-[0.3em] text-primary">Up next</div>
        {!loaded ? (
          <div className="text-2xl font-semibold text-muted-foreground">Loading…</div>
        ) : days.length === 0 ? (
          <div className="text-2xl font-semibold text-muted-foreground">No upcoming bookings yet.</div>
        ) : (
          <div className="space-y-5">
            {days.map(([k, items]) => (
              <div key={k}>
                <div className="mb-2 text-lg font-bold text-muted-foreground">{k === todayK ? "Today" : fmtDayLong(items[0].start)}</div>
                <div className="space-y-2">
                  {items.map((b) => (
                    <div key={b.id} className="flex items-center gap-5 rounded-2xl border border-border bg-card px-6 py-4 shadow-soft">
                      <div className="w-44 shrink-0 text-2xl font-black tabular-nums text-primary">{fmtTime(b.start)}<span className="text-muted-foreground"> – {fmtTime(b.end)}</span></div>
                      <div className="truncate text-2xl font-semibold text-foreground">{b.title}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* footer */}
      <footer className="flex items-center justify-between border-t border-border px-10 py-3 text-sm text-muted-foreground">
        <span>{error ? "⚠️ connection lost — showing last data" : updatedAt ? `Updated ${fmtClock(updatedAt)} · auto-refresh every 30s` : "connecting…"}</span>
        <span className="flex gap-4">{ROOMS.map((r) => <Link key={r.name} to="/room-display/$room" params={{ room: r.slugs[0] }} className={r.name === roomName ? "font-bold text-primary" : "hover:text-foreground"}>{r.short}</Link>)}</span>
      </footer>
    </div>
  );
}
