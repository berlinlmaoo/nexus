export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { checkProjectAccess } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { restorableDelete } from '@/lib/deletion-snapshot'
import { emitAutomationsChanged } from '@/lib/socket-emitter'
import {
  MAX_ACTIONS,
  actionError,
  actionsOf,
  nextSlot,
  normalizeAction,
  normalizeConditions,
  normalizeTrigger,
  scheduleOf,
  triggerError,
  type Conditions,
  type Rule,
} from '@/lib/automation-rules'
import type { InputJsonValue } from '@prisma/client/runtime/client'

/**
 * Project automations (rebuilt 12 Oct 2026). Anyone who can see the project lists them; only people who
 * manage it (LEAD: Manager, BoD, One Above All — lib/rbac.ts) create, edit, toggle or delete.
 *
 * Every trigger/action type is normalised on save AND on read (lib/automation-rules.ts): the old web UI
 * stored "task_created" while the engine matched "TASK_CREATED", so its rules never fired.
 *
 * Released apps: iOS/Android read GET (decoding trigger/action as {type, field?, value?} strings) and
 * PATCH {id, enabled}. Both shapes are unchanged; everything new is additive.
 */

type Row = {
  id: string; name: string; enabled: boolean; projectId: string
  trigger: unknown; action: unknown; actions: unknown; condition: unknown; conditions: unknown
  createdAt: Date; updatedAt: Date; createdById: string | null
  lastRunAt: Date | null; lastRunStatus: string | null; runCount: number
}

/** A row as clients see it: normalised types, `action` = the first action (released apps). */
function present(row: Row) {
  const trigger = normalizeTrigger(row.trigger) ?? { type: String((row.trigger as { type?: unknown } | null)?.type ?? 'UNKNOWN') }
  const actions = actionsOf(row)
  const conditions = normalizeConditions(row.conditions, row.condition)
  const schedule = trigger.type === 'SCHEDULED' ? scheduleOf(trigger) : null
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    projectId: row.projectId,
    trigger,
    action: actions[0] ? { type: actions[0].type, ...(actions[0].field ? { field: actions[0].field } : {}), ...(actions[0].value !== undefined ? { value: actions[0].value } : {}) } : null,
    actions,
    conditions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
    lastRunAt: row.lastRunAt,
    lastRunStatus: row.lastRunStatus,
    runCount: row.runCount,
    nextRunAt: schedule && row.enabled ? nextSlot(schedule, new Date()) : null,
  }
}

type Parsed = { trigger: Rule; actions: Rule[]; conditions: Conditions | null }

/** Validate a posted rule. `partial` (PATCH) lets any of the three be absent. */
async function parseRule(
  body: { trigger?: unknown; action?: unknown; actions?: unknown; condition?: unknown; conditions?: unknown },
  partial: boolean,
): Promise<{ ok: true; value: Partial<Parsed> } | { ok: false; error: string }> {
  const out: Partial<Parsed> = {}
  if (body.trigger !== undefined || !partial) {
    const trigger = normalizeTrigger(body.trigger)
    if (!trigger) return { ok: false, error: 'Unknown trigger' }
    const err = triggerError(trigger)
    if (err) return { ok: false, error: err }
    out.trigger = trigger
  }
  if (body.actions !== undefined || body.action !== undefined || !partial) {
    const raw = Array.isArray(body.actions) ? body.actions : body.action ? [body.action] : []
    if (raw.length === 0) return { ok: false, error: 'Add at least one action' }
    if (raw.length > MAX_ACTIONS) return { ok: false, error: `At most ${MAX_ACTIONS} actions` }
    const actions: Rule[] = []
    for (const a of raw) {
      const n = normalizeAction(a)
      if (!n) return { ok: false, error: `Unknown action ${(a as { type?: unknown })?.type ?? ''}` }
      const err = actionError(n)
      if (err) return { ok: false, error: err }
      actions.push(n)
    }
    out.actions = actions
  }
  if (body.conditions !== undefined || body.condition !== undefined) {
    out.conditions = normalizeConditions(body.conditions, body.condition)
  } else if (!partial) out.conditions = null
  return { ok: true, value: out }
}

