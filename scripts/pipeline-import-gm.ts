/**
 * Imports the GM's 41 deals ("Control Tower TZN" seed, TZN-26001…) into the company's Pipeline board
 * (owner/GM, 9 Oct 2026: "Import the 41 deals into that board, each in its current stage").
 *
 * Every deal keeps the GM's code, stage, values, statuses, dates and notes exactly as his file has them —
 * an option NEXUS does not offer (his "Not Assessed" vendor registration) is kept and shown as-is. His BD /
 * PM are placeholders ("BD 1", "PM 2"), so they go into the free-text bdName / pmName and nobody is
 * guessed; the team picks the real people on each deal later. No execution projects are made: these deals
 * came in already won, and "Create execution project" on a deal makes one when it is wanted.
 *
 * Idempotent: a code already on the board is skipped, so a second run adds nothing. Each new deal gets the
 * same "create" audit row a deal made in the app gets (nextDealCode reads them), by the --actor.
 *
 *   docker run --rm -v ~/nexus:/w:ro -v <seed dir>:/seed:ro --network container:nexus-postgres \
 *     -e PGHOST=127.0.0.1 -e PGUSER=… -e PGPASSWORD=… -e DATABASE_URL=postgresql:///<db> \
 *     --entrypoint sh nexus-builder:latest -c 'cp -r /w /t && cd /t && rm -rf node_modules && ln -s /app/node_modules node_modules \
 *       && npx prisma generate >/dev/null && npx tsx scripts/pipeline-import-gm.ts --project <id> --seed /seed/s3.js [--actor <email>] [--dry-run]'
 */
import prisma from "../src/lib/prisma"
import { PIPELINE_STAGES, SERVICE_OPTIONS, CONTRACT_STATUS_OPTIONS, VREG_STATUS_OPTIONS, READINESS_OPTIONS,
  DELIVERABLE_STATUS_OPTIONS, DELIVERABLE_RISK_OPTIONS, PAYMENT_STATUS_OPTIONS, CLOSING_STATUS_OPTIONS } from "../src/lib/pipeline"
import { readFileSync } from "node:fs"

