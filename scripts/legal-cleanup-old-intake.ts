/**
 * Removes what the retired Legal document generator left in the Legal project (owner, 14 Oct 2026: "sisa
 * nganggur … custom field legalcf_* & form legalform_* di project Legal dibersihin"): the custom fields with
 * id `legalcf_*` and the intake forms with id `legalform_*` that scripts/legal-forms-sql.ts (deleted in
 * ddae1199) created. Only those deterministic ids are touched — a field or form someone made by hand is not.
 *
 * Each one goes through restorableDelete, exactly like deleting it in the app: a DeletionSnapshot with every
 * task's value / every submission, restorable from Control Room → Audit. Default is a dry run that lists what
 * would go; pass --apply to delete. --actor <email> is who the audit rows name
 * (default env NEXUS_OWNER_EMAIL; one of the two is required).
 *
 * Run like scripts/pipeline-create-board.ts (nexus-builder image, --network container:nexus-postgres,
 * DATABASE_URL): npx tsx scripts/legal-cleanup-old-intake.ts [--apply] [--actor email]
 *
 * Not touched here: the GOOGLE_DOCS_* variables in the server's env files (remove them there), and the
 * Legal project's sections (they hold tasks).
 */
import prisma from "../src/lib/prisma"
import { restorableDelete } from "../src/lib/deletion-snapshot"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const apply = process.argv.includes("--apply")
  const actorEmail = arg("actor") ?? process.env.NEXUS_OWNER_EMAIL
  if (!actorEmail) throw new Error("usage: [--apply] --actor <email> (or set NEXUS_OWNER_EMAIL)")
  const actor = await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true } })
  if (!actor) throw new Error(`actor ${actorEmail} not found`)

  const [fields, forms] = await Promise.all([
    prisma.customField.findMany({
      where: { id: { startsWith: "legalcf_" } },
      select: { id: true, name: true, projectId: true, project: { select: { name: true, workspaceId: true } }, _count: { select: { values: true } } },
    }),
    prisma.form.findMany({
      where: { id: { startsWith: "legalform_" } },
      select: { id: true, name: true, projectId: true, project: { select: { name: true, workspaceId: true } }, _count: { select: { submissions: true } } },
    }),
  ])
  for (const f of fields) console.log(`custom field ${f.id} "${f.name}" in "${f.project.name}" — ${f._count.values} values`)
  for (const f of forms) console.log(`form ${f.id} "${f.name}" in "${f.project.name}" — ${f._count.submissions} submissions`)
  if (!fields.length && !forms.length) {
    console.log("nothing left to clean")
    return
  }
  if (!apply) {
    console.log("dry run: pass --apply to delete these (restorable from Control Room → Audit)")
    return
  }
  for (const f of forms) {
    await restorableDelete({
      entityType: "form", entityId: f.id, entityName: f.name, workspaceId: f.project.workspaceId, userId: actor.id,
      metadata: { submissionCount: f._count.submissions, projectId: f.projectId, reason: "old Legal intake" },
      meta: { open: { type: "form", id: f.id, projectId: f.projectId }, projectId: f.projectId },
      remove: (tx) => tx.form.delete({ where: { id: f.id } }),
    })
    console.log(`deleted form ${f.id}`)
  }
  for (const f of fields) {
    await restorableDelete({
      entityType: "custom_field", entityId: f.id, entityName: f.name, workspaceId: f.project.workspaceId, userId: actor.id,
      metadata: { projectId: f.projectId, reason: "old Legal intake" },
      meta: { open: { type: "project", id: f.projectId }, projectId: f.projectId },
      remove: (tx) => tx.customField.delete({ where: { id: f.id } }),
    })
    console.log(`deleted custom field ${f.id}`)
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
