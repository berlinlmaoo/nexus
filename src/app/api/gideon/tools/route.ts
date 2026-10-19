export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { sectionForStatus } from '@/lib/status-sections'
import { minutesLateAgainstShift, safeAttendanceTimezone, resolveShiftWindowAt, formatAttendanceDateKey } from '@/lib/attendance'
import { isCheckInAway, placeLabel } from '@/lib/attendance-place'
import { markdownToTipTap, extractTextFromTipTap } from '@/lib/tiptap-utils'
import { getGideonUserId } from '@/lib/gideon-identity'
import { authenticateGideonService } from '@/lib/gideon-service-auth'
import { checkProjectAccess } from '@/lib/rbac'
import { notifyCommentAdded, notifyComplaintStatus, notifyTaskAssigned, notifyTaskCompleted } from '@/lib/notification-service'
import { normalizeCustomFieldOptions, normalizeCustomFieldType, serializeCustomFieldValue } from '@/lib/custom-fields'
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
import { runAutomations } from '@/lib/automation-engine'
import { searchWorkspace, type SearchHitKind } from '@/lib/workspace-search'
import { emitCommentAdded, emitTaskCreated, emitTaskUpdated } from '@/lib/socket-emitter'
import { deleteTaskAs, TaskDeleteRefusal } from '@/lib/task-delete'
import { createTaskNeedsProject, editableTaskProjects } from '@/lib/gideon-task-target'
import type { Prisma, ProjectStatus, TaskPriority, TaskStatus, User } from '@/generated/prisma/client'
import { gideonGetCalendar, gideonListRoomBookings } from '@/lib/gideon-calendar-tools'
import {
  BookRoomRefusal, describeBookRoom, describeCancelRoomBooking, describeMoveRoomBooking, gideonBookRoom,
  gideonCancelRoomBooking, gideonMoveRoomBooking } from '@/lib/gideon-book-room'
import { humanDay, parseDueInput, todayWib } from '@/lib/gideon-dates'
import { wibDay, wibTime } from '@/lib/calendar/core'
import { TASK_PAGE, TASK_PAGE_MAX, compactProject, compactTask, page, urgencyOrder, wibDayKey } from '@/lib/gideon-compact'
import { legalActor } from '@/lib/legal/access'
import { ORG_WORKSPACE_ID } from '@/lib/org'
import { listDocuments } from '@/lib/legal/archive'
import {
  cardFromResult, needsApproval, parseApprovalMode, proposalLang, proposalView, publishRunEvent, recordStep, refsFromResult,
  resolveRunForToolCall, stepArg, stepLabel, WRITE_ACTIONS, type GideonDiffRow } from '@/lib/gideon-runs'
import { EXTRA_DISABLED_TEXT, extraTool, extraToolEnabled, runExtraTool } from '@/lib/gideon-tools'
import { folderProjectIds } from '@/lib/gideon-tools/tasks-bulk'
import { MEMORY_ACTIONS, MemoryRefusal, runMemoryTool } from '@/lib/gideon-memory'

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
  | 'get_task'
  | 'search_docs'
  | 'get_doc'
  | 'create_document'
  | 'search_workspace'
  | 'get_calendar'
  | 'list_room_bookings'
  | 'book_room'
  | 'move_room_booking'
  | 'cancel_room_booking'
  | 'search_deals'
  | 'search_legal_documents'
  | 'delete_task'

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

function asLimit(value: unknown, fallback = 50) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)))
}

function descriptionExcerpt(description?: string | null) {
  if (!description) return null
  return description.length > 280 ? `${description.slice(0, 277)}...` : description
}

function actorScopedProjectWhere(actor: Pick<User, 'id'>, input: Record<string, unknown>) {
  const where: Prisma.ProjectWhereInput = {}
  const workspaceId = asString(input.workspaceId)
  const status = asString(input.status) as ProjectStatus | undefined

  if (workspaceId) where.workspaceId = workspaceId
  if (status) where.status = status

  where.OR = [
    { members: { some: { userId: actor.id } } },
    { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD'] } } } } },
  ]

  return where
}

function actorScopedTaskWhere(actor: Pick<User, 'id'>, input: Record<string, unknown>) {
  const where: Prisma.TaskWhereInput = {}
  const taskListWhere: Prisma.TaskListWhereInput = {}
  const projectId = asString(input.projectId)
  const status = asString(input.status) as TaskStatus | undefined
  const priority = asString(input.priority) as TaskPriority | undefined
  const rawAssignee = asString(input.assigneeId)
  const assigneeId = rawAssignee === 'me' ? actor.id : rawAssignee

  if (projectId) taskListWhere.projectId = projectId
  // A folder (18 Oct 2026): every project of the folder and its sub-folders this person can see (normalizeToolInput).
  else if (Array.isArray(input.projectIds)) taskListWhere.projectId = { in: input.projectIds.filter((x): x is string => typeof x === 'string') }
  if (status) where.status = status
  if (priority) where.priority = priority
  if (assigneeId) where.assignees = { some: { userId: assigneeId } }
  // Filters added 18 Oct 2026 so "my overdue tasks" is one small call instead of every task the person can see.
  const open = input.open === true || input.open === 'true' || input.overdue === true || input.overdue === 'true'
  if (open && !status) where.status = { notIn: ['DONE', 'CANCELLED'] }
  const today = todayWib()
  const dueFrom = typeof input.dueFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dueFrom) ? input.dueFrom : null
  const dueTo = typeof input.dueTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dueTo) ? input.dueTo : null
  const due: Prisma.DateTimeNullableFilter = {}
  if (input.overdue === true || input.overdue === 'true') due.lt = new Date(`${today}T00:00:00+07:00`)
  if (dueFrom) due.gte = new Date(`${dueFrom}T00:00:00+07:00`)
  if (dueTo) due.lt = new Date(new Date(`${dueTo}T00:00:00+07:00`).getTime() + 86400e3)
  if (Object.keys(due).length) where.dueDate = due

  taskListWhere.project = {
    OR: [
      { members: { some: { userId: actor.id } } },
      { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD'] } } } } },
    ],
  }

  if (Object.keys(taskListWhere).length > 0) where.taskList = taskListWhere

  return where
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
  // Compact rows (18 Oct 2026): a name, status and task counts per project. The member roster with emails and
  // avatars made this 140 KB for a BoD; get_project_summary / list_members give a project's people.
  const where = actorScopedProjectWhere(actor, input)
  const query = asString(input.query) || asString(input.name)
  if (query) where.name = { contains: query, mode: 'insensitive' }
  const limit = Math.max(1, Math.min(MAX_LIMIT, typeof input.limit === 'number' ? Math.floor(input.limit) : MAX_LIMIT))
  const offset = typeof input.offset === 'number' && input.offset > 0 ? Math.floor(input.offset) : 0
  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      select: { id: true, name: true, status: true, type: true, _count: { select: { members: true } }, taskLists: { select: { id: true, _count: { select: { tasks: true } } } } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.project.count({ where }),
  ])
  const listIds = projects.flatMap((p) => p.taskLists.map((l) => l.id))
  const openRows = listIds.length
    ? await prisma.task.groupBy({ by: ['taskListId'], where: { taskListId: { in: listIds }, status: { notIn: ['DONE', 'CANCELLED'] } }, _count: { _all: true } })
    : []
  const openByList = new Map(openRows.map((r) => [r.taskListId, r._count._all]))
  const items = projects.map((p) => compactProject(p, p.taskLists.reduce((s, l) => s + (openByList.get(l.id) ?? 0), 0)))
  // Say whose list this is: for a Manager / Staff it IS "the projects I am in"; a BoD sees every project.
  const bodPlus = await prisma.workspaceMember.count({ where: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD'] } } })
  return {
    scope: bodPlus ? 'Every project of the company (BoD / One Above All see all of them), not only the ones this person is a member of.' : 'Exactly the projects this person is a member of.',
    ...page(items, total, offset, limit, 'pass query (part of the project name)'),
  }
}

async function listMembers(actor: User, input: Record<string, unknown>) {
  const workspaceId = asString(input.workspaceId)
  const projectId = asString(input.projectId)

  if (projectId) {
    const members = await prisma.projectMember.findMany({
      where: {
        projectId,
        ...({
              project: {
                OR: [
                  { members: { some: { userId: actor.id } } },
                  { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD'] } } } } },
                ],
              },
            }),
      },
      select: { role: true, user: { select: { id: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
      take: MAX_LIMIT,
    })
    return members.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role }))
  }

  const members = await prisma.workspaceMember.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD', 'MANAGER'] } } } },
    },
    select: { role: true, user: { select: { id: true, name: true } }, workspace: { select: { name: true } } },
    orderBy: { joinedAt: 'asc' },
    take: MAX_LIMIT,
  })
  return members.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role, workspace: m.workspace.name }))
}

