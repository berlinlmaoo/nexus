import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Plus, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { fmtTime, nexusApi, type CalendarEventPayload, type NexusCalendarEvent, type NexusTeam } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/master-calendar")({ component: MasterCalendar });

const ini = (name?: string | null) => (name ? name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") : "?");
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthGrid(anchor: Date) {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function MasterCalendar() {
  const [teamId, setTeamId] = useState<string>("");
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<"agenda" | "calendar">("agenda");
  const [composer, setComposer] = useState<{ date: string; event?: NexusCalendarEvent } | null>(null);

  const teams = useQuery({ queryKey: ["nexus", "teams"], queryFn: nexusApi.teams, retry: false });
  const teamList = teams.data ?? [];
  const activeTeamId = teamId || teamList[0]?.id || "";

  const days = useMemo(() => monthGrid(anchor), [anchor]);
  const rangeStart = days[0].toISOString();
  const rangeEnd = days[days.length - 1].toISOString();

  const events = useQuery({
    queryKey: ["nexus", "calendar", activeTeamId, rangeStart, rangeEnd],
    queryFn: () => nexusApi.masterCalendar(activeTeamId, rangeStart, rangeEnd),
    enabled: !!activeTeamId,
    retry: false,
  });
  const agenda = useMemo(() => {
    const map = new Map<string, NexusCalendarEvent[]>();
    for (const ev of events.data?.events ?? []) {
      const d = new Date(ev.startsAt);
      if (d.getMonth() !== anchor.getMonth() || d.getFullYear() !== anchor.getFullYear()) continue;
      const k = ev.startsAt.slice(0, 10);
      map.set(k, [...(map.get(k) ?? []), ev]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, evs]) => [k, [...evs].sort((x, y) => Number(y.isAllDay ?? false) - Number(x.isAllDay ?? false) || x.startsAt.localeCompare(y.startsAt))] as const);
  }, [events.data, anchor]);
  const byDay = useMemo(() => {
    const map = new Map<string, NexusCalendarEvent[]>();
    for (const ev of events.data?.events ?? []) {
      const k = ev.startsAt.slice(0, 10);
      map.set(k, [...(map.get(k) ?? []), ev]);
    }
    return map;
  }, [events.data]);

  const activeTeam = teamList.find((t) => t.id === activeTeamId);
  const todayKey = dayKey(new Date());

  return (
    <div>
      <PageHeader
        title="Team Calendar"
        subtitle="Shared schedule, meetings, and availability — live per team."
        actions={
          <>
            <select value={activeTeamId} onChange={(e) => setTeamId(e.target.value)} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold outline-none focus:border-primary">
              {teamList.length === 0 && <option value="">No teams</option>}
              {teamList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button disabled={!activeTeamId} onClick={() => setComposer({ date: todayKey })} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> New event</button>
          </>
        }
      />

      <div className="p-4 md:p-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold tracking-tight">{anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
          <div className="flex items-center gap-3">
            {/* view switcher */}
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
              {(["agenda", "calendar"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={cn("rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>{v}</button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))} className="rounded-lg border border-border p-1.5 transition-colors hover:bg-accent active:scale-[0.97]"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={() => setAnchor(new Date())} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent active:scale-[0.98]">Today</button>
              <button onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))} className="rounded-lg border border-border p-1.5 transition-colors hover:bg-accent active:scale-[0.97]"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        {teams.isLoading && <CenterLoader />}
        {!teams.isLoading && teamList.length === 0 && <Empty title="No teams yet" message="Master calendar is team-scoped. Buat / gabung team dulu untuk lihat jadwal." />}

        {activeTeamId && events.isLoading && <CenterLoader />}
        {activeTeamId && events.isError && <Empty title="Couldn't load events" message="Gagal memuat events — cek akses team / session." />}
        {activeTeamId && view === "agenda" && !events.isLoading && !events.isError && agenda.length === 0 && (
          <Empty title="Nothing scheduled" message="Belum ada agenda di bulan ini. Tambah lewat New event." />
        )}

        {/* CALENDAR (month grid) view */}
        {activeTeamId && view === "calendar" && !events.isError && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const k = dayKey(d);
                const inMonth = d.getMonth() === anchor.getMonth();
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const dayEvents = byDay.get(k) ?? [];
                return (
                  <div key={k} className={cn("min-h-24 border-b border-r border-border p-1.5 last:border-r-0", weekend && "bg-muted/20", !inMonth && "bg-muted/30 text-muted-foreground/50")}>
                    <button onClick={() => setComposer({ date: k })} className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors hover:bg-accent", k === todayKey && "bg-primary text-primary-foreground hover:bg-primary")}>{d.getDate()}</button>
                    <div className="mt-1 space-y-1">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <button key={ev.id} onClick={() => setComposer({ date: k, event: ev })} className="block w-full truncate rounded-md bg-primary/10 px-1.5 py-0.5 text-left text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20">
                          {!ev.isAllDay && <span className="text-primary/70">{fmtTime(ev.startsAt)} </span>}{ev.title}
                        </button>
                      ))}
                      {dayEvents.length > 3 && <div className="px-1.5 text-[10px] font-semibold text-muted-foreground">+{dayEvents.length - 3} more</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTeamId && view === "agenda" && agenda.length > 0 && (
          <div className="space-y-6">
            {agenda.map(([k, evs]) => {
              const d = new Date(k);
              const isToday = k === todayKey;
              return (
                <div key={k} className="flex gap-4">
                  {/* date column */}
                  <div className="w-12 shrink-0 text-center">
                    <div className={cn("flex flex-col items-center justify-center rounded-2xl py-2", isToday ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-foreground")}>
                      <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                      <span className="font-display text-xl font-bold leading-none">{d.getDate()}</span>
                    </div>
                  </div>
                  {/* events */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-baseline gap-2 pt-1">
                      <span className="text-sm font-bold">{d.toLocaleDateString("en-US", { weekday: "long" })}</span>
                      {isToday && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Today</span>}
                      <span className="text-xs text-muted-foreground">· {evs.length} event{evs.length === 1 ? "" : "s"}</span>
                    </div>
                    {evs.map((ev) => (
                      <button key={ev.id} onClick={() => setComposer({ date: k, event: ev })} className="group flex w-full items-stretch gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        <span className="w-16 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                          {ev.isAllDay ? "All day" : (<>{fmtTime(ev.startsAt)}{ev.endsAt && <span className="block font-normal text-muted-foreground/70">{fmtTime(ev.endsAt)}</span>}</>)}
                        </span>
                        <span className="w-1 shrink-0 rounded-full bg-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold group-hover:text-primary">{ev.title}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            {ev.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{ev.location}</span>}
                            {(ev.attendees?.length ?? 0) > 0 && <span>{ev.attendees!.length} attendee{ev.attendees!.length === 1 ? "" : "s"}</span>}
                          </div>
                        </div>
                        {(ev.attendees?.length ?? 0) > 0 && (
                          <div className="hidden shrink-0 items-center -space-x-1.5 sm:flex">
                            {ev.attendees!.slice(0, 4).map((a, i) => <span key={i} title={a.user?.name ?? ""} className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary ring-2 ring-card">{ini(a.user?.name)}</span>)}
                            {ev.attendees!.length > 4 && <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground ring-2 ring-card">+{ev.attendees!.length - 4}</span>}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {composer && activeTeam && (
        <EventComposer team={activeTeam} date={composer.date} event={composer.event} onClose={() => setComposer(null)} />
      )}
    </div>
  );
}

function EventComposer({ team, date, event, onClose }: { team: NexusTeam; date: string; event?: NexusCalendarEvent; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!event;
  const [title, setTitle] = useState(event?.title ?? "");
  const [eventDate, setEventDate] = useState(event ? event.startsAt.slice(0, 10) : date);
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay ?? false);
  const [startTime, setStartTime] = useState(event && !event.isAllDay ? event.startsAt.slice(11, 16) : "09:00");
  const [endTime, setEndTime] = useState(event?.endsAt && !event.isAllDay ? event.endsAt.slice(11, 16) : "10:00");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [attendeeIds, setAttendeeIds] = useState<string[]>(() => (event?.attendees ?? []).map((a) => a.userId || a.user?.id).filter(Boolean) as string[]);

  const invalidate = () => qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("calendar") });
  const payload = (): CalendarEventPayload => ({ teamId: team.id, title: title.trim(), date: eventDate, isAllDay, startTime: isAllDay ? null : startTime, endTime: isAllDay ? null : endTime, attendeeIds, location: location || null, description: description || null });

  const save = useMutation({
    mutationFn: () => editing ? nexusApi.updateCalendarEvent(event!.id, payload()) : nexusApi.createCalendarEvent(payload()),
    onSuccess: () => { invalidate(); onClose(); },
  });
  const del = useMutation({ mutationFn: () => nexusApi.deleteCalendarEvent(event!.id), onSuccess: () => { invalidate(); onClose(); } });

  const members = team.members ?? [];
  const toggleAttendee = (id: string) => setAttendeeIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">{editing ? "Edit event" : "New event"}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-bold text-muted-foreground">Date<input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-2 py-2 text-sm" /></label>
            <label className="flex items-end gap-2 pb-2 text-sm font-semibold"><input type="checkbox" checked={isAllDay} onChange={(e) => setIsAllDay(e.target.checked)} className="h-4 w-4 accent-primary" /> All day</label>
          </div>
          {!isAllDay && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-bold text-muted-foreground"><Clock className="mr-1 inline h-3 w-3" />Start<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-2 py-2 text-sm" /></label>
              <label className="text-[11px] font-bold text-muted-foreground">End<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-2 py-2 text-sm" /></label>
            </div>
          )}
          <label className="block text-[11px] font-bold text-muted-foreground"><MapPin className="mr-1 inline h-3 w-3" />Location<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room / link" className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" /></label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description…" className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          {members.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Attendees</span>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const id = m.userId || m.user?.id; if (!id) return null;
                  const on = attendeeIds.includes(id);
                  return <button key={id} onClick={() => toggleAttendee(id)} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors", on ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-accent")}>{m.user?.name ?? m.user?.email ?? "Member"}</button>;
                })}
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center gap-2">
          <button disabled={!title.trim() || save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? "Save" : "Create event"}</button>
          {editing && <button onClick={() => { if (confirm("Delete this event?")) del.mutate(); }} className="inline-flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 active:scale-[0.98]"><Trash2 className="h-4 w-4" /> Delete</button>}
          {save.isError && <span className="text-xs font-semibold text-destructive">Gagal — cek akses team.</span>}
        </div>
      </div>
    </div>
  );
}

function CenterLoader() {
  return <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
}
function Empty({ title, message }: { title: string; message: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">{title}</div><p className="mt-2 text-sm text-muted-foreground">{message}</p></div>;
}
