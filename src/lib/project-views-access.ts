import { checkProjectAccess } from "@/lib/rbac"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"
import { emitProjectChanged } from "@/lib/workspace-realtime"

/**
 * Who may do what with a project's saved views (owner, 12 Oct 2026):
 *  - read the shared views, and make / change / delete one's OWN personal views: anyone who can open the
 *    project (guests and viewers too — a personal view changes nothing anyone else sees);
 *  - add, change, reorder or delete a SHARED view: project members and above (the same bar as editing
 *    tasks and sections). Viewers and guests can still filter and sort on screen, they just cannot save
 *    it for everyone.
 */
export async function viewAccess(userId: string, projectId: string): Promise<{ read: boolean; editShared: boolean }> {
  const read = await checkProjectAccess(userId, projectId, ["GUEST"])
  if (!read.allowed) return { read: false, editShared: false }
  const edit = await checkProjectAccess(userId, projectId, ["MEMBER"])
  return { read: true, editShared: edit.allowed }
}

/**
 * Realtime: a shared view changed → every open copy of the project refetches its views (workspace room,
 * `workspace-changed` { kind: "projects", projectId }); a personal view → only the owner's other tabs and
 * devices (their own user room). The web keys views under ["nexus", "project-views", projectId], which the
 * ping's project invalidation covers (lib/invalidate.ts). Apps that do not know views just refetch the
 * project, as for any project ping.
 */
export function notifyViewsChanged(projectId: string, actorId: string, shared: boolean) {
  if (shared) void emitProjectChanged(projectId, { actorId })
  else emitWorkspaceChanged(null, { kind: "projects", projectId, actorId }, [actorId])
}