function taskPaging(input: Record<string, unknown>) {
  const limit = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.max(1, Math.min(TASK_PAGE_MAX, Math.floor(input.limit))) : TASK_PAGE
  const offset = typeof input.offset === 'number' && input.offset > 0 ? Math.floor(input.offset) : 0
  return { limit, offset }
}

/** The rows a task list needs for compactTask (no emails, avatars, option lists or creator). */
const compactTaskSelect = {
  id: true, title: true, description: true, status: true, priority: true, dueDate: true,
  taskList: { select: { name: true, projectId: true, project: { select: { id: true, name: true } } } },
  assignees: { select: { user: { select: { name: true } } } },
  customFieldValues: { select: { value: true, customField: { select: { name: true, type: true } } }, orderBy: { customField: { position: 'asc' as const } } },
} satisfies Prisma.TaskSelect

async function listTasks(actor: User, input: Record<string, unknown>) {
  // Compact and paged (18 Oct 2026): 25 rows by default with the total and how to get the rest.
  const where = actorScopedTaskWhere(actor, input)
  const { limit, offset } = taskPaging(input)
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({ where, select: compactTaskSelect, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }], take: limit, skip: offset }),
    prisma.task.count({ where }),
  ])
  const today = todayWib()
  const oneProject = Boolean(asString(input.projectId))
  const items = tasks.map((t) => compactTask(t, today, !oneProject))
  return {
    ...(oneProject && tasks[0]?.taskList?.project ? { project: tasks[0].taskList.project.name, projectId: tasks[0].taskList.project.id } : {}),
    ...page(items, total, offset, limit, 'narrow with status / open / overdue / assigneeId / dueFrom-dueTo / projectId'),
  }
}

async function searchTasks(actor: User, input: Record<string, unknown>) {
  const query = asString(input.query)
  if (!query) throw new Error('query is required')

  const baseWhere = actorScopedTaskWhere(actor, input)
  const where: Prisma.TaskWhereInput = {
    ...baseWhere,
    OR: [
      { title: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ],
  }
  const { limit, offset } = taskPaging(input)
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({ where, select: compactTaskSelect, orderBy: [{ updatedAt: 'desc' }], take: limit, skip: offset }),
    prisma.task.count({ where }),
  ])
  const today = todayWib()
  return page(tasks.map((t) => compactTask(t, today, true)), total, offset, limit, 'add projectId / status / open')
}

async function getProjectSummary(actor: User, input: Record<string, unknown>) {
  const projectId = asString(input.projectId)
  if (!projectId) throw new Error('projectId is required')

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
      ...({
            OR: [
              { members: { some: { userId: actor.id } } },
              { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD'] } } } } },
            ],
          }),
    },
    select: {
      id: true,
      name: true,
      status: true,
      type: true,
      workspace: { select: { name: true } },
      members: { select: { role: true, user: { select: { id: true, name: true } } }, orderBy: { joinedAt: 'asc' }, take: 40 },
      _count: { select: { members: true } },
    },
  })

  if (!project) throw new Error('Project not found or not accessible')

  const taskWhere = { taskList: { projectId } }
  const openWhere: Prisma.TaskWhereInput = { ...taskWhere, status: { notIn: ['DONE', 'CANCELLED'] } }
  const today = todayWib()
  const [totalTasks, completedTasks, byStatusRows, byPriorityRows, lists, byListRows, openByListRows, overdueOpen, openRows] = await Promise.all([
    prisma.task.count({ where: taskWhere }),
    prisma.task.count({ where: { ...taskWhere, status: 'DONE' } }),
    prisma.task.groupBy({ by: ['status'], where: taskWhere, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['priority'], where: openWhere, _count: { _all: true } }),
    prisma.taskList.findMany({ where: { projectId }, select: { id: true, name: true }, orderBy: { position: 'asc' } }),
    prisma.task.groupBy({ by: ['taskListId'], where: taskWhere, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['taskListId'], where: openWhere, _count: { _all: true } }),
    prisma.task.count({ where: { ...openWhere, dueDate: { lt: new Date(`${today}T00:00:00+07:00`) } } }),
    // The open tasks that matter most (urgent / high first, then the earliest due): enough to say what is going on
    // without a second call. The full list stays one nexus_list_tasks away.
    prisma.task.findMany({ where: openWhere, select: compactTaskSelect, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }], take: 200 }),
  ])

  const byStatus = Object.fromEntries(byStatusRows.map((row) => [row.status, row._count._all]))
  const byPriority = Object.fromEntries(byPriorityRows.map((row) => [row.priority, row._count._all]))
  const totalByList = new Map(byListRows.map((r) => [r.taskListId, r._count._all]))
  const openByList = new Map(openByListRows.map((r) => [r.taskListId, r._count._all]))
  const openTasks = totalTasks - completedTasks - (byStatus.CANCELLED ?? 0)
  const top = [...openRows].sort(urgencyOrder).slice(0, 8).map((t) => compactTask(t, today, false))

  return {
    project: { id: project.id, name: project.name, status: project.status, ...(project.type !== 'TASK' ? { type: project.type } : {}), workspace: project.workspace.name },
    totalTasks,
    completedTasks,
    openTasks,
    overdueOpenTasks: overdueOpen,
    progressPercent: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    byStatus,
    openByPriority: byPriority,
    // Columns (sections) as the board shows them: total and still open per column.
    byColumn: lists.map((l) => ({ column: l.name, total: totalByList.get(l.id) ?? 0, open: openByList.get(l.id) ?? 0 })).filter((c) => c.total > 0),
    members: project.members.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role })),
    ...(project._count.members > project.members.length ? { moreMembers: project._count.members - project.members.length } : {}),
    topOpenTasks: top,
    ...(openTasks > top.length ? { moreOpen: `${openTasks - top.length} more open tasks — nexus_list_tasks with projectId and open=true (paged).` } : {}),
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

// RE-ENABLED 12 Oct 2026 (owner: GIDEON cards "for tasks/docs it creates"): project Pages are browsable
// again (project → Pages tab, /docs/<id>), so a doc GIDEON writes has somewhere to be opened from.
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
      checkInDistanceMeters: true, checkInAddress: true, checkInLat: true, checkInLng: true,
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

  // Request yang DIBATALKAN atau DITOLAK untuk tanggal ini. Bukan cover — tapi bukti niat: seorang staff
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
  // diubah (seorang staff: 15:00 → 19:00), catatan jamnya tetap benar tapi penaltinya jadi salah — dan
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
    // Dua bentuk: (1) menurut shift sekarang dia tidak telat sama sekali; (2) jatah day-off ikut
    // terpotong (itu hukuman telat >120 menit) padahal menurut shift sekarang telatnya ≤120 menit.
    penaltyContradictsCurrentShift:
      pen.lateXp < 0 &&
      lateAgainstCurrentShift !== null &&
      (lateAgainstCurrentShift <= grace || (pen.autoDayOffs > 0 && lateAgainstCurrentShift <= 120)),
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
  // Jam PULANG yang diharapkan: shift tetap → akhir shift; Flexi → check-in + 9 jam. Outage sore
  // yang menelan jam ini membuat orang tidak bisa check-out (seorang staff, 15 Sep 2026: masuk 12:14,
  // pulang seharusnya 21:14, tunnel mati 18:09–23:54, lalu kena −25 "lupa check-out").
  let expectedCheckoutAt: Date | null = null
  let coversExpectedCheckout: boolean | null = null
  if (outageRow && office && effectiveShift) {
    try {
      const { shiftStartAt, shiftEndAt } = resolveShiftWindowAt(attendanceDate, office, effectiveShift)
      const endedAt = outageRow.endedAt ?? new Date()
      coversShiftStart = shiftStartAt >= outageRow.startedAt && shiftStartAt <= endedAt
      expectedCheckoutAt = effectiveShift.flexi && record?.checkInAt
        ? new Date(record.checkInAt.getTime() + 9 * 60 * 60 * 1000)
        : shiftEndAt
      coversExpectedCheckout = expectedCheckoutAt >= outageRow.startedAt && expectedCheckoutAt <= endedAt
    } catch { coversShiftStart = null; coversExpectedCheckout = null }
  }
  const wib = (d: Date) => d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
  // Check-out yang jatuh di HARI LAIN adalah penutupan otomatis saat check-in berikutnya ("lupa
  // check-out"), bukan jam pulang sungguhan. Model membaca checkOutAt terisi = "sudah check-out".
  const checkOutAutoClosed = Boolean(
    record?.checkInAt && record?.checkOutAt && formatAttendanceDateKey(record.checkOutAt) !== formatAttendanceDateKey(record.checkInAt),
  )

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
    expectedCheckoutWib: expectedCheckoutAt ? wib(expectedCheckoutAt) : null,
    coversExpectedCheckout,
    checkOutAutoClosed,
    checkoutMeaning:
      'coversExpectedCheckout=true berarti outage TERCATAT menelan jam PULANG yang diharapkan (akhir shift, atau ' +
      'check-in + 9 jam untuk Flexi): orang ini memang tidak bisa check-out. checkOutAutoClosed=true berarti ' +
      'checkOutAt yang terisi itu penutupan otomatis di hari berikutnya, BUKAN jam pulang sungguhan — hari itu ' +
      'sebenarnya tanpa check-out, dan penalti "lupa check-out" (−25) mungkin sudah/akan kena. Obatnya koreksi jam: ' +
      'usulkan check-out = expectedCheckoutWib, check-in tidak diubah.',
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
    // Location-free members may check in anywhere; the record is still filed under the nearest office.
    // checkInAway = outside that office's radius, and then place is the address they checked in at.
    // Say THAT when asked where they were, not the office (owner, 28 Sep 2026).
    checkInAway: isCheckInAway(record),
    place: placeLabel(record) || null,
  }
}

