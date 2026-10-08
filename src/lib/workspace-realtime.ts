import prisma from "./prisma"
import { createLogger } from "./logger"
import { emitWorkspaceChanged } from "./socket-emitter"

const log = createLogger("workspace-realtime")

/**
 * `workspace-changed` { kind: "projects", projectId } for a project whose workspace the caller does not
 * have at hand (member and invite routes, team sync, restore). One indexed lookup, and never throws: the
 * write it reports has already succeeded, and a missed ping must not turn that into an error.
 *
 * `userIds` also pings those users' own rooms. Pass the people whose access changed: someone added to a
 * project as a guest is usually not in its workspace, so the workspace room alone would miss them.
 */
export async function emitProjectChanged(
  projectId: string,
  opts: { actorId?: string; userIds?: Array<string | null | undefined> } = {},
): Promise<void> {
  try {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
    emitWorkspaceChanged(project?.workspaceId, { kind: "projects", projectId, actorId: opts.actorId }, opts.userIds)
  } catch (error) {
    log.warn("workspace-changed: could not look up the project's workspace", { projectId, error: String(error) })
  }
}
