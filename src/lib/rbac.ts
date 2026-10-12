import prisma from '@/lib/prisma'
import type { ProjectRole, WorkspaceRole } from '@/generated/prisma/client'

// ProjectRole expresses the REQUIRED level of an action (LEAD=Full, MEMBER=Edit, VIEWER/GUEST=View) and,
// on ProjectMember, marks the project's Owner (LEAD). Access levels: see "Project access levels" below.
const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  LEAD: 4,
  MEMBER: 3,
  VIEWER: 2,
  GUEST: 1,
}

// Org-wide role hierarchy: One Above All > BoD > Manager > Staff.
export const WORKSPACE_HIERARCHY: Record<WorkspaceRole, number> = {
  ONE_ABOVE_ALL: 4,
  BOD: 3,
  MANAGER: 2,
  STAFF: 1,
}

// Workspace "manager" tier = Manager and above (Manager, BoD, One Above All).
// Use this everywhere a check grants workspace/team/project management rights so the
// top tier (One Above All) is never accidentally excluded.
export const MANAGER_WORKSPACE_ROLES: WorkspaceRole[] = ['ONE_ABOVE_ALL', 'BOD', 'MANAGER']

export function isWorkspaceManagerRole(role?: WorkspaceRole | null): boolean {
  return role === 'ONE_ABOVE_ALL' || role === 'BOD' || role === 'MANAGER'
}

export async function isSystemAdminUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })

  return user?.role === 'ADMIN'
}

// ─── Project access levels (owner decision 13 Oct 2026, Notion's model) ─────────────────────────────────
//
//   FULL     Full access — rename, settings, automations, statuses/columns, members, delete the project
//   EDIT     Can edit    — create / edit / delete tasks, docs, sheets, comments
//   COMMENT  Can comment — read, and comment
//   VIEW     Can view    — read only
//
// Who gets which:
//   - system admin, and the roles in PROJECT_WIDE_ROLES (One Above All, BoD) → FULL on every project of
//     their workspace (Notion's workspace owners). Not on a PIPELINE project they are not a member of.
//   - everyone else (Manager, Staff) → only projects they are a member of, at that membership's level.
//     The project's Owner (ProjectMember.role LEAD — shown as "Project Owner") is FULL; otherwise
//     ProjectMember.accessLevel (EDIT by default). Nobody else sees a project.
// This is the ONE place that answers "what may this person do in this project"; every route asks it
// through checkProjectAccess / projectAccessLevel.

export type AccessLevel = 'FULL' | 'EDIT' | 'COMMENT' | 'VIEW'
export const ACCESS_LEVELS: AccessLevel[] = ['FULL', 'EDIT', 'COMMENT', 'VIEW']
export const LEVEL_RANK: Record<AccessLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 }

/** Workspace roles with Full access to every project of the workspace. The workspace-wide rule lives here. */
export const PROJECT_WIDE_ROLES: WorkspaceRole[] = ['ONE_ABOVE_ALL', 'BOD']
export function hasProjectWideAccess(role?: string | null): boolean {
  return !!role && (PROJECT_WIDE_ROLES as string[]).includes(role)
}

export function isAccessLevel(v: unknown): v is AccessLevel {
  return typeof v === 'string' && (ACCESS_LEVELS as string[]).includes(v)
}

/**
 * A membership's level. role and accessLevel are written together (roleForLevel), so they agree; role wins
 * where it is specific — LEAD (the Project Owner) = FULL, GUEST = COMMENT, VIEWER = VIEW — because older
 * code paths (project create, email invites, team sync) write only role. A plain MEMBER reads accessLevel.
 */
export function memberAccessLevel(m: { role?: string | null; accessLevel?: string | null } | null | undefined): AccessLevel | null {
  if (!m) return null
  if (m.role === 'LEAD') return 'FULL'
  if (m.role === 'GUEST') return 'COMMENT'
  if (m.role === 'VIEWER') return 'VIEW'
  return isAccessLevel(m.accessLevel) && m.accessLevel !== 'FULL' ? m.accessLevel : 'EDIT'
}