type SeedDeal = {
  id: string; name: string; brand?: string; service?: string; bd?: string; pm?: string; stage: string; prob?: number
  contractValue?: number; netValue?: number; invoiceValue?: number; contractStatus?: string; vregStatus?: string
  readiness?: string; deliverableStatus?: string; deliverableRisk?: string; paymentStatus?: string
  outstandingReceivable?: number; maxDaysOverdue?: number; netCash?: number; closingStatus?: string
  mainDate?: string | null; nextAction?: string; nextActionDate?: string | null; blocker?: string; notes?: string
  paymentDueDate?: string | null
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** The seed is the GM page's embedded JSON; tolerate a `var x = …;` wrapper around it. */
function readSeed(path: string): SeedDeal[] {
  const raw = readFileSync(path, "utf8")
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
  const parsed = JSON.parse(json) as { projects?: SeedDeal[] }
  if (!Array.isArray(parsed.projects)) throw new Error("seed has no `projects` array")
  return parsed.projects
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const day = (v: unknown): Date | null => (typeof v === "string" && DATE_RE.test(v) ? new Date(`${v}T00:00:00.000Z`) : null)
const money = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0)
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const optText = (v: unknown): string | null => text(v) || null

async function main() {
  const projectId = arg("project")
  const seedPath = arg("seed")
  const actorEmail = arg("actor") ?? "bagasputro.bp@gmail.com"
  const dryRun = process.argv.includes("--dry-run")
  if (!projectId || !seedPath) throw new Error("usage: --project <pipeline project id> --seed <s3.js> [--actor <email>] [--dry-run]")

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, type: true } })
  if (!project) throw new Error(`project ${projectId} not found`)
  if (project.type !== "PIPELINE") throw new Error(`project "${project.name}" is ${project.type}, not PIPELINE`)
  const actor = await prisma.user.findFirst({ where: { email: { equals: actorEmail, mode: "insensitive" } }, select: { id: true, name: true } })
  if (!actor) throw new Error(`actor ${actorEmail} not found`)

  const seed = readSeed(seedPath)
  const existing = new Set((await prisma.pipelineDeal.findMany({ where: { projectId }, select: { code: true } })).map((d) => d.code))

  // Values outside NEXUS's option lists are kept (the board shows them as-is); listed so nobody is surprised.
  const lists: Record<string, readonly string[]> = {
    stage: PIPELINE_STAGES, service: SERVICE_OPTIONS, contractStatus: CONTRACT_STATUS_OPTIONS, vregStatus: VREG_STATUS_OPTIONS,
    readiness: READINESS_OPTIONS, deliverableStatus: DELIVERABLE_STATUS_OPTIONS, deliverableRisk: DELIVERABLE_RISK_OPTIONS,
    paymentStatus: PAYMENT_STATUS_OPTIONS, closingStatus: CLOSING_STATUS_OPTIONS,
  }
  const offList = new Map<string, number>()

  // Appended after whatever each column already holds, in the GM's order.
  const lastPos = new Map<string, number>()
  for (const s of PIPELINE_STAGES) {
    const last = await prisma.pipelineDeal.findFirst({ where: { projectId, stage: s }, orderBy: { position: "desc" }, select: { position: true } })
    lastPos.set(s, last?.position ?? 0)
  }

  let added = 0
  let skipped = 0
  for (const d of seed) {
    const code = text(d.id)
    if (!/^TZN-\d{5}$/.test(code)) { console.warn(`skip: bad code ${JSON.stringify(d.id)}`); skipped++; continue }
    if (existing.has(code)) { skipped++; continue }
    if (!(PIPELINE_STAGES as readonly string[]).includes(d.stage)) throw new Error(`${code}: unknown stage ${JSON.stringify(d.stage)}`)
    for (const [field, options] of Object.entries(lists)) {
      const v = (d as Record<string, unknown>)[field]
      if (typeof v === "string" && v && !options.includes(v)) offList.set(`${field}=${v}`, (offList.get(`${field}=${v}`) ?? 0) + 1)
    }
    const position = (lastPos.get(d.stage) ?? 0) + 1024
    lastPos.set(d.stage, position)
    const data = {
      projectId, code, position,
      name: text(d.name).slice(0, 200) || code,
      brand: text(d.brand),
      service: text(d.service) || "Other",
      bdName: optText(d.bd),
      pmName: optText(d.pm),
      stage: d.stage,
      probability: typeof d.prob === "number" && d.prob >= 0 && d.prob <= 1 ? d.prob : 0.1,
      contractValue: money(d.contractValue),
      netValue: money(d.netValue),
      invoiceValue: money(d.invoiceValue),
      contractStatus: text(d.contractStatus) || "Not Started",
      vregStatus: text(d.vregStatus) || "Not Required",
      readiness: text(d.readiness) || "N/A",
      deliverableStatus: text(d.deliverableStatus) || "Not Started",
      deliverableRisk: text(d.deliverableRisk) || "Aman",
      paymentStatus: text(d.paymentStatus) || "Not Yet",
      outstandingReceivable: money(d.outstandingReceivable),
      paymentDueDate: day(d.paymentDueDate),
      maxDaysOverdue: typeof d.maxDaysOverdue === "number" && d.maxDaysOverdue >= 0 ? Math.round(d.maxDaysOverdue) : 0,
      netCash: money(d.netCash),
      closingStatus: text(d.closingStatus) || "Not Ready",
      mainDate: day(d.mainDate),
      nextAction: text(d.nextAction),
      nextActionDate: day(d.nextActionDate),
      blocker: text(d.blocker),
      notes: text(d.notes),
      createdById: actor.id,
      updatedById: actor.id,
    }
    if (dryRun) { console.log(`would add ${code} ${data.stage} — ${data.name}`); added++; continue }
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.pipelineDeal.create({ data, select: { id: true, code: true, name: true } })
      await tx.auditLog.create({
        data: {
          action: "create", entityType: "pipeline_deal", entityId: row.id, entityName: `${row.code} ${row.name}`,
          userId: actor.id, metadata: { projectId, code: row.code, stage: data.stage, source: "gm-seed" },
        },
      })
      return row
    })
    console.log(`added ${created.code} ${data.stage} — ${created.name}`)
    added++
  }
  for (const [k, n] of offList) console.log(`note: kept value outside NEXUS's list: ${k} (${n}×)`)
  console.log(`${dryRun ? "[dry run] " : ""}project "${project.name}" (${projectId}): ${added} added, ${skipped} already there or skipped, seed ${seed.length}`)
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
