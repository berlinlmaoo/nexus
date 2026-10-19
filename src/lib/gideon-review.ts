import { NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID, orgRoleOf } from "@/lib/org"
import { parseGideonAttachments } from "@/lib/gideon-attachments"
import { proposalView, type GideonRunMeta } from "@/lib/gideon-runs"

/**
 * Control Room › GIDEON › People › person (owner, 18 Oct 2026).
 *
 *   Overview / Credits: BoD and One Above All (counts, credits and tiers only, like /api/gideon/usage).
 *   Chats: the company workspace's ONE_ABOVE_ALL only — BoD, Manager, Staff and the retired system ADMIN
 *   flag get 403 here, whatever the client shows. Read-only: nothing here writes anything.
 *
 * Owner's decisions, deliberately: viewing a chat sends NO notification to the person, writes NO audit-log
 * entry and asks for NO reason. Transparency is the one-time notice every user gets in the GIDEON panel
 * ("GIDEON chats can be reviewed by the Board of Directors for work purposes.") and the line in
 * the privacy policy. Chats the person deleted are included, marked deleted, until the 90-day purge
 * (lib/gideon-chat-retention.ts).
 *
 * Response shapes are stable for the iOS / Android Control Room: the transcript's messages are the SAME
 * shape /api/gideon/history returns (role, content, tools, attachments, runId, meta{steps,sources,cards,
 * proposals}) plus id, createdAt, tier and credits.
 */

type Guard = { error: NextResponse } | { viewerId: string; role: string | null }

async function viewer(): Promise<Guard> {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  return { viewerId: session.user.id, role: await orgRoleOf(session.user.id) }
}

/** BoD or One Above All of the company workspace (overview + credits). */
export async function requireBodPlus(): Promise<Guard> {
  const v = await viewer()
  if ("error" in v) return v
  if (v.role !== "BOD" && v.role !== "ONE_ABOVE_ALL") return { error: NextResponse.json({ error: "Forbidden", code: "BOD_ONLY" }, { status: 403 }) }
  return v
}

/** The company workspace's One Above All, nobody else (chats). */
export async function requireOaa(): Promise<Guard> {
  const v = await viewer()
  if ("error" in v) return v
  if (v.role !== "ONE_ABOVE_ALL") return { error: NextResponse.json({ error: "Only the One Above All can read GIDEON chats.", code: "OAA_ONLY" }, { status: 403 }) }
  return v
}

/**
 * The person whose GIDEON use is reviewed: a member of the company workspace, or someone offboarded from it
 * (offboarding removes the membership and sets deactivatedAt; their chats stay reviewable until purged).
 * Anyone else — a stranger's personal workspace — is a 404, never a hint that the id exists.
 */
export async function reviewTarget(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, avatar: true, deactivatedAt: true,
      workspaceMembers: { where: { workspaceId: ORG_WORKSPACE_ID }, select: { role: true } },
    },
  })
  if (!user) return null
  const role = user.workspaceMembers[0]?.role ?? null
  if (!role && !user.deactivatedAt) return null
  return { id: user.id, name: user.name, email: user.email, avatar: user.avatar, role, offboarded: Boolean(user.deactivatedAt) }
}

export const notFound = () => NextResponse.json({ error: "Person not found" }, { status: 404 })

// ── Chat list ─────────────────────────────────────────────────────────────────────────────────────────

export type ReviewChatRow = {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  /** Every turn (questions + answers). */
  messages: number
  questions: number
  /** The tier that answered most in this chat (astra | luna | terra | experimental), null before tiers were logged. */
  tier: string | null
  tiers: string[]
  credits: number
  deleted: boolean
  deletedAt: string | null
  /** With ?q=: the line that matched. */
  match: string | null
}

