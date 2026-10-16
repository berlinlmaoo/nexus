import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { CalendarClock, Check, ChevronRight, Loader2 } from "lucide-react";
import { decideGideonProposal, roomAvailability, type GideonProposal, type RoomAvailability } from "@/lib/gideon";
import { roomLabel } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { PROPOSAL_APPLY, PROPOSAL_DISCARD, ProposalHead } from "./GideonProposalParts";

/**
 * GIDEON's book_room card (owner, 16 Oct 2026). GIDEON never guesses a room: the card lists every room with its
 * availability for that exact slot (read live — it changes by the minute), free ones selectable, busy ones
 * disabled with who holds them until when. A named room is preselected when it is free; otherwise, with exactly
 * one room free, that one is. With none free, the nearest free slots (same day, ±2 h) are chips that move the
 * card to that time. Apply stays disabled until a free room is chosen, and sends the room and slot: the server
 * checks both again and, if taken meanwhile, keeps the card open with the reason.
 */
export function GideonBookRoomCard({ proposal, onDecided }: { proposal: GideonProposal; onDecided: (p: GideonProposal) => void }) {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const router = useRouter();
  const b = proposal.booking!;
  const open = proposal.status === "PENDING";
  const [slot, setSlot] = useState({ startsAt: b.startsAt, endsAt: b.endsAt });
  const [room, setRoom] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["room-availability", slot.startsAt, slot.endsAt],
    queryFn: () => roomAvailability(slot.startsAt, slot.endsAt),
    enabled: open,
    staleTime: 15_000,
    retry: 1,
  });
  const rooms = q.data?.rooms ?? [];
  const free = rooms.filter((r) => r.free);
  const named = b.room ? rooms.find((r) => r.room === b.room) : undefined;

  // The preselection, until the person picks: the named room if it is free, else the only free room.
  useEffect(() => {
    if (touched || !q.data) return;
    setRoom(named?.free ? named.room : free.length === 1 ? free[0].room : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, touched]);
  // A server refusal (taken meanwhile) shows its reason and re-reads the rooms.
  useEffect(() => {
    if (open && proposal.error) void qc.invalidateQueries({ queryKey: ["room-availability"] });
  }, [open, proposal.error, qc]);

  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).replace(/,/g, "");
  const when = `${day(slot.startsAt)} · ${time(slot.startsAt)}–${time(slot.endsAt)}`;
  const chosen = rooms.find((r) => r.room === room && r.free);

  const decide = async (d: "apply" | "discard") => {
    setPending(d);
    setError(null);
    try {
      const next = await decideGideonProposal(proposal.id, d, d === "apply" && chosen ? { room: chosen.room, startsAt: slot.startsAt, endsAt: slot.endsAt } : undefined);
      onDecided(next);
      if (next.status === "APPLIED") void qc.invalidateQueries({ queryKey: ["room-bookings"] });
      if (next.status === "PENDING") { setTouched(false); void qc.invalidateQueries({ queryKey: ["room-availability"] }); }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't do that."));
    } finally {
      setPending(null);
    }
  };

  const statusLine =
    proposal.status === "APPLIED" ? t("Room booked") :
    proposal.status === "DISCARDED" ? t("Discarded") :
    proposal.status === "FAILED" ? t("Couldn't apply: {reason}", { reason: proposal.error ?? "" }) :
    proposal.status === "APPLYING" ? t("Applying…") : null;

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card", open ? "shadow-soft" : "opacity-90")}>
      <ProposalHead open={open} title={open ? b.title : t("Book a room")} summary={b.title} />
      <div className="space-y-2 px-3 pb-2.5 text-xs">
        <div className="flex items-center gap-1.5 font-medium"><CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />{when}</div>
        {open && (
          <>
            {q.isLoading && <div className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("Checking the rooms…")}</div>}
            {q.isError && <div className="text-destructive">{t("Couldn't check the rooms.")}</div>}
            {named && !named.free && <div className="text-amber-700 dark:text-amber-400">{t("{room} is booked then. Pick a free room below.", { room: t(roomLabel(named.room)) })}</div>}
            <RoomPicker rooms={rooms} room={room} disabled={!!pending} onPick={(r) => { setTouched(true); setRoom(r); }} />
            {q.data && free.length === 0 && (
              <FreeSlotChips slots={q.data.freeSlots} onPick={(f) => { setTouched(false); setRoom(null); setSlot(f); }} />
            )}
            {proposal.error && <div className="font-medium text-destructive">{proposal.error}</div>}
          </>
        )}
        {!open && proposal.status === "APPLIED" && b.room && <div className="font-medium">{t(roomLabel(b.room))}</div>}
      </div>
      {statusLine && <div className={cn("px-3 py-2 text-xs font-medium", proposal.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>{statusLine}</div>}
      {proposal.status === "APPLIED" && b.bookingId && (
        <div className="px-3 pb-3">
          <a
            href={`/room-booking?booking=${b.bookingId}`}
            onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); router.history.push(`/room-booking?booking=${b.bookingId}`); }}
            className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <CalendarClock className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /><span className="flex-1">{t("Open Room Booking")}</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
          </a>
        </div>
      )}
      {error && <div className="px-3 pb-2 text-xs font-medium text-destructive">{error}</div>}
      {open && (
        <div className="flex justify-end gap-1.5 border-t border-border/60 px-2.5 py-2">
          <button type="button" onClick={() => void decide("discard")} disabled={!!pending} className={PROPOSAL_DISCARD}>
            {pending === "discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Discard")}
          </button>
          <button type="button" onClick={() => void decide("apply")} disabled={!!pending || !chosen} title={!chosen ? t("Choose a room") : undefined} className={PROPOSAL_APPLY}>
            {pending === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t("Apply")}
          </button>
        </div>
      )}
    </div>
  );
}

