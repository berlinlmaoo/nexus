import prisma from '@/lib/prisma'
import type { ProjectRole } from '@/generated/prisma/client'

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  LEAD: 4,
  MEMBER: 3,
  VIEWER: 2,
  GUEST: 1,
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

  if (user?.role === 'ADMIN') {
    return { allowed: true, role: 'LEAD' }
  }

  const workspaceRole = project?.workspace.members[0]?.role
  if (workspaceRole === 'OWNER' || workspaceRole === 'ADMIN') {
    return { allowed: true, role: 'LEAD' }
  }

  if (!membership) {
    return { allowed: false, role: null }
  }

  const userLevel = ROLE_HIERARCHY[membership.role]
  const minRequired = Math.min(...requiredRole.map((r) => ROLE_HIERARCHY[r]))
  const allowed = userLevel >= minRequired

  return { allowed, role: membership.role }
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
