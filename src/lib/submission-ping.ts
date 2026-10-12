/**
 * Live "My Submissions" (owner, 12 Oct 2026): when a task that a form submission created changes (status,
 * column, handler, comment, Bukti Pencairan), the submitter's open board and detail refetch. The
 * submitter is usually not in the project's room, so the ping goes to their own `user:<id>` room as a
 * `workspace-changed` { kind: "submissions" } — ids only; the board refetches through its API.
 */
import prisma from "@/lib/prisma"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"

export async function pingSubmitter(taskId: string | null | undefined, actorId?: string | null) {
  if (!taskId) return
  try {
    const sub = await prisma.formSubmission.findUnique({ where: { taskId }, select: { submitterId: true } })
    if (!sub?.submitterId) return
    emitWorkspaceChanged(null, { kind: "submissions", ...(actorId ? { actorId } : {}) }, [sub.submitterId])
  } catch {
    // best-effort: a ping never fails the write that caused it
  }
}
