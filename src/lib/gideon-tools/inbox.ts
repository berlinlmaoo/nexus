import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { isAutoDeduction } from "@/lib/attendance-absence"
import { canUserReviewRequest } from "@/lib/attendance-approvers"
import { isBodPlus } from "@/lib/complaints"
import { legalActor } from "@/lib/legal/access"
import { chatUnreadForUser } from "@/lib/chat-unread"
import { clip, limitOf, str, whenWib, PUBLIC_BASE } from "./util"
import type { ExtraTool, Input } from "./types"

/**
 * "What needs me now" (owner, 18 Oct 2026): one compact read of the person's own inbox — unread notifications,
 * mentions (task comments, docs, Threads, chat), and everything waiting on THEIR decision: attendance requests and
 * offsite check-outs they approve (the same resolver as the Approvals page, lib/attendance-approvers.ts), GIDEON
 * cards they have not decided, support tickets (BoD), Legal requests where they are PIC.
 * Every list is the person's own, read with the same scope as the page that shows it.
 */

const REQUEST_TYPE: Record<string, string> = { LEAVE: "Annual leave", SICK: "Sick", PERMIT: "Permission (izin)", DAY_OFF: "Day off", RED_DATE: "Public holiday" }

/** The bell's groups, by notification type (the web's notificationGroup, kept coarse). */
function groupOf(type: string): string {
  const t = type.toLowerCase()
  if (t.includes("mention")) return "mention"
  if (t === "message") return "chat"
  if (t.startsWith("attendance") || t.startsWith("offsite") || t.includes("dayoff") || t.includes("quota")) return "attendance"
  if (t.startsWith("task") || t.startsWith("comment") || t.includes("due") || t === "block_reminder" || t === "reminder") return "work"
  if (t.startsWith("legal")) return "legal"
  if (t.startsWith("complaint")) return "ticket"
  if (t.startsWith("feed_")) return "threads"
  if (t.includes("announcement")) return "announcement"
  return "other"
}

type Row = { id: string; type: string; title: string; message: string; read: boolean; link: string | null; createdAt: Date; actorId: string | null }

async function actorNames(rows: Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => Boolean(x)))]
  if (!ids.length) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  return new Map(users.map((u) => [u.id, u.name ?? ""]))
}

function noteRow(n: Row, names: Map<string, string>) {
  return {
    kind: groupOf(n.type),
    title: clip(n.title, 90),
    ...(n.message && n.message !== n.title ? { text: clip(n.message, 140) } : {}),
    ...(n.actorId && names.get(n.actorId) ? { from: names.get(n.actorId) } : {}),
    when: whenWib(n.createdAt),
    ...(n.read ? { read: true } : {}),
    ...(n.link ? { link: `${PUBLIC_BASE}${n.link}` } : {}),
  }
}

async function notifications(actor: User, limit: number) {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: actor.id, read: false, NOT: { type: { in: ["MESSAGE"] } } }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.groupBy({ by: ["type"], where: { userId: actor.id, read: false }, _count: { _all: true } }),
  ])
  const byKind: Record<string, number> = {}
  for (const r of unread) byKind[groupOf(r.type)] = (byKind[groupOf(r.type)] ?? 0) + r._count._all
  const total = Object.values(byKind).reduce((s, n) => s + n, 0)
  const names = await actorNames(rows)
  return { unread: total, byKind, items: rows.map((r) => noteRow(r, names)), ...(total > rows.length ? { more: `${total - rows.length} more unread; they are in the Inbox (${PUBLIC_BASE}/inbox).` } : {}) }
}

async function mentions(actor: User, limit: number) {
  const since = new Date(Date.now() - 14 * 86400e3)
  const rows = await prisma.notification.findMany({
    where: { userId: actor.id, type: { contains: "mention", mode: "insensitive" }, createdAt: { gte: since } },
    orderBy: [{ read: "asc" }, { createdAt: "desc" }],
    take: limit,
  })
  const names = await actorNames(rows)
  return { last14Days: rows.length, items: rows.map((r) => noteRow(r, names)) }
}

async function chats(actor: User) {
  const u = await chatUnreadForUser(actor.id).catch(() => null)
  if (!u) return null
  const total = u.totalUnread
  if (!total) return { unreadMessages: 0 }
  const ids = [...u.perConversation.entries()].filter(([, v]) => v.unread > 0 && !v.muted).map(([id, v]) => [id, v.unread] as const).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const convos = ids.length ? await prisma.conversation.findMany({ where: { id: { in: ids.map(([id]) => id) } }, select: { id: true, name: true, type: true, project: { select: { name: true } }, members: { where: { userId: { not: actor.id } }, select: { user: { select: { name: true } } }, take: 3 } } }) : []
  return {
    unreadMessages: total,
    ...(u.mentions ? { mentions: u.mentions } : {}),
    conversations: ids.map(([id, n]) => {
      const c = convos.find((x) => x.id === id)
      const name = c?.name || c?.project?.name || c?.members.map((m) => m.user.name).filter(Boolean).join(", ") || "Chat"
      return { name, unread: n }
    }),
  }
}