/** Opaque keyset cursor over (updatedAt DESC, id DESC): stable while chats are added or touched. */
export function encodeCursor(updatedAt: Date, id: string) {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`).toString("base64url")
}
export function decodeCursor(raw: string | null): { at: Date; id: string } | null {
  if (!raw) return null
  try {
    const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|")
    const at = new Date(iso)
    if (!id || Number.isNaN(at.getTime())) return null
    return { at, id }
  } catch {
    return null
  }
}

/** Per-chat counts, tiers and credits for one page of chats, in one query. */
export async function chatAggregates(chatIds: string[]) {
  const out = new Map<string, { messages: number; questions: number; tiers: string[]; credits: number }>()
  if (chatIds.length === 0) return out
  const rows = await prisma.$queryRaw<{ chatId: string; messages: bigint; questions: bigint; tiers: (string | null)[] | null; credits: bigint | null }[]>`
    SELECT m."chatId",
           COUNT(*)                                   AS "messages",
           COUNT(*) FILTER (WHERE m.role = 'user')    AS "questions",
           ARRAY_AGG(r.tier ORDER BY r."startedAt") FILTER (WHERE r.tier IS NOT NULL) AS "tiers",
           COALESCE(SUM(c.credits), 0)                AS "credits"
    FROM "GideonMessage" m
    LEFT JOIN "GideonRun" r ON r.id = m."runId"
    LEFT JOIN "GideonCreditUsage" c ON c."runId" = m."runId"
    WHERE m."chatId" IN (${Prisma.join(chatIds)})
    GROUP BY m."chatId"
  `
  for (const r of rows) {
    const counts = new Map<string, number>()
    for (const t of r.tiers ?? []) if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
    out.set(r.chatId, {
      messages: Number(r.messages),
      questions: Number(r.questions),
      tiers: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
      credits: Number(r.credits ?? 0),
    })
  }
  return out
}

// ── Transcript ────────────────────────────────────────────────────────────────────────────────────────

export const TRANSCRIPT_PAGE = 200

/**
 * One chat's turns, oldest first (a page of the newest TRANSCRIPT_PAGE before `before`), in /api/gideon/history's
 * shape. Proposal statuses are refreshed from GideonProposal (Applied / Discarded happened after the turn was saved).
 */
export async function transcript(chatId: string, before: Date | null, limit = TRANSCRIPT_PAGE) {
  const rows = await prisma.gideonMessage.findMany({
    where: { chatId, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: { id: true, role: true, content: true, tools: true, attachments: true, runId: true, meta: true, createdAt: true },
  })
  const more = rows.length > limit
  const page = rows.slice(0, limit)
  const runIds = page.map((r) => r.runId).filter((x): x is string => Boolean(x))
  const [proposals, runs, usage] = runIds.length
    ? await Promise.all([
        prisma.gideonProposal.findMany({ where: { runId: { in: runIds } }, orderBy: { createdAt: "asc" } }),
        prisma.gideonRun.findMany({ where: { id: { in: runIds } }, select: { id: true, tier: true } }),
        prisma.gideonCreditUsage.findMany({ where: { runId: { in: runIds } }, select: { runId: true, credits: true, tier: true } }),
      ])
    : [[], [], []]
  const tierOf = new Map(runs.map((r) => [r.id, r.tier]))
  const usageOf = new Map(usage.map((u) => [u.runId, u]))
  const metaOf = (row: { runId: string | null; meta: unknown }) => {
    if (!row.meta || typeof row.meta !== "object") return null
    const meta = row.meta as GideonRunMeta
    const mine = proposals.filter((p) => p.runId === row.runId).map((p) => proposalView(p))
    // GIDEON Memory chips are the person's own (owner, 19 Oct 2026): the OAA review shows the chat, never them.
    const { memories: _ownerOnly, ...shared } = meta
    void _ownerOnly
    return { ...shared, proposals: mine.length ? mine : (meta.proposals ?? []) }
  }
  const oldest = page.length ? page[page.length - 1].createdAt.toISOString() : null
  const messages = [...page].reverse().map((row) => {
    const u = row.runId ? usageOf.get(row.runId) : undefined
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      tools: row.tools,
      attachments: parseGideonAttachments(row.attachments),
      runId: row.runId,
      meta: metaOf(row),
      createdAt: row.createdAt.toISOString(),
      tier: (row.runId ? tierOf.get(row.runId) : null) ?? u?.tier ?? null,
      credits: u?.credits ?? null,
    }
  })
  return { messages, olderBefore: more ? oldest : null }
}
