import prisma from "@/lib/prisma"

/**
 * Nested project folders form a tree via ProjectFolder.parentFolderId. We cap the tree at
 * MAX_FOLDER_DEPTH levels (root = 1) and forbid cycles. These helpers do small, depth-bounded walks
 * — fine for an interactive sidebar (a workspace has tens of folders, not millions).
 */
export const MAX_FOLDER_DEPTH = 3

/** Depth of a folder: 1 for a root folder, +1 per ancestor. */
export async function folderDepth(folderId: string): Promise<number> {
  let depth = 1
  let cursor = folderId
  const seen = new Set<string>()
  while (true) {
    if (seen.has(cursor)) break // defensive against a pre-existing cycle
    seen.add(cursor)
    const row = await prisma.projectFolder.findUnique({
      where: { id: cursor },
      select: { parentFolderId: true },
    })
    const parentId: string | null = row?.parentFolderId ?? null
    if (!parentId) break
    depth++
    cursor = parentId
    if (depth > MAX_FOLDER_DEPTH + 3) break // hard stop, never loop forever
  }
  return depth
}

/** Height of the subtree rooted at folderId: 1 for a leaf folder, +1 per nesting level below it. */
export async function folderSubtreeHeight(folderId: string): Promise<number> {
  const children = await prisma.projectFolder.findMany({
    where: { parentFolderId: folderId },
    select: { id: true },
  })
  if (children.length === 0) return 1
  let maxChild = 0
  for (const child of children) {
    maxChild = Math.max(maxChild, await folderSubtreeHeight(child.id))
  }
  return 1 + maxChild
}

/** All descendant folder ids of a folder (used to prevent moving a folder into its own subtree). */
export async function folderDescendantIds(folderId: string): Promise<Set<string>> {
  const out = new Set<string>()
  const stack = [folderId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    const children = await prisma.projectFolder.findMany({
      where: { parentFolderId: id },
      select: { id: true },
    })
    for (const child of children) {
      if (!out.has(child.id)) {
        out.add(child.id)
        stack.push(child.id)
      }
    }
  }
  return out
}

/**
 * Validate placing/moving a folder subtree under `parentFolderId`. Returns an error string if it would
 * break the rules, or null if OK. `movingFolderId` is set when MOVING an existing folder (so we can
 * check cycles + the subtree's height); omit it when CREATING a brand-new (height-1) folder.
 */
export async function validateFolderPlacement(opts: {
  workspaceId: string
  parentFolderId: string | null
  movingFolderId?: string
}): Promise<string | null> {
  const { workspaceId, parentFolderId, movingFolderId } = opts
  if (!parentFolderId) return null // moving to root is always allowed

  if (movingFolderId && parentFolderId === movingFolderId) {
    return "Folder tidak bisa dipindah ke dalam dirinya sendiri."
  }

  const parent = await prisma.projectFolder.findUnique({
    where: { id: parentFolderId },
    select: { id: true, workspaceId: true },
  })
  if (!parent || parent.workspaceId !== workspaceId) {
    return "Folder tujuan tidak ditemukan di workspace ini."
  }

  if (movingFolderId) {
    const descendants = await folderDescendantIds(movingFolderId)
    if (descendants.has(parentFolderId)) {
      return "Folder tidak bisa dipindah ke dalam subfolder-nya sendiri."
    }
  }

  const parentDepth = await folderDepth(parentFolderId)
  const subtreeHeight = movingFolderId ? await folderSubtreeHeight(movingFolderId) : 1
  if (parentDepth + subtreeHeight > MAX_FOLDER_DEPTH) {
    return `Maksimal ${MAX_FOLDER_DEPTH} level folder — pemindahan ini akan melebihi batas.`
  }

  return null
}