async function approvals(actor: User, limit: number) {
  const out: Record<string, unknown> = {}
  const ctx = await getAttendanceWorkspaceContext(actor.id)
  if (ctx.workspace && ctx.canReviewAttendanceRequests) {
    const scope = ctx.approvalScopeUserIds
    const where = {
      workspaceId: ctx.workspace.id,
      status: "PENDING" as const,
      userId: scope === null ? { not: actor.id } : { in: scope.filter((id) => id !== actor.id) },
    }
    const pending = await prisma.attendanceRequest.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, userId: true, type: true, startDate: true, endDate: true, reason: true, createdAt: true, escalatedAt: true, approvalSource: true, reviewedById: true, user: { select: { name: true } } },
    })
    const mine = []
    for (const r of pending) {
      if (isAutoDeduction(r as Parameters<typeof isAutoDeduction>[0])) continue
      const verdict = await canUserReviewRequest(actor.id, r.userId, ctx.workspace.id, ctx)
      if (verdict.ok) mine.push(r)
    }
    const day = (d: Date) => d.toISOString().slice(0, 10)
    out.attendanceRequests = {
      waiting: mine.length,
      items: mine.slice(0, limit).map((r) => ({
        requestId: r.id,
        who: r.user?.name ?? null,
        type: REQUEST_TYPE[r.type] ?? r.type,
        days: day(r.startDate) === day(r.endDate) ? day(r.startDate) : `${day(r.startDate)} – ${day(r.endDate)}`,
        reason: clip(r.reason, 120),
        filed: whenWib(r.createdAt),
        ...(r.escalatedAt ? { escalated: true } : {}),
      })),
      how: "Approve or reject with nexus_decide_attendance_request (a card the person confirms).",
    }
    const offsite = await prisma.attendanceRecord.findMany({
      where: { workspaceId: ctx.workspace.id, checkOutOffsite: true, checkOutApproval: "PENDING", ...(scope === null ? { userId: { not: actor.id } } : { userId: { in: scope.filter((id) => id !== actor.id) } }) },
      orderBy: { checkOutAt: "asc" },
      take: limit,
      select: { id: true, checkOutAt: true, user: { select: { name: true } } },
    })
    if (offsite.length) out.offsiteCheckouts = { waiting: offsite.length, items: offsite.map((o) => ({ who: o.user?.name ?? null, at: whenWib(o.checkOutAt) })), where: `${PUBLIC_BASE}/attendance` }
  }
  const proposals = await prisma.gideonProposal.findMany({
    where: { userId: actor.id, status: "PENDING", createdAt: { gte: new Date(Date.now() - 7 * 86400e3) } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { summary: true, createdAt: true },
  })
  if (proposals.length) out.gideonCards = { waiting: proposals.length, items: proposals.map((p) => ({ summary: clip(p.summary, 100), made: whenWib(p.createdAt) })) }
  if (ctx.workspace && isBodPlus(ctx.workspaceRole)) {
    // The BoD's OWN workspace only, like the web Support inbox (/api/complaints): a personal workspace makes its
    // owner One Above All there, and without this filter that role listed every company ticket (19 Oct 2026).
    const where = { workspaceId: ctx.workspace.id, status: { in: ["OPEN" as const, "AWAITING_DECISION" as const] } }
    const [tickets, n, corrections] = await Promise.all([
      prisma.complaint.findMany({ where, orderBy: { lastMessageAt: "asc" }, take: limit, select: { subject: true, status: true, category: true, lastMessageAt: true, reporter: { select: { name: true } } } }),
      prisma.complaint.count({ where }),
      prisma.attendanceCorrection.count({ where: { workspaceId: ctx.workspace.id, status: "PENDING" } }),
    ])
    if (n) out.supportTickets = { open: n, items: tickets.map((t) => ({ subject: clip(t.subject, 90), from: t.reporter?.name ?? null, category: t.category, status: t.status === "AWAITING_DECISION" ? "Awaiting decision" : "Open", last: whenWib(t.lastMessageAt) })), where: `${PUBLIC_BASE}/complaints` }
    if (corrections) out.attendanceCorrections = { waiting: corrections, where: `${PUBLIC_BASE}/complaints` }
  }
  if (await legalActor(actor.id)) {
    const rows = await prisma.legalRequest.findMany({
      where: { picId: actor.id, column: { not: "DONE" }, rejectedAt: null },
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }],
      take: limit,
      select: { templateName: true, docType: true, deadline: true, column: true, requester: { select: { name: true } } },
    })
    if (rows.length) out.legalRequests = { waiting: rows.length, items: rows.map((r) => ({ what: r.templateName || r.docType, from: r.requester?.name ?? null, ...(r.deadline ? { deadline: r.deadline.toISOString().slice(0, 10) } : {}), column: r.column === "IN_PROGRESS" ? "In progress" : "To do" })), where: `${PUBLIC_BASE}/legal` }
  }
  return out
}

async function getMyInbox(actor: User, input: Input) {
  const section = (str(input.section) ?? "all").toLowerCase()
  const limit = limitOf(input, 8, 25)
  const want = (s: string) => section === "all" || section === s
  const [n, m, c, a] = await Promise.all([
    want("notifications") ? notifications(actor, limit) : null,
    want("mentions") ? mentions(actor, limit) : null,
    want("chat") || section === "all" ? chats(actor) : null,
    want("approvals") ? approvals(actor, limit) : null,
  ])
  return {
    ...(n ? { notifications: n } : {}),
    ...(m ? { mentions: m } : {}),
    ...(c ? { chat: c } : {}),
    ...(a ? { waitingForYou: a } : {}),
    note: "Only this person's own inbox. Lead with what waits on their decision, then mentions, then the rest. Times are WIB.",
  }
}

export const inboxTools: Record<string, ExtraTool> = {
  get_my_inbox: { read: getMyInbox, stepArg: (i) => str(i.section) ?? null },
}
