import prisma from '@/lib/prisma'
import type { ProjectRole } from '@/generated/prisma/client'

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  LEAD: 4,
  MEMBER: 3,
  VIEWER: 2,
  GUEST: 1,
}

export async function checkProjectAccess(
  userId: string,
  projectId: string,
  requiredRole: ProjectRole[]
): Promise<{ allowed: boolean; role: ProjectRole | null }> {
  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { role: true },
  })

  if (!membership) {
    return { allowed: false, role: null }
  }

  const userLevel = ROLE_HIERARCHY[membership.role]
  const minRequired = Math.min(...requiredRole.map((r) => ROLE_HIERARCHY[r]))
  const allowed = userLevel >= minRequired

  return { allowed, role: membership.role }
}
