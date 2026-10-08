/**
 * Deleted projects and tasks, kept so they can be put back (owner, 8 Oct 2026: a Restore button in
 * Control Room → Audit, after a lead deleted 18 projects that were still in use).
 *
 * A project or task delete in NEXUS is a real DELETE that cascades through dozens of tables (lists,
 * tasks, subtasks, assignees, custom field values, files, sheets, the project's chat room…) and sets
 * a few more to NULL (activity, notifications). This module collects every one of those rows BEFORE
 * the delete, by walking the foreign keys Postgres itself enforces — so a table added next month is
 * covered without touching this file — and later writes them back parent-first, re-pointing the rows
 * that only lost their link.
 *
 * Pure: it only talks to the database through `Db`, so the API (a Prisma transaction) and the
 * backfill script (plain node + pg, scripts/deletion-snapshot-from-backup.mjs) run the same code.
 * Erasable TypeScript only (no enums, no parameter properties): node can load it by stripping types.
 */

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

type Row = Record<string, unknown>

/** A row that outlived the delete with `column` set to NULL; restoring sets it back to `value`. */
export type SnapshotLink = { table: string; column: string; key: string; value: string }

export type SnapshotData = {
  v: 1
  root: { table: string; ids: string[] }
  /** Every row the delete removed, by table, as `to_jsonb(row)`. */
  tables: Record<string, Row[]>
  links: SnapshotLink[]
  /**
   * The folders a deleted project sat in, outermost first. Not deleted with it — kept because a lead
   * who empties a folder often deletes the folder next, and the project should come back where it was.
   */
  containers?: { ProjectFolder?: Row[] }
}

export type Fk = { child: string; parent: string; del: string; col: string; refcol: string }

export type DbSchema = {
  fks: Fk[]
  /** Primary key columns per table. */
  pk: Map<string, string[]>
  /** Column name → data type per table. */
  columns: Map<string, Map<string, string>>
}

export type RestoreErrorCode = "ALREADY_EXISTS" | "PARENT_MISSING"

