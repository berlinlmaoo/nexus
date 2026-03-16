import prisma from '@/lib/prisma'

/**
 * Check if user is a guest on a project. Returns true if user is a GUEST
 * and should be blocked from write operations.
 */
export async function isGuestUser(
  userId: string,
  projectId: string
): Promise<boolean> {
  const membership = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: { userId, projectId },
    },
    select: { role: true },
  })

  return membership?.role === 'GUEST'
}

/**
 * Check if the user has at least the given role on a project.
 * Role hierarchy: LEAD > MEMBER > VIEWER > GUEST
 */
export async function hasProjectRole(
  userId: string,
  projectId: string,
  minRole: 'LEAD' | 'MEMBER' | 'VIEWER' | 'GUEST'
): Promise<boolean> {
  const membership = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: { userId, projectId },
    },
    select: { role: true },
  })

  if (!membership) return false

  const hierarchy = { LEAD: 4, MEMBER: 3, VIEWER: 2, GUEST: 1 }
  return hierarchy[membership.role] >= hierarchy[minRole]
}