/** The ProjectMember.role written with a level, so released apps (which read role) see the same thing. */
export function roleForLevel(level: AccessLevel): ProjectRole {
  return level === 'FULL' ? 'LEAD' : level === 'COMMENT' ? 'GUEST' : level === 'VIEW' ? 'VIEWER' : 'MEMBER'
}

/** The viewer's level in a project, or null for no access. */
export async function projectAccessLevel(userId: string, projectId: string): Promise<AccessLevel | null> {
  const [user, membership, project] = await prisma.$transaction([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.projectMember.findUnique({ where: { userId_projectId: { userId, projectId } }, select: { role: true, accessLevel: true } }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { type: true, workspace: { select: { members: { where: { userId }, select: { role: true }, take: 1 } } } },
    }),
  ])
  if (!project) return null
  if (user?.role === 'ADMIN') return 'FULL'
  const workspaceRole = project.workspace.members[0]?.role
  if (!workspaceRole) return null
  const own = memberAccessLevel(membership)
  // A PIPELINE project is for the people added to it and nobody else (owner, 9 Oct 2026).
  if (project.type === 'PIPELINE') return own
  if (hasProjectWideAccess(workspaceRole)) return 'FULL'
  return own
}

/** Required ProjectRole → level: LEAD = FULL, MEMBER = EDIT, VIEWER / GUEST = VIEW. */
function levelForRequired(requiredRole: ProjectRole[]): AccessLevel {
  const min = Math.min(...requiredRole.map((r) => ROLE_HIERARCHY[r]))
  return min >= ROLE_HIERARCHY.LEAD ? 'FULL' : min >= ROLE_HIERARCHY.MEMBER ? 'EDIT' : 'VIEW'
}

const ROLE_FOR_LEVEL: Record<AccessLevel, ProjectRole> = { FULL: 'LEAD', EDIT: 'MEMBER', COMMENT: 'GUEST', VIEW: 'VIEWER' }

/** Does the viewer have at least `min` in this project? */
export async function hasProjectLevel(userId: string, projectId: string, min: AccessLevel): Promise<boolean> {
  const level = await projectAccessLevel(userId, projectId)
  return !!level && LEVEL_RANK[level] >= LEVEL_RANK[min]
}

/**
 * The historical entry point every route uses: `requiredRole` LEAD = FULL, MEMBER = EDIT, VIEWER/GUEST =
 * VIEW. `role` answers the viewer's level in the old vocabulary (FULL→LEAD, EDIT→MEMBER, COMMENT→GUEST,
 * VIEW→VIEWER). Use hasProjectLevel(…, "COMMENT") for comment writes.
 */
export async function checkProjectAccess(
  userId: string,
  projectId: string,
  requiredRole: ProjectRole[]
): Promise<{ allowed: boolean; role: ProjectRole | null; level: AccessLevel | null }> {
  const level = await projectAccessLevel(userId, projectId)
  if (!level) return { allowed: false, role: null, level: null }
  const need = levelForRequired(requiredRole)
  return { allowed: LEVEL_RANK[level] >= LEVEL_RANK[need], role: ROLE_FOR_LEVEL[level], level }
}

/**
 * Org-wide workspace access check (BoD > Manager > Staff). System ADMIN bypasses.
 * Use this instead of ad-hoc `role === 'BOD' || role === 'ADMIN'` checks.
 */
export async function checkWorkspaceAccess(
  userId: string,
  workspaceId: string,
  minRole: WorkspaceRole
): Promise<{ allowed: boolean; role: WorkspaceRole | null }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role === 'ADMIN') {
    return { allowed: true, role: 'BOD' }
  }
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  })
  if (!membership) {
    return { allowed: false, role: null }
  }
  return { allowed: WORKSPACE_HIERARCHY[membership.role] >= WORKSPACE_HIERARCHY[minRole], role: membership.role }
}

export async function checkWorkspaceRoutingAccess(
  userId: string,
  workspaceId: string
): Promise<{ allowed: boolean; role: string | null }> {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId,
      },
    },
    select: { role: true },
  })

  if (!membership) {
    return { allowed: false, role: null }
  }

  return { allowed: true, role: membership.role }
}
