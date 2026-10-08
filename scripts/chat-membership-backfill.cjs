// One-time (and re-runnable) chat membership backfill — CHAT-CONTRACT 8 Oct 2026, "Membership (security)".
//
// Applies the rules of src/lib/chat-membership.ts to every row written before they existed:
//
//   1. PROJECT rooms: exactly the project's members who are still in the project's workspace. Missing
//      rooms are created, missing members added, everyone else removed. Conversation.workspaceId =
//      the project's workspace.
//   2. GROUP / DM rooms: Conversation.workspaceId set to the workspace every (non-deleted) member is in.
//      A room whose members no longer share one (someone left the company) gets the workspace most of
//      them are in (the company wins a tie) and whoever is not in it is removed. A DM that loses its
//      counterpart keeps that person's name as its own, so the one left still sees who it was with.
//      Deleted accounts are never removed from groups/DMs (their history keeps a name).
//   3. Inbox rows of chat (type MESSAGE / MESSAGE_MENTION, link /messages?c=<id>) that the person has
//      already read in the chat, or for a room they are no longer in, are marked read — chat no longer
//      writes a bell row per message, and the old ones would otherwise sit in the bell count forever.
//
// Idempotent: a second run finds nothing to do. Default is a DRY RUN inside a READ ONLY transaction:
// it prints what it would change and writes nothing. --apply writes, in one transaction.
//
// Runs inside the app container (its own `pg` and DATABASE_URL), no Prisma client needed — so it works
// with the old image as well as the new one:
//
//   docker exec -i nexus-app-beta node - < scripts/chat-membership-backfill.cjs              # dry run
//   docker exec -i nexus-app-beta node - --apply < scripts/chat-membership-backfill.cjs      # write
//   docker exec -i nexus-app-beta node - --verbose < scripts/chat-membership-backfill.cjs    # every change
//
// Writing needs schema.sql applied first (Conversation.workspaceId); the dry run says so if it is not.
"use strict"

const { createRequire } = require("node:module")
const crypto = require("node:crypto")
const appRequire = createRequire("/app/package.json")
const pg = appRequire("pg")

const APPLY = process.argv.includes("--apply")
const VERBOSE = process.argv.includes("--verbose") || !APPLY
const ORG_WORKSPACE_ID = (process.env.NEXUS_ORG_WORKSPACE_ID || "").trim() || "cmmroq7dk0001vewe92nk1g0w"
const DELETED_DOMAIN = "@deleted.invalid"
const CHAT_TYPES = ["MESSAGE", "MESSAGE_MENTION"]

// Prisma-style cuid: "c" + time + random, 25 chars. Ids are opaque strings; only uniqueness matters.
function cuid() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
  const rnd = Array.from(crypto.randomBytes(16), (b) => alphabet[b % 36]).join("")
  return ("c" + Date.now().toString(36).padStart(8, "0") + rnd).slice(0, 25)
}

