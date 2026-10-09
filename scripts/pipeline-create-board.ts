/**
 * Creates the company's one Pipeline board, "Control Tower TZN" (owner/GM, 9 Oct 2026: "Desainnya cuma satu
 * papan/pipeline utama buat semua deal, lintas BD dan brand"), in the company workspace — the same project
 * POST /api/projects { type: "PIPELINE" } makes, for running once on a server before anyone opens the app.
 *
 * Owner (project LEAD): the user with --owner (default bagasputro.bp@gmail.com) when they are in the company
 * workspace, else its One Above All. Idempotent: when the workspace already has a PIPELINE project, that one
 * is printed and nothing is written. --dry-run only prints what it would do. Prints the project id last,
 * for scripts/pipeline-import-gm.ts --project <id>.
 *
 * Run like pipeline-import-gm.ts (nexus-builder image, --network container:nexus-postgres, DATABASE_URL).
 */
import prisma from "../src/lib/prisma"
import { ORG_WORKSPACE_ID } from "../src/lib/org"

const BOARD_NAME = "Control Tower TZN"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const ownerEmail = arg("owner") ?? "bagasputro.bp@gmail.com"
  const dryRun = process.argv.includes("--dry-run")

  const workspace = await prisma.workspace.findUnique({ where: { id: ORG_WORKSPACE_ID }, select: { id: true, name: true } })
  if (!workspace) throw new Error(`company workspace ${ORG_WORKSPACE_ID} not found`)

  const existing = await prisma.project.findFirst({
    where: { workspaceId: ORG_WORKSPACE_ID, type: "PIPELINE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  })
  if (existing) {
    console.log(`already there: "${existing.name}" in ${workspace.name}`)
    console.log(existing.id)
    return
  }

  const byEmail = await prisma.workspaceMember.findFirst({
    where: { workspaceId: ORG_WORKSPACE_ID, user: { email: { equals: ownerEmail, mode: "insensitive" } } },
    select: { userId: true, user: { select: { name: true, email: true } } },
  })
  const owner = byEmail ?? await prisma.workspaceMember.findFirst({
    where: { workspaceId: ORG_WORKSPACE_ID, role: "ONE_ABOVE_ALL" },
    orderBy: { joinedAt: "asc" },
    select: { userId: true, user: { select: { name: true, email: true } } },
  })
  if (!owner) throw new Error("no owner: neither --owner nor a One Above All is in the company workspace")

  console.log(`${dryRun ? "[dry run] would create" : "creating"} "${BOARD_NAME}" (PIPELINE) in ${workspace.name}, owner ${owner.user.name} <${owner.user.email}>`)
  if (dryRun) return

  const project = await prisma.project.create({
    data: {
      name: BOARD_NAME,
      description: "Papan pipeline perusahaan: semua deal, lintas BD dan brand.",
      type: "PIPELINE",
      workspaceId: ORG_WORKSPACE_ID,
      members: { create: { userId: owner.userId, role: "LEAD" } },
      // The three default sections every project gets: an app that does not know PIPELINE opens it as an
      // ordinary, empty task project (spec §1).
      taskLists: { create: [{ name: "To Do", position: 0 }, { name: "In Progress", position: 1 }, { name: "Done", position: 2 }] },
    },
    select: { id: true },
  })
  await prisma.auditLog.create({
    data: { action: "create", entityType: "project", entityId: project.id, entityName: BOARD_NAME, userId: owner.userId, metadata: { type: "PIPELINE", source: "pipeline-create-board" } },
  })
  console.log(project.id)
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
