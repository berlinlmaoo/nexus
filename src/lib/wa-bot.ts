// Gideon WhatsApp command bot (v1, command-only — deterministic, no LLM).
// Inbound WA DM → mapped to a NEXUS user by phone → a fixed set of safe commands.
// Replies (and the morning digest) go out via the same Hermes bridge used for notifications.
import prisma from "@/lib/prisma"
import { TaskStatus } from "@/generated/prisma"
import { logAudit } from "@/lib/audit"
import { postWaBridge } from "@/lib/wa-bridge"

const BRIDGE_URL =
  process.env.WA_WEBHOOK_URL ||
  process.env.HERMES_WA_BRIDGE_URL ||
  "http://host.docker.internal:3001/send"

function digits(s: string | null | undefined) { return (s || "").replace(/\D/g, "") }
// Indonesian normalisation: a local "08…" number and intl "628…" are the same person.
function normId(d: string) { return d.startsWith("0") ? "62" + d.slice(1) : d }

function phoneMatches(senderDigits: string, phone: string | null): boolean {
  if (!phone) return false
  const a = normId(senderDigits), b = normId(digits(phone))
  if (!a || !b) return false
  return a === b || a.slice(-9) === b.slice(-9) // tolerate country-code / leading-zero differences
}

function phoneToChatId(phone: string | null): string | null {
  const d = normId(digits(phone || ""))
  return d ? `${d}@s.whatsapp.net` : null
}

async function sendWaChat(chatId: string, message: string) {
  try {
    // Host-header override (loopback) so the bridge's DNS-rebinding guard accepts the container's request.
    await postWaBridge(BRIDGE_URL, { chatId, message })
  } catch (e) { console.error("[wa-bot] reply send failed", e) }
}

// Stable, normalised form of the WA identity the bridge reports (strip device suffix, lowercase).
function normalizeWaId(s: string | null | undefined) { return (s || "").trim().toLowerCase().replace(/:\d+@/, "@") }

async function resolveUser(senderId: string) {
  // 1) verified link (works regardless of LID vs phone format)
  const wid = normalizeWaId(senderId)
  if (wid) {
    const linked = await prisma.user.findFirst({ where: { whatsappId: wid }, select: { id: true, name: true } })
    if (linked) return linked
  }
  // 2) fallback: admin-set phone number match
  const sd = digits(senderId)
  if (!sd) return null
  const users = await prisma.user.findMany({ where: { phoneNumber: { not: null } }, select: { id: true, name: true, phoneNumber: true } })
  return users.find((u) => phoneMatches(sd, u.phoneNumber)) ?? null
}

async function handleLink(senderId: string, chatId: string, arg: string) {
  const code = (arg || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (!code) { await sendWaChat(chatId, "Format: `/link <kode>`. Ambil kodenya di NEXUS → Settings → Hubungkan WhatsApp."); return }
  const target = await prisma.user.findFirst({ where: { waLinkCode: code, waLinkExpiresAt: { gt: new Date() } }, select: { id: true, name: true } })
  if (!target) { await sendWaChat(chatId, "Kode salah atau udah kedaluwarsa. Generate ulang di NEXUS ya."); return }
  const wid = normalizeWaId(senderId)
  await prisma.$transaction([
    prisma.user.updateMany({ where: { whatsappId: wid }, data: { whatsappId: null } }), // re-link: steal from any prior owner
    prisma.user.update({ where: { id: target.id }, data: { whatsappId: wid, waLinkCode: null, waLinkExpiresAt: null } }),
  ])
  await sendWaChat(chatId, `✅ WhatsApp kamu terhubung ke akun *${target.name}*! Coba ketik /today.`)
}

// "Today" in WIB (UTC+7), expressed as a UTC instant range for dueDate comparisons.
function todayRangeWIB(): { start: Date; end: Date } {
  const wib = new Date(Date.now() + 7 * 3600 * 1000)
  const startUTC = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 0, 0, 0) - 7 * 3600 * 1000
  return { start: new Date(startUTC), end: new Date(startUTC + 24 * 3600 * 1000) }
}

const NOT_DONE = { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] }

