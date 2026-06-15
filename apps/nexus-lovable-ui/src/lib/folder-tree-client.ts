import type { NexusProjectFolder } from "@/lib/nexus-api";

export const MAX_FOLDER_DEPTH = 3;

/** "Grandparent / Parent / Folder" breadcrumb for a folder (for move-target labels). */
export function folderPath(folder: NexusProjectFolder, byId: Map<string, NexusProjectFolder>): string {
  const parts: string[] = [];
  let cur: NexusProjectFolder | undefined = folder;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentFolderId ? byId.get(cur.parentFolderId) : undefined;
  }
  return parts.join(" / ");
}

/** All folders nested anywhere under folderId. */
export function descendantFolderIds(folderId: string, folders: NexusProjectFolder[]): Set<string> {
  const out = new Set<string>();
  const stack = [folderId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const f of folders) {
      if ((f.parentFolderId ?? null) === id && !out.has(f.id)) {
        out.add(f.id);
        stack.push(f.id);
      }
    }
  }
  return out;
}

/** Depth of a folder: 1 for a root folder, +1 per ancestor. */
export function folderDepthOf(folderId: string, byId: Map<string, NexusProjectFolder>): number {
  let depth = 1;
  let cur = byId.get(folderId);
  const seen = new Set<string>();
  while (cur && cur.parentFolderId && !seen.has(cur.id)) {
    seen.add(cur.id);
    depth++;
    cur = byId.get(cur.parentFolderId);
  }
  return depth;
}

/** Height of the subtree rooted at folderId: 1 for a leaf, +1 per nesting level below. */
export function folderHeightOf(folderId: string, folders: NexusProjectFolder[]): number {
  const children = folders.filter((f) => (f.parentFolderId ?? null) === folderId);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((c) => folderHeightOf(c.id, folders)));
}

/**
 * Can a dragged item move into `targetFolderId` (null = root)? Projects can go anywhere; a folder
 * can't go into itself / its own subtree, and the result must stay within MAX_FOLDER_DEPTH.
 */
export function canMoveInto(
  drag: { kind: "project" | "folder"; id: string },
  targetFolderId: string | null,
  folders: NexusProjectFolder[],
): boolean {
  if (drag.kind === "project") return true;
  if (targetFolderId === null) return true;
  if (targetFolderId === drag.id) return false;
  if (descendantFolderIds(drag.id, folders).has(targetFolderId)) return false;
  const byId = new Map(folders.map((f) => [f.id, f]));
  return folderDepthOf(targetFolderId, byId) + folderHeightOf(drag.id, folders) <= MAX_FOLDER_DEPTH;
}
