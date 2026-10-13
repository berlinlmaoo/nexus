import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { hasProjectWideAccess } from "@/lib/rbac"
import type { LegalActor } from "@/lib/legal/access"

// Linking a legal document to a project or a Pipeline deal (owner, 14 Oct 2026). Legal access doesn't widen
// project access: you can link only what you can already open (the rule of lib/rbac.ts projectAccessLevel —
// a PIPELINE board only for its members, other projects for BoD/One Above All or their members).

async function wide(actor: LegalActor): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { role: true } })
  return user?.role === "ADMIN" || hasProjectWideAccess(actor.orgRole)
}

async function visibleProjects(actor: LegalActor): Promise<Prisma.ProjectWhereInput> {
  const member = { members: { some: { userId: actor.userId } } }
  if (!(await wide(actor))) return { workspaceId: ORG_WORKSPACE_ID, ...member }
  return { workspaceId: ORG_WORKSPACE_ID, OR: [{ type: { not: "PIPELINE" } }, member] }
}

/** Deals live on PIPELINE boards, which are for their members only. */
async function visibleDeals(actor: LegalActor): Promise<Prisma.PipelineDealWhereInput> {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { role: true } })
  if (user?.role === "ADMIN") return { project: { workspaceId: ORG_WORKSPACE_ID } }
  return { project: { workspaceId: ORG_WORKSPACE_ID, members: { some: { userId: actor.userId } } } }
}

export async function searchLinks(actor: LegalActor, q: string) {
  const needle = q.trim().slice(0, 100)
  const [projects, deals] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [await visibleProjects(actor), { type: { not: "PIPELINE" } }, needle ? { name: { contains: needle, mode: "insensitive" } } : {}] },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
    prisma.pipelineDeal.findMany({
      where: {
        AND: [
          await visibleDeals(actor),
          needle ? { OR: [{ name: { contains: needle, mode: "insensitive" } }, { code: { contains: needle, mode: "insensitive" } }, { brand: { contains: needle, mode: "insensitive" } }] } : {},
        ],
      },
      select: { id: true, code: true, name: true, brand: true, projectId: true },
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
  ])
  return { projects, deals }
}

/** Null when the actor may link it, else why not. `undefined`/null ids are always fine (no link). */
export async function linkProblem(actor: LegalActor, projectId?: string | null, dealId?: string | null): Promise<string | null> {
  if (projectId && !(await prisma.project.count({ where: { AND: [{ id: projectId }, await visibleProjects(actor)] } }))) return "Project not found"
  if (dealId && !(await prisma.pipelineDeal.count({ where: { AND: [{ id: dealId }, await visibleDeals(actor)] } }))) return "Deal not found"
  return null
}
