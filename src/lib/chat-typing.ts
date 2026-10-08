/**
 * "… is typing" in a chat, like WhatsApp (owner Berlin, 9 Oct 2026: "di menu chat, bikin status titik
 * titik gitu kaya wa kalo ada orang lain atau lawan bicara pas lg ngetik", and "indikator mengetiknya jg
 * harus keliatan profile picture org yg ngetiknya").
 *
 * The socket server (pages/api/socket.ts) relays a client's `typing` { conversationId, typing } to the
 * room's other people as { conversationId, userId, name, avatar, typing }. Nothing is stored and nothing
 * is pushed. This file is the pure half: what a valid event is, and which events are relayed at all.
 */

/** A relayed `typing` from one socket, at most this often per room (a "stopped" after a "typing" always goes). */
export const TYPING_MIN_INTERVAL_MS = 1000

export type TypingEvent = { conversationId: string; typing: boolean }

/** The relayed payload. `name` and `avatar` come from the server's own record of the sender, never the client. */
export type TypingRelay = { conversationId: string; userId: string; name: string; avatar: string | null; typing: boolean }

/** The client's event, checked: a conversation id and a boolean, nothing else is read. */
export function parseTypingEvent(raw: unknown): TypingEvent | null {
  if (!raw || typeof raw !== "object") return null
  const { conversationId, typing } = raw as { conversationId?: unknown; typing?: unknown }
  if (typeof conversationId !== "string" || conversationId.length === 0 || conversationId.length > 64) return null
  if (typeof typing !== "boolean") return null
  return { conversationId, typing }
}

/**
 * One socket's typing, per room: whether an event is passed on.
 *
 *   - "typing" within TYPING_MIN_INTERVAL_MS of the last event passed on for that room: dropped. Clients
 *     repeat "typing" every 3 s while someone types; anything faster is noise or abuse.
 *   - "stopped" after a "typing" that was passed on: always passed on, so an indicator is never left on.
 *   - "stopped" with nothing to take back: dropped.
 *
 * `stop(room)` / `stopAll()` are for leaving a room and disconnecting: the rooms that still show this
 * socket typing, each to be told "stopped".
 */
export class TypingGate {
  private readonly minIntervalMs: number
  private readonly rooms = new Map<string, { typing: boolean; at: number }>()

  constructor(minIntervalMs: number = TYPING_MIN_INTERVAL_MS) {
    this.minIntervalMs = minIntervalMs
  }

  accept(room: string, typing: boolean, now: number = Date.now()): boolean {
    const last = this.rooms.get(room)
    if (typing) {
      if (last && now - last.at < this.minIntervalMs) return false
      this.rooms.set(room, { typing: true, at: now })
      return true
    }
    if (!last?.typing) return false
    this.rooms.set(room, { typing: false, at: now })
    return true
  }

  /** True when this socket was shown typing in `room` (now cleared). */
  stop(room: string): boolean {
    const was = this.rooms.get(room)?.typing === true
    this.rooms.delete(room)
    return was
  }

  /** Every room this socket was shown typing in (all cleared). */
  stopAll(): string[] {
    const out = Array.from(this.rooms.entries()).filter(([, s]) => s.typing).map(([room]) => room)
    this.rooms.clear()
    return out
  }
}
