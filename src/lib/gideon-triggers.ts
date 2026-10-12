import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { askGideon } from "@/lib/gideon-chat"
import { getGideonUserId, GIDEON_EMAIL } from "@/lib/gideon-identity"
import { checkProjectAccess } from "@/lib/rbac"
import { approvalPromptLine } from "@/lib/gideon-runs"
import { emitCommentAdded } from "@/lib/socket-emitter"
import { createInAppNotification, notifyCommentAdded, notifyStatusUpdate } from "@/lib/notification-service"
import type { ProjectHealth } from "@/generated/prisma/client"
import { isSingletonLeader } from "@/lib/bluegreen"

/**
 * GIDEON triggers beyond the chat box (owner, 12 Oct 2026 — Notion's "On a schedule" and "When
 * mentioned"):
 *   - a weekly project digest on a schedule (GideonSchedule: weekdays + HH:MM + timezone), posted as a
 *     project status update signed by GIDEON;
 *   - @GIDEON in a task comment: GIDEON answers in the same thread.
 * Both run as a real person (the schedule's creator / the one who mentioned), so GIDEON never sees more
 * than they do, and both are logged as GideonRuns (Insights). Writes they want to make are held as
 * proposals for that person (approval mode "always_ask").
 */
const log = createLogger("gideon-triggers")

// ── Time ──────────────────────────────────────────────────────────────────────────────────────────────

/** Wall-clock parts of `date` in `timeZone`. */
function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: Number(get("hour")), mm: Number(get("minute")), wd }
}

/** The UTC instant at which `timeZone` reads y-m-d hh:mm (offset probed twice, so DST edges land right). */
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const offsetAt = (t: number) => {
    const p = zonedParts(new Date(t), timeZone)
    return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - t
  }
  let t = guess - offsetAt(guess)
  t = guess - offsetAt(t)
  return new Date(t)
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Next run strictly after `after`: the first listed weekday at HH:MM (in `timeZone`). Null if none. */
export function nextOccurrence(weekdays: number[], time: string, timeZone: string, after: Date = new Date()): Date | null {
  const days = [...new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!days.length || !match || !isValidTimeZone(timeZone)) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  if (hh > 23 || mm > 59) return null
  const today = zonedParts(after, timeZone)
  for (let i = 0; i <= 7; i++) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + i))
    const wd = base.getUTCDay()
    if (!days.includes(wd)) continue
    const at = zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hh, mm, timeZone)
    if (at.getTime() > after.getTime()) return at
  }
  return null
}

// ── Weekly digest ─────────────────────────────────────────────────────────────────────────────────────

const HEALTH = new Set(["ON_TRACK", "AT_RISK", "OFF_TRACK"])
const DAY = 24 * 60 * 60 * 1000

type DigestTask = { id: string; title: string; status: string; priority: string; dueDate: Date | null; completedAt: Date | null; updatedAt: Date; section: string; assignees: string[] }