// ── Attendance-approval helpers (WhatsApp /approve /reject /pending) ──────────────
const REQ_TYPE_LABEL: Record<string, string> = {
  LEAVE: "Cuti", SICK: "Sakit", PERMIT: "Izin", DAY_OFF: "Day off", RED_DATE: "Tanggal merah",
}
// Short, human-typable handle for a request: last 6 of the cuid → effectively unique among pending.
function reqCode(id: string) { return id.slice(-6).toUpperCase() }
function fmtDateRange(start: Date, end: Date) {
  const f = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })
  const s = f(start), e = f(end)
  return s === e ? s : `${s}–${e}`
}
// Reachable WA target for a user. Prefer the link-VERIFIED WhatsApp id (set via /link) over the
// admin-typed, UNVERIFIED phone — a mistyped phone would otherwise deliver leave/PII messages to a
// stranger. Fall back to phone-derived JID only when there's no verified link.
function recipientChatId(u: { phoneNumber: string | null; whatsappId: string | null }): string | null {
  if (u.whatsappId && u.whatsappId.includes("@s.whatsapp.net")) return u.whatsappId
  return u.phoneNumber ? phoneToChatId(u.phoneNumber) : null
}
// The set of workspaces a user may approve attendance in (mirror of canManageAttendance):
// system admin → all workspaces; otherwise the workspaces where they're org BoD / One-Above-All.
// Resolved ONCE per command so /pending and /approve avoid N+1 per-request auth checks.
async function approverScope(userId: string): Promise<{ all: boolean; workspaceIds: string[] }> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (u?.role === "ADMIN") return { all: true, workspaceIds: [] }
  const ms = await prisma.workspaceMember.findMany({
    where: { userId, role: { in: ["BOD", "ONE_ABOVE_ALL"] } },
    select: { workspaceId: true },
  })
  return { all: false, workspaceIds: ms.map((m) => m.workspaceId) }
}

