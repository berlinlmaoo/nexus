import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowDown, CalendarClock, Check, ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { decideGideonProposal, roomAvailability, type GideonProposal } from "@/lib/gideon";
import { roomLabel } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { FreeSlotChips, RoomPicker } from "./GideonBookRoomCard";

/**
 * GIDEON's move_room_booking / cancel_room_booking card (owner, 16 Oct 2026). Both show the booking as it is now;
 * a move also shows where it goes, with the room picker and nearest-slot chips of the book_room card (the rooms'
 * availability for the new slot is read live, leaving this booking out, and checked again on Apply). The new room
 * is preselected when it is free; with a room that could be more than one, or a busy one, the person picks.
 * Apply sends the booking id (and for a move the room and slot): a client that cannot is refused by the server.
 */
export function GideonBookingChangeCard({ proposal, onDecided }: { proposal: GideonProposal; onDecided: (p: GideonProposal) => void }) {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const router = useRouter();
  const c = proposal.bookingChange!;
  const isMove = c.kind === "move";
  const open = proposal.status === "PENDING";
  const [slot, setSlot] = useState({ startsAt: c.after?.startsAt ?? c.before.startsAt, endsAt: c.after?.endsAt ?? c.before.endsAt });
  const [room, setRoom] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["room-availability", slot.startsAt, slot.endsAt, c.bookingId],
    queryFn: () => roomAvailability(slot.startsAt, slot.endsAt, c.bookingId),
    enabled: open && isMove,
    staleTime: 15_000,
    retry: 1,
  });
  const rooms = q.data?.rooms ?? [];
  const free = rooms.filter((r) => r.free);
  const target = c.after?.room ? rooms.find((r) => r.room === c.after?.room) : undefined;

  // The preselection, until the person picks: the new room if it is free, else the only free one among the candidates.
  useEffect(() => {
    if (!isMove || touched || !q.data) return;
    const candidates = free.filter((r) => (c.after?.candidates ?? []).includes(r.room));
    setRoom(target?.free ? target.room : candidates.length === 1 ? candidates[0].room : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, touched]);
  useEffect(() => {
    if (open && isMove && proposal.error) void qc.invalidateQueries({ queryKey: ["room-availability"] });
  }, [open, isMove, proposal.error, qc]);

  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).replace(/,/g, "");
  const when = (s: { startsAt: string; endsAt: string }) => `${day(s.startsAt)} · ${time(s.startsAt)}–${time(s.endsAt)}`;
  const chosen = rooms.find((r) => r.room === room && r.free);
  const canApply = isMove ? !!chosen : true;

  const decide = async (d: "apply" | "discard") => {
    setPending(d);
    setError(null);
    try {
      const choice = d !== "apply" ? undefined : isMove ? (chosen ? { bookingId: c.bookingId, room: chosen.room, startsAt: slot.startsAt, endsAt: slot.endsAt } : undefined) : { bookingId: c.bookingId };
      const next = await decideGideonProposal(proposal.id, d, choice);
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
    proposal.status === "APPLIED" ? (isMove ? t("Booking moved") : t("Booking cancelled")) :
    proposal.status === "DISCARDED" ? t("Discarded") :
    proposal.status === "FAILED" ? t("Couldn't apply: {reason}", { reason: proposal.error ?? "" }) :
    proposal.status === "APPLYING" ? t("Applying…") : null;
  const landed = c.applied ?? null;

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-background", open ? "border-amber-500/40" : "border-border opacity-90")}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <ShieldCheck className={cn("h-4 w-4 shrink-0", open ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-muted-foreground">{open ? t("Waiting for your approval") : isMove ? t("Move a booking") : t("Cancel a booking")}</span>
          <span className="block truncate text-sm font-semibold" title={c.title}>{c.title}</span>
        </span>
      </div>
      <div className="space-y-2 px-3 py-2 text-xs">
        <div className={cn("rounded-lg border border-border px-2.5 py-1.5", !isMove && proposal.status === "APPLIED" && "line-through opacity-70")}>
          {isMove && <span className="block text-[11px] font-semibold text-muted-foreground">{t("Now")}</span>}
          <span className="block font-semibold">{t(roomLabel(c.before.room))}</span>
          <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />{when(c.before)}</span>
          {c.bookedBy && <span className="block truncate text-muted-foreground">{t("Booked by {name}", { name: c.bookedBy })}</span>}
        </div>
        {isMove && (
          <>
            <div className="flex justify-center text-muted-foreground" aria-hidden><ArrowDown className="h-3.5 w-3.5" /></div>
            <div className="rounded-lg border border-primary/40 px-2.5 py-1.5">
              <span className="block text-[11px] font-semibold text-muted-foreground">{t("Moves to")}</span>
              {!open && landed ? (
                <>
                  <span className="block font-semibold">{t(roomLabel(landed.room))}</span>
                  <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />{when(landed)}</span>
                </>
              ) : (
                <>
                  {(chosen?.room ?? c.after?.room) && <span className="block font-semibold">{t(roomLabel((chosen?.room ?? c.after?.room) as string))}</span>}
                  <span className="flex items-center gap-1.5 font-medium"><CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />{when(slot)}</span>
                </>
              )}
            </div>
            {open && (
              <>
                {q.isLoading && <div className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("Checking the rooms…")}</div>}
                {q.isError && <div className="text-destructive">{t("Couldn't check the rooms.")}</div>}
                {target && !target.free && <div className="text-amber-700 dark:text-amber-400">{t("{room} is booked then. Pick a free room below.", { room: t(roomLabel(target.room)) })}</div>}
                <RoomPicker rooms={rooms} room={room} disabled={!!pending} onPick={(r) => { setTouched(true); setRoom(r); }} />
                {q.data && free.length === 0 && <FreeSlotChips slots={q.data.freeSlots} onPick={(f) => { setTouched(false); setRoom(null); setSlot(f); }} />}
              </>
            )}
          </>
        )}
        {!isMove && open && <div className="text-muted-foreground">{t("This frees the room for that time. A BoD can restore it from the Audit.")}</div>}
        {open && proposal.error && <div className="font-medium text-destructive">{proposal.error}</div>}
      </div>
      {statusLine && <div className={cn("px-3 py-2 text-xs font-medium", proposal.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>{statusLine}</div>}
      {proposal.status === "APPLIED" && isMove && (
        <div className="px-3 pb-3">
          <a
            href={`/room-booking?booking=${c.bookingId}`}
            onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); router.history.push(`/room-booking?booking=${c.bookingId}`); }}
            className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <CalendarClock className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /><span className="flex-1">{t("Open Room Booking")}</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
          </a>
        </div>
      )}
      {error && <div className="px-3 pb-2 text-xs font-medium text-destructive">{error}</div>}
      {open && (
        <div className="flex justify-end gap-2 border-t border-border/60 px-3 py-2">
          <button type="button" onClick={() => void decide("discard")} disabled={!!pending} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent disabled:opacity-50">
            {pending === "discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Discard")}
          </button>
          <button
            type="button"
            onClick={() => void decide("apply")}
            disabled={!!pending || !canApply}
            title={!canApply ? t("Choose a room") : undefined}
            className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50", isMove ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {pending === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {isMove ? t("Apply") : t("Cancel booking")}
          </button>
        </div>
      )}
    </div>
  );
}