const isDeleted = (email) => typeof email === "string" && email.toLowerCase().endsWith(DELETED_DOMAIN)

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (run it inside the app container)")
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const q = async (sql, params) => (await client.query(sql, params)).rows
  const log = (...a) => console.log(...a)

  await client.query("BEGIN")
  if (!APPLY) await client.query("SET TRANSACTION READ ONLY")

  try {
    const cols = await q(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND ((table_name = 'Conversation' AND column_name = 'workspaceId')
            OR (table_name = 'ConversationMember' AND column_name = 'mutedUntil'))`,
    )
    const hasWorkspaceCol = cols.some((c) => c.table_name === "Conversation")
    const hasMuteCol = cols.some((c) => c.table_name === "ConversationMember")
    log(`mode: ${APPLY ? "APPLY (writes, one transaction)" : "DRY RUN (read-only transaction, nothing written)"}`)
    log(`schema: Conversation.workspaceId ${hasWorkspaceCol ? "present" : "MISSING"}, ConversationMember.mutedUntil ${hasMuteCol ? "present" : "MISSING"}`)
    if (APPLY && !hasWorkspaceCol) throw new Error("Conversation.workspaceId is missing — apply schema.sql first, then re-run with --apply")

    // ---- load ----
    const workspaces = await q(`SELECT w.id, w.name, (SELECT COUNT(*)::int FROM "WorkspaceMember" m WHERE m."workspaceId" = w.id) AS size FROM "Workspace" w`)
    const wsSize = new Map(workspaces.map((w) => [w.id, w.size]))
    const wsName = new Map(workspaces.map((w) => [w.id, w.name]))
    const wsOf = new Map()
    for (const r of await q(`SELECT "userId", "workspaceId" FROM "WorkspaceMember"`)) {
      if (!wsOf.has(r.userId)) wsOf.set(r.userId, new Set())
      wsOf.get(r.userId).add(r.workspaceId)
    }
    const users = new Map((await q(`SELECT id, name, email FROM "User"`)).map((u) => [u.id, u]))
    const projects = await q(`SELECT id, name, "workspaceId" FROM "Project"`)
    const pmOf = new Map()
    for (const r of await q(`SELECT "userId", "projectId" FROM "ProjectMember"`)) {
      if (!pmOf.has(r.projectId)) pmOf.set(r.projectId, new Set())
      pmOf.get(r.projectId).add(r.userId)
    }
    const convos = await q(
      `SELECT id, type::text AS type, name, "projectId"${hasWorkspaceCol ? `, "workspaceId"` : `, NULL::text AS "workspaceId"`} FROM "Conversation"`,
    )
    const membersOf = new Map(convos.map((c) => [c.id, new Set()]))
    for (const r of await q(`SELECT "conversationId", "userId" FROM "ConversationMember"`)) membersOf.get(r.conversationId)?.add(r.userId)
    const roomOfProject = new Map(convos.filter((c) => c.projectId).map((c) => [c.projectId, c]))
    const nameOf = (id) => users.get(id)?.name ?? id

    const stats = { roomsCreated: 0, membersAdded: 0, membersRemoved: 0, workspaceSet: 0, dmRenamed: 0, splitRooms: 0, unresolved: 0 }
    const changes = []

    // ---- 1. project rooms ----
    for (const p of projects) {
      const entitled = new Set([...(pmOf.get(p.id) ?? [])].filter((u) => wsOf.get(u)?.has(p.workspaceId)))
      const room = roomOfProject.get(p.id)
      if (!room) {
        if (entitled.size === 0) continue
        const id = cuid()
        stats.roomsCreated++
        stats.membersAdded += entitled.size
        changes.push(`create project room "${p.name}" with ${entitled.size} member(s)`)
        if (APPLY) {
          await client.query(
            `INSERT INTO "Conversation" (id, type, name, "projectId", "workspaceId", "createdAt", "updatedAt")
             VALUES ($1, 'PROJECT', $2, $3, $4, NOW(), NOW())`,
            [id, p.name, p.id, p.workspaceId],
          )
          for (const u of entitled) {
            await client.query(
              `INSERT INTO "ConversationMember" (id, "conversationId", "userId") VALUES ($1, $2, $3)
               ON CONFLICT ("conversationId", "userId") DO NOTHING`,
              [cuid(), id, u],
            )
          }
        }
        continue
      }
      const current = membersOf.get(room.id) ?? new Set()
      const toAdd = [...entitled].filter((u) => !current.has(u))
      const toRemove = [...current].filter((u) => !entitled.has(u))
      for (const u of toAdd) {
        stats.membersAdded++
        changes.push(`project "${p.name}": add ${nameOf(u)}`)
        if (APPLY) {
          await client.query(
            `INSERT INTO "ConversationMember" (id, "conversationId", "userId") VALUES ($1, $2, $3)
             ON CONFLICT ("conversationId", "userId") DO NOTHING`,
            [cuid(), room.id, u],
          )
        }
      }
      for (const u of toRemove) {
        stats.membersRemoved++
        const why = !(pmOf.get(p.id) ?? new Set()).has(u) ? "not a project member" : "not in the project's workspace"
        changes.push(`project "${p.name}": remove ${nameOf(u)} (${why})`)
        if (APPLY) await client.query(`DELETE FROM "ConversationMember" WHERE "conversationId" = $1 AND "userId" = $2`, [room.id, u])
      }
      if (room.workspaceId !== p.workspaceId) {
        stats.workspaceSet++
        if (APPLY) await client.query(`UPDATE "Conversation" SET "workspaceId" = $1 WHERE id = $2`, [p.workspaceId, room.id])
      }
    }

    // ---- 2. groups and DMs ----
    const rank = (w) => [w === ORG_WORKSPACE_ID ? 1 : 0, wsSize.get(w) ?? 0]
    const better = (a, b) => {
      const [ra, rb] = [rank(a), rank(b)]
      if (ra[0] !== rb[0]) return ra[0] > rb[0]
      if (ra[1] !== rb[1]) return ra[1] > rb[1]
      return a < b
    }
    for (const c of convos.filter((x) => x.type === "GROUP" || x.type === "DM")) {
      const members = [...(membersOf.get(c.id) ?? [])]
      const living = members.filter((u) => !isDeleted(users.get(u)?.email))
      const label = `${c.type} ${c.name ? `"${c.name}"` : members.map(nameOf).join(" & ")} (${c.id})`
      let target = c.workspaceId
      if (!target) {
        const counts = new Map()
        for (const u of living) for (const w of wsOf.get(u) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1)
        if (counts.size === 0) {
          stats.unresolved++
          changes.push(`${label}: no member is in any workspace — left as is`)
          continue
        }
        const max = Math.max(...counts.values())
        const best = [...counts.entries()].filter(([, n]) => n === max).map(([w]) => w).reduce((a, b) => (better(a, b) ? a : b))
        const unanimous = max === living.length
        // Several workspaces holding everyone: prefer the company, then the largest.
        target = unanimous
          ? [...counts.entries()].filter(([, n]) => n === living.length).map(([w]) => w).reduce((a, b) => (better(a, b) ? a : b))
          : best
        if (!unanimous) {
          stats.splitRooms++
          changes.push(`${label}: members no longer share a workspace — keeping it in "${wsName.get(target) ?? target}" (${max}/${living.length})`)
        }
        stats.workspaceSet++
        if (APPLY) await client.query(`UPDATE "Conversation" SET "workspaceId" = $1 WHERE id = $2`, [target, c.id])
      }
      const out = living.filter((u) => !(wsOf.get(u)?.has(target)))
      for (const u of out) {
        stats.membersRemoved++
        changes.push(`${label}: remove ${nameOf(u)} (not in "${wsName.get(target) ?? target}")`)
        if (APPLY) await client.query(`DELETE FROM "ConversationMember" WHERE "conversationId" = $1 AND "userId" = $2`, [c.id, u])
      }
      if (c.type === "DM" && out.length && !(c.name ?? "").trim()) {
        stats.dmRenamed++
        changes.push(`${label}: keeps the name "${nameOf(out[0])}"`)
        if (APPLY) await client.query(`UPDATE "Conversation" SET name = $1 WHERE id = $2`, [nameOf(out[0]), c.id])
      }
    }

    // ---- 3. chat rows in the Inbox ----
    // Counted (dry run) or updated (apply) AFTER the membership changes above, so "no longer in the
    // room" sees the removals of this same run.
    const readInChat = `
      n.read = false AND n.type = ANY($1::text[]) AND n.link LIKE '/messages?c=%'
      AND EXISTS (SELECT 1 FROM "ConversationMember" cm
                   WHERE cm."userId" = n."userId" AND n.link = '/messages?c=' || cm."conversationId"
                     AND cm."lastReadAt" IS NOT NULL AND n."createdAt" <= cm."lastReadAt" + INTERVAL '5 seconds')`
    const notInRoom = `
      n.read = false AND n.type = ANY($1::text[]) AND n.link LIKE '/messages?c=%'
      AND NOT EXISTS (SELECT 1 FROM "ConversationMember" cm
                       WHERE cm."userId" = n."userId" AND n.link = '/messages?c=' || cm."conversationId")`
    const [{ n: alreadyRead }] = await q(`SELECT COUNT(*)::int AS n FROM "Notification" n WHERE ${readInChat}`, [CHAT_TYPES])
    const [{ n: orphaned }] = await q(`SELECT COUNT(*)::int AS n FROM "Notification" n WHERE ${notInRoom}`, [CHAT_TYPES])
    const [{ n: stillUnread }] = await q(
      `SELECT COUNT(*)::int AS n FROM "Notification" n WHERE n.read = false AND n.type = ANY($1::text[])`, [CHAT_TYPES],
    )
    if (APPLY) {
      await client.query(`UPDATE "Notification" n SET read = true WHERE ${readInChat}`, [CHAT_TYPES])
      await client.query(`UPDATE "Notification" n SET read = true WHERE ${notInRoom}`, [CHAT_TYPES])
    }

    // ---- report ----
    log("")
    if (VERBOSE) {
      if (changes.length === 0) log("no membership changes")
      for (const line of changes) log("  " + line)
      log("")
    }
    log(`project rooms created:        ${stats.roomsCreated}`)
    log(`members added:                ${stats.membersAdded}`)
    log(`members removed:              ${stats.membersRemoved}`)
    log(`room workspace set:           ${stats.workspaceSet}${hasWorkspaceCol ? "" : " (column missing: not writable yet)"}`)
    log(`DMs keeping the left name:    ${stats.dmRenamed}`)
    log(`groups/DMs split (see above): ${stats.splitRooms}`)
    log(`groups/DMs left unresolved:   ${stats.unresolved}`)
    log(`chat Inbox rows → read:       ${alreadyRead} already read in the chat, ${orphaned} for rooms no longer joined (of ${stillUnread} unread chat rows)`)

    if (APPLY) {
      await client.query("COMMIT")
      log("\nAPPLIED (committed). Re-running should report nothing to do.")
    } else {
      await client.query("ROLLBACK")
      log("\nDRY RUN — nothing written. Re-run with --apply to write.")
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error("chat-membership-backfill failed:", error?.message ?? error)
  process.exit(1)
})
