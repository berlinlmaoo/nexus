export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { minutesLateAgainstShift, safeAttendanceTimezone, resolveShiftWindowAt, formatAttendanceDateKey } from '@/lib/attendance'
import { markdownToTipTap, extractTextFromTipTap } from '@/lib/tiptap-utils'
import { getGideonUserId } from '@/lib/gideon-identity'
import { authenticateGideonService } from '@/lib/gideon-service-auth'
import { checkProjectAccess } from '@/lib/rbac'
import { notifyCommentAdded, notifyTaskAssigned, notifyTaskCompleted } from '@/lib/notification-service'
import { normalizeCustomFieldNumberInput, normalizeCustomFieldOptions, normalizeCustomFieldType, serializeCustomFieldValue } from '@/lib/custom-fields'
import { FLEXI_WINDOW_END, parseDateOnlyToUtc, resolveEffectiveAttendanceShift } from '@/lib/attendance'
import {
  findCoveringAttendanceRequests, getOutageRecord, hasAttendanceWaiver, isAutoDeduction, isOutageDay,
  readAttendancePenaltiesForDate } from '@/lib/attendance-absence'
import {
  ATTENDANCE_CORRECTION_INCLUDE, CORRECTION_REASON_MAX, CORRECTION_REASON_MIN, DATE_KEY_RE,
  describeCorrection, parseProposedTime, serializeAttendanceCorrection, validateCorrectionTimes,
  proposeAttendanceCorrection, proposeAttendancePenaltyCancellation } from '@/lib/attendance-correction'
import { BODY_MAX, isBodPlus } from '@/lib/complaints'
import { GIDEON_EMAIL } from '@/lib/gideon-identity'
import { resolveAutoAssignAssigneeIds } from '@/lib/project-auto-assign'
import type { Prisma, ProjectStatus, TaskPriority, TaskStatus, User } from '@/generated/prisma/client'

type GideonAction =
  | 'list_projects'
  | 'list_members'
  | 'list_tasks'
  | 'search_tasks'
  | 'get_project_summary'
  | 'create_task'
  | 'update_task'
  | 'add_task_comment'
  | 'list_custom_fields'
  | 'get_attendance_day'
  | 'propose_attendance_correction'
  | 'propose_penalty_cancellation'
  | 'resolve_ticket'

type ToolBody = {
  action?: GideonAction | string
  input?: Record<string, unknown>
}

const MAX_LIMIT = 100
const TASK_STATUSES = new Set(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'])
const TASK_PRIORITIES = new Set(['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'])
const STATUS_TO_LIST_NAMES: Record<string, string[]> = {
  TODO: ['To Do', 'Todo', 'Backlog'],
  IN_PROGRESS: ['In Progress', 'Doing'],
  IN_REVIEW: ['Review', 'In Review'],
  DONE: ['Done', 'DONE', 'Completed'],
}

function ok(data: unknown) {
  return NextResponse.json({ ok: true, data })
}

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const strings = value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
  return strings.length ? Array.from(new Set(strings)) : []
}

function asTaskStatus(value: unknown) {
  const status = asString(value)
  if (!status) return undefined
  if (!TASK_STATUSES.has(status)) throw new Error(`Invalid task status: ${status}`)
  return status as TaskStatus
}

function asTaskPriority(value: unknown) {
  const priority = asString(value)
  if (!priority) return undefined
  if (!TASK_PRIORITIES.has(priority)) throw new Error(`Invalid task priority: ${priority}`)
  return priority as TaskPriority
}