async function getAccessibleProject(actor: User, projectId: string) {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
      ...({
            OR: [
              { members: { some: { userId: actor.id } } },
              { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD'] } } } } },
            ],
          }),
    },
    select: { id: true, name: true, status: true },
  })
  if (!project) throw new Error('Project not found or not accessible')
  return project
}

// Web-parity WRITE gate: a user may create/update tasks + comment via Gideon only where they could on
// the web — project MEMBER+ (LEAD/MEMBER) or workspace BoD/One-Above-All. VIEWERs and non-members stay
// read-only. (The workspace-wide rule lives inside checkProjectAccess.)
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
        ...({
              project: {
                OR: [
                  { members: { some: { userId: actor.id } } },
                  { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD'] } } } } },
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

    // NUMBER: "Rp 1,5 jt" / "369.000" / 369000 -> what the field's format stores (Rupiah = digits).
    const options = normalizeCustomFieldOptions(normalizedType, field.options)

    return {
      customFieldId: field.id,
      name: field.name,
      value: serializeCustomFieldValue(normalizedType, request.value, undefined, options),
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
  // A relative day ("Friday", "besok") resolves to an explicit date; today's weekday means next week (gideon-dates.ts).
  const dueDate = parseDueInput(input.dueDate)
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
      actorId: actor.id,
    })
  ))

  // Project automations see a task GIDEON made like any other new task (12 Oct 2026).
  runAutomations({ kind: 'task_created', projectId: taskList.projectId, actorId: actor.id, taskId: task.id }).catch(() => {})

  const verified = await prisma.task.findUnique({ where: { id: task.id }, include: taskInclude })
  // Realtime (12 Oct 2026): a task GIDEON made appears on open boards like any other new task.
  emitTaskCreated(taskList.projectId, JSON.parse(JSON.stringify(verified || task)))
  const made = verified || task
  // The day to say in the reply ("due Fri 23 Oct"), resolved and explicit.
  return { ...serializeTask(made), ...(made.dueDate ? { dueLabel: dueLabel(made.dueDate) } : {}) }
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
  const dueDate = parseDueInput(input.dueDate)
  const taskListId = asString(input.taskListId)
  const assigneeIds = asStringArray(input.assigneeIds)
  const customFieldUpdates = await resolveCustomFieldUpdates(actor, existing.taskList.projectId, input)

  if (title) data.title = title
  if (input.description === null || description !== undefined) data.description = description || null
  if (status) data.status = status
  // completedAt is stamped by the DB trigger (Task_completion_stamp); this only says who.
  if (status === 'DONE' && existing.status !== 'DONE') data.completedBy = { connect: { id: actor.id } }
  if (priority) data.priority = priority
  if (dueDate !== undefined) data.dueDate = dueDate
  if (taskListId) {
    const targetList = await resolveTaskList(actor, { taskListId }, status)
    data.taskList = { connect: { id: targetList.id } }
  } else if (status && status !== existing.status) {
    // Sections are the status options (lib/status-sections.ts): a new status moves the task to its column.
    const moveTo = await sectionForStatus(prisma, existing.taskList.projectId, existing.taskListId, status)
    if (moveTo) data.taskList = { connect: { id: moveTo } }
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
      actorId: actor.id,
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

  // Project automations (12 Oct 2026): the same "task_updated" event the task PATCH route raises.
  const beforeAssignees: string[] = existing.assignees.map((entry: any) => entry.user.id)
  runAutomations({
    kind: 'task_updated',
    projectId: existing.taskList.projectId,
    actorId: actor.id,
    taskId,
    changes: {
      ...(status ? { status: { from: existing.status, to: status } } : {}),
      ...(priority ? { priority: { from: existing.priority, to: priority } } : {}),
      ...(title ? { title: { from: existing.title, to: title } } : {}),
      ...(dueDate !== undefined ? { dueDate: { from: existing.dueDate ? new Date(existing.dueDate).toISOString() : null, to: dueDate ? new Date(dueDate).toISOString() : null } } : {}),
      ...(taskListId ? { section: { from: existing.taskListId, to: verified.taskListId } } : {}),
      ...(assigneeIds !== undefined ? { assignee: { added: assigneeIds.filter((id) => !beforeAssignees.includes(id)), removed: beforeAssignees.filter((id) => !assigneeIds.includes(id)) } } : {}),
    },
  }).catch(() => {})

  emitTaskUpdated(existing.taskList.projectId, JSON.parse(JSON.stringify(verified)))
  return { ...serializeTask(verified), ...(dueDate !== undefined && verified.dueDate ? { dueLabel: dueLabel(verified.dueDate) } : {}) }
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
  emitCommentAdded(task.taskList.projectId, taskId, JSON.parse(JSON.stringify({ ...comment, taskId, parentId: null })))

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

/** The support-ticket tools (the requester's own attendance day, remedy proposals, closing a ticket). */
const ATTENDANCE_ACTIONS = new Set(['get_attendance_day', 'propose_attendance_correction', 'propose_penalty_cancellation', 'resolve_ticket'])

/**
 * Model arguments arrive in several spellings (project_id, project, projectName, q, text…). The first
 * call of a run often used one of those and failed with "projectId is required", then the model retried
 * — the user saw a red "1 failed" step (owner, 12 Oct 2026). Normalise before validating: snake_case →
 * camelCase, query aliases → query, and a project NAME → the id of a project the actor can see.
 */
async function normalizeToolInput(actor: User, action: string, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw ?? {})) input[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v
  if (!asString(input.query)) {
    const q = asString(input.q) || asString(input.text) || asString(input.search) || asString(input.question) || asString(input.keyword) || asString(input.keywords)
    if (q) input.query = q
  }
  const wantsProject = action === 'get_project_summary' || action === 'list_custom_fields' || action === 'create_doc' || action === 'create_task' || action === 'list_tasks' || action === 'search_tasks' || action === 'get_calendar' || action === 'list_members'
  if (wantsProject && !asString(input.projectId)) {
    const name = asString(input.project) || asString(input.projectName) || (action === 'get_project_summary' ? asString(input.name) || asString(input.query) : '')
    if (name) {
      const match = await prisma.project.findFirst({
        where: { ...actorScopedProjectWhere(actor, {}), name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      }) ?? await prisma.project.findFirst({
        where: { ...actorScopedProjectWhere(actor, {}), name: { contains: name, mode: 'insensitive' } },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      })
      if (match) input.projectId = match.id
      // A project name that matches nothing this person can see is an answer, not a reason to list everything.
      else if (action === 'list_tasks' || action === 'search_tasks' || action === 'get_project_summary') throw new Error(`No project this person can see is named like "${name}".`)
    }
  }
  // folder (18 Oct 2026, the Folder view: Board + Calendar of every project in a folder and its sub-folders): a
  // folder name or id → the ids of those projects this person can see, for list_tasks / search_tasks / get_calendar.
  if ((action === 'list_tasks' || action === 'search_tasks' || action === 'get_calendar') && !asString(input.projectId)) {
    const folder = asString(input.folder) ?? asString(input.folderId) ?? asString(input.folderName)
    if (folder) {
      const f = await folderProjectIds(actor, folder)
      input.projectIds = f.projectIds
      input.folderName = f.name
      if (!f.projectIds.length) throw new Error(`The folder "${f.name}" has no project this person can see.`)
    }
  }
  // "Put it on the calendar" (owner, 18 Oct 2026): the Calendar shows TASKS, and only ones with a PIC and a date
  // (Master Calendar rule). A create_task with calendar=true must have a date; with nobody named the PIC is the
  // person themselves (changeable on the card).
  if (action === 'create_task') applyCalendarDefaults(actor, input)
  // assignee (18 Oct 2026): "me" or a person's name → assigneeId, for list_tasks / search_tasks.
  if ((action === 'list_tasks' || action === 'search_tasks') && !asString(input.assigneeId)) {
    const who = asString(input.assignee) || asString(input.assigneeName) || asString(input.person)
    if (who && /^(me|saya|aku|gw|gue)$/i.test(who)) input.assigneeId = actor.id
    else if (who) {
      const people = await prisma.user.findMany({
        where: { name: { contains: who, mode: 'insensitive' }, deactivatedAt: null, workspaceMembers: { some: { workspaceId: ORG_WORKSPACE_ID } } },
        select: { id: true, name: true },
        take: 6,
      })
      const exact = people.filter((p) => p.name?.toLowerCase() === who.toLowerCase())
      const pick = exact.length === 1 ? exact : people
      if (pick.length === 1) input.assigneeId = pick[0].id
      else if (!pick.length) throw new Error(`Nobody in the company is named like "${who}".`)
      else throw new Error(`Several people match "${who}": ${pick.map((p) => p.name).join(', ')}. Ask which one, or pass assignee with the full name.`)
    }
  }
  return input
}

/** create_task calendar=true: a date is required and the PIC defaults to the person (both the card and a direct create). */
function applyCalendarDefaults(actor: Pick<User, 'id'>, input: Record<string, unknown>) {
  if (input.calendar !== true && input.calendar !== 'true') return
  if (!parseDueInput(input.dueDate ?? input.due_date)) throw new Error('A task on the calendar needs a date. Ask which day (and time, if any).')
  if (input.dueDate === undefined && input.due_date !== undefined) input.dueDate = input.due_date
  const ids = asStringArray(input.assigneeIds ?? input.assignee_ids) ?? []
  if (!ids.length) input.assigneeIds = [actor.id]
}

/**
 * `approved`: this call is the Apply of a proposal the person approved (x-gideon-approved). delete_task runs ONLY
 * then — never straight from the model, whatever the approval mode (owner, 18 Oct 2026).
 */
async function dispatch(actor: User, action: string, rawInput: Record<string, unknown>, approved = false): Promise<unknown> {
  const input = await normalizeToolInput(actor, action, rawInput)
  switch (action) {
    case 'delete_task':
      if (!approved) throw new Error('Deleting a task always waits for the person to confirm it on a card in the NEXUS GIDEON chat. Nothing was deleted.')
      return applyDeleteTask(actor, input)
    case 'list_projects':
      return listProjects(actor, input)
    case 'list_members':
      return listMembers(actor, input)
    case 'list_tasks':
      return listTasks(actor, input)
    case 'search_tasks':
      return searchTasks(actor, input)
    case 'get_project_summary':
      return getProjectSummary(actor, input)
    case 'list_custom_fields':
      return listCustomFields(actor, input)
    case 'get_task':
      return getTaskDetail(actor, input)
    case 'search_docs':
      return searchDocs(actor, input)
    case 'get_doc':
      return getDoc(actor, input)
    case 'search_workspace':
      return searchWorkspaceTool(actor, input)
    // The Master Calendar and Room Booking, read as this person sees them (16 Oct 2026).
    case 'get_calendar':
      return gideonGetCalendar(actor.id, input)
    case 'list_room_bookings':
      return gideonListRoomBookings(actor.id, input)
    // A write (approval modes, gideon-runs.ts): the Room Booking page's own path, as this person.
    case 'book_room':
      return gideonBookRoom(actor.id, input)
    // Moving / cancelling one (16 Oct 2026): the Room Booking page's PATCH / DELETE path, as this person.
    case 'move_room_booking':
      return gideonMoveRoomBooking(actor.id, input)
    case 'cancel_room_booking':
      return gideonCancelRoomBooking(actor.id, input)
    // Pipeline deals and Legal documents (18 Oct 2026): read only, loaded on demand by the model.
    case 'search_deals':
      return searchDeals(actor, input)
    case 'search_legal_documents':
      return searchLegalDocuments(actor, input)
    case 'create_task':
      return createTask(actor, input)
    case 'update_task':
      return updateTask(actor, input)
    case 'add_task_comment':
      return addTaskComment(actor, input)
    case 'create_document':
      return createDocument(actor, input)
    case 'get_attendance_day':
      return getAttendanceDay(actor, input)
    case 'propose_attendance_correction':
      return proposeAttendanceCorrection(actor, input, undefined, { enforceTicketDate: true })
    // The second remedy. Still a proposal: it writes an AttendanceCorrection row and a thread
    // message, and no XP moves until a BoD taps approve. There is no tool action here that applies
    // one, by design and not by omission.
    case 'propose_penalty_cancellation':
      return proposeAttendancePenaltyCancellation(actor, input, undefined, { enforceTicketDate: true })
    // Menutup tiket yang memang sudah tidak menyisakan apa pun. SERVER yang membuktikan itu (lihat
    // resolveTicketByGideon); model hanya boleh memintanya. Tiket yang masih punya potongan, jatah
    // day-off terpotong, atau usulan yang menunggu, ditolak di sini apa pun kata modelnya.
    case 'resolve_ticket':
      return resolveTicketByGideon(actor, input)
    default:
      // The 18 Oct 2026 package (inbox, chat, reminders, …): lib/gideon-tools. A write there runs only as an Apply
      // or, for approval "modes", straight from the model when no card is needed (needsApproval said so).
      if (extraTool(action)) return runExtraTool(actor, action, input, { approved, direct: !approved })
      throw new UnknownActionError(`Unknown GIDEON tool action: ${action}`)
  }
}

class UnknownActionError extends Error {}

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
  const action = String(body.action ?? '')

  // A server that must never hand GIDEON attendance (the DEV server, 12 Oct 2026) refuses those tools
  // here too, on top of its plugin not registering them.
  if (ATTENDANCE_ACTIONS.has(action) && process.env.NEXUS_GIDEON_NO_ATTENDANCE === '1') {
    return error('Attendance tools are not available on this server', 403)
  }

  // Applying a write the person approved (POST /api/gideon/proposals/[id]): the proposal decides what
  // runs, not this body, and only for the person it was proposed to.
  const approvedId = req.headers.get('x-gideon-approved')
  if (approvedId) {
    const proposal = await prisma.gideonProposal.findUnique({ where: { id: approvedId } })
    if (!proposal || proposal.status !== 'APPLYING' || proposal.userId !== auth.actor.id) return error('Proposal is not being applied', 409)
    try {
      return ok(await dispatch(auth.actor, proposal.action, (proposal.input as Record<string, unknown>) ?? {}, true))
    } catch (err) {
      // A delete refused at Apply (gone, changed, no longer Can edit): the card says why, in both languages.
      if (err instanceof TaskDeleteRefusal) {
        return NextResponse.json({ ok: false, error: DELETE_REFUSAL_TEXT[err.code], code: err.code }, { status: err.status })
      }
      // The apply route keeps a booking card open when its slot was taken meanwhile (code ROOM_TAKEN).
      if (err instanceof BookRoomRefusal) {
        return NextResponse.json({ ok: false, error: err.message, code: err.code, ...err.detail }, { status: err.code === 'ROOM_TAKEN' ? 409 : 400 })
      }
      return error(err instanceof Error ? err.message : 'NEXUS GIDEON tool failed', 400)
    }
  }

  // Which conversation this call belongs to (steps, sources, cards, approval). No run = exactly the
  // behaviour every caller had before 12 Oct 2026.
  const headerRun = req.headers.get('x-gideon-run')
  const run = await resolveRunForToolCall(headerRun, auth.actor.id).catch(() => null)
  // GIDEON Memory (19 Oct 2026): the asking person's OWN memories only (actor-scoped); writes only inside their own
  // CHAT run, where the chat route parked what they actually wrote. Never a proposal card: the chip is the consent.
  if (MEMORY_ACTIONS.has(action)) {
    const stepId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    const label = stepLabel(action, null)
    if (run) publishRunEvent(run.id, { type: 'step', step: { id: stepId, tool: action, arg: null, label, status: 'running' } })
    const started = Date.now()
    try {
      const out = await runMemoryTool(auth.actor.id, action, input, run ? { id: run.id, trigger: run.trigger } : null)
      if (run) {
        publishRunEvent(run.id, { type: 'step', step: { id: stepId, tool: action, arg: null, label, status: 'done' } })
        for (const m of out.memories) publishRunEvent(run.id, { type: 'memory', memory: m })
        await recordStep(run.id, { tool: action, arg: null, ok: true, durationMs: Date.now() - started })
      }
      return ok(out.data)
    } catch (err) {
      // A refusal is an answer for the model (say it, do not retry), not a failed step the person sees in red.
      const message = err instanceof Error ? err.message : 'GIDEON Memory failed'
      const refusal = err instanceof MemoryRefusal
      if (run) {
        publishRunEvent(run.id, { type: 'step', step: { id: stepId, tool: action, arg: null, label, status: refusal ? 'done' : 'error', ...(refusal ? {} : { error: message.slice(0, 200) }) } })
        await recordStep(run.id, { tool: action, arg: null, ok: refusal, error: refusal ? null : message, durationMs: Date.now() - started })
      }
      return refusal ? ok({ saved: false, refused: err.code, note: message }) : error(message, 400)
    }
  }
  // A chat names its run; when that run is gone, finished, stale or someone else's, its approval mode can no longer
  // be honoured, so a WRITE is refused instead of running with no card at all (19 Oct 2026 privacy gate). Reads go on.
  if (!run && headerRun && WRITE_ACTIONS.has(action)) {
    return error('This chat run is no longer active, so nothing can be changed from it. Ask the person to send the message again.', 409)
  }
  if (!run) {
    try {
      return ok(await dispatch(auth.actor, action, input))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'NEXUS GIDEON tool failed'
      return error(message, 400)
    }
  }

  const extraArg = extraTool(action)?.stepArg
  const arg = extraArg ? await Promise.resolve(extraArg(input)).catch(() => null) : await stepArg(action, input)
  const stepId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const label = stepLabel(action, arg)
  publishRunEvent(run.id, { type: 'step', step: { id: stepId, tool: action, arg, label, status: 'running' } })
  const started = Date.now()

  try {
    // Assignees / a due date for a task this run only proposed so far: into that one create card.
    const merged = action === 'update_task' ? await mergeIntoCreateProposal(auth.actor, run.id, input) : null
    if (merged) {
      publishRunEvent(run.id, { type: 'step', step: { id: stepId, tool: action, arg, label, status: 'done' } })
      publishRunEvent(run.id, { type: 'proposal', proposal: proposalView(merged.proposal, await proposalLang(auth.actor.id, req.headers)) })
      await recordStep(run.id, { tool: action, arg, ok: true, durationMs: Date.now() - started })
      return ok({
        proposed: true,
        merged: true,
        proposalId: merged.proposal.id,
        status: 'PENDING',
        summary: merged.proposal.summary,
        ...(merged.due ? { due: merged.due } : {}),
        note: 'Merged into the same create-task card (the task does not exist until approved). NOT applied yet; tell the person it is waiting for their approval in the card below. Next time put assignees and the due date in nexus_create_task itself.',
      })
    }

    if (needsApproval(parseApprovalMode(run.approvalMode) ?? 'dont_ask', action, input, auth.actor.id)) {
      const { proposal, due, note: extraNote } = await proposeWrite(auth.actor, run.id, action, input, { contextProjectId: run.projectId ?? null })
      const picker = action === 'create_task' && (proposal.input as { pickProject?: unknown } | null)?.pickProject === true
      const pre = picker ? ((proposal.input as { taskTarget?: { preselectedProjectName?: string | null } }).taskTarget?.preselectedProjectName ?? null) : null
      publishRunEvent(run.id, { type: 'step', step: { id: stepId, tool: action, arg, label, status: 'done' } })
      publishRunEvent(run.id, { type: 'proposal', proposal: proposalView(proposal, await proposalLang(auth.actor.id, req.headers)) })
      await recordStep(run.id, { tool: action, arg, ok: true, durationMs: Date.now() - started })
      return ok({
        proposed: true,
        proposalId: proposal.id,
        status: 'PENDING',
        summary: proposal.summary,
        // The resolved day, to say in the reply ("due Fri 23 Oct"), never just "Friday".
        ...(due ? { due } : {}),
        note: extraNote
          ? extraNote
          : action === 'move_room_booking'
          ? 'NOT moved yet. It is waiting for the person on the card below, which shows the booking before and after (and every room with whether it is free then) and where they tap Apply; tell them so, do not say it is moved.'
          : action === 'cancel_room_booking'
          ? 'NOT cancelled yet. It is waiting for the person to confirm it on the card below; tell them so, do not say it is cancelled.'
          : action === 'book_room'
          ? 'NOT booked yet. It is waiting for the person on the card below, where they pick or confirm the room (every room is shown with whether it is free then) and tap Apply; tell them so, do not say it is booked, and do not ask which room in the chat.'
          : action === 'delete_task'
          ? 'NOT deleted yet. It is waiting for the person to confirm it on the card below, which shows the task and a Delete button; tell them so in one short sentence, never say it is deleted. Do not offer to set it to Cancelled or Done instead. After they confirm it can still be restored from the Audit.'
          : picker
          ? `NOT created yet. The card below has a project picker${pre ? `, preselected to ${pre}` : ''} (only projects this person can edit), plus section, PIC and due date; they ${pre ? 'confirm or change it' : 'pick the project'} there and tap Apply. Tell them so in one short sentence; do NOT ask which project in the chat.${due ? ` Say the due date as "${due}".` : ''}`
          : action === 'create_task'
          ? `NOT applied yet. It is waiting for the person to approve it in NEXUS; tell them so, do not say it is done.${due ? ` Say the due date as "${due}".` : ''} This proposalId is the only id of the task until then: to add assignees or a due date to it, call nexus_update_task with taskId = this proposalId and it joins the same card.`
          : `NOT applied yet. It is waiting for the person to approve it in NEXUS; tell them so, do not say it is done.${due ? ` Say the due date as "${due}".` : ''}`,
      })
    }

    const data = await dispatch(auth.actor, action, input)
    const refs = refsFromResult(action, data)
    const card = cardFromResult(action, data)
    publishRunEvent(run.id, { type: 'step', step: { id: stepId, tool: action, arg, label, status: 'done' } })
    if (refs.length) publishRunEvent(run.id, { type: 'sources', sources: refs })
    if (card) publishRunEvent(run.id, { type: 'card', card })
    await recordStep(run.id, { tool: action, arg, ok: true, durationMs: Date.now() - started, refs, card })
    return ok(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'NEXUS GIDEON tool failed'
    publishRunEvent(run.id, { type: 'step', step: { id: stepId, tool: action, arg, label, status: 'error', error: message.slice(0, 200) } })
    await recordStep(run.id, { tool: action, arg, ok: false, error: message, durationMs: Date.now() - started })
    return error(message, 400)
  }
}

// ── Workspace Q&A (12 Oct 2026, Notion AI parity) ─────────────────────────────────────────────────────

const SEARCH_KINDS = new Set<SearchHitKind>(['project', 'task', 'doc', 'comment', 'form', 'message'])

/** One search across projects, tasks, docs, comments, forms and chat, with the asker's visibility only. */
async function searchWorkspaceTool(actor: User, input: Record<string, unknown>) {
  const query = asString(input.query)
  if (!query) throw new Error('query is required')
  const kinds = (asStringArray(input.kinds) ?? []).filter((k): k is SearchHitKind => SEARCH_KINDS.has(k as SearchHitKind))
  const { terms, hits } = await searchWorkspace(actor.id, query, { kinds, projectId: asString(input.projectId) ?? null, limit: asLimit(input.limit, 12) })
  return {
    terms,
    hits: hits.map((h) => ({ ...h, link: `${PUBLIC_BASE}${h.url}` })),
    note: hits.length ? 'Cite what you use by its exact title. Only these results exist for this person; do not invent others.' : 'Nothing this person can see matches. Say so; do not guess.',
  }
}

// ── Reads added 12 Oct 2026 (sources / citations) ─────────────────────────────────────────────────────

async function getTaskDetail(actor: User, input: Record<string, unknown>) {
  const taskId = asString(input.taskId)
  if (!taskId) throw new Error('taskId is required')
  const task = await getAccessibleTask(actor, taskId)
  const comments = await prisma.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { id: true, content: true, createdAt: true, parentId: true, user: { select: { name: true } } },
  })
  return {
    ...serializeTask(task),
    description: task.description ? String(task.description).slice(0, 4000) : null,
    url: `${PUBLIC_BASE}/tasks/${task.id}`,
    comments: comments.reverse().map((c) => ({ id: c.id, by: c.user?.name ?? null, at: c.createdAt, replyTo: c.parentId, text: c.content.slice(0, 600) })),
  }
}

function docProjectScope(actor: Pick<User, 'id'>): Prisma.DocWhereInput {
  return {
    project: {
      OR: [
        { members: { some: { userId: actor.id } } },
        { workspace: { members: { some: { userId: actor.id, role: { in: ['ONE_ABOVE_ALL', 'BOD'] } } } } },
      ],
    },
  }
}

async function searchDocs(actor: User, input: Record<string, unknown>) {
  const query = asString(input.query)
  if (!query) throw new Error('query is required')
  const projectId = asString(input.projectId)
  const docs = await prisma.doc.findMany({
    where: {
      ...docProjectScope(actor),
      ...(projectId ? { projectId } : {}),
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { contentText: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: asLimit(input.limit, 10),
    select: { id: true, title: true, projectId: true, updatedAt: true, contentText: true, project: { select: { name: true } } },
  })
  return docs.map((d) => ({
    id: d.id,
    title: d.title,
    projectId: d.projectId,
    project: d.project?.name ?? null,
    updatedAt: d.updatedAt,
    excerpt: (d.contentText ?? '').replace(/\s+/g, ' ').slice(0, 280),
    url: `${PUBLIC_BASE}/docs/${d.id}`,
  }))
}

async function getDoc(actor: User, input: Record<string, unknown>) {
  const docId = asString(input.docId)
  if (!docId) throw new Error('docId is required')
  const doc = await prisma.doc.findFirst({
    where: { id: docId, ...docProjectScope(actor) },
    select: { id: true, title: true, projectId: true, updatedAt: true, contentText: true, project: { select: { name: true } } },
  })
  if (!doc) throw new Error('Doc not found or not accessible')
  return {
    id: doc.id,
    title: doc.title,
    projectId: doc.projectId,
    project: doc.project?.name ?? null,
    updatedAt: doc.updatedAt,
    text: (doc.contentText ?? '').slice(0, 12000),
    url: `${PUBLIC_BASE}/docs/${doc.id}`,
  }
}

// ── Approval mode: a write held as a proposal (12 Oct 2026) ───────────────────────────────────────────

const STATUS_WORD: Record<string, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', IN_REVIEW: 'In review', DONE: 'Done', CANCELLED: 'Cancelled' }
const fmtDate = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null)

/**
 * A due date as the card and the reply say it: "Fri 23 Oct" (plus the WIB time when it has one), so a relative
 * day the person used ("due Friday") is never left for them to work out (owner, 16 Oct 2026).
 */
function dueLabel(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const date = new Date(d)
  const time = wibTime(date)
  return `${humanDay(wibDay(date), 'en', todayWib())}${time ? ` ${time}` : ''}`
}
const dueDay = (d: Date | string | null | undefined) => (d ? wibDay(new Date(d)) : null)

async function userNames(ids: string[]): Promise<string> {
  if (!ids.length) return '—'
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  return ids.map((id) => users.find((u) => u.id === id)?.name ?? '?').join(', ')
}

/** `store`: facts resolved when describing that the proposal keeps in its input (a booking's "before"). */
type WriteDescription = { summary: string; diff: GideonDiffRow[]; projectId: string | null; taskId: string | null; due?: string | null; store?: Record<string, unknown>; note?: string }

/**
 * Check the write exactly as far as it can be checked without making it (access, the task and list it
 * names) and describe it as a diff. Applying it later re-runs the real action as the same person, so a
 * permission lost in between still refuses.
 */
async function describeWrite(actor: User, action: string, input: Record<string, unknown>, ctx: { contextProjectId?: string | null } = {}): Promise<WriteDescription> {
  let summary = ''
  const diff: GideonDiffRow[] = []
  let projectId: string | null = null
  let taskId: string | null = null
  let dueText: string | null | undefined
  let store: Record<string, unknown> | undefined

  // The 18 Oct 2026 package describes its own writes (lib/gideon-tools); `preview` (a long text shown in full on
  // the card) travels in the stored input.
  if (action === 'create_task') applyCalendarDefaults(actor, input)
  const extra = extraTool(action)
  if (extra?.describe) {
    if (!(await extraToolEnabled(action))) throw new Error(EXTRA_DISABLED_TEXT)
    const d = await extra.describe(actor, input)
    return {
      summary: d.summary,
      diff: d.diff,
      projectId: d.projectId ?? null,
      taskId: d.taskId ?? null,
      store: { ...(d.store ?? {}), ...(d.preview ? { preview: d.preview.slice(0, 8000) } : {}) },
      note: d.note,
    }
  }

  if (action === 'create_task' && createTaskNeedsProject(input)) {
    // No project named (owner, 18 Oct 2026): the card gets a project picker — only projects this person can edit —
    // instead of a "which project?" in the chat. Preselected when it is obvious: a project name the model passed,
    // the project the chat is about (open page / @-mention), or the only one there is. Checked again on Apply.
    const title = asString(input.title)
    if (!title) throw new Error('title is required')
    const status = asTaskStatus(input.status) || 'TODO'
    const projects = await editableTaskProjects(actor.id)
    if (!projects.length) throw new Error('This person cannot add tasks to any project (it needs Can edit access in one). Tell them so.')
    const hint = (asString(input.project) ?? asString(input.projectName) ?? asString(input.project_name) ?? '').toLowerCase()
    const byName = hint ? (projects.find((p) => p.name.toLowerCase() === hint) ?? (projects.filter((p) => p.name.toLowerCase().includes(hint)).length === 1 ? projects.find((p) => p.name.toLowerCase().includes(hint)) : undefined)) : undefined
    const pre = byName ?? projects.find((p) => p.id === ctx.contextProjectId) ?? (projects.length === 1 ? projects[0] : undefined)
    projectId = pre?.id ?? null
    summary = pre ? `Create task “${title}” in ${pre.name}` : `Create task “${title}”`
    const due = parseDueInput(input.dueDate)
    dueText = dueLabel(due)
    const assignees = asStringArray(input.assigneeIds) ?? []
    diff.push(
      { field: 'Title', to: title },
      { field: 'Project', to: pre?.name ?? '—' },
      { field: 'Status', to: STATUS_WORD[status] ?? status },
      { field: 'Due', to: dueText ?? '—', toDay: dueDay(due) },
      { field: 'Assignees', to: await userNames(assignees) },
    )
    store = { pickProject: true, taskTarget: { projects, preselectedProjectId: pre?.id ?? null, preselectedProjectName: pre?.name ?? null, dueDay: dueDay(due) } }
  } else if (action === 'create_task') {
    const title = asString(input.title)
    if (!title) throw new Error('title is required')
    const status = asTaskStatus(input.status) || 'TODO'
    const taskList = await resolveTaskList(actor, input, status)
    await assertCanWrite(actor, taskList.projectId)
    projectId = taskList.projectId
    summary = `Create task “${title}” in ${taskList.project.name}`
    // The whole task on one card, every time (owner, 16 Oct 2026): title, section, status, due, assignees —
    // an empty due date or assignee list says so instead of leaving the row out.
    const due = parseDueInput(input.dueDate)
    dueText = dueLabel(due)
    const assignees = asStringArray(input.assigneeIds) ?? []
    diff.push(
      { field: 'Title', to: title },
      { field: 'Section', to: taskList.name },
      { field: 'Status', to: STATUS_WORD[status] ?? status },
      { field: 'Due', to: dueText ?? '—', toDay: dueDay(due) },
      { field: 'Assignees', to: await userNames(assignees) },
    )
    const priority = asTaskPriority(input.priority)
    if (priority) diff.push({ field: 'Priority', to: priority })
    const description = asString(input.description)
    if (description) diff.push({ field: 'Description', to: description.slice(0, 300) })
  } else if (action === 'update_task') {
    const id = asString(input.taskId)
    if (!id) throw new Error('taskId is required')
    const existing = await getAccessibleTask(actor, id)
    await assertCanWrite(actor, existing.taskList.projectId)
    projectId = existing.taskList.projectId
    taskId = existing.id
    summary = `Update task “${existing.title}”`
    const title = asString(input.title)
    if (title && title !== existing.title) diff.push({ field: 'Title', from: existing.title, to: title })
    const status = asTaskStatus(input.status)
    if (status && status !== existing.status) diff.push({ field: 'Status', from: STATUS_WORD[existing.status] ?? existing.status, to: STATUS_WORD[status] ?? status })
    const priority = asTaskPriority(input.priority)
    if (priority && priority !== existing.priority) diff.push({ field: 'Priority', from: existing.priority, to: priority })
    const due = parseDueInput(input.dueDate)
    if (due !== undefined && fmtDate(due) !== fmtDate(existing.dueDate)) {
      dueText = dueLabel(due)
      diff.push({ field: 'Due', from: dueLabel(existing.dueDate) ?? '—', to: dueText ?? '—', fromDay: dueDay(existing.dueDate), toDay: dueDay(due) })
    }
    const listId = asString(input.taskListId)
    if (listId && listId !== existing.taskListId) {
      const target = await resolveTaskList(actor, { taskListId: listId })
      diff.push({ field: 'Section', from: existing.taskList.name, to: target.name })
    }
    const assignees = asStringArray(input.assigneeIds)
    if (assignees !== undefined) {
      const before = existing.assignees.map((a: { user: { id: string } }) => a.user.id)
      if (before.slice().sort().join() !== assignees.slice().sort().join()) diff.push({ field: 'Assignees', from: await userNames(before), to: await userNames(assignees) })
    }
    if (input.description === null || asString(input.description) !== undefined) {
      const next = input.description === null ? '' : String(input.description)
      if (next !== (existing.description ?? '')) diff.push({ field: 'Description', from: (existing.description ?? '').slice(0, 200) || '—', to: next.slice(0, 300) || '—' })
    }
    const cf = await resolveCustomFieldUpdates(actor, existing.taskList.projectId, input)
    if (cf.length) diff.push({ field: 'Custom fields', to: `${cf.length} change${cf.length === 1 ? '' : 's'}` })
    if (!diff.length) throw new Error('Nothing would change on this task')
  } else if (action === 'add_task_comment') {
    const id = asString(input.taskId)
    const content = asString(input.content)
    if (!id) throw new Error('taskId is required')
    if (!content) throw new Error('content is required')
    const task = await getAccessibleTask(actor, id)
    await assertCanWrite(actor, task.taskList.projectId)
    projectId = task.taskList.projectId
    taskId = task.id
    summary = `Comment on “${task.title}”`
    diff.push({ field: 'Comment', to: content.slice(0, 600) })
  } else if (action === 'book_room') {
    const booking = await describeBookRoom(actor.id, input)
    summary = booking.summary
    diff.push(...booking.diff)
  } else if (action === 'move_room_booking' || action === 'cancel_room_booking') {
    const change = action === 'move_room_booking' ? await describeMoveRoomBooking(actor.id, input) : await describeCancelRoomBooking(actor.id, input)
    summary = change.summary
    diff.push(...change.diff)
    store = change.store
  } else if (action === 'delete_task') {
    const id = asString(input.taskId) ?? asString(input.task_id)
    if (!id) throw new Error('taskId is required (find the task first with nexus_search_tasks or nexus_list_tasks)')
    const existing = await getAccessibleTask(actor, id)
    // The Delete button's own rule (DELETE /api/tasks/:id, lib/task-delete.ts): Can edit in the task's project.
    // Checked again when the person taps Apply.
    const { allowed } = await checkProjectAccess(actor.id, existing.taskList.projectId, ['MEMBER'])
    if (!allowed) throw new Error(`This person cannot delete tasks in ${existing.taskList.project?.name ?? 'this project'}: deleting needs Can edit access there. Tell them so; do not propose anything else instead.`)
    projectId = existing.taskList.projectId
    taskId = existing.id
    summary = `Delete task “${existing.title}”`
    const assignees = existing.assignees.map((a: { user: { name: string | null } }) => a.user.name ?? '?')
    const projectName = existing.taskList.project?.name ?? null
    dueText = dueLabel(existing.dueDate)
    diff.push(
      { field: 'Task', to: existing.title },
      { field: 'Project', to: projectName ?? '—' },
      { field: 'Status', to: existing.taskList.name ?? STATUS_WORD[existing.status] ?? existing.status },
      { field: 'Due', to: dueText ?? '—', toDay: dueDay(existing.dueDate) },
      { field: 'Assignees', to: assignees.length ? assignees.join(', ') : '—' },
    )
    // What the card shows, kept as it was now; Apply deletes only this version of the task (updatedAt).
    store = {
      taskId: existing.id,
      before: {
        title: existing.title, projectId, projectName, status: existing.taskList.name ?? null,
        progress: STATUS_WORD[existing.status] ?? existing.status, due: dueText ?? null, dueDay: dueDay(existing.dueDate),
        assignees, updatedAt: existing.updatedAt.toISOString(),
      },
    }
  } else if (action === 'create_document') {
    const pid = String(input.projectId ?? '').trim()
    const title = String(input.title ?? '').trim()
    const markdown = String(input.markdown ?? input.content ?? '')
    if (!pid) throw new Error('projectId is required')
    if (!title) throw new Error('title is required')
    if (!markdown.trim()) throw new Error('markdown is required')
    const project = await getAccessibleProject(actor, pid)
    await assertCanWrite(actor, pid)
    projectId = pid
    summary = `Write doc “${title}” in ${project.name}`
    diff.push({ field: 'Title', to: title }, { field: 'Body', to: markdown.slice(0, 400) })
  } else {
    throw new Error(`${action} cannot be proposed`)
  }
  // On the calendar (create_task calendar=true): say where it will show, on the card and in the reply.
  let note: string | undefined
  if (action === 'create_task' && (input.calendar === true || input.calendar === 'true')) {
    diff.push({ field: 'Calendar', to: 'Shows on the calendar (it has a PIC and a date)' })
    note = `NOT created yet: it waits on the card below.${dueText ? ` Say the date as "${dueText}".` : ''} Once applied it appears on the Calendar on that day, because it has a PIC (${await userNames(asStringArray(input.assigneeIds) ?? [])}) and a date; the PIC can be changed on the card.`
  }
  return { summary, diff, projectId, taskId, due: dueText, store, note }
}

const DELETE_REFUSAL_TEXT: Record<'NOT_FOUND' | 'NEEDS_EDIT_ACCESS' | 'CHANGED', string> = {
  NOT_FOUND: 'This task is already gone (someone deleted it). Nothing else was deleted · Task ini sudah tidak ada (sudah dihapus orang lain).',
  NEEDS_EDIT_ACCESS: 'You no longer have Can edit access in this project, so the task was not deleted · Kamu tidak punya akses Can edit di project ini, jadi task tidak dihapus.',
  CHANGED: 'This task changed after the card was made, so nothing was deleted. Check it and ask GIDEON again · Task ini berubah setelah kartu dibuat, jadi tidak dihapus. Cek lagi lalu minta GIDEON ulang.',
}

/**
 * The approved delete (owner, 18 Oct 2026): the web Delete button's own path (lib/task-delete.ts) as the person —
 * Can edit re-checked now, the copy for Control Room → Audit, the realtime ping — and only the task as the card
 * showed it (updatedAt), so a task edited in between is not deleted on an old approval.
 */
async function applyDeleteTask(actor: User, input: Record<string, unknown>) {
  const taskId = asString(input.taskId)
  if (!taskId) throw new Error('taskId is required')
  const before = (input.before && typeof input.before === 'object' ? input.before : {}) as { updatedAt?: unknown }
  const { auditLogId, task } = await deleteTaskAs(actor.id, taskId, {
    expectedUpdatedAt: typeof before.updatedAt === 'string' ? before.updatedAt : null,
    via: 'GIDEON',
  })
  return { deleted: true, taskId: task.id, title: task.title, project: task.projectName, auditLogId, restore: 'It can be restored from Control Room → Audit.' }
}

/** Describe the write and store it as a proposal for the person to approve. */
async function proposeWrite(actor: User, runId: string, action: string, input: Record<string, unknown>, ctx: { contextProjectId?: string | null } = {}) {
  const d = await describeWrite(actor, action, input, ctx)
  const proposal = await prisma.gideonProposal.create({
    data: {
      runId,
      userId: actor.id,
      action,
      input: (d.store ? { ...input, ...d.store } : input) as Prisma.InputJsonValue,
      summary: d.summary.slice(0, 300),
      diff: d.diff as unknown as Prisma.InputJsonValue,
      projectId: d.projectId,
      taskId: d.taskId,
    },
  })
  return { proposal, due: d.due ?? null, note: d.note ?? null }
}

/** The fields of an update_task that a task not created yet can take into its create proposal. */
const MERGEABLE_FIELDS = ['title', 'description', 'status', 'priority', 'dueDate', 'assigneeIds', 'taskListId', 'customFields'] as const

/**
 * An update_task aimed at a task this run has only PROPOSED (its id is the create proposal's id — the only id
 * the model has for it): the fields go into that create proposal instead (owner, 16 Oct 2026). One card per new
 * task, complete; nothing exists until Apply, so Discard leaves nothing behind. Null when the id is not a
 * pending create proposal of this run and person.
 */
async function mergeIntoCreateProposal(actor: User, runId: string, input: Record<string, unknown>) {
  const id = asString(input.taskId) ?? asString(input.proposalId)
  if (!id) return null
  const target = await prisma.gideonProposal.findFirst({ where: { id, runId, userId: actor.id, action: 'create_task', status: 'PENDING' } })
  if (!target) return null
  const merged: Record<string, unknown> = { ...((target.input as Record<string, unknown>) ?? {}) }
  for (const key of MERGEABLE_FIELDS) if (input[key] !== undefined) merged[key] = input[key]
  const d = await describeWrite(actor, 'create_task', merged, { contextProjectId: asString((target.input as Record<string, unknown> | null)?.taskTarget && ((target.input as { taskTarget?: { preselectedProjectId?: unknown } }).taskTarget?.preselectedProjectId)) ?? null })
  // A picker card that now names its project becomes an ordinary create card (and the other way round).
  const nextInput = { ...merged, ...(d.store ?? { pickProject: false, taskTarget: null }) }
  // Conditional, like the Apply claim: a proposal decided in the meantime is not changed under the person.
  const changed = await prisma.gideonProposal.updateMany({
    where: { id: target.id, status: 'PENDING' },
    data: { input: nextInput as Prisma.InputJsonValue, summary: d.summary.slice(0, 300), diff: d.diff as unknown as Prisma.InputJsonValue, projectId: d.projectId },
  })
  if (changed.count === 0) throw new Error('That task proposal was already decided; ask again.')
  const proposal = await prisma.gideonProposal.findUnique({ where: { id: target.id } })
  return proposal ? { proposal, due: d.due ?? null } : null
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
  await notifyComplaintStatus({ reporterId: complaint.reporterId, complaintId, status: 'RESOLVED', detail: note.slice(0, 160) }).catch(() => {})
  return { resolved: true, complaintId, date: dateKey, verified: { xpRemaining: remaining, autoDayOffs: pen.autoDayOffs, pendingProposals: 0 } }
}

// ── Pipeline deals and Legal documents (18 Oct 2026) ──────────────────────────────────────────────────────
// Read only. Deferred tools: the model loads them when a question is about a deal or a legal document.

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`

/**
 * Deals on the Pipeline boards this person can open (a board is an ordinary project for access: member, or BoD /
 * One Above All). Matches the deal name, brand, code, BD or PM; filters by stage. Compact rows.
 */
async function searchDeals(actor: User, input: Record<string, unknown>) {
  const query = asString(input.query)
  const stage = asString(input.stage)
  const boardWhere: Prisma.ProjectWhereInput = { ...actorScopedProjectWhere(actor, {}), type: 'PIPELINE' }
  const projectId = asString(input.projectId)
  if (projectId) boardWhere.id = projectId
  const where: Prisma.PipelineDealWhereInput = { project: boardWhere }
  const and: Prisma.PipelineDealWhereInput[] = []
  if (query) {
    and.push({
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { brand: { contains: query, mode: 'insensitive' } },
        { code: { contains: query, mode: 'insensitive' } },
        { bdName: { contains: query, mode: 'insensitive' } },
        { pmName: { contains: query, mode: 'insensitive' } },
        { bd: { name: { contains: query, mode: 'insensitive' } } },
        { pm: { name: { contains: query, mode: 'insensitive' } } },
      ],
    })
  }
  if (stage) and.push({ stage: { contains: stage, mode: 'insensitive' } })
  if (and.length) where.AND = and
  const { limit, offset } = taskPaging(input)
  const [deals, total] = await Promise.all([
    prisma.pipelineDeal.findMany({
      where,
      select: {
        id: true, code: true, name: true, brand: true, stage: true, probability: true, contractValue: true, netValue: true,
        services: true, service: true, contractStatus: true, paymentStatus: true, outstandingReceivable: true, deliverableStatus: true,
        deliverableRisk: true, closingStatus: true, mainDate: true, nextAction: true, nextActionDate: true, blocker: true,
        bdName: true, pmName: true, bd: { select: { name: true } }, pm: { select: { name: true } }, project: { select: { name: true } },
      },
      orderBy: [{ contractValue: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.pipelineDeal.count({ where }),
  ])
  const items = deals.map((d) => {
    const row: Record<string, unknown> = {
      code: d.code, name: d.name, board: d.project.name, stage: d.stage,
      bd: d.bd?.name ?? d.bdName ?? null, pm: d.pm?.name ?? d.pmName ?? null,
      contractValue: rupiah(d.contractValue),
    }
    if (d.brand) row.brand = d.brand
    if (d.netValue) row.netValue = rupiah(d.netValue)
    row.probability = `${Math.round(d.probability * 100)}%`
    const services = d.services.length ? d.services : d.service ? [d.service] : []
    if (services.length) row.services = services.join(', ')
    for (const [k, v, skip] of [
      ['contract', d.contractStatus, 'Not Started'], ['payment', d.paymentStatus, 'Not Yet'], ['deliverable', d.deliverableStatus, 'Not Started'],
      ['risk', d.deliverableRisk, 'Aman'], ['closing', d.closingStatus, 'Not Ready'],
    ] as const) if (v && v !== skip) row[k] = v
    if (d.outstandingReceivable) row.outstanding = rupiah(d.outstandingReceivable)
    if (d.mainDate) row.mainDate = wibDayKey(d.mainDate)
    if (d.nextAction) row.nextAction = `${d.nextAction}${d.nextActionDate ? ` (${wibDayKey(d.nextActionDate)})` : ''}`
    if (d.blocker) row.blocker = d.blocker.slice(0, 160)
    return row
  })
  return {
    ...page(items, total, offset, limit, 'pass query (deal, brand, code, BD or PM) or stage'),
    ...(total ? {} : { note: 'No deal on a Pipeline board this person can open matches. Say so; do not guess.' }),
  }
}

/**
 * Legal documents: invitation only (the Legal page's own rule, lib/legal/access.ts). Someone without Legal access gets
 * a plain refusal the model can relay — never a list.
 */
async function searchLegalDocuments(actor: User, input: Record<string, unknown>) {
  const legal = await legalActor(actor.id)
  if (!legal) return { access: false, note: 'This person has no access to Legal (it is by invitation only). Tell them so; do not guess any document.' }
  const sp = new URLSearchParams()
  const query = asString(input.query)
  if (query) sp.set('q', query)
  const docType = asString(input.docType)
  if (docType) sp.set('docType', docType.toUpperCase())
  const status = asString(input.status)
  if (status) sp.set('status', status.toUpperCase())
  const { limit, offset } = taskPaging(input)
  sp.set('limit', String(limit))
  sp.set('page', String(Math.floor(offset / limit) + 1))
  const { documents, total } = await listDocuments(legal, sp)
  const items = documents.map((d) => ({
    number: d.number || null,
    title: d.title,
    type: d.docType,
    status: d.status,
    ...(d.counterparty ? { counterparty: d.counterparty } : {}),
    ...(d.docDate ? { date: d.docDate } : {}),
    company: (d.company as { name?: string } | null)?.name ?? null,
    ...((d.project as { name?: string } | null)?.name ? { project: (d.project as { name: string }).name } : {}),
    ...((d.deal as { name?: string } | null)?.name ? { deal: (d.deal as { name: string }).name } : {}),
    ...(d.signedAt ? { signedAt: wibDayKey(d.signedAt) } : {}),
  }))
  return page(items, total, offset, limit, 'pass query (number, title or counterparty), docType or status')
}
