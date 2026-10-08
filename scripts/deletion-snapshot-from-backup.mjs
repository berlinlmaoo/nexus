// Restorable copies of projects/tasks deleted BEFORE deletes kept one (owner, 8 Oct 2026), taken from
// a backup restored into its own database — plus the round-trip check of src/lib/deletion-snapshot-core.ts.
//
// Runs with plain node 22 next to the database (the repo's own `pg`, connection from PG* env):
//   docker run --rm --network container:nexus-postgres -v ~/nexus:/n -w /n \
//     --env-file <(docker exec nexus-postgres env | sed -n 's/^POSTGRES_USER=/PGUSER=/p; s/^POSTGRES_PASSWORD=/PGPASSWORD=/p') \
//     -e PGHOST=127.0.0.1 node:22-alpine node scripts/deletion-snapshot-from-backup.mjs <mode> ...
//
// Modes:
//   snapshot --target <db> --source <backupdb> --as-of <ISO> --audit <id,id,…> [--apply]
//       For each delete in the target's AuditLog: the rows that delete removed, read from the backup,
//       stored as a DeletionSnapshot (source "backup") so Control Room → Audit can restore it.
//       Dry run unless --apply.
//   check-restore --db <nexus_rt_…> --audit <id,id,…>
//       On a TEST copy: restores those snapshots and compares every restored row with the snapshot.
//   round-trip --db <nexus_rt_…> [--project <id>]
//       On a TEST copy: capture → delete → restore one project (default: the one with most tasks) and
//       compares every row and every re-pointed link with what was there before.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRequire } from "node:module"
import crypto from "node:crypto"
import path from "node:path"

const require = createRequire(import.meta.url)
const pg = require("pg")
const here = path.dirname(fileURLToPath(import.meta.url))
const corePath = path.join(here, "..", "src", "lib", "deletion-snapshot-core.ts")

async function loadCore() {
  try {
    return await import(pathToFileURL(corePath).href)
  } catch {
    const ts = require("typescript")
    const out = ts.transpileModule(await readFile(corePath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"))
  }
}

const core = await loadCore()
const [mode, ...rest] = process.argv.slice(2)
const args = {}
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) continue
  const next = rest[i + 1]
  args[rest[i].slice(2)] = next && !next.startsWith("--") ? (i++, next) : true
}

async function connect(database) {
  const client = new pg.Client({ database })
  await client.connect()
  return { client, db: { query: async (sql, params = []) => (await client.query(sql, params)).rows } }
}

function testDbOnly(name) {
  if (!/^nexus_rt_/.test(name ?? "")) throw new Error(`--db must be a test copy named nexus_rt_…, got ${name}`)
}

const ROOT = { project: "Project", task: "Task" }

/** Rows as they are in the database now, keyed like the snapshot. */
async function currentRows(db, schema, table, rows) {
  const pk = schema.pk.get(table)
  if (!pk || pk.length !== 1) return null
  const keys = rows.map((r) => String(r[pk[0]]))
  const got = await db.query(
    `select to_jsonb(t) as r from ${core.ident(table)} t where t.${core.ident(pk[0])}::text = any($1::text[])`,
    [keys],
  )
  return new Map(got.map((x) => [String(x.r[pk[0]]), x.r]))
}

/** Every snapshot row back, value for value (columns that still exist). Returns mismatch lines. */
async function compareWithSnapshot(db, schema, data) {
  const problems = []
  for (const [table, rows] of Object.entries(data.tables)) {
    const now = await currentRows(db, schema, table, rows)
    if (!now) continue
    const pk = schema.pk.get(table)[0]
    const columns = schema.columns.get(table)
    let missing = 0
    let differ = 0
    for (const row of rows) {
      const got = now.get(String(row[pk]))
      if (!got) {
        missing++
        continue
      }
      for (const c of Object.keys(row)) {
        if (!columns.has(c)) continue
        if (JSON.stringify(row[c]) !== JSON.stringify(got[c])) {
          differ++
          if (differ <= 3) problems.push(`${table}.${c} of ${row[pk]}: ${JSON.stringify(row[c])} → ${JSON.stringify(got[c])}`)
        }
      }
    }
    if (missing) problems.push(`${table}: ${missing} of ${rows.length} rows not back`)
  }
  return problems
}

async function linksBack(db, data) {
  let off = 0
  for (const l of data.links) {
    const [r] = await db.query(
      `select ${core.ident(l.column)}::text as v from ${core.ident(l.table)} where id::text = $1`,
      [l.key],
    )
    if (r && r.v !== l.value) off++
  }
  return off
}