async function openAssignedTasks(userId: string, titleContains?: string) {
  return prisma.task.findMany({
    where: {
      assignees: { some: { userId } },
      status: NOT_DONE,
      ...(titleContains ? { title: { contains: titleContains, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, title: true, dueDate: true, taskList: { select: { name: true, project: { select: { name: true } } } } },
    orderBy: { dueDate: "asc" },
    take: 25,
  })
}

const HELP = [
  "🤖 *NEXUS — perintah cepat:*",
  "• `/today` — task due hari ini",
  "• `/done <judul>` — tandai task selesai",
  "• `/snooze <judul> [hari]` — geser due date (default +1)",
  "• `/pending` — permintaan absen yang nunggu approval kamu (BoD)",
  "• `/approve <kode> [alasan]` — setujui permintaan absen",
  "• `/reject <kode> [alasan]` — tolak permintaan absen",
  "• `/link <kode>` — hubungkan akun (ambil kode di NEXUS → Settings)",
  "• `/nexus` — menu ini",
].join("\n")

// `/nexus` is the NEXUS menu (not /help — that stays Hermes'). Others kept as harmless extras.
const HELP_ALIASES = ["nexus", "menu", "help", "?"]
const ACTION_CMDS = ["today", "done", "snooze", "unlink"]

/** Handle one inbound WA message. No-ops silently on non-command chatter. */
export async function handleWaInbound(input: { chatId: string; senderId: string; text: string }): Promise<void> {
  const text = (input.text || "").trim()
  if (!text) return
  const [head, ...rest] = text.split(/\s+/)
  const cmd = head.replace(/^\//, "").toLowerCase()
  const isSlash = text.startsWith("/")

  const arg = rest.join(" ").trim()

  if (HELP_ALIASES.includes(cmd)) { await sendWaChat(input.chatId, HELP); return }
  // /link works WITHOUT being registered yet — it's literally how you get registered.
  if (cmd === "link") { await handleLink(input.senderId, input.chatId, arg); return }
  if (!isSlash && !ACTION_CMDS.includes(cmd)) return // ignore ordinary chat — only react to commands

  const user = await resolveUser(input.senderId)
  if (!user) { await sendWaChat(input.chatId, "Nomor WhatsApp kamu belum terhubung ke NEXUS. Buka *NEXUS → Settings → Hubungkan WhatsApp* buat ambil kode, terus kirim `/link <kode>` ke sini ya."); return }
  const firstName = user.name?.split(" ")[0] || ""

  if (cmd === "unlink") {
    await prisma.user.update({ where: { id: user.id }, data: { whatsappId: null } })
    await sendWaChat(input.chatId, "🔌 WhatsApp kamu udah di-unlink dari NEXUS.")
    return
  }

  if (cmd === "today") {
    const { start, end } = todayRangeWIB()
    const tasks = (await openAssignedTasks(user.id)).filter((t) => t.dueDate && t.dueDate >= start && t.dueDate < end)
    if (tasks.length === 0) { await sendWaChat(input.chatId, `Halo ${firstName} 👋 — gak ada task due hari ini 🎉`); return }
    const lines = tasks.map((t, i) => `${i + 1}. *${t.title}* — ${t.taskList?.project?.name ?? t.taskList?.name ?? "—"}`)
    await sendWaChat(input.chatId, `📋 *Due hari ini* (${tasks.length}):\n${lines.join("\n")}`)
    return
  }

  if (cmd === "done") {
    if (!arg) { await sendWaChat(input.chatId, "Format: `/done <judul task>`"); return }
    const matches = await openAssignedTasks(user.id, arg)
    if (matches.length === 0) { await sendWaChat(input.chatId, `Gak nemu task aktif kamu yang cocok "${arg}".`); return }
    if (matches.length > 1) { await sendWaChat(input.chatId, `Ada ${matches.length} task cocok — sebut lebih spesifik:\n${matches.slice(0, 6).map((t) => `• ${t.title}`).join("\n")}`); return }
    const t = matches[0]
    await prisma.task.update({ where: { id: t.id }, data: { status: TaskStatus.DONE } })
    await sendWaChat(input.chatId, `✅ *${t.title}* ditandai DONE.`)
    return
  }

  if (cmd === "snooze") {
    if (!arg) { await sendWaChat(input.chatId, "Format: `/snooze <judul> [hari]`"); return }
    const parts = arg.split(/\s+/)
    let days = 1
    let title = arg
    const last = parts[parts.length - 1]
    if (parts.length > 1 && /^\d+$/.test(last)) { days = Math.min(365, Math.max(1, parseInt(last, 10))); title = parts.slice(0, -1).join(" ") }
    const matches = await openAssignedTasks(user.id, title)
    if (matches.length === 0) { await sendWaChat(input.chatId, `Gak nemu task aktif kamu yang cocok "${title}".`); return }
    if (matches.length > 1) { await sendWaChat(input.chatId, `Ada ${matches.length} task cocok — sebut lebih spesifik:\n${matches.slice(0, 6).map((t) => `• ${t.title}`).join("\n")}`); return }
    const t = matches[0]
    const base = t.dueDate ? new Date(t.dueDate) : todayRangeWIB().start
    const next = new Date(base.getTime() + days * 24 * 3600 * 1000)
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: next } })
    await sendWaChat(input.chatId, `⏰ *${t.title}* digeser +${days} hari → ${next.toLocaleDateString("id-ID", { day: "numeric", month: "short" })}.`)
    return
  }

  if (cmd === "pending") {
    const scope = await approverScope(user.id)
    if (!scope.all && scope.workspaceIds.length === 0) { await sendWaChat(input.chatId, "Kamu bukan approver absen di workspace manapun."); return }
    const mine = await prisma.attendanceRequest.findMany({
      where: { status: "PENDING", ...(scope.all ? {} : { workspaceId: { in: scope.workspaceIds } }) },
      select: { id: true, type: true, startDate: true, endDate: true, user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    })
    if (mine.length === 0) { await sendWaChat(input.chatId, "Gak ada permintaan absen yang nunggu approval kamu. 🎉"); return }
    const lines = mine.slice(0, 15).map((r, i) => `${i + 1}. *${r.user.name}* — ${REQ_TYPE_LABEL[r.type] ?? r.type}, ${fmtDateRange(r.startDate, r.endDate)}  ·  /approve ${reqCode(r.id)}`)
    await sendWaChat(input.chatId, `📋 *Nunggu approval* (${mine.length}):\n${lines.join("\n")}${mine.length > 15 ? `\n…dan ${mine.length - 15} lagi` : ""}`)
    return
  }

  if (cmd === "approve" || cmd === "reject") {
    const parts = arg.split(/\s+/).filter(Boolean)
    const code = (parts[0] || "").trim().toUpperCase()
    const note = (parts.slice(1).join(" ").trim() || "").slice(0, 1000) || null
    if (!code) { await sendWaChat(input.chatId, `Format: \`/${cmd} <kode> [alasan]\`. Kodenya ada di notifikasi permintaan, atau ketik /pending.`); return }
    const scope = await approverScope(user.id)
    if (!scope.all && scope.workspaceIds.length === 0) { await sendWaChat(input.chatId, "Kamu gak punya akses buat approve/reject permintaan absen."); return }
    // Only consider PENDING requests WITHIN the approver's scope, then match by id-suffix code.
    const candidates = await prisma.attendanceRequest.findMany({
      where: { status: "PENDING", ...(scope.all ? {} : { workspaceId: { in: scope.workspaceIds } }) },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    })
    const matched = candidates.filter((r) => reqCode(r.id) === code)
    if (matched.length === 0) { await sendWaChat(input.chatId, `Gak nemu permintaan PENDING dengan kode *${code}* yang bisa kamu proses. Ketik /pending buat lihat yang nunggu.`); return }
    if (matched.length > 1) { await sendWaChat(input.chatId, `Kode *${code}* cocok ke ${matched.length} permintaan — buka NEXUS buat proses manual ya.`); return }

    const targetId = matched[0].id
    const nextStatus = cmd === "approve" ? "APPROVED" : "REJECTED"
    // Race-safe transition: only act if still PENDING.
    const res = await prisma.attendanceRequest.updateMany({
      where: { id: targetId, status: "PENDING" },
      data: { status: nextStatus, reviewedById: user.id, reviewedAt: new Date(), approvalSource: "ADMIN", reviewNote: note },
    })
    if (res.count === 0) { await sendWaChat(input.chatId, "Permintaan itu barusan udah diproses orang lain."); return }

    const updated = await prisma.attendanceRequest.findUnique({
      where: { id: targetId },
      select: { type: true, startDate: true, endDate: true, userId: true, user: { select: { name: true, phoneNumber: true, whatsappId: true } } },
    })
    if (!updated) return
    // Audit the off-platform approval (mirror the in-app PATCH; tag via:whatsapp).
    await logAudit({
      action: "update",
      entityType: "attendance_request",
      entityId: targetId,
      entityName: `${updated.type}:${updated.user.name}`,
      userId: user.id,
      metadata: { status: nextStatus, approvalSource: "ADMIN", via: "whatsapp" },
    }).catch((e) => console.error("[wa-bot] audit log failed", e))

    const label = REQ_TYPE_LABEL[updated.type] ?? updated.type
    const range = fmtDateRange(updated.startDate, updated.endDate)
    await sendWaChat(input.chatId, `${cmd === "approve" ? "✅" : "❌"} *${label}* ${updated.user.name} (${range}) di-${cmd === "approve" ? "APPROVE" : "TOLAK"}.`)
    // Notify the requester (skip if they somehow approved their own).
    const reqChat = recipientChatId(updated.user)
    if (reqChat && updated.userId !== user.id) {
      const approver = user.name?.split(" ")[0] ?? "BoD"
      const msg = cmd === "approve"
        ? `✅ *${label}* kamu (${range}) di-*APPROVE* sama ${approver}. 🎉`
        : `❌ *${label}* kamu (${range}) di-*TOLAK* sama ${approver}.${note ? `\nAlasan: "${note}"` : ""}`
      await sendWaChat(reqChat, msg)
    }
    return
  }

  await sendWaChat(input.chatId, `Perintah gak dikenali.\n${HELP}`)
}

/** Ping all approvers (org BoD / One-Above-All of the request's workspace + system admins) on
 *  WhatsApp the moment a new PENDING attendance request is created, with /approve + /reject codes so
 *  they can act straight from chat. Fire-and-forget from the create route. */
export async function notifyApproversOfRequest(requestId: string): Promise<void> {
  const req = await prisma.attendanceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, type: true, startDate: true, endDate: true, reason: true, status: true, userId: true,
      workspaceId: true, user: { select: { name: true } },
    },
  })
  if (!req || req.status !== "PENDING") return

  const [members, admins] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: req.workspaceId, role: { in: ["BOD", "ONE_ABOVE_ALL"] } },
      select: { user: { select: { id: true, name: true, phoneNumber: true, whatsappId: true } } },
    }),
    // System admins are globally privileged, but only ping the ones who are members of THIS workspace
    // — avoids blasting (and leaking the requester's name/reason to) admins of unrelated workspaces.
    prisma.user.findMany({ where: { role: "ADMIN", workspaceMembers: { some: { workspaceId: req.workspaceId } } }, select: { id: true, name: true, phoneNumber: true, whatsappId: true } }),
  ])
  const approvers = new Map<string, { id: string; name: string; phoneNumber: string | null; whatsappId: string | null }>()
  for (const m of members) approvers.set(m.user.id, m.user)
  for (const a of admins) approvers.set(a.id, a)
  approvers.delete(req.userId) // don't ask someone to approve their own request

  const label = REQ_TYPE_LABEL[req.type] ?? req.type
  const range = fmtDateRange(req.startDate, req.endDate)
  const code = reqCode(req.id)
  const msg = [
    `🔔 *Permintaan absen baru*`,
    `${req.user.name} — *${label}*`,
    `🗓️ ${range}`,
    req.reason ? `📝 "${req.reason}"` : null,
    ``,
    `Setujui:  /approve ${code}`,
    `Tolak:  /reject ${code} [alasan]`,
  ].filter((l): l is string => l !== null).join("\n")

  for (const a of approvers.values()) {
    const chatId = recipientChatId(a)
    if (chatId) await sendWaChat(chatId, msg)
  }
}

