import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { hasProjectWideAccess } from "@/lib/rbac"
import type { LegalActor } from "@/lib/legal/access"

/** Whoever links: a Legal member, or a requester filling the request form (same visibility rule). */
export type LinkViewer = Pick<LegalActor, "userId" | "orgRole">

// Linking a legal document to a project or a Pipeline deal (owner, 14 Oct 2026). Legal access doesn't widen
// project access: you can link only what you can already open (the rule of lib/rbac.ts projectAccessLevel —
// a PIPELINE board only for its members, other projects for BoD/One Above All or their members).

async function wide(actor: LinkViewer): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { role: true } })
  return user?.role === "ADMIN" || hasProjectWideAccess(actor.orgRole)
}

async function visibleProjects(actor: LinkViewer): Promise<Prisma.ProjectWhereInput> {
  const member = { members: { some: { userId: actor.userId } } }
  if (!(await wide(actor))) return { workspaceId: ORG_WORKSPACE_ID, ...member }
  return { workspaceId: ORG_WORKSPACE_ID, OR: [{ type: { not: "PIPELINE" } }, member] }
}

/** Deals live on PIPELINE boards, which are for their members only. */
async function visibleDeals(actor: LinkViewer): Promise<Prisma.PipelineDealWhereInput> {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { role: true } })
  if (user?.role === "ADMIN") return { project: { workspaceId: ORG_WORKSPACE_ID } }
  return { project: { workspaceId: ORG_WORKSPACE_ID, members: { some: { userId: actor.userId } } } }
}

export async function searchLinks(actor: LinkViewer, q: string) {
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
export async function linkProblem(actor: LinkViewer, projectId?: string | null, dealId?: string | null): Promise<string | null> {
  if (projectId && !(await prisma.project.count({ where: { AND: [{ id: projectId }, await visibleProjects(actor)] } }))) return "Project not found"
  if (dealId && !(await prisma.pipelineDeal.count({ where: { AND: [{ id: dealId }, await visibleDeals(actor)] } }))) return "Deal not found"
  return null
}

/**
 * A document's project / deal as this viewer may see it: a link they can't open shows as hidden
 * (`linkHidden`), never by name — a Legal member who isn't on a Pipeline board learns nothing about its deals.
 */
export async function redactLinks<T extends { project: { id: string } | null; deal: { id: string } | null }>(actor: LinkViewer, docs: T[]): Promise<(T & { linkHidden: boolean })[]> {
  const projectIds = [...new Set(docs.map((d) => d.project?.id).filter((x): x is string => !!x))]
  const dealIds = [...new Set(docs.map((d) => d.deal?.id).filter((x): x is string => !!x))]
  const [projects, deals] = await Promise.all([
    projectIds.length ? prisma.project.findMany({ where: { AND: [{ id: { in: projectIds } }, await visibleProjects(actor)] }, select: { id: true } }) : [],
    dealIds.length ? prisma.pipelineDeal.findMany({ where: { AND: [{ id: { in: dealIds } }, await visibleDeals(actor)] }, select: { id: true } }) : [],
  ])
  const okP = new Set(projects.map((p) => p.id))
  const okD = new Set(deals.map((d) => d.id))
  return docs.map((d) => {
    const project = d.project && okP.has(d.project.id) ? d.project : null
    const deal = d.deal && okD.has(d.deal.id) ? d.deal : null
    return { ...d, project, deal, linkHidden: (!!d.project && !project) || (!!d.deal && !deal) }
  })
}
