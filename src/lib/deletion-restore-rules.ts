import { RestoreError, type Db, type SnapshotData } from "@/lib/deletion-snapshot-core"
import { pnlRecurringCursorForNow } from "@/lib/pnl"

/**
 * The few restores that need more than "write the rows back", run inside the restore's transaction
 * (lib/deletion-snapshot.ts restoreDeletion): a check that refuses before anything is written, and a
 * fix-up after. Everything that only tells screens to refetch happens after the commit, in
 * lib/deletion-restore-followup.ts.
 */

type Row = Record<string, unknown>

function first(data: SnapshotData, table: string): Row | null {
  return data.tables[table]?.[0] ?? null
}

/** Refusals: a restore that would double-book a room. */
export async function beforeRestoreInTx(db: Db, entityType: string, data: SnapshotData): Promise<void> {
  if (entityType === "room_booking") {
    const booking = first(data, "RoomBooking")
    if (!booking || booking.status !== "ACTIVE") return
    // Same rule as POST /api/room-bookings: same room, overlapping, still active.
    const [hit] = await db.query<{ n: number }>(
      `select count(*)::int as n from "RoomBooking" b, jsonb_populate_record(null::"RoomBooking", $1::jsonb) r
       where b."workspaceId" = r."workspaceId" and b.room = r.room and b.status = 'ACTIVE'
         and b."startsAt" < r."endsAt" and b."endsAt" > r."startsAt" and b.id <> r.id`,
      [JSON.stringify(booking)],
    )
    if (hit && hit.n > 0) throw new RestoreError("CONFLICT", "The room has been booked for that time since.", { table: "RoomBooking" })
  }
}

/** Fix-ups once the rows are back: positions and a recurring expense's posting cursor. */
export async function afterRestoreInTx(db: Db, entityType: string, data: SnapshotData): Promise<void> {
  if (entityType === "task_list") {
    // The delete renumbered the other sections 0…n-1; put this one back at its old index.
    const section = first(data, "TaskList")
    if (!section) return
    const others = await db.query<{ id: string; position: number }>(
      `select id, position from "TaskList" where "projectId" = $1 and id <> $2 order by position, "createdAt", id`,
      [section.projectId, section.id],
    )
    const order = others.map((o) => o.id)
    order.splice(Math.max(0, Math.min(Number(section.position ?? 0), order.length)), 0, String(section.id))
    const now = new Map(others.map((o) => [o.id, o.position]))
    now.set(String(section.id), Number(section.position ?? 0))
    const moves = order.map((id, i) => ({ id, p: i })).filter((m) => now.get(m.id) !== m.p)
    if (moves.length) {
      await db.query(
        `update "TaskList" t set position = v.p from jsonb_to_recordset($1::jsonb) as v(id text, p int) where t.id = v.id`,
        [JSON.stringify(moves)],
      )
    }
    return
  }

  if (entityType === "sheet_rows") {
    // Rows go back where they were, unless rows have taken those places since (an import that
    // replaced the sheet): then they go after the last row, in their old order.
    const rows = data.tables.SheetRow ?? []
    const ids = data.root.ids
    if (!rows.length || !ids.length) return
    const sheetId = String(rows[0].sheetId)
    const positions = rows.map((r) => Number(r.position))
    const [clash] = await db.query<{ n: number }>(
      `select count(*)::int as n from "SheetRow" where "sheetId" = $1 and id <> all($2::text[]) and position = any($3::float8[])`,
      [sheetId, ids, positions],
    )
    if (!clash || clash.n === 0) return
    const [{ max }] = await db.query<{ max: number }>(
      `select coalesce(max(position), -1)::float8 as max from "SheetRow" where "sheetId" = $1 and id <> all($2::text[])`,
      [sheetId, ids],
    )
    const ordered = [...rows].sort((a, b) => Number(a.position) - Number(b.position))
    const moves = ordered.map((r, i) => ({ id: String(r.id), p: Number(max) + 1 + i }))
    await db.query(
      `update "SheetRow" t set position = v.p from jsonb_to_recordset($1::jsonb) as v(id text, p float8) where t.id = v.id`,
      [JSON.stringify(moves)],
    )
    return
  }

  if (entityType === "pnl_recurring") {
    // Months it spent deleted are not billed, the same rule as pause → resume (PATCH …/recurring/[id]).
    const t = first(data, "PnlRecurringExpense")
    if (!t || t.active === false) return
    const cursor = pnlRecurringCursorForNow(Number(t.dayOfMonth ?? 1))
    const last = typeof t.lastPostedKey === "string" ? t.lastPostedKey : null
    if (!last || last < cursor) {
      await db.query(`update "PnlRecurringExpense" set "lastPostedKey" = $1 where id = $2`, [cursor, t.id])
    }
  }
}