export class RestoreError extends Error {
  code: RestoreErrorCode
  constructor(code: RestoreErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export type RestoreResult = {
  inserted: Record<string, number>
  /** Folders that were gone and were made again for the restored project. */
  foldersCreated: number
  /** Rows that could not come back: what they pointed at is gone, or the row is already there. */
  skipped: Record<string, number>
  relinked: number
}

const CHUNK = 5000

export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function unique(values: unknown[]): string[] {
  const out = new Set<string>()
  for (const v of values) if (v !== null && v !== undefined) out.add(String(v))
  return Array.from(out)
}

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** The foreign keys, primary keys and columns of the `public` schema, as Postgres enforces them. */
export async function readSchema(db: Db): Promise<DbSchema> {
  const fks = await db.query<Fk>(`
    select ch.relname::text as child, pa.relname::text as parent, c.confdeltype::text as del,
           a.attname::text as col, af.attname::text as refcol
    from pg_constraint c
    join pg_class ch on ch.oid = c.conrelid
    join pg_class pa on pa.oid = c.confrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
    where c.contype = 'f' and ch.relnamespace = 'public'::regnamespace and cardinality(c.conkey) = 1
    order by 1, 4`)
  const pkRows = await db.query<{ tbl: string; col: string }>(`
    select cl.relname::text as tbl, a.attname::text as col
    from pg_index i
    join pg_class cl on cl.oid = i.indrelid
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indisprimary and cl.relnamespace = 'public'::regnamespace
    order by 1, a.attnum`)
  const colRows = await db.query<{ tbl: string; col: string; type: string }>(`
    select table_name::text as tbl, column_name::text as col, data_type::text as type
    from information_schema.columns where table_schema = 'public'`)
  const pk = new Map<string, string[]>()
  for (const r of pkRows) pk.set(r.tbl, [...(pk.get(r.tbl) ?? []), r.col])
  const columns = new Map<string, Map<string, string>>()
  for (const r of colRows) {
    if (!columns.has(r.tbl)) columns.set(r.tbl, new Map())
    columns.get(r.tbl)!.set(r.col, r.type)
  }
  return { fks, pk, columns }
}

async function rowsWhere(db: Db, table: string, col: string, values: string[]): Promise<Row[]> {
  const out: Row[] = []
  for (const part of chunks(values)) {
    const rows = await db.query<{ r: Row }>(
      `select to_jsonb(t) as r from ${ident(table)} t where t.${ident(col)}::text = any($1::text[])`,
      [part],
    )
    // pg hands jsonb back parsed; a driver that hands it back as text is parsed here.
    for (const x of rows) out.push(typeof x.r === "string" ? (JSON.parse(x.r) as Row) : x.r)
  }
  return out
}

function keyOf(schema: DbSchema, table: string, row: Row): string {
  const pk = schema.pk.get(table)
  return pk ? JSON.stringify(pk.map((c) => String(row[c]))) : JSON.stringify(row)
}

/**
 * Every row a DELETE of `ids` from `rootTable` would take with it (ON DELETE CASCADE, followed to the
 * end), plus the rows it would only unlink (ON DELETE SET NULL). Run it in the same transaction as
 * the delete so nothing slips in between.
 */
export async function captureDeletion(db: Db, schema: DbSchema, rootTable: string, ids: string[]): Promise<SnapshotData> {
  const rootPk = schema.pk.get(rootTable)?.[0] ?? "id"
  const tables = new Map<string, Map<string, Row>>()
  const add = (table: string, rows: Row[]): Row[] => {
    let seen = tables.get(table)
    if (!seen) tables.set(table, (seen = new Map()))
    const fresh: Row[] = []
    for (const row of rows) {
      const key = keyOf(schema, table, row)
      if (seen.has(key)) continue
      seen.set(key, row)
      fresh.push(row)
    }
    return fresh
  }

  const cascades = schema.fks.filter((fk) => fk.del === "c")
  let frontier = new Map<string, Row[]>([[rootTable, add(rootTable, await rowsWhere(db, rootTable, rootPk, unique(ids)))]])
  while (frontier.size) {
    const next = new Map<string, Row[]>()
    for (const fk of cascades) {
      const parents = frontier.get(fk.parent)
      if (!parents?.length) continue
      const values = unique(parents.map((r) => r[fk.refcol]))
      if (!values.length) continue
      const fresh = add(fk.child, await rowsWhere(db, fk.child, fk.col, values))
      if (fresh.length) next.set(fk.child, [...(next.get(fk.child) ?? []), ...fresh])
    }
    frontier = next
  }

  const links: SnapshotLink[] = []
  for (const fk of schema.fks) {
    if (fk.del !== "n") continue
    const parents = tables.get(fk.parent)
    if (!parents?.size) continue
    const pk = schema.pk.get(fk.child)
    if (!pk || pk.length !== 1) continue
    const values = unique(Array.from(parents.values()).map((r) => r[fk.refcol]))
    const own = tables.get(fk.child)
    for (const part of chunks(values)) {
      const rows = await db.query<{ key: string; value: string }>(
        `select t.${ident(pk[0])}::text as key, t.${ident(fk.col)}::text as value
         from ${ident(fk.child)} t where t.${ident(fk.col)}::text = any($1::text[])`,
        [part],
      )
      for (const r of rows) {
        // Taken whole by the same delete (another path cascades to it): it comes back with its value.
        if (own?.has(JSON.stringify([r.key]))) continue
        links.push({ table: fk.child, column: fk.col, key: r.key, value: r.value })
      }
    }
  }

  const out: Record<string, Row[]> = {}
  for (const [table, rows] of tables) if (rows.size) out[table] = Array.from(rows.values())
  const data: SnapshotData = { v: 1, root: { table: rootTable, ids: unique(ids) }, tables: out, links }
  if (rootTable === "Project" && schema.columns.get("ProjectFolder")?.has("parentFolderId")) {
    const folders = await folderChain(db, unique((out.Project ?? []).map((p) => p.folderId)))
    if (folders.length) data.containers = { ProjectFolder: folders }
  }
  return data
}

/** The given folders and every folder above them, outermost first. */
async function folderChain(db: Db, ids: string[]): Promise<Row[]> {
  const byId = new Map<string, Row>()
  let wanted = ids
  for (let depth = 0; wanted.length && depth < 32; depth++) {
    const rows = await rowsWhere(db, "ProjectFolder", "id", wanted.filter((id) => !byId.has(id)))
    for (const r of rows) byId.set(String(r.id), r)
    wanted = unique(rows.map((r) => r.parentFolderId)).filter((id) => !byId.has(id))
  }
  const level = (r: Row, guard = 0): number => {
    const parent = r.parentFolderId == null ? undefined : byId.get(String(r.parentFolderId))
    return parent && guard < 32 ? level(parent, guard + 1) + 1 : 0
  }
  return Array.from(byId.values()).sort((a, b) => level(a) - level(b))
}

/**
 * The deleted project's folders, as they are now: still there → kept; gone but a folder of the same
 * name exists in that workspace (made again by hand) → that one; gone → made again with its old id,
 * under its own (mapped) parent. Returns old id → id to use.
 */
async function restoreFolders(db: Db, schema: DbSchema, data: SnapshotData): Promise<{ map: Map<string, string>; created: number }> {
  const map = new Map<string, string>()
  let created = 0
  const columns = schema.columns.get("ProjectFolder")
  const folders = data.containers?.ProjectFolder ?? []
  if (!columns || !folders.length) return { map, created }
  for (const folder of folders) {
    const id = String(folder.id)
    const [same] = await db.query<{ id: string }>(`select id from "ProjectFolder" where id = $1`, [id])
    if (same) {
      map.set(id, same.id)
      continue
    }
    const [named] = await db.query<{ id: string }>(
      `select id from "ProjectFolder" where "workspaceId" = $1 and name = $2`,
      [folder.workspaceId, folder.name],
    )
    if (named) {
      map.set(id, named.id)
      continue
    }
    let parent: string | null = folder.parentFolderId == null ? null : String(folder.parentFolderId)
    if (parent !== null) {
      if (map.has(parent)) parent = map.get(parent)!
      else {
        const [there] = await db.query<{ id: string }>(`select id from "ProjectFolder" where id = $1`, [parent])
        parent = there ? there.id : null
      }
    }
    const names = Object.keys(folder).filter((c) => columns.has(c))
    const rows = await db.query<{ id: string }>(
      `insert into "ProjectFolder" (${names.map(ident).join(", ")})
       select ${names.map((c) => `r.${ident(c)}`).join(", ")}
       from jsonb_populate_recordset(null::"ProjectFolder", $1::jsonb) r
       where exists (select 1 from "Workspace" w where w.id = r."workspaceId")
       on conflict do nothing
       returning id`,
      [JSON.stringify([{ ...folder, parentFolderId: parent }])],
    )
    if (rows.length) {
      map.set(id, rows[0].id)
      created++
    }
  }
  return { map, created }
}

/**
 * The root rows ready to go back: folders mapped, and an optional link (ON DELETE SET NULL) whose
 * target is gone set to NULL — the project comes back without a folder rather than not at all.
 */
async function rootRowsNow(db: Db, schema: DbSchema, table: string, rows: Row[], folders: Map<string, string>): Promise<Row[]> {
  let out = rows.map((r) => ({ ...r }))
  if (table === "Project" && folders.size) {
    out = out.map((r) => (r.folderId != null && folders.has(String(r.folderId)) ? { ...r, folderId: folders.get(String(r.folderId)) } : r))
  }
  for (const fk of schema.fks) {
    if (fk.child !== table || fk.del !== "n" || fk.parent === table) continue
    const values = unique(out.map((r) => r[fk.col]))
    if (!values.length) continue
    const gone = await db.query<{ v: string }>(
      `select v from unnest($1::text[]) as v where not exists (select 1 from ${ident(fk.parent)} p where p.${ident(fk.refcol)}::text = v)`,
      [values],
    )
    if (!gone.length) continue
    const missing = new Set(gone.map((g) => g.v))
    out = out.map((r) => (r[fk.col] != null && missing.has(String(r[fk.col])) ? { ...r, [fk.col]: null } : r))
  }
  return out
}

/** Rows per table, for the "comes back with 120 tasks, 14 files…" line. */
export function snapshotCounts(data: SnapshotData): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [table, rows] of Object.entries(data.tables)) out[table] = rows.length
  return out
}

