import prisma from '@/lib/prisma'
import { ORG_WORKSPACE_ID } from '@/lib/org'
import type { Prisma } from '@/generated/prisma/client'
import type { AuditIdKind, AuditIdSets, AuditNames } from '@/lib/audit-describe'

/**
 * Who may read the audit log, and which rows. Shared by GET /api/audit and GET /api/audit/[id] so the
 * two can never disagree: a row the list would not show is a 404 on the detail endpoint too.
 *
 * Caller must hold an admin-tier role. Memberships are resolved deterministically (the old findFirst
 * picked an arbitrary membership, so a STAFF-in-A / BOD-in-B user got an unpredictable verdict).
 * Every workspace where they're BOD/MANAGER/ONE_ABOVE_ALL is collected — visibility is then scoped to
 * actors in exactly those workspaces (no cross-tenant audit-log leak). A system ADMIN or the company
 * workspace's ONE_ABOVE_ALL sees everything.
 */
export type AuditAccess =
  | { ok: false }
  | { ok: true; allSeeing: boolean; scope: Prisma.AuditLogWhereInput }

export async function resolveAuditAccess(userId: string): Promise<AuditAccess> {
  const [memberships, user] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true, role: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])

  const isGlobalAdmin = user?.role === 'ADMIN'
  // All-seeing = system admin or One Above All of the COMPANY workspace. Being ONE_ABOVE_ALL of any
  // other workspace is what every sign-up gets for their personal workspace, so it only scopes.
  const isAllSeeing =
    isGlobalAdmin || memberships.some((m) => m.workspaceId === ORG_WORKSPACE_ID && m.role === 'ONE_ABOVE_ALL')
  const adminWorkspaceIds = memberships
    .filter((m) => m.role === 'BOD' || m.role === 'MANAGER' || m.role === 'ONE_ABOVE_ALL')
    .map((m) => m.workspaceId)

  if (!isAllSeeing && adminWorkspaceIds.length === 0) return { ok: false }

  // Scope to actors inside the caller's admin workspaces unless they're an all-seeing super-admin.
  const scope: Prisma.AuditLogWhereInput = isAllSeeing
    ? {}
    : { user: { workspaceMembers: { some: { workspaceId: { in: adminWorkspaceIds } } } } }
  return { ok: true, allSeeing: isAllSeeing, scope }
}

const MAX_IDS_PER_KIND = 200

/**
 * id → name for every id a row mentions: at most one query per kind, all in parallel, and none for a
 * kind the row does not mention. A lookup that fails leaves that kind unresolved (ids show as ids)
 * instead of failing the request.
 */
export async function resolveAuditNames(ids: AuditIdSets): Promise<AuditNames> {
  const take = (kind: AuditIdKind) => (ids[kind] ?? []).slice(0, MAX_IDS_PER_KIND)
  const toMap = (rows: Array<{ id: string; name?: string | null; title?: string | null; email?: string | null }>) => {
    const out: Record<string, string> = {}
    for (const r of rows) {
      const label = r.name ?? r.title ?? r.email
      if (label) out[r.id] = label
    }
    return out
  }
  const run = async <T extends { id: string }>(
    kind: AuditIdKind,
    query: (list: string[]) => Promise<T[]>,
  ): Promise<[AuditIdKind, Record<string, string>]> => {
    const list = take(kind)
    if (list.length === 0) return [kind, {}]
    try {
      return [kind, toMap((await query(list)) as Array<{ id: string; name?: string | null; title?: string | null; email?: string | null }>)]
    } catch {
      return [kind, {}]
    }
  }

  const pairs = await Promise.all([
    run('user', (list) => prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true, email: true } })),
    run('task', (list) => prisma.task.findMany({ where: { id: { in: list } }, select: { id: true, title: true } })),
    run('project', (list) => prisma.project.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })),
    run('customField', (list) => prisma.customField.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })),
    run('office', (list) => prisma.officeLocation.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })),
    run('form', (list) => prisma.form.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })),
    run('taskList', (list) => prisma.taskList.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })),
    run('workspace', (list) => prisma.workspace.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })),
    run('team', (list) => prisma.team.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })),
  ])
  const names: AuditNames = {}
  for (const [kind, map] of pairs) names[kind] = map
  return names
}
