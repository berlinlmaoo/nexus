import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID } from "@/lib/org"

export async function getAdminAccessContext(userId: string) {
  const [user, workspaceMemberships] = await prisma.$transaction([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
      },
    }),
    prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          select: { id: true, name: true, slug: true },
        },
      },
      orderBy: { joinedAt: "asc" },
    }),
  ])

  const isSystemAdmin = user?.role === "ADMIN"
  // Company-level admin rights come from the role in the COMPANY workspace only. A role in any
  // other workspace (e.g. the personal workspace every sign-up owns as ONE_ABOVE_ALL) grants none.
  const orgRole = workspaceMemberships.find((membership) => membership.workspaceId === ORG_WORKSPACE_ID)?.role ?? null
  const isWorkspaceAdmin = orgRole === "BOD" || orgRole === "MANAGER" || orgRole === "ONE_ABOVE_ALL"

  return {
    user,
    workspaceMemberships,
    primaryWorkspaceMembership: workspaceMemberships[0] ?? null,
    isSystemAdmin,
    isWorkspaceAdmin,
    orgRole,
    canAccessUserManagement: Boolean(user && (isSystemAdmin || isWorkspaceAdmin)),
  }
}

export async function requireAdminPageAccess() {
  const session = await auth().catch(() => null)

  if (!session?.user?.id) {
    redirect("/login")
  }

  const context = await getAdminAccessContext(session.user.id)

  if (!context.user) {
    redirect("/login")
  }

  if (!context.canAccessUserManagement) {
    redirect("/dashboard")
  }

  return {
    session,
    context,
  }
}

export async function getAdminSessionContext() {
  const session = await auth().catch(() => null)

  if (!session?.user?.id) {
    return { session: null, context: null }
  }

  const context = await getAdminAccessContext(session.user.id)

  if (!context.user) {
    return { session, context: null }
  }

  return { session, context }
}