function asDate(value: unknown) {
  if (value === null) return null
  const raw = asString(value)
  if (!raw) return undefined
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${raw}`)
  return parsed
}

function asLimit(value: unknown, fallback = 50) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)))
}

function descriptionExcerpt(description?: string | null) {
  if (!description) return null
  return description.length > 280 ? `${description.slice(0, 277)}...` : description
}

function actorScopedProjectWhere(actor: Pick<User, 'id' | 'role'>, input: Record<string, unknown>) {
  const where: Prisma.ProjectWhereInput = {}
  const workspaceId = asString(input.workspaceId)
  const status = asString(input.status) as ProjectStatus | undefined

  if (workspaceId) where.workspaceId = workspaceId
  if (status) where.status = status

  if (actor.role !== 'ADMIN') {
    where.OR = [
      { members: { some: { userId: actor.id } } },
      { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD', 'MANAGER'] } } } } },
    ]
  }

  return where
}

function actorScopedTaskWhere(actor: Pick<User, 'id' | 'role'>, input: Record<string, unknown>) {
  const where: Prisma.TaskWhereInput = {}
  const taskListWhere: Prisma.TaskListWhereInput = {}
  const projectId = asString(input.projectId)
  const status = asString(input.status) as TaskStatus | undefined
  const priority = asString(input.priority) as TaskPriority | undefined
  const assigneeId = asString(input.assigneeId)

  if (projectId) taskListWhere.projectId = projectId
  if (status) where.status = status
  if (priority) where.priority = priority
  if (assigneeId) where.assignees = { some: { userId: assigneeId } }

  if (actor.role !== 'ADMIN') {
    taskListWhere.project = {
      OR: [
        { members: { some: { userId: actor.id } } },
        { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD', 'MANAGER'] } } } } },
      ],
    }
  }

  if (Object.keys(taskListWhere).length > 0) where.taskList = taskListWhere

  return where
}

const projectInclude = {
  workspace: { select: { id: true, name: true, slug: true } },
  members: {
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true, avatar: true } },
    },
    orderBy: { joinedAt: 'asc' as const },
  },
  taskLists: {
    select: { id: true, name: true, position: true, _count: { select: { tasks: true } } },
    orderBy: { position: 'asc' as const },
  },
}

const taskInclude = {
  taskList: {
    select: {
      id: true,
      name: true,
      projectId: true,
      project: { select: { id: true, name: true, status: true } },
    },
  },
  assignees: {
    select: { user: { select: { id: true, name: true, email: true, avatar: true } } },
  },
  creator: { select: { id: true, name: true, email: true } },
  customFieldValues: {
    select: {
      id: true,
      customFieldId: true,
      value: true,
      customField: { select: { id: true, name: true, type: true, options: true, position: true } },
    },
    orderBy: { customField: { position: 'asc' as const } },
  },
}

function serializeProject(project: any) {
  const taskLists = project.taskLists.map((list: any) => ({
    id: list.id,
    name: list.name,
    position: list.position,
    taskCount: list._count.tasks,
  }))

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    color: project.color,
    icon: project.icon,
    workspace: project.workspace,
    members: project.members,
    taskLists,
    taskCount: taskLists.reduce((sum: number, list: { taskCount: number }) => sum + list.taskCount, 0),
  }
}

function serializeTask(task: any) {
  return {
    id: task.id,
    title: task.title,
    description: descriptionExcerpt(task.description),
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    tags: task.tags,
    project: task.project || task.taskList?.project || null,
    taskList: task.taskList ? { id: task.taskList.id, name: task.taskList.name, projectId: task.taskList.projectId } : null,
    assignees: task.assignees.map((entry: any) => entry.user),
    creator: task.creator,
    customFields: (task.customFieldValues || []).map((entry: any) => ({
      id: entry.id,
      customFieldId: entry.customFieldId,
      name: entry.customField?.name,
      type: entry.customField?.type,
      options: entry.customField?.options,
      value: entry.value,
    })),
  }
}

async function listProjects(actor: User, input: Record<string, unknown>) {
  const projects = await prisma.project.findMany({
    where: actorScopedProjectWhere(actor, input),
    include: projectInclude,
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: MAX_LIMIT,
  })

  return projects.map(serializeProject)
}

async function listMembers(actor: User, input: Record<string, unknown>) {
  const workspaceId = asString(input.workspaceId)
  const projectId = asString(input.projectId)

  if (projectId) {
    const members = await prisma.projectMember.findMany({
      where: {
        projectId,
        ...(actor.role === 'ADMIN'
          ? {}
          : {
              project: {
                OR: [
                  { members: { some: { userId: actor.id } } },
                  { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD', 'MANAGER'] } } } } },
                ],
              },
            }),
      },
      select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } } },
      orderBy: { joinedAt: 'asc' },
      take: MAX_LIMIT,
    })
    return members
  }

  const members = await prisma.workspaceMember.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      ...(actor.role === 'ADMIN' ? {} : { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD', 'MANAGER'] } } } } }),
    },
    select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } }, workspace: { select: { id: true, name: true, slug: true } } },
    orderBy: { joinedAt: 'asc' },
    take: MAX_LIMIT,
  })
  return members
}

async function listTasks(actor: User, input: Record<string, unknown>) {
  const tasks = await prisma.task.findMany({
    where: actorScopedTaskWhere(actor, input),
    include: taskInclude,
    orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
    take: asLimit(input.limit),
  })

  return tasks.map(serializeTask)
}

async function searchTasks(actor: User, input: Record<string, unknown>) {
  const query = asString(input.query)
  if (!query) throw new Error('query is required')

  const baseWhere = actorScopedTaskWhere(actor, input)
  const tasks = await prisma.task.findMany({
    where: {
      ...baseWhere,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    },
    include: taskInclude,
    orderBy: [{ updatedAt: 'desc' }],
    take: asLimit(input.limit),
  })

  return tasks.map(serializeTask)
}

async function getProjectSummary(actor: User, input: Record<string, unknown>) {
  const projectId = asString(input.projectId)
  if (!projectId) throw new Error('projectId is required')

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
      ...(actor.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { members: { some: { userId: actor.id } } },
              { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD', 'MANAGER'] } } } } },
            ],
          }),
    },
    select: {
      id: true,
      name: true,
      status: true,
      workspace: { select: { id: true, name: true, slug: true } },
      members: { select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } } } },
    },
  })

  if (!project) throw new Error('Project not found or not accessible')

  const taskWhere = { taskList: { projectId } }
  const [totalTasks, completedTasks, byStatusRows, byPriorityRows] = await Promise.all([
    prisma.task.count({ where: taskWhere }),
    prisma.task.count({ where: { ...taskWhere, status: 'DONE' } }),
    prisma.task.groupBy({ by: ['status'], where: taskWhere, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['priority'], where: taskWhere, _count: { _all: true } }),
  ])

  const byStatus = Object.fromEntries(byStatusRows.map((row) => [row.status, row._count._all]))
  const byPriority = Object.fromEntries(byPriorityRows.map((row) => [row.priority, row._count._all]))

  return {
    project,
    totalTasks,
    completedTasks,
    progressPercent: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    byStatus,
    byPriority,
  }
}

/**
 * DISABLED 8 September 2026, together with the Knowledge Library disappearing from the web and app
 * ahead of Z Vault. It was never used: all four documents in the library were written by people, not
 * by GIDEON. Leaving it wired would have meant GIDEON filing things into a library nobody can browse
 * to and handing out links to a page that is no longer in anyone's menu.
 *
 * Kept rather than deleted because the need it answers is real and comes back with Z Vault: GIDEON
 * can read the whole workspace and reason about it, and without somewhere to put the result a long
 * answer only exists inside one chat. Re-enabling is the action entry and the union member.
 *
 * Writes a document into the Knowledge Library.
 *
 * The one thing GIDEON could not do: it can read the whole workspace and reason about it, then had
 * nowhere to put the result. Everything else about this is deliberately ordinary — same project
 * access gate as creating a task, authored by the person who asked, so it appears in the library
 * under their name and not under a service account nobody recognises.
 */
/** Where a person can actually open what GIDEON wrote. */
const PUBLIC_BASE = (process.env.NEXUS_PUBLIC_URL || 'https://nexus.znetworks.id').replace(/\/+$/, '')

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createDocument(actor: User, input: Record<string, unknown>) {
  const projectId = String(input.projectId ?? '').trim()
  const title = String(input.title ?? '').trim()
  const markdown = String(input.markdown ?? input.content ?? '')

  if (!projectId) throw new Error('projectId is required')
  if (!title) throw new Error('title is required')
  if (!markdown.trim()) throw new Error('markdown is required — a document with no body is not worth creating')

  const project = await getAccessibleProject(actor, projectId)
  await assertCanWrite(actor, projectId)

  // Stored as ProseMirror nodes, which is what the library renders. A plain string saves without
  // complaint and then shows up blank.
  const content = markdownToTipTap(markdown)

  const doc = await prisma.doc.create({
    data: {
      title,
      content: content as never,
      contentText: extractTextFromTipTap(content),
      projectId,
      // GIDEON wrote it; the person who asked owns it. Both are true, and neither has to be guessed
      // from the text later.
      authorId: await getGideonUserId(),
      ownerId: actor.id,
      parentId: typeof input.parentId === 'string' && input.parentId ? input.parentId : null,
    },
    select: { id: true, title: true, createdAt: true },
  })

  return {
    id: doc.id,
    title: doc.title,
    project: project.name,
    // Absolute, because GIDEON hands this straight to a person. Given a relative path it invented a
    // host and produced a link to an old domain — authoritative-looking and going nowhere.
    // NEXTAUTH_URL is the container's own 127.0.0.1 address, so it cannot answer this.
    url: `${PUBLIC_BASE}/docs/${doc.id}`,
    createdAt: doc.createdAt,
  }
}

// proposeAttendanceCorrection now lives in @/lib/attendance-correction: the reporter can file
// one too, and two copies of the rules that decide what may be proposed is one copy too many.


/**
 * One day of the actor's OWN attendance, read-only — and everything needed to choose a remedy for it.
 *
 * Added because GIDEON was being asked to validate an attendance ticket while unable to see the
 * record it was validating against — it could read the photo and nothing else, so every conclusion
 * rested on the picture alone.
 *
 * Widened afterwards for the same reason one step further out. Seeing only the record, the model could
 * tell that someone checked in at 18:21 but not that a permit covered the day, that NEXUS was
 * unreachable, that 15:00 (not 09:00) was their shift, or that 120 XP had actually been docked — so
 * every case still came out as "propose a time", including the ones a time cannot fix. One call now
 * returns: the record, the shift that defines "on time" for THIS person on THIS date, whether the day
 * is on the outage register (plus an anonymous headcount of who else was penalised, because that
 * register is unreliable), every leave/permit/sick request covering the date with its status, and the
 * XP actually charged.
 *
 * Always the actor, never a userId from the input. GIDEON acts as whoever asked, so on a ticket it
 * reads the reporter's day and no one else's. A BoD wanting to look at a colleague's attendance has
 * the attendance board for that; widening this tool would turn "help me with my ticket" into a way
 * to read the whole company's hours.
 *
 * Reading only. There is deliberately no counterpart that writes: a correction goes through
 * propose_attendance_correction and a human approval, because a person MAY mark themselves present
 * and so acting-as-them guards nothing here.
 */
async function getAttendanceDay(actor: User, input: Record<string, unknown>) {
  const raw = String(input.date ?? input.attendanceDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('date is required, format YYYY-MM-DD')

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: actor.id },
    select: { workspaceId: true },
  })
  if (!membership) throw new Error('No workspace membership found')
  // ACTOR-SCOPED, everywhere below. Every query in this function is keyed on actor.id and this
  // workspaceId; `input.userId` is never read, and there is no code path that could. GIDEON runs as
  // whoever asked, so on a ticket this is the reporter's own day and nobody else's.
  const workspaceId = membership.workspaceId
  const attendanceDate = parseDateOnlyToUtc(raw)

  const record = await prisma.attendanceRecord.findFirst({
    where: {
      userId: actor.id,
      workspaceId,
      attendanceDate: { gte: new Date(`${raw}T00:00:00.000Z`), lt: new Date(`${raw}T23:59:59.999Z`) },
    },
    select: {
      id: true, attendanceDate: true, checkInAt: true, checkOutAt: true, status: true,
      lateMinutes: true, earlyLeaveMinutes: true, workedMinutes: true,
      checkInStatus: true, checkOutStatus: true, correctedAt: true,
      officeLocation: true,
    },
  })

  // Local clock as well as the raw instant. Given only UTC the model reports "15.09 UTC" into a
  // ticket read by people who live seven hours ahead of it — and an attendance argument settled on a
  // misread clock is settled wrongly.
  const jakarta = (d: Date | null) =>
    d ? d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) : null

  // ---- What "on time" MEANT for this person on this date. -------------------------------------
  // Without it there is no way to tell a fair proposal from an unfair one: the model was proposing
  // times it had read off a screenshot, which is when someone gave up trying, not when they were due.
  // Needs an office (the shift can come from the office default, and the offices here disagree —
  // 15:00 at HQ, 09:00 elsewhere). The day's own office first; failing that the one this person
  // actually checks in at; failing that the workspace's only office. Never a guess between several.
  let office = record?.officeLocation ?? null
  let officeSource: 'record' | 'usual' | 'only-active' | 'unknown' = record?.officeLocation ? 'record' : 'unknown'
  if (!office) {
    const usual = await prisma.attendanceRecord.findFirst({
      where: { userId: actor.id, workspaceId },
      orderBy: { attendanceDate: 'desc' },
      select: { officeLocation: true },
    })
    if (usual?.officeLocation) {
      office = usual.officeLocation
      officeSource = 'usual'
    } else {
      const offices = await prisma.officeLocation.findMany({ where: { workspaceId, isActive: true }, take: 2 })
      if (offices.length === 1) {
        office = offices[0]
        officeSource = 'only-active'
      }
    }
  }
  const effectiveShift = office
    ? await resolveEffectiveAttendanceShift({ userId: actor.id, workspaceId, office, date: attendanceDate })
    : null
  const shift = effectiveShift
    ? {
        // The wall-clock the person was due, in Jakarta time. THIS is the time to propose when a
        // proposal is warranted at all — never a timestamp read off an error screenshot.
        shiftStartTime: effectiveShift.shiftStartTime,
        shiftEndTime: effectiveShift.shiftEndTime,
        // Flexi people are not late until the window END; that, not the start, is the on-time line.
        onTimeCutoff: effectiveShift.flexi ? FLEXI_WINDOW_END : effectiveShift.shiftStartTime,
        flexi: effectiveShift.flexi,
        source: effectiveShift.source,
        teamName: effectiveShift.teamName,
        graceMinutes: Math.max(0, office?.lateGraceMinutes ?? 0),
        office: office?.name ?? null,
        officeSource,
      }
    : { unknown: true, note: 'Kantornya gak bisa ditentukan (orang ini belum pernah absen dan workspace punya lebih dari satu kantor aktif), jadi jam shift-nya gak bisa dipastikan. Jangan menebak jamnya.' }

  // ---- Cover: a leave / permit / sick request over this date. ----------------------------------
  // PENDING counts, and that is the point. Both attendance crons hold the penalty back for a request
  // that is merely filed, so a day covered by one is not plain lateness however late the clock reads.
  const covering = await findCoveringAttendanceRequests(actor.id, workspaceId, attendanceDate)
  const coveringRequests = covering.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    // The cron's own "Auto: telat >120 menit" day-off is a PENALTY, not cover for one. Marked, because
    // a model reading a list of "APPROVED DAY_OFF" rows would otherwise conclude the day was excused
    // when that row IS the punishment being complained about.
    isAutoDeduction: isAutoDeduction(r),
    reason: r.reason,
    filedAt: r.createdAt,
    reviewedAt: r.reviewedAt,
  }))
  const realCover = coveringRequests.filter((r) => !r.isAutoDeduction)

  // Request yang DIBATALKAN atau DITOLAK untuk tanggal ini. Bukan cover — tapi bukti niat: Violet
  // mengajukan izin 13 Sep lalu membatalkannya karena ternyata sakit, dan tool ini dulu melaporkan
  // "tidak ada pengajuan" seolah dia tidak pernah bilang apa-apa. GIDEON perlu tahu ada yang pernah
  // diajukan, apa alasannya, dan kapan dibatalkan — lalu menilai buktinya sendiri.
  const cancelledRows = await prisma.attendanceRequest.findMany({
    where: { userId: actor.id, workspaceId, status: { in: ['CANCELED', 'REJECTED'] }, startDate: { lte: attendanceDate }, endDate: { gte: attendanceDate } },
    select: { id: true, type: true, status: true, reason: true, createdAt: true, updatedAt: true, reviewNote: true },
    orderBy: { createdAt: 'asc' },
  })
  const cancelledRequests = cancelledRows.map((r) => ({
    id: r.id, type: r.type, status: r.status, reason: r.reason, filedAt: r.createdAt, endedAt: r.updatedAt, reviewNote: r.reviewNote,
  }))

  // ---- What the day actually cost, off the XP ledger. ------------------------------------------
  const pen = await readAttendancePenaltiesForDate(actor.id, workspaceId, attendanceDate, raw)
  const totalPenaltyXp = pen.lateXp + pen.noCheckoutXp + pen.alphaXp

  // ---- Telat menurut shift SEKARANG vs penalti yang tercatat. ---------------------------------
  // Penalti dihitung malam itu dengan shift yang berlaku SAAT ITU. Kalau shift orangnya lalu
  // diubah (Queen: 15:00 → 19:00), catatan jamnya tetap benar tapi penaltinya jadi salah — dan
  // obatnya PEMBATALAN POTONGAN, bukan mengganti jam masuk yang memang benar. Tanpa fakta ini
  // GIDEON pernah mengusulkan mengubah 18:05 menjadi 19:00 pada orang yang memang absen 18:05.
  let lateAgainstCurrentShift: number | null = null
  if (record?.checkInAt && office && effectiveShift) {
    try {
      const baseline = effectiveShift.flexi ? '15:00' : effectiveShift.shiftStartTime
      lateAgainstCurrentShift = Math.max(0, minutesLateAgainstShift(record.checkInAt, attendanceDate, baseline, safeAttendanceTimezone(office.timezone)))
    } catch { lateAgainstCurrentShift = null }
  }
  const grace = Math.max(0, office?.lateGraceMinutes ?? 0)
  const shiftCheck = {
    recordedLateMinutes: record?.lateMinutes ?? null,
    lateAgainstCurrentShift,
    // true = ledger mencatat telat, tapi menurut shift yang berlaku SEKARANG orang ini tidak telat.
    penaltyContradictsCurrentShift: pen.lateXp < 0 && lateAgainstCurrentShift !== null && lateAgainstCurrentShift <= grace,
    meaning:
      'penaltyContradictsCurrentShift=true berarti shift orang ini berubah sesudah penalti dihitung; jam yang tercatat ' +
      'BENAR, penaltinya yang tidak berlaku lagi → usulkan PEMBATALAN POTONGAN. JANGAN mengusulkan koreksi jam: ' +
      'jam itu memang jam dia absen.',
  }
  const waived = await hasAttendanceWaiver(actor.id, raw)

  // ---- Was NEXUS down that day? ----------------------------------------------------------------
  // isOutageDay reads the AttendanceOutage table (written by the host-side probe) as well as the
  // hand-typed env var, and counts only days whose CHECK-IN WINDOW the outage actually swallowed —
  // an outage that began at 19:41 did not stop that morning's shift and must not pardon it.
  //
  // A false here still means NOT RECORDED, never DID NOT HAPPEN. The probe only started running after
  // 2–3 Sep 2026 went unrecorded and cost 33 people 5,198 XP, so anything before it depends on someone
  // having noticed. The field is named for what it actually knows.
  //
  // The corroboration is a headcount, and a headcount only: how many people in this workspace carry an
  // attendance penalty for that same date. It is deliberately anonymous — no names, no ids, nothing
  // per-person — so it stays a fact about the SYSTEM, which is what an outage is, and reading it can
  // never become a way to read a colleague's hours. Everyone in the workspace losing XP on one day is
  // the signature of an outage; one person losing XP is a person who was late.
  const memberIds = (await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } })).map((m) => m.userId)
  const dayPenaltyRows = await prisma.xpTransaction.findMany({
    where: { userId: { in: memberIds }, reason: { in: [`attendance:late:${raw}`, `attendance:nocheckout:${raw}`, `attendance:alpha:${raw}`] } },
    select: { userId: true, reason: true },
  })
  const penalizedMembers = new Set(dayPenaltyRows.map((r) => r.userId))
  const alphaMembers = new Set(dayPenaltyRows.filter((r) => r.reason.startsWith('attendance:alpha:')).map((r) => r.userId))
  // A headcount with NOTHING to compare it against is not evidence, and shipping one as if it were
  // produced a real defect: this workspace penalises 18-28 people EVERY day, so "22 of 46 were
  // penalised" reads as alarming while being exactly average. GIDEON quoted it as corroboration of an
  // outage on an ordinary day. So the baseline ships WITH the number — the median of the 14 days
  // before this one — and `aboveNormal` does the comparison here rather than hoping the model does.
  const baselineStart = new Date(attendanceDate.getTime() - 14 * 24 * 60 * 60 * 1000)
  const baselineRows = await prisma.$queryRaw<{ tgl: string; n: bigint }[]>`
    SELECT substring(reason from '[0-9]{4}-[0-9]{2}-[0-9]{2}') AS tgl, count(DISTINCT "userId") AS n
    FROM "XpTransaction"
    WHERE reason ~ '^attendance:(alpha|late|nocheckout):'
      AND substring(reason from '[0-9]{4}-[0-9]{2}-[0-9]{2}') >= ${formatAttendanceDateKey(baselineStart)}
      AND substring(reason from '[0-9]{4}-[0-9]{2}-[0-9]{2}') < ${raw}
    GROUP BY 1`
  const counts = baselineRows.map((r) => Number(r.n)).sort((a, b) => a - b)
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : null

  // Jam check-in PERTAMA hari itu dibanding kebiasaan 21 hari sebelumnya, dalam menit sejak tengah
  // malam WIB supaya shift malam ikut terhitung apa adanya.
  const firstRows = await prisma.$queryRaw<{ tgl: string; menit: number }[]>`
    SELECT to_char("attendanceDate", 'YYYY-MM-DD') AS tgl,
           MIN(EXTRACT(EPOCH FROM (
             ("checkInAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')
             - date_trunc('day', "checkInAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')
           )) / 60)::float AS menit
    FROM "AttendanceRecord"
    WHERE "workspaceId" = ${membership.workspaceId}
      AND "checkInAt" IS NOT NULL
      AND "attendanceDate" >= ${new Date(attendanceDate.getTime() - 21 * 24 * 60 * 60 * 1000)}
      AND "attendanceDate" <= ${attendanceDate}
    GROUP BY 1`
  const hhmm = (m: number | null) =>
    m === null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`
  const todayFirst = firstRows.find((r) => r.tgl === raw)?.menit ?? null
  const priorFirsts = firstRows.filter((r) => r.tgl !== raw).map((r) => r.menit).sort((a, b) => a - b)
  const medianFirst = priorFirsts.length >= 5 ? priorFirsts[Math.floor(priorFirsts.length / 2)] : null
  const laterBy = todayFirst !== null && medianFirst !== null ? Math.round(todayFirst - medianFirst) : null
  const checkInPattern = {
    firstCheckIn: hhmm(todayFirst),
    normalFirstCheckIn: hhmm(medianFirst),
    minutesLaterThanNormal: laterBy,
    // Ambang 150 menit: pada 21 hari di sekitar 3 September 2026 ambang ini memisahkan hari itu
    // (+257) dari SEMUA hari lain (tertinggi berikutnya +134).
    unusuallyLateStart: laterBy !== null && laterBy >= 150,
    meaning:
      'unusuallyLateStart=true berarti HARI ITU tidak ada seorang pun yang bisa check-in sampai jauh lewat ' +
      'jam biasa — tanda kuat sistemnya memang tidak bisa diakses, walaupun tanggalnya belum tercatat. ' +
      'false TIDAK menutup kemungkinan gangguan sore/malam: sinyal ini hanya melihat pagi.',
  }

  // Baris register outage untuk tanggal ini, apa pun blocksCheckIn-nya. `recordedByNexus` (di bawah)
  // hanya true untuk hari amnesti penuh; outage sore/malam yang diprobe otomatis tercatat dengan
  // blocksCheckIn=false dan dulu TIDAK terlihat di sini sama sekali — pada 15 September 2026 tunnel
  // mati 18:09–23:54 WIB, tujuh orang shift 19:00 kena alpha, dan GIDEON membaca "tidak tercatat".
  // Yang menentukan bagi SATU orang bukan harinya, tapi apakah jendela outage menelan jam masuknya.
  const outageRow = await getOutageRecord(raw)
  let coversShiftStart: boolean | null = null
  if (outageRow && office && effectiveShift) {
    try {
      const { shiftStartAt } = resolveShiftWindowAt(attendanceDate, office, effectiveShift)
      const endedAt = outageRow.endedAt ?? new Date()
      coversShiftStart = shiftStartAt >= outageRow.startedAt && shiftStartAt <= endedAt
    } catch { coversShiftStart = null }
  }
  const wib = (d: Date) => d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })

  const outage = {
    recordedByNexus: await isOutageDay(raw),
    meaning:
      'recordedByNexus=true berarti tanggal ini SUDAH terdaftar sebagai hari NEXUS down (semua cron melewatinya). ' +
      'recordedByNexus=false berarti BELUM TERCATAT — bukan berarti sistemnya tidak down. Daftar itu diisi otomatis ' +
      'oleh prober sejak 8 September 2026; sebelum tanggal itu ia bergantung pada ada tidaknya orang yang mengetiknya.',
    // Jendela outage yang tercatat hari itu (kalau ada), dan apakah jendela itu menelan jam MASUK orang
    // ini. coversShiftStart=true adalah bukti kuat: orang ini memang tidak bisa check-in tepat waktu.
    window: outageRow
      ? { startWib: wib(outageRow.startedAt), endWib: outageRow.endedAt ? wib(outageRow.endedAt) : null, minutes: outageRow.minutesDown, source: outageRow.source }
      : null,
    coversShiftStart,
    coversMeaning:
      'coversShiftStart=true berarti ada outage TERCATAT yang jendelanya menelan jam masuk orang ini di tanggal itu — ' +
      'usulkan pembatalan potongan, walaupun recordedByNexus=false. null berarti jam masuknya tidak bisa dipastikan.',
    // Anonymous headcounts, for raising a suspected outage to a BoD with a number attached.
    sameDaySignal: {
      workspaceMembers: memberIds.length,
      membersPenalized: penalizedMembers.size,
      membersWithNoCheckInAtAll: alphaMembers.size,
      // Median orang kena potongan pada 14 hari sebelumnya. Inilah pembandingnya.
      normalPenalizedPerDay: median,
      // true hanya kalau hari ini JELAS di atas kebiasaan (>=1,5x median). Angka di bawah ini
      // BUKAN tanda gangguan apa pun — cuma hari kerja biasa di workspace ini.
      aboveNormal: median !== null && median > 0 ? penalizedMembers.size >= median * 1.5 : false,
    },
    // Sinyal yang benar-benar bekerja untuk outage yang tidak sempat dicatat, dan yang selama ini
    // hanya dipura-purakan oleh jumlah kepala. Pada 3 September 2026 tunnel mati sampai 15:16 WIB dan
    // check-in pertama hari itu 15:00 — sementara 20 hari di sekitarnya mulai antara 00:08 dan 12:57.
    // Kalau TIDAK SEORANG PUN bisa masuk sampai sore, ada sesuatu di depan pintunya.
    //
    // Batasnya nyata dan harus disebut: ia hanya melihat outage yang memakan PAGI. Outage 2 September
    // mulai 19:41 dan check-in pertama hari itu 12:20 yang biasa saja — tidak terlihat di sini. Itu
    // pertukaran yang benar, karena outage yang memakan pagi persis kasus blocksCheckIn.
    //
    // Shift malam masuk jam 00:08 dan 02:02, jadi pembandingnya median workspace ini sendiri, bukan
    // jam kantor yang diketik seseorang. Ia menyesuaikan diri kalau pola shift berubah.
    checkInPattern,
  }

  const common = {
    date: raw,
    user: { id: actor.id, name: actor.name },
    timezone: 'Asia/Jakarta (WIB)',
    shift,
    outage,
    coveringRequests,
    shiftCheck,
    // Diajukan lalu dibatalkan/ditolak untuk tanggal ini. Bukan cover; bukti niat. Kosong = memang
    // tidak pernah ada pengajuan.
    cancelledRequests,
    // Pre-chewed because it is the single fact that decides the remedy, and a model that has to derive
    // it from the array above will sometimes derive it wrong.
    coveredByRequest: realCover.length > 0,
    xpPenalties: {
      lateXp: pen.lateXp,
      noCheckoutXp: pen.noCheckoutXp,
      alphaXp: pen.alphaXp,
      autoDayOffsDeducted: pen.autoDayOffs,
      totalPenaltyXp,
      // Nothing on the ledger = nothing to cancel. Usually means a cron already refunded it once the
      // permit was approved, and the honest answer is "your XP is already back", not a proposal.
      hasPenaltyToCancel: totalPenaltyXp < 0 || pen.autoDayOffs > 0,
      alreadyWaived: waived,
    },
  }

  if (!record) {
    // Said plainly rather than returned as an empty object: "no record" is a real answer here — it
    // usually means the check-in never landed, which is exactly what a ticket is about. Everything
    // above is still returned: a day the outage swallowed has no record and is still judgeable.
    return {
      ...common,
      found: false,
      note: 'Tidak ada catatan absensi untuk tanggal ini. Biasanya berarti check-in tidak pernah masuk.',
    }
  }

  return {
    ...common,
    date: formatAttendanceDateKey(record.attendanceDate),
    found: true,
    status: record.status,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    checkInLocal: jakarta(record.checkInAt),
    checkOutLocal: jakarta(record.checkOutAt),
    checkInStatus: record.checkInStatus,
    checkOutStatus: record.checkOutStatus,
    lateMinutes: record.lateMinutes,
    earlyLeaveMinutes: record.earlyLeaveMinutes,
    workedMinutes: record.workedMinutes,
    correctedAt: record.correctedAt,
    office: record.officeLocation?.name ?? null,
  }
}