async function digestData(projectId: string) {
  const now = Date.now()
  const rows = await prisma.task.findMany({
    where: { taskList: { projectId } },
    select: {
      id: true, title: true, status: true, priority: true, dueDate: true, completedAt: true, updatedAt: true,
      taskList: { select: { name: true } },
      assignees: { select: { user: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 600,
  })
  const tasks: DigestTask[] = rows.map((t) => ({
    id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, completedAt: t.completedAt, updatedAt: t.updatedAt,
    section: t.taskList?.name ?? "", assignees: t.assignees.map((a) => a.user.name).filter(Boolean) as string[],
  }))
  const open = (t: DigestTask) => t.status !== "DONE" && t.status !== "CANCELLED"
  const brief = (t: DigestTask) => ({
    title: t.title, status: t.status, priority: t.priority, section: t.section,
    due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, who: t.assignees.join(", ") || null,
  })
  const doneThisWeek = tasks.filter((t) => t.completedAt && now - t.completedAt.getTime() <= 7 * DAY)
  const overdue = tasks.filter((t) => open(t) && t.dueDate && t.dueDate.getTime() < now)
  const dueNextWeek = tasks.filter((t) => open(t) && t.dueDate && t.dueDate.getTime() >= now && t.dueDate.getTime() - now <= 7 * DAY)
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "IN_REVIEW")
  const stale = tasks.filter((t) => open(t) && now - t.updatedAt.getTime() > 14 * DAY)
  return {
    data: {
      totals: { tasks: tasks.length, open: tasks.filter(open).length, done: tasks.filter((t) => t.status === "DONE").length },
      doneThisWeek: doneThisWeek.slice(0, 25).map(brief),
      inProgress: inProgress.slice(0, 25).map(brief),
      overdue: overdue.slice(0, 25).map(brief),
      dueNextWeek: dueNextWeek.slice(0, 25).map(brief),
      untouched14Days: stale.slice(0, 10).map(brief),
    },
    counts: { done: doneThisWeek.length, overdue: overdue.length, due: dueNextWeek.length, inProgress: inProgress.length },
  }
}

/**
 * One digest for one schedule. `manual` = "Run now" from the project (still logged, still posted).
 * Returns the run outcome; never throws.
 */
export async function runScheduledDigest(scheduleId: string, opts: { manual?: boolean } = {}): Promise<{ ok: boolean; error?: string; statusUpdateId?: string }> {
  const schedule = await prisma.gideonSchedule.findUnique({ where: { id: scheduleId } })
  if (!schedule) return { ok: false, error: "Schedule not found" }
  const finish = async (status: "SUCCEEDED" | "FAILED" | "SKIPPED", runId: string | null) => {
    await prisma.gideonSchedule.update({ where: { id: scheduleId }, data: { lastRunAt: new Date(), lastStatus: status, ...(runId ? { lastRunId: runId } : {}) } }).catch(() => {})
  }
  const project = await prisma.project.findUnique({ where: { id: schedule.projectId }, select: { id: true, name: true } })
  const owner = await prisma.user.findUnique({ where: { id: schedule.createdById }, select: { id: true, name: true, email: true, deactivatedAt: true } })
  if (!project || !owner || owner.deactivatedAt) {
    await finish("SKIPPED", null)
    return { ok: false, error: !project ? "Project not found" : "The person who set this up can no longer run it" }
  }
  // GIDEON reads as the schedule's owner, so the owner must still be able to read the project.
  if (!(await checkProjectAccess(owner.id, project.id, ["VIEWER"])).allowed) {
    await finish("SKIPPED", null)
    return { ok: false, error: "The person who set this up no longer has access to this project" }
  }

  const { data, counts } = await digestData(project.id)
  const en = schedule.language === "en"
  const prompt = [
    en
      ? `You are GIDEON, the assistant inside NEXUS. Write this week's digest of the project "${project.name}" for its team, from the data below. The data is complete: do not call tools unless you truly need one task's detail. Do not invent anything.`
      : `Kamu GIDEON, asisten di NEXUS. Tulis ringkasan mingguan project "${project.name}" untuk timnya, dari data di bawah. Datanya sudah lengkap: jangan panggil tool kecuali benar-benar perlu detail satu task. Jangan mengarang apa pun.`,
    en
      ? `The FIRST line must be exactly one of: STATUS: ON_TRACK | STATUS: AT_RISK | STATUS: OFF_TRACK. Then Markdown, at most 220 words, with short sections: **Done this week**, **In progress**, **Overdue**, **Next 7 days**, **Needs attention**. Use exact task titles and owners. Skip a section that is empty.`
      : `Baris PERTAMA wajib persis salah satu: STATUS: ON_TRACK | STATUS: AT_RISK | STATUS: OFF_TRACK. Lalu Markdown, maksimal 220 kata, bagian pendek: **Selesai minggu ini**, **Sedang jalan**, **Terlambat**, **7 hari ke depan**, **Perlu perhatian**. Pakai judul task dan PIC persis. Lewati bagian yang kosong.`,
    schedule.instructions ? (en ? `Extra focus from the Project Owner: ${schedule.instructions}` : `Fokus tambahan dari Pemilik Project: ${schedule.instructions}`) : "",
    approvalPromptLine("always_ask", en ? "en" : "id"),
    "",
    "DATA:",
    JSON.stringify(data),
  ].filter(Boolean).join("\n")

  let runId: string | null = null
  const reply = await askGideon({
    prompt,
    user: owner.name ?? "",
    actorEmail: owner.email ?? owner.id,
    trigger: "SCHEDULE",
    approvalMode: "always_ask",
    projectId: project.id,
    scheduleId,
    title: `${opts.manual ? "Digest (run now)" : "Weekly digest"} · ${project.name}`,
    model: "luna",
    timeoutMs: 240_000,
    tag: `digest ${project.id}`,
    onRun: (id) => { runId = id },
  }).catch((error) => {
    log.error("digest failed", { scheduleId, error: String(error) })
    return null
  })
  if (!reply) {
    await finish("FAILED", runId)
    return { ok: false, error: "GIDEON did not answer" }
  }

  const firstLine = reply.split("\n")[0] ?? ""
  const m = /STATUS:\s*(ON_TRACK|AT_RISK|OFF_TRACK)/i.exec(firstLine)
  const body = (m ? reply.split("\n").slice(1).join("\n") : reply).trim()
  let status: ProjectHealth = "ON_TRACK"
  if (m && HEALTH.has(m[1].toUpperCase())) status = m[1].toUpperCase() as ProjectHealth
  else {
    const prev = await prisma.statusUpdate.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, select: { status: true } })
    if (prev) status = prev.status
  }
  const gideonId = await getGideonUserId()
  const update = await prisma.statusUpdate.create({
    data: { projectId: project.id, authorId: gideonId, status, text: body.slice(0, 6000) },
    select: { id: true },
  })
  await finish("SUCCEEDED", runId)
  notifyStatusUpdate({
    projectId: project.id,
    projectName: project.name,
    updatedByName: "GIDEON",
    status,
    summary: `${counts.done} done · ${counts.inProgress} in progress · ${counts.overdue} overdue · ${counts.due} due next 7 days`,
  }).catch(() => {})
  return { ok: true, statusUpdateId: update.id }
}

