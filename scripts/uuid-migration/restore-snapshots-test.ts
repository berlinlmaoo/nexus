/**
 * Restore-from-Audit still works after the UUIDv7 conversion (docs/internal/UUID-MIGRATION.md).
 *
 *   DATABASE_URL=postgres://…/copy npx tsx scripts/uuid-migration/restore-snapshots-test.ts > result.json
 *
 * For every DeletionSnapshot not yet restored: restoreSnapshot() inside a transaction that is ROLLED BACK,
 * recording what it inserted / skipped / relinked (or the error). Run it on the original copy and on the
 * converted copy: the per-snapshot results (keyed by the snapshot's id mapped back to its old id) must be
 * identical. ONLY for throwaway copies (it writes, then rolls back).
 */
import pg from "pg"
import { readSchema, restoreSnapshot, type SnapshotData } from "../../src/lib/deletion-snapshot-core"

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const db = { query: async <T,>(sql: string, params?: unknown[]) => (await client.query(sql, params as unknown[])).rows as T[] }
  const hasMap = (await db.query<{ ok: boolean }>("select to_regclass('public.legacy_id_map') is not null as ok"))[0].ok
  const rows = await db.query<{ id: string; old: string | null; data: SnapshotData }>(
    `select s.id, ${hasMap ? "m.old_id" : "null"} as old, s.data from "DeletionSnapshot" s
     ${hasMap ? "left join legacy_id_map m on m.new_id = s.id" : ""} where s."restoredAt" is null order by s."createdAt"`,
  )
  const schema = await readSchema(db)
  const out: Record<string, unknown> = {}
  for (const r of rows) {
    const key = r.old ?? r.id
    await client.query("begin")
    try {
      const res = await restoreSnapshot(db, schema, r.data)
      out[key] = { ok: true, inserted: res.inserted, skipped: res.skipped, relinked: res.relinked, folders: res.foldersCreated }
    } catch (e) {
      out[key] = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 120) }
    } finally {
      await client.query("rollback")
    }
  }
  console.log(JSON.stringify(out, Object.keys(out).sort().length ? undefined : undefined, 0))
  await client.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