/** Tables in an order where every table comes after the tables it points at (self-references aside). */
export function parentFirst(tables: string[], fks: Fk[]): string[] {
  const set = new Set(tables)
  const deps = new Map<string, Set<string>>()
  for (const t of tables) deps.set(t, new Set())
  for (const fk of fks) {
    if (fk.child !== fk.parent && set.has(fk.child) && set.has(fk.parent)) deps.get(fk.child)!.add(fk.parent)
  }
  const placed = new Set<string>()
  const order: string[] = []
  while (order.length < set.size) {
    const remaining = Array.from(set).filter((t) => !placed.has(t)).sort()
    const ready = remaining.filter((t) => Array.from(deps.get(t)!).every((p) => placed.has(p)))
    // A cycle between two tables: place the rest as they are; rows whose parent isn't back yet are
    // skipped and counted instead of failing the whole restore.
    for (const t of ready.length ? ready : remaining) {
      placed.add(t)
      order.push(t)
    }
  }
  return order
}

/**
 * Rows of a table that points at itself (subtasks, nested pages), shallowest first: written in
 * batches, a parent then always lands in the same batch as its children or an earlier one.
 */
export function parentRowsFirst(table: string, rows: Row[], schema: DbSchema): Row[] {
  const selfFks = schema.fks.filter((fk) => fk.child === table && fk.parent === table)
  if (!selfFks.length) return rows
  const byRef = new Map<string, Map<string, Row>>()
  for (const fk of selfFks) {
    if (!byRef.has(fk.refcol)) byRef.set(fk.refcol, new Map(rows.map((r) => [String(r[fk.refcol]), r])))
  }
  const depth = new Map<Row, number>()
  const depthOf = (row: Row, guard: number): number => {
    const known = depth.get(row)
    if (known !== undefined) return known
    let d = 0
    if (guard < 64) {
      for (const fk of selfFks) {
        const v = row[fk.col]
        const parent = v === null || v === undefined ? undefined : byRef.get(fk.refcol)!.get(String(v))
        if (parent && parent !== row) d = Math.max(d, depthOf(parent, guard + 1) + 1)
      }
    }
    depth.set(row, d)
    return d
  }
  return rows
    .map((row, i) => ({ row, i, d: depthOf(row, 0) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.row)
}

/**
 * Writes a snapshot back. Root rows that already exist → ALREADY_EXISTS (nothing written). A root row
 * whose own parent is gone (a task whose project was deleted) → PARENT_MISSING (nothing written, as
 * long as the caller runs this in a transaction). Any other row whose parent is gone is skipped and
 * counted, so one dangling link never blocks bringing back a whole project.
 */
export async function restoreSnapshot(db: Db, schema: DbSchema, data: SnapshotData): Promise<RestoreResult> {
  const root = data.root.table
  const rootPk = schema.pk.get(root)?.[0] ?? "id"
  const [{ n: present }] = await db.query<{ n: number }>(
    `select count(*)::int as n from ${ident(root)} where ${ident(rootPk)}::text = any($1::text[])`,
    [data.root.ids],
  )
  if (present > 0) throw new RestoreError("ALREADY_EXISTS", "It is already back.")

  const folders = await restoreFolders(db, schema, data)
  const inserted: Record<string, number> = {}
  const skipped: Record<string, number> = {}
  for (const table of parentFirst(Object.keys(data.tables), schema.fks)) {
    let rows = data.tables[table]
    if (!rows?.length) continue
    if (table === root) rows = await rootRowsNow(db, schema, table, rows, folders.map)
    const columns = schema.columns.get(table)
    if (!columns) {
      skipped[table] = rows.length // the table no longer exists
      continue
    }
    // Columns added since the snapshot take their defaults; columns dropped since are left out.
    const names = Object.keys(rows[0]).filter((c) => columns.has(c))
    let total = 0
    for (const part of chunks(parentRowsFirst(table, rows, schema), 2000)) {
      const params: unknown[] = [JSON.stringify(part)]
      const conditions: string[] = []
      for (const fk of schema.fks) {
        if (fk.child !== table || !names.includes(fk.col)) continue
        let condition = `r.${ident(fk.col)} is null or exists (select 1 from ${ident(fk.parent)} p where p.${ident(fk.refcol)} = r.${ident(fk.col)})`
        if (fk.parent === table) {
          // A subtask whose parent is in this same batch: both land in one statement, and the
          // foreign key is checked at the end of it.
          params.push(unique(part.map((r) => r[fk.refcol])))
          condition += ` or r.${ident(fk.col)}::text = any($${params.length}::text[])`
        }
        conditions.push(`(${condition})`)
      }
      const list = names.map(ident).join(", ")
      const [{ n }] = await db.query<{ n: number }>(
        `with ins as (
           insert into ${ident(table)} (${list})
           select ${names.map((c) => `r.${ident(c)}`).join(", ")}
           from jsonb_populate_recordset(null::${ident(table)}, $1::jsonb) r
           ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
           on conflict do nothing
           returning 1)
         select count(*)::int as n from ins`,
        params,
      )
      total += n
    }
    inserted[table] = total
    if (total < rows.length) skipped[table] = rows.length - total
  }
  if ((inserted[root] ?? 0) < data.root.ids.length) {
    throw new RestoreError("PARENT_MISSING", "What it belonged to no longer exists.")
  }

  let relinked = 0
  const groups = new Map<string, SnapshotLink[]>()
  for (const link of data.links) {
    const k = `${link.table}\u0000${link.column}`
    groups.set(k, [...(groups.get(k) ?? []), link])
  }
  for (const [k, links] of groups) {
    const [table, column] = k.split("\u0000")
    const pk = schema.pk.get(table)
    const fk = schema.fks.find((f) => f.child === table && f.col === column)
    const type = schema.columns.get(table)?.get(column)
    if (!pk || pk.length !== 1 || !fk || (type !== "text" && type !== "character varying")) continue
    for (const part of chunks(links)) {
      const [{ n }] = await db.query<{ n: number }>(
        `with u as (
           update ${ident(table)} t set ${ident(column)} = v.value
           from jsonb_to_recordset($1::jsonb) as v(key text, value text)
           where t.${ident(pk[0])}::text = v.key and t.${ident(column)} is null
             and exists (select 1 from ${ident(fk.parent)} p where p.${ident(fk.refcol)}::text = v.value)
           returning 1)
         select count(*)::int as n from u`,
        [JSON.stringify(part.map((l) => ({ key: l.key, value: l.value })))],
      )
      relinked += n
    }
  }
  return { inserted, foldersCreated: folders.created, skipped, relinked }
}