// ── Clock ─────────────────────────────────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __nexusGideonTicker?: boolean }

/**
 * Every minute: schedules whose nextRunAt has passed. The claim moves nextRunAt forward in the same
 * conditional update, so two processes (or a restart mid-tick) never run one slot twice. Stands down
 * when GIDEON is not configured and on a read-only replica. Off with NEXUS_GIDEON_TICKER=0.
 */
export function startGideonTicker() {
  if (g.__nexusGideonTicker) return
  g.__nexusGideonTicker = true
  let busy = false
  const tick = async () => {
    // Blue-green: only the singleton leader (live slot) delivers schedules (lib/bluegreen.ts).
    if (busy || !process.env.GIDEON_CHAT_URL || !isSingletonLeader()) return
    busy = true
    try {
      const rows = await prisma.$queryRaw<Array<{ ro: boolean }>>`select pg_is_in_recovery() as ro`
      if (rows[0]?.ro) return
      const now = new Date()
      const due = await prisma.gideonSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 5 })
      for (const s of due) {
        const next = nextOccurrence(s.weekdays, s.time, s.timezone, new Date(Math.max(now.getTime(), (s.nextRunAt ?? now).getTime())))
        const claimed = await prisma.gideonSchedule.updateMany({ where: { id: s.id, nextRunAt: s.nextRunAt }, data: { nextRunAt: next } })
        if (claimed.count === 0) continue
        // A slot missed by more than 6 hours (server was down) is skipped, not delivered late on a Tuesday night.
        if (s.nextRunAt && now.getTime() - s.nextRunAt.getTime() > 6 * 60 * 60 * 1000) {
          await prisma.gideonSchedule.update({ where: { id: s.id }, data: { lastStatus: "SKIPPED" } }).catch(() => {})
          continue
        }
        const r = await runScheduledDigest(s.id)
        log.info("scheduled digest", { scheduleId: s.id, ok: r.ok, error: r.error })
      }
    } catch (err) {
      log.error("gideon tick failed", { error: String(err) })
    } finally {
      busy = false
    }
  }
  setTimeout(() => { void tick() }, 30_000).unref?.()
  setInterval(() => { void tick() }, 60_000).unref?.()
}

// ── @GIDEON in task comments ──────────────────────────────────────────────────────────────────────────

/** "@GIDEON", "@gideon", "@Gideon," — a word on its own, not part of an email or another name. */
export function mentionsGideon(text: string): boolean {
  return /(^|[^\w@.])@gideon\b/i.test(text || "")
}

const MENTIONS_PER_HOUR = 20

/**
 * Answer an @GIDEON comment in its thread. Fire-and-forget from the comments route; never throws.
 * Runs as the person who mentioned. Writes GIDEON wants are held for that person's approval
 * (GideonProposal), and the reply says so.
 */