async function getAccessibleProject(actor: User, projectId: string) {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
      ...(actor.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { members: { some: { userId: actor.id } } },
              { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD', 'MANAGER'] } } } } },
            ],
          }),
    },
    select: { id: true, name: true, status: true },
  })
  if (!project) throw new Error('Project not found or not accessible')
  return project
}

// Web-parity WRITE gate: a user may create/update tasks + comment via Gideon only where they could on
// the web — project MEMBER+ (LEAD/MEMBER), workspace BoD/Manager/One-Above-All, or system ADMIN. VIEWERs
// and non-members stay read-only. (ADMIN/workspace-admin short-circuit inside checkProjectAccess.)
async function assertCanWrite(actor: User, projectId: string) {
  const { allowed } = await checkProjectAccess(actor.id, projectId, ['MEMBER'])
  if (!allowed) throw new Error('Kamu gak punya akses buat bikin/ubah di project ini lewat Gideon.')
}

async function getAccessibleTask(actor: User, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, ...actorScopedTaskWhere(actor, {}) },
    include: taskInclude,
  })
  if (!task) throw new Error('Task not found or not accessible')
  return task
}

async function resolveTaskList(actor: User, input: Record<string, unknown>, status?: TaskStatus) {
  const taskListId = asString(input.taskListId)
  const projectId = asString(input.projectId)

  if (taskListId) {
    const taskList = await prisma.taskList.findFirst({
      where: {
        id: taskListId,
        ...(projectId ? { projectId } : {}),
        ...(actor.role === 'ADMIN'
          ? {}
          : {
              project: {
                OR: [
                  { members: { some: { userId: actor.id } } },
                  { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD', 'MANAGER'] } } } } },
                ],
              },
            }),
      },
      select: {
        id: true,
        name: true,
        projectId: true,
        project: {
          select: {
            id: true,
            name: true,
            status: true,
            autoAssignEnabled: true,
            autoAssignAssigneeIds: true,
            members: { select: { userId: true } },
          },
        },
      },
    })
    if (!taskList) throw new Error('Task list not found or not accessible')
    return taskList
  }

  if (!projectId) throw new Error('projectId or taskListId is required')
  await getAccessibleProject(actor, projectId)

  const preferredNames = status ? STATUS_TO_LIST_NAMES[status] || [] : []
  for (const name of preferredNames) {
    const taskList = await prisma.taskList.findFirst({
      where: { projectId, name: { equals: name, mode: 'insensitive' } },
      select: {
        id: true,
        name: true,
        projectId: true,
        project: {
          select: {
            id: true,
            name: true,
            status: true,
            autoAssignEnabled: true,
            autoAssignAssigneeIds: true,
            members: { select: { userId: true } },
          },
        },
      },
    })
    if (taskList) return taskList
  }

  const fallback = await prisma.taskList.findFirst({
    where: { projectId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      name: true,
      projectId: true,
      project: {
        select: {
          id: true,
          name: true,
          status: true,
          autoAssignEnabled: true,
          autoAssignAssigneeIds: true,
          members: { select: { userId: true } },
        },
      },
    },
  })
  if (!fallback) throw new Error('No task list found for project')
  return fallback
}

async function listCustomFields(actor: User, input: Record<string, unknown>) {
  const projectId = asString(input.projectId)
  if (!projectId) throw new Error('projectId is required')
  await getAccessibleProject(actor, projectId)

  return prisma.customField.findMany({
    where: { projectId },
    select: { id: true, name: true, type: true, options: true, position: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
}

function asCustomFieldInputs(value: unknown): Array<{ fieldId?: string; name?: string; value: unknown }> {
  if (!Array.isArray(value)) return []
  const inputs: Array<{ fieldId?: string; name?: string; value: unknown }> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const fieldId = asString(record.fieldId || record.customFieldId)
    const name = asString(record.name || record.fieldName)
    if (!fieldId && !name) continue
    inputs.push({ fieldId, name, value: record.value })
  }
  return inputs
}

async function resolveCustomFieldUpdates(actor: User, projectId: string, input: Record<string, unknown>) {
  const requested = asCustomFieldInputs(input.customFields)
  if (requested.length === 0) return []
  await getAccessibleProject(actor, projectId)

  const fields = await prisma.customField.findMany({
    where: { projectId },
    select: { id: true, name: true, type: true, options: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })

  return requested.map((request) => {
    const field = request.fieldId
      ? fields.find((candidate) => candidate.id === request.fieldId)
      : fields.find((candidate) => candidate.name.toLowerCase() === request.name?.toLowerCase())
    if (!field) throw new Error(`Custom field not found: ${request.fieldId || request.name}`)

    const normalizedType = normalizeCustomFieldType(field.type)
    if (!normalizedType) throw new Error(`Unsupported custom field type for ${field.name}: ${field.type}`)

    const options = normalizeCustomFieldOptions(normalizedType, field.options)
    const rawValue = normalizedType === 'NUMBER'
      ? normalizeCustomFieldNumberInput(String(request.value ?? ''), options)
      : request.value

    return {
      customFieldId: field.id,
      name: field.name,
      value: serializeCustomFieldValue(normalizedType, rawValue),
    }
  })
}

async function seedTaskCustomFieldDefaults(tx: Prisma.TransactionClient, taskId: string, projectId: string, taskCreatedAt?: Date | string | null) {
  const customFields = await tx.customField.findMany({
    where: { projectId },
    select: { id: true, type: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
  if (customFields.length === 0) return

  const valuesToCreate = customFields
    .map((field) => {
      const normalizedType = normalizeCustomFieldType(field.type)
      if (!normalizedType) return null
      return {
        customFieldId: field.id,
        taskId,
        value: serializeCustomFieldValue(normalizedType, undefined, taskCreatedAt),
      }
    })
    .filter((value): value is { customFieldId: string; taskId: string; value: string } => Boolean(value))

  if (valuesToCreate.length > 0) {
    await tx.customFieldValue.createMany({ data: valuesToCreate, skipDuplicates: true })
  }
}

async function applyCustomFieldUpdates(tx: Prisma.TransactionClient, taskId: string, updates: Array<{ customFieldId: string; value: string }>) {
  for (const update of updates) {
    await tx.customFieldValue.upsert({
      where: { customFieldId_taskId: { customFieldId: update.customFieldId, taskId } },
      update: { value: update.value },
      create: { customFieldId: update.customFieldId, taskId, value: update.value },
    })
  }
}

async function createTask(actor: User, input: Record<string, unknown>) {
  const title = asString(input.title)
  if (!title) throw new Error('title is required')
  const status = asTaskStatus(input.status) || 'TODO'
  const priority = asTaskPriority(input.priority) || 'MEDIUM'
  const dueDate = asDate(input.dueDate)
  const requestedAssigneeIds = asStringArray(input.assigneeIds)
  const taskList = await resolveTaskList(actor, input, status)
  await assertCanWrite(actor, taskList.projectId)
  const assigneeIds = resolveAutoAssignAssigneeIds({
    requestedAssigneeIds,
    autoAssignEnabled: taskList.project.autoAssignEnabled,
    autoAssignAssigneeIds: taskList.project.autoAssignAssigneeIds,
    validProjectMemberIds: taskList.project.members.map((member) => member.userId),
  })
  const customFieldUpdates = await resolveCustomFieldUpdates(actor, taskList.projectId, input)

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        title,
        description: asString(input.description) || null,
        status,
        priority,
        dueDate: dueDate === undefined ? null : dueDate,
        taskListId: taskList.id,
        creatorId: await getGideonUserId(),
        ...(assigneeIds.length > 0 ? { assignees: { create: assigneeIds.map((userId) => ({ userId })) } } : {}),
      },
      include: taskInclude,
    })

    await seedTaskCustomFieldDefaults(tx, created.id, taskList.projectId, created.createdAt)
    await applyCustomFieldUpdates(tx, created.id, customFieldUpdates)

    await tx.activityLog.create({
      data: {
        action: 'GIDEON_TASK_CREATED',
        details: `GIDEON created task: ${created.title}`,
        userId: actor.id,
        taskId: created.id,
        projectId: taskList.projectId,
      },
    })

    return created
  })

  await Promise.all(assigneeIds.map((assigneeId) =>
    notifyTaskAssigned({
      assigneeId,
      taskId: task.id,
      taskTitle: task.title,
      projectName: taskList.project.name,
      projectId: taskList.projectId,
      assignedByName: actor.name,
    })
  ))

  const verified = await prisma.task.findUnique({ where: { id: task.id }, include: taskInclude })
  return serializeTask(verified || task)
}

async function updateTask(actor: User, input: Record<string, unknown>) {
  const taskId = asString(input.taskId)
  if (!taskId) throw new Error('taskId is required')
  const existing = await getAccessibleTask(actor, taskId)
  await assertCanWrite(actor, existing.taskList.projectId)

  const data: Prisma.TaskUpdateInput = {}
  const title = asString(input.title)
  const description = input.description === null ? null : asString(input.description)
  const status = asTaskStatus(input.status)
  const priority = asTaskPriority(input.priority)
  const dueDate = asDate(input.dueDate)
  const taskListId = asString(input.taskListId)
  const assigneeIds = asStringArray(input.assigneeIds)
  const customFieldUpdates = await resolveCustomFieldUpdates(actor, existing.taskList.projectId, input)

  if (title) data.title = title
  if (input.description === null || description !== undefined) data.description = description || null
  if (status) data.status = status
  if (priority) data.priority = priority
  if (dueDate !== undefined) data.dueDate = dueDate
  if (taskListId) {
    const targetList = await resolveTaskList(actor, { taskListId }, status)
    data.taskList = { connect: { id: targetList.id } }
  }

  if (Object.keys(data).length === 0 && assigneeIds === undefined && customFieldUpdates.length === 0) throw new Error('No update fields provided')

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.task.update({ where: { id: taskId }, data })
    }
    if (assigneeIds !== undefined) {
      await tx.taskAssignee.deleteMany({ where: { taskId } })
      if (assigneeIds.length > 0) await tx.taskAssignee.createMany({ data: assigneeIds.map((userId) => ({ taskId, userId })), skipDuplicates: true })
    }
    await applyCustomFieldUpdates(tx, taskId, customFieldUpdates)
    await tx.activityLog.create({
      data: {
        action: 'GIDEON_TASK_UPDATED',
        details: `GIDEON updated task: ${existing.title}`,
        userId: actor.id,
        taskId,
        projectId: existing.taskList?.projectId,
      },
    })
  })

  const verified = await prisma.task.findUnique({ where: { id: taskId }, include: taskInclude })
  if (!verified) throw new Error('Task update verification failed')

  const newAssigneeIds = assigneeIds ? assigneeIds.filter((id) => !existing.assignees.some((entry: any) => entry.user.id === id)) : []
  await Promise.all(newAssigneeIds.map((assigneeId) =>
    notifyTaskAssigned({
      assigneeId,
      taskId: verified.id,
      taskTitle: verified.title,
      projectName: verified.taskList.project.name,
      projectId: verified.taskList.projectId,
      assignedByName: actor.name,
    })
  ))

  if (status === 'DONE' && existing.status !== 'DONE') {
    await notifyTaskCompleted({
      taskId: verified.id,
      taskTitle: verified.title,
      projectId: verified.taskList.projectId,
      projectName: verified.taskList.project.name,
      completedByName: actor.name,
      completedById: actor.id,
    })
  }

  return serializeTask(verified)
}