function json(v: unknown): InputJsonValue {
  return v as InputJsonValue
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const { allowed } = await checkProjectAccess(session.user.id, projectId, ['MEMBER'])
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { allowed: canEdit } = await checkProjectAccess(session.user.id, projectId, ['LEAD'])
    const rows = (await prisma.automation.findMany({ where: { projectId }, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] })) as Row[]
    return NextResponse.json({ automations: rows.map((r) => present(r)), canEdit })
  } catch (error) {
    console.error('Error fetching automations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : ''
    const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
    if (!name || !projectId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ['LEAD'])
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden: you need Full access to the project to create automations' }, { status: 403 })
    }

    const parsed = await parseRule(body, false)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { trigger, actions, conditions } = parsed.value as Parsed

    const automation = (await prisma.automation.create({
      data: {
        name, projectId,
        trigger: json(trigger),
        action: json(actions[0]),
        actions: json(actions),
        ...(conditions ? { conditions: json(conditions) } : {}),
        enabled: body.enabled === false ? false : true,
        createdById: session.user.id,
      },
    })) as Row

    logAudit({ action: "create", entityType: "automation", entityId: automation.id, entityName: name, userId: session.user.id, request: req, metadata: { projectId, trigger: trigger.type, actions: actions.map((a) => a.type) } })
    emitAutomationsChanged(projectId, automation.id, session.user.id)

    return NextResponse.json({ automation: present(automation) }, { status: 201 })
  } catch (error) {
    console.error('Error creating automation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { id, enabled } = body ?? {}
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const existing = await prisma.automation.findUnique({ where: { id }, select: { projectId: true } })
    if (!existing) return NextResponse.json({ error: 'Automation not found' }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, existing.projectId, ['LEAD'])
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden: you need Full access to the project to update automations' }, { status: 403 })
    }

    const parsed = await parseRule(body, true)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { trigger, actions, conditions } = parsed.value

    const data: Record<string, unknown> = {}
    if (typeof enabled === 'boolean') data.enabled = enabled
    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 200)
      if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
      data.name = name
    }
    if (trigger) data.trigger = json(trigger)
    if (actions) { data.actions = json(actions); data.action = json(actions[0]) }
    if (conditions !== undefined) data.conditions = conditions ? json(conditions) : null

    const automation = (await prisma.automation.update({ where: { id }, data })) as Row

    logAudit({ action: "update", entityType: "automation", entityId: id, entityName: automation.name, userId: session.user.id, request: req, metadata: { projectId: existing.projectId, changes: { enabled, name: body.name, trigger: trigger?.type, actions: actions?.map((a) => a.type), conditions: conditions === undefined ? undefined : conditions?.rules.length ?? 0 } } })
    emitAutomationsChanged(existing.projectId, id, session.user.id)

    return NextResponse.json({ automation: present(automation) })
  } catch (error) {
    console.error('Error updating automation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const existing = await prisma.automation.findUnique({ where: { id }, select: { projectId: true, name: true, project: { select: { workspaceId: true } } } })
    if (!existing) return NextResponse.json({ error: 'Automation not found' }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, existing.projectId, ['LEAD'])
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden: you need Full access to the project to delete automations' }, { status: 403 })
    }

    // Kept first, so Control Room → Audit can restore it.
    await restorableDelete({
      entityType: "automation", entityId: id, entityName: existing.name, workspaceId: existing.project.workspaceId,
      userId: session.user.id, request: req, metadata: { projectId: existing.projectId },
      meta: { open: { type: "project", id: existing.projectId }, projectId: existing.projectId },
      remove: (tx) => tx.automation.delete({ where: { id } }),
    })
    emitAutomationsChanged(existing.projectId, id, session.user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting automation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
