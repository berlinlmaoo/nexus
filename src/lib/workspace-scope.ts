import prisma from "@/lib/prisma"

/**
 * Get the workspace IDs a user belongs to.
 * Used to enforce workspace-level data isolation.
 */
export async function getUserWorkspaceIds(userId: string): Promise<string[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { workspaceId: true },
  })
  return memberships.map((m) => m.workspaceId)
}

/**
 * Check if a user has access to a specific workspace.
 */
export async function checkWorkspaceAccess(
  userId: string,
  workspaceId: string
): Promise<{ allowed: boolean; role: string | null }> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  })

  if (!membership) {
    return { allowed: false, role: null }
  }

  return { allowed: true, role: membership.role }
}

/**
 * Verify that a project belongs to one of the user's workspaces.
 * Prevents cross-workspace data access.
 */
export async function verifyProjectWorkspaceAccess(
  userId: string,
  projectId: string
): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true },
  })

  if (!project) return false

  const { allowed } = await checkWorkspaceAccess(userId, project.workspaceId)
  return allowed
}

/**
 * Get workspace-scoped filter for Prisma queries.
 * Ensures queries only return data from workspaces the user belongs to.
 *
 * Usage:
 *   const scope = await getWorkspaceScope(userId)
 *   const goals = await prisma.goal.findMany({
 *     where: { ...scope.goal, ...otherFilters },
 *   })
 */
export async function getWorkspaceScope(userId: string) {
  const workspaceIds = await getUserWorkspaceIds(userId)

  return {
    project: { workspaceId: { in: workspaceIds } },
    goal: { workspaceId: { in: workspaceIds } },
    team: { workspaceId: { in: workspaceIds } },
    portfolio: { workspaceId: { in: workspaceIds } },
    task: {
      taskList: {
        project: { workspaceId: { in: workspaceIds } },
      },
    },
    doc: {
      project: { workspaceId: { in: workspaceIds } },
    },
    workspaceIds,
  }
}