export async function answerGideonMention(commentId: string): Promise<void> {
  try {
    if (!process.env.GIDEON_CHAT_URL) return
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true, content: true, parentId: true, taskId: true,
        user: { select: { id: true, name: true, email: true, deactivatedAt: true } },
        task: { select: { id: true, title: true, status: true, dueDate: true, description: true, taskList: { select: { name: true, projectId: true, project: { select: { name: true } } } } } },
      },
    })
    if (!comment?.task || !comment.user || comment.user.deactivatedAt) return
    if (comment.user.email === GIDEON_EMAIL) return
    const recent = await prisma.gideonRun.count({ where: { userId: comment.user.id, trigger: "MENTION", startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } })
    if (recent >= MENTIONS_PER_HOUR) {
      log.info("mention skipped: hourly limit", { userId: comment.user.id })
      return
    }

    const task = comment.task
    const projectId = task.taskList.projectId
    const rootId = comment.parentId ?? comment.id
    const thread = await prisma.comment.findMany({
      where: { taskId: task.id, OR: [{ id: rootId }, { parentId: rootId }] },
      orderBy: { createdAt: "asc" },
      take: 14,
      select: { id: true, content: true, user: { select: { name: true } } },
    })
    const name = comment.user.name || "anggota tim"
    const question = comment.content.replace(/@gideon\b/gi, "").trim() || comment.content
    const prompt = [
      `[IDENTITAS] Kamu GIDEON, dipanggil dengan @GIDEON oleh "${name}" di kolom komentar sebuah task NEXUS. Jawabanmu akan diposting sebagai balasan di thread komentar itu dan dibaca anggota project lain juga.`,
      `[SOAL DIRIMU SENDIRI] Kamu GIDEON, titik. Jangan menyebut model, provider, vendor atau framework apa pun.`,
      `[TASK] "${task.title}" (taskId: ${task.id}) di project "${task.taskList.project?.name ?? ""}" (projectId: ${projectId}), section "${task.taskList.name}", status ${task.status}${task.dueDate ? `, tenggat ${task.dueDate.toISOString().slice(0, 10)}` : ""}.`,
      task.description ? `[DESKRIPSI] ${task.description.slice(0, 1500)}` : "",
      `[THREAD]\n${thread.map((c) => `${c.user?.name ?? "?"}: ${c.content.slice(0, 500)}`).join("\n")}`,
      approvalPromptLine("always_ask"),
      `[FORMAT] Maksimal 8 baris, langsung ke inti, Markdown ringan. Bahasa mengikuti bahasa pertanyaannya.`,
      `Pertanyaan dari ${name}: ${question.slice(0, 2000)}`,
    ].filter(Boolean).join("\n\n")

    let runId: string | null = null
    const reply = await askGideon({
      prompt,
      user: name,
      actorEmail: comment.user.email || comment.user.id,
      trigger: "MENTION",
      approvalMode: "always_ask",
      projectId,
      taskId: task.id,
      title: `@GIDEON · ${task.title}`,
      timeoutMs: 200_000,
      tag: `mention ${task.id}`,
      onRun: (id) => { runId = id },
    }).catch(() => null)

    const pending = runId ? await prisma.gideonProposal.count({ where: { runId, status: "PENDING" } }) : 0
    const lines = [reply?.trim() || "Maaf, GIDEON gagal menjawab kali ini. Coba mention lagi sebentar lagi."]
    if (pending > 0) lines.push(`\n_${pending} perubahan menunggu persetujuan ${name} di panel GIDEON._`)
    const gideonId = await getGideonUserId()
    const posted = await prisma.comment.create({
      data: { taskId: task.id, userId: gideonId, content: lines.join("\n").slice(0, 8000), parentId: rootId },
      include: { user: true },
    })
    await prisma.activityLog.create({
      data: { action: "GIDEON_COMMENT_ADDED", details: `GIDEON answered @GIDEON on task: ${task.title}`, userId: comment.user.id, taskId: task.id, projectId },
    }).catch(() => {})
    emitCommentAdded(projectId, task.id, JSON.parse(JSON.stringify(posted)))
    // Followers (the asker auto-follows by commenting) hear about the answer like any other comment.
    notifyCommentAdded({ taskId: task.id, taskTitle: task.title, projectId, commentByName: "GIDEON", commentById: gideonId, commentSnippet: lines[0].slice(0, 180) }).catch(() => {})
    if (pending > 0) {
      createInAppNotification({
        userId: comment.user.id,
        type: "gideon_proposal",
        title: "GIDEON is waiting for your approval",
        message: `${pending} change${pending === 1 ? "" : "s"} on “${task.title}”. Open GIDEON to review.`,
        taskId: task.id,
        projectId,
        link: `/tasks/${task.id}`,
        push: false,
      }).catch(() => {})
    }
  } catch (error) {
    log.error("mention failed", { commentId, error: String(error) })
  }
}
