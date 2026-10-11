import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID } from "@/lib/org"

/**
 * Who may see the Pipeline Dashboard (owner, 9 Oct 2026, evening — replaces the BoD + Agency + IT/Legal/
 * Finance rule of that afternoon): "akses project pipelinenya kaya nambah orang biasa aja di task project
 * yg perlu di add manual per project", "aksesnya yg tentuin yg buat project pipelinenya", "yg bisa buka
 * chat dan project nya yg di add didalem projectnya doang".
 *
 * So the board is an ordinary project for access: checkProjectAccess decides every route, the socket's
 * project room and the project's chat room, exactly as for a task project, and its lead adds people as
 * project members from the usual member screen. Nothing here grants access; this file only answers what
 * the clients need to draw the "Pipeline" nav entry and the New project picker.
 */

/**
 * The company's one Pipeline board (owner/GM, 9 Oct 2026: "cuma satu papan/pipeline utama buat semua deal,
 * lintas BD dan brand"). The oldest PIPELINE project of the company workspace; null until it is created.
 */
export async function companyPipelineProject(): Promise<{ id: string; name: string } | null> {
  return prisma.project.findFirst({
    where: { workspaceId: ORG_WORKSPACE_ID, type: "PIPELINE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  })
}

/**
 * The two flags of GET /api/workspaces/members (names kept so clients need no change):
 * - canAccessPipeline: may pick "Pipeline Dashboard" in New project — anyone in the company workspace.
 * - pipelineProjectId: always null since boards are no longer one per company (owner, 11 Oct 2026).
 *   Clients used it to OPEN the existing board instead of creating one; null makes them create.
 */
export async function pipelineFlags(userId: string): Promise<{ canAccessPipeline: boolean; pipelineProjectId: string | null }> {
  const inCompany = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: ORG_WORKSPACE_ID } },
    select: { id: true },
  })
  return { canAccessPipeline: !!inCompany, pipelineProjectId: null }
}
