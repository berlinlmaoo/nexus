import prisma from '@/lib/prisma'
import type { ProjectRole, WorkspaceRole } from '@/generated/prisma/client'

// ProjectRole is now only used to express the REQUIRED level of an action
// (LEAD=manage, MEMBER=contribute, VIEWER/GUEST=view). Project membership itself
// carries no per-project role anymore — access is driven by the org-wide workspace
// role (BoD / Manager / Staff) + whether the user is a member of the project.
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

export async function checkProjectAccess(
  userId: string,
  projectId: string,
  requiredRole: ProjectRole[]
): Promise<{ allowed: boolean; role: ProjectRole | null }> {
  const [user, membership, project] = await prisma.$transaction([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    }),
    prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { role: true },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            members: {
              where: { userId },
              select: { role: true },
              take: 1,
            },
          },
        },
      },
    }),
  ])

  // System super-admin (cross-workspace, dev/owner) → full access everywhere.
  if (user?.role === 'ADMIN') {
    return { allowed: true, role: 'LEAD' }
  }

  const workspaceRole = project?.workspace.members[0]?.role
  if (!workspaceRole) {
    // Not a member of the project's workspace → no access.
    return { allowed: false, role: null }
  }

  const isMember = !!membership
  const minRequired = Math.min(...requiredRole.map((r) => ROLE_HIERARCHY[r]))
  // What does the action need? LEAD(4)=manage, MEMBER(3)=contribute/edit, ≤VIEWER(2)=view.
  const need: 'manage' | 'contribute' | 'view' =
    minRequired >= ROLE_HIERARCHY.LEAD ? 'manage' : minRequired >= ROLE_HIERARCHY.MEMBER ? 'contribute' : 'view'

  // One Above All / BoD → manage everything in the workspace.
  if (workspaceRole === 'ONE_ABOVE_ALL' || workspaceRole === 'BOD') {
    return { allowed: true, role: 'LEAD' }
  }

  // Manager → manage EVERY project in the workspace (member or not), same as BoD for project work.
  if (workspaceRole === 'MANAGER') {
    return { allowed: true, role: 'LEAD' }
  }

  // Staff → only projects they're a member of; can view + contribute, but not manage.
  if (!isMember) {
    return { allowed: false, role: null }
  }
  return need === 'manage' ? { allowed: false, role: 'MEMBER' } : { allowed: true, role: 'MEMBER' }
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