async function addTaskComment(actor: User, input: Record<string, unknown>) {
  const taskId = asString(input.taskId)
  const content = asString(input.content)
  if (!taskId) throw new Error('taskId is required')
  if (!content) throw new Error('content is required')
  const task = await getAccessibleTask(actor, taskId)
  await assertCanWrite(actor, task.taskList.projectId)

  // Signed by GIDEON, and naming the person who asked. In a shared thread a comment under a
  // colleague's name that they never wrote is a lie nobody can spot afterwards — and one with no
  // name attached is an instruction from nowhere.
  const signed = `${content}\n\n— GIDEON, atas permintaan ${actor.name}`
  const comment = await prisma.comment.create({
    data: { taskId, userId: await getGideonUserId(), content: signed },
    select: { id: true, content: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
  })

  await prisma.activityLog.create({
    data: {
      action: 'GIDEON_COMMENT_ADDED',
      details: `GIDEON commented on task: ${task.title}`,
      userId: actor.id,
      taskId,
      projectId: task.taskList?.projectId,
    },
  })

  await notifyCommentAdded({
    taskId,
    taskTitle: task.title,
    projectId: task.taskList.projectId,
    commentByName: actor.name,
    commentById: actor.id,
    commentSnippet: content.slice(0, 180),
  })

  return { task: serializeTask(task), comment }
}

export async function POST(req: Request) {
  const auth = await authenticateGideonService(req)
  if (!auth.ok) return auth.response

  let body: ToolBody
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON body')
  }

  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}

  try {
    switch (body.action) {
      case 'list_projects':
        return ok(await listProjects(auth.actor, input))
      case 'list_members':
        return ok(await listMembers(auth.actor, input))
      case 'list_tasks':
        return ok(await listTasks(auth.actor, input))
      case 'search_tasks':
        return ok(await searchTasks(auth.actor, input))
      case 'get_project_summary':
        return ok(await getProjectSummary(auth.actor, input))
      case 'list_custom_fields':
        return ok(await listCustomFields(auth.actor, input))
      case 'create_task':
        return ok(await createTask(auth.actor, input))
      case 'update_task':
        return ok(await updateTask(auth.actor, input))
      case 'add_task_comment':
        return ok(await addTaskComment(auth.actor, input))
      case 'get_attendance_day':
        return ok(await getAttendanceDay(auth.actor, input))
      case 'propose_attendance_correction':
        return ok(await proposeAttendanceCorrection(auth.actor, input))
      // The second remedy. Still a proposal: it writes an AttendanceCorrection row and a thread
      // message, and no XP moves until a BoD taps approve. There is no tool action here that applies
      // one, by design and not by omission.
      case 'propose_penalty_cancellation':
        return ok(await proposeAttendancePenaltyCancellation(auth.actor, input))
      // Menutup tiket yang memang sudah tidak menyisakan apa pun. SERVER yang membuktikan itu (lihat
      // resolveTicketByGideon); model hanya boleh memintanya. Tiket yang masih punya potongan, jatah
      // day-off terpotong, atau usulan yang menunggu, ditolak di sini apa pun kata modelnya.
      case 'resolve_ticket':
        return ok(await resolveTicketByGideon(auth.actor, input))
      default:
        return error(`Unknown GIDEON tool action: ${body.action}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'NEXUS GIDEON tool failed'
    return error(message, 400)
  }
}

/**
 * GIDEON menutup tiketnya sendiri — hanya untuk tiket yang sudah tidak menyisakan apa pun.
 *
 * Latar: setelah amnesti 3 September dan refund-refund lain, sejumlah tiket berakhir dengan
 * "potongannya sudah kembali, yang tersisa cuma BoD menutup tiket ini" — dan BoD membacanya sebagai
 * "didiamkan". Tiket seperti itu memang selesai; yang kurang cuma statusnya. Tapi "sudah tidak ada
 * yang tersisa" bukan penilaian model: di sini server memeriksa ledger hari itu, jatah day-off
 * otomatis, dan usulan yang masih menunggu, lalu menolak kalau salah satunya masih ada.
 */
async function resolveTicketByGideon(actor: { id: string }, input: Record<string, unknown>) {
  const complaintId = asString(input.complaintId)
  const dateKey = asString(input.date)
  const note = asString(input.note)
  if (!complaintId) throw new Error('complaintId is required')
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('date is required as "YYYY-MM-DD"')
  if (!note || note.length < 10) throw new Error('note is required (min 10 chars) — the one sentence the reporter and the BoD will read as the closing')

  const complaint = await prisma.complaint.findUnique({
    where: { id: complaintId },
    select: { id: true, workspaceId: true, reporterId: true, category: true, status: true },
  })
  if (!complaint || complaint.reporterId !== actor.id) throw new Error('Complaint not found or not accessible')
  if (!['ATTENDANCE', 'EXP', 'DAY_OFF'].includes(complaint.category)) throw new Error('resolve_ticket hanya untuk tiket ATTENDANCE, EXP, atau DAY_OFF')
  if (complaint.status === 'RESOLVED' || complaint.status === 'CLOSED') throw new Error('Tiket ini sudah ditutup.')

  const pendingProposal = await prisma.attendanceCorrection.count({ where: { complaintId, status: 'PENDING' } })
  if (pendingProposal > 0) throw new Error('Masih ada usulan yang menunggu keputusan BoD di tiket ini — tiketnya belum selesai.')

  const attendanceDate = new Date(`${dateKey}T00:00:00.000Z`)
  const pen = await readAttendancePenaltiesForDate(actor.id, complaint.workspaceId, attendanceDate, dateKey)
  const remaining = pen.lateXp + pen.noCheckoutXp + pen.alphaXp
  if (remaining < 0 || pen.autoDayOffs > 0) {
    throw new Error(
      `Masih ada yang tersisa pada ${dateKey}: ${remaining < 0 ? `${remaining} XP` : ''}${remaining < 0 && pen.autoDayOffs > 0 ? ' dan ' : ''}${pen.autoDayOffs > 0 ? `${pen.autoDayOffs} jatah day off terpotong` : ''}. Usulkan pembatalan, jangan tutup.`,
    )
  }

  const gideon = await prisma.user.findUnique({ where: { email: GIDEON_EMAIL }, select: { id: true } })
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.complaintMessage.create({
      data: { complaintId, authorId: gideon?.id ?? actor.id, fromReviewer: true, body: note.slice(0, BODY_MAX) },
    })
    await tx.complaint.update({
      where: { id: complaintId },
      data: { status: 'RESOLVED', resolvedAt: now, resolvedById: gideon?.id ?? null, lastMessageAt: now },
    })
    await tx.complaintEvent.create({
      data: { complaintId, action: 'status', fromStatus: complaint.status, toStatus: 'RESOLVED', actorId: gideon?.id ?? actor.id },
    })
  })
  return { resolved: true, complaintId, date: dateKey, verified: { xpRemaining: remaining, autoDayOffs: pen.autoDayOffs, pendingProposals: 0 } }
}