const wibTime = (iso: string, locale: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });

/**
 * Every room for one slot: free ones selectable, busy ones disabled with who holds them until when, the capacity
 * when it is known. Shared by the book_room card and the move card (GideonBookingChangeCard).
 */
export function RoomPicker({ rooms, room, disabled, onPick }: { rooms: RoomAvailability["rooms"]; room: string | null; disabled?: boolean; onPick: (room: string) => void }) {
  const { t, locale } = useLang();
  if (rooms.length === 0) return null;
  return (
    <div role="radiogroup" aria-label={t("Choose a room")} className="space-y-1">
      {rooms.map((r) => (
        <button
          key={r.room}
          type="button"
          role="radio"
          aria-checked={room === r.room}
          disabled={!r.free || disabled}
          onClick={() => onPick(r.room)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
            room === r.room && r.free ? "border-ring bg-accent/60" : "border-border",
            r.free ? "hover:border-primary/40" : "cursor-not-allowed opacity-60",
          )}
        >
          <span className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border", room === r.room && r.free ? "border-ring" : "border-muted-foreground/50")}>
            {room === r.room && r.free && <span className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t(roomLabel(r.room))}{r.capacity ? <span className="font-normal text-muted-foreground"> · {t("{n} seats", { n: r.capacity })}</span> : null}</span>
            {r.busy && <span className="block truncate text-muted-foreground">{t("Booked by {name} until {time}", { name: r.busy.by ?? t("someone"), time: wibTime(r.busy.endsAt, locale) })}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The nearest free slots (same day, ±2 h) when no room is free: a chip moves the card to that time. */
export function FreeSlotChips({ slots, onPick }: { slots: RoomAvailability["freeSlots"]; onPick: (slot: { startsAt: string; endsAt: string }) => void }) {
  const { t, locale } = useLang();
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground">{t("No room is free then. Nearest free times:")}</div>
      <div className="flex flex-wrap gap-1">
        {slots.map((f) => (
          <button
            key={f.startsAt}
            type="button"
            onClick={() => onPick({ startsAt: f.startsAt, endsAt: f.endsAt })}
            className="rounded-full border border-border px-2 py-0.5 font-medium tabular-nums transition-colors hover:border-primary/40 hover:bg-accent"
          >
            {wibTime(f.startsAt, locale)}–{wibTime(f.endsAt, locale)}
          </button>
        ))}
      </div>
    </div>
  );
}