/** Morning digest. Triggered by a CRON_SECRET route. opts.onlyUserId → just that user (test mode);
 *  opts.includeEmpty → still send even with no tasks (so a test shows the message). */
export async function sendDigestToAll(opts?: { onlyUserId?: string; includeEmpty?: boolean }): Promise<{ users: number; sent: number }> {
  const users = await prisma.user.findMany({
    where: {
      OR: [{ phoneNumber: { not: null } }, { whatsappId: { not: null } }],
      ...(opts?.onlyUserId ? { id: opts.onlyUserId } : {}),
    },
    select: { id: true, name: true, phoneNumber: true, whatsappId: true },
  })
  const { start } = todayRangeWIB()
  const end = new Date(start.getTime() + 24 * 3600 * 1000)
  let sent = 0
  for (const u of users) {
    const [due, overdue] = await Promise.all([
      prisma.task.findMany({ where: { assignees: { some: { userId: u.id } }, status: NOT_DONE, dueDate: { gte: start, lt: end } }, select: { title: true }, take: 6, orderBy: { dueDate: "asc" } }),
      prisma.task.count({ where: { assignees: { some: { userId: u.id } }, status: NOT_DONE, dueDate: { lt: start } } }),
    ])
    const empty = due.length === 0 && overdue === 0
    if (empty && !opts?.includeEmpty) continue
    // Reliable send target: prefer the phone-derived JID; fall back to a standard linked JID.
    const chatId = u.phoneNumber ? phoneToChatId(u.phoneNumber) : (u.whatsappId && u.whatsappId.includes("@s.whatsapp.net") ? u.whatsappId : null)
    if (!chatId) continue
    const first = u.name?.split(" ")[0] || "tim"
    const lines = due.slice(0, 5).map((t) => `• ${t.title}`)
    const msg = empty
      ? [`🌅 *Pagi, ${first}!*`, `Gak ada task due hari ini 🎉`, `Jangan lupa absen ya! ✅`].join("\n")
      : [
          `🌅 *Pagi, ${first}!*`,
          `📋 Due hari ini: *${due.length}*${overdue ? ` · ⚠️ Overdue: *${overdue}*` : ""}`,
          ...(lines.length ? [lines.join("\n")] : []),
          `Balas */today* buat detail. Jangan lupa absen ya! ✅`,
        ].join("\n")
    await sendWaChat(chatId, msg)
    sent++
  }
  return { users: users.length, sent }
}
