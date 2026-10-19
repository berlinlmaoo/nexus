import prisma from "@/lib/prisma"

/**
 * Position for a new page (Doc): one past the highest among its siblings, so it lands at the bottom and
 * the order stays fixed (A-26, owner 19 Oct 2026). Lists sort by position, then createdAt.
 */
export async function nextDocPosition(projectId: string, parentId: string | null): Promise<number> {
  const last = await prisma.doc.findFirst({
    where: { projectId, parentId },
    orderBy: { position: "desc" },
    select: { position: true },
  })
  return (last?.position ?? -1) + 1
}
