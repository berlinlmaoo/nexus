import prisma from "./prisma"
import { eventBus, BUS_EVENTS } from "./event-bus"
import { createLogger } from "./logger"

const log = createLogger("complaint-realtime")

export type ComplaintChangedKind = "created" | "status" | "message" | "correction"

/**
 * `complaint-changed` { id, kind } (tickets realtime, 19 Oct 2026) to exactly the people who may open the ticket
 * today (api/complaints GET): its reporter, and every BoD / One Above All of its workspace. Never a workspace or
 * project room: Staff and Managers must not even learn that someone else's ticket moved. Ids only; the board, the
 * counts and an open thread refetch through the API. Never throws: the write it reports already succeeded.
 */
export async function emitComplaintChanged(complaintId: string | null | undefined, kind: ComplaintChangedKind): Promise<void> {
  if (!complaintId) return
  try {
    const complaint = await prisma.complaint.findUnique({ where: { id: complaintId }, select: { reporterId: true, workspaceId: true } })
    if (!complaint) return
    const reviewers = await prisma.workspaceMember.findMany({
      where: { workspaceId: complaint.workspaceId, role: { in: ["BOD", "ONE_ABOVE_ALL"] } },
      select: { userId: true },
    })
    const userIds = Array.from(new Set([complaint.reporterId, ...reviewers.map((r) => r.userId)].filter((x): x is string => !!x)))
    eventBus.emit(BUS_EVENTS.COMPLAINT_CHANGED, { userIds, payload: { id: complaintId, kind } })
  } catch (error) {
    log.warn("complaint-changed failed", { complaintId, error: String(error) })
  }
}