function line(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${n}`)
    .join(", ")
}

if (mode === "snapshot") {
  const ids = String(args.audit ?? "").split(",").filter(Boolean)
  if (!args.target || !args.source || !args["as-of"] || !ids.length) throw new Error("snapshot needs --target --source --as-of --audit")
  const asOf = new Date(args["as-of"])
  if (Number.isNaN(asOf.getTime())) throw new Error("bad --as-of")
  const target = await connect(args.target)
  const source = await connect(args.source)
  const sourceSchema = await core.readSchema(source.db)
  let made = 0
  for (const auditId of ids) {
    const [a] = await target.db.query(
      `select id, action, "entityType", "entityId", "entityName", "userId" from "AuditLog" where id = $1`,
      [auditId],
    )
    const root = a && ROOT[a.entityType]
    if (!a || a.action !== "delete" || !root || !a.entityId) {
      console.log(`${auditId}: not a project/task delete — skipped`)
      continue
    }
    const [{ n: has }] = await target.db.query(`select count(*)::int as n from "DeletionSnapshot" where "auditLogId" = $1`, [auditId])
    if (has) {
      console.log(`${a.entityName}: already has a snapshot — skipped`)
      continue
    }
    const [{ n: alive }] = await target.db.query(`select count(*)::int as n from ${core.ident(root)} where id = $1`, [a.entityId])
    if (alive) {
      console.log(`${a.entityName}: exists again — skipped`)
      continue
    }
    const data = await core.captureDeletion(source.db, sourceSchema, root, [a.entityId])
    if (!data.tables[root]?.length) {
      console.log(`${a.entityName}: not in the backup — nothing to keep`)
      continue
    }
    const counts = core.snapshotCounts(data)
    let workspaceId = data.tables.Project?.[0]?.workspaceId ?? null
    if (!workspaceId && root === "Task") {
      const [w] = await source.db.query(
        `select p."workspaceId" from "TaskList" l join "Project" p on p.id = l."projectId" where l.id = $1`,
        [data.tables.Task[0].taskListId],
      )
      workspaceId = w?.workspaceId ?? null
    }
    console.log(`${a.entityName}: ${line(counts)}; links ${data.links.length}`)
    if (!args.apply) continue
    await target.db.query(
      `insert into "DeletionSnapshot" (id, "auditLogId", "entityType", "entityId", "entityName", "workspaceId", source, "dataAsOf", data, counts, "deletedById")
       values ($1, $2, $3, $4, $5, $6, 'backup', $7, $8::jsonb, $9::jsonb, $10)`,
      [`ds_${crypto.randomBytes(12).toString("hex")}`, a.id, a.entityType, a.entityId, a.entityName, workspaceId, asOf,
        JSON.stringify(data), JSON.stringify(counts), a.userId],
    )
    made++
  }
  console.log(args.apply ? `\nAPPLIED: ${made} snapshot(s) written.` : "\nDRY RUN — nothing written. Re-run with --apply.")
  await target.client.end()
  await source.client.end()
} else if (mode === "check-restore") {
  testDbOnly(args.db)
  const ids = String(args.audit ?? "").split(",").filter(Boolean)
  const { client, db } = await connect(args.db)
  const schema = await core.readSchema(db)
  let bad = 0
  for (const auditId of ids) {
    const [s] = await db.query(`select "entityName", data from "DeletionSnapshot" where "auditLogId" = $1`, [auditId])
    if (!s) {
      console.log(`${auditId}: no snapshot`)
      bad++
      continue
    }
    await client.query("begin")
    try {
      const result = await core.restoreSnapshot(db, schema, s.data)
      await client.query("commit")
      const problems = await compareWithSnapshot(db, schema, s.data)
      const off = await linksBack(db, s.data)
      if (problems.length || off) bad++
      console.log(`${s.entityName}: back ${line(result.inserted)}; skipped ${JSON.stringify(result.skipped)}; relinked ${result.relinked}/${s.data.links.length}${off ? `; ${off} links NOT back` : ""}`)
      for (const p of problems.slice(0, 8)) console.log(`   ✗ ${p}`)
    } catch (e) {
      await client.query("rollback")
      bad++
      console.log(`${s.entityName}: FAILED ${e.code ?? ""} ${e.message}`)
    }
  }
  console.log(bad ? `\n${bad} problem(s)` : "\nALL OK")
  await client.end()
  process.exitCode = bad ? 1 : 0
} else if (mode === "round-trip") {
  testDbOnly(args.db)
  const { client, db } = await connect(args.db)
  const schema = await core.readSchema(db)
  let projectId = args.project
  if (!projectId) {
    const [p] = await db.query(
      `select l."projectId" as id from "Task" t join "TaskList" l on l.id = t."taskListId" group by 1 order by count(*) desc limit 1`,
    )
    projectId = p.id
  }
  await client.query("begin")
  const data = await core.captureDeletion(db, schema, "Project", [projectId])
  console.log(`captured ${projectId}: ${line(core.snapshotCounts(data))}; links ${data.links.length}`)
  await db.query(`delete from "Project" where id = $1`, [projectId])
  const [{ n: left }] = await db.query(`select count(*)::int as n from "Task" t join "TaskList" l on l.id = t."taskListId" where l."projectId" = $1`, [projectId])
  const result = await core.restoreSnapshot(db, schema, data)
  const problems = await compareWithSnapshot(db, schema, data)
  const off = await linksBack(db, data)
  let again = null
  try {
    await core.restoreSnapshot(db, schema, data)
  } catch (e) {
    again = e.code
  }
  await client.query("rollback")
  console.log(`after delete: ${left} tasks left; restored ${line(result.inserted)}; skipped ${JSON.stringify(result.skipped)}; relinked ${result.relinked}/${data.links.length}`)
  console.log(`second restore: ${again ?? "NO ERROR (wrong)"}`)
  for (const p of problems.slice(0, 12)) console.log(`   ✗ ${p}`)
  const ok = left === 0 && !problems.length && !off && again === "ALREADY_EXISTS" && !Object.keys(result.skipped).length
  console.log(ok ? "ROUND TRIP OK (rolled back)" : "ROUND TRIP FAILED (rolled back)")
  await client.end()
  process.exitCode = ok ? 0 : 1
} else {
  console.log("modes: snapshot | check-restore | round-trip (see the top of this file)")
  process.exitCode = 2
}
