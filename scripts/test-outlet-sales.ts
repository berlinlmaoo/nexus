/**
 * Outlet Sales Dashboard (owner, 10 Oct 2026): rules + the writes the API runs, against a TEST database.
 *   sh /tmp/pl-run.sh nexus_rt_20261008 scripts/test-outlet-sales.ts
 * Makes its own project (and removes it at the end). Never point it at production.
 */
import prisma from "../src/lib/prisma"
import { checkCreatableProjectType } from "../src/lib/project-tabs"
import { monthBounds, pctOf, statusOf, sumFilled, summarizeMonth, outletToday } from "../src/lib/outlet-sales"
import {
  canManageOutletTargets,
  createOutletEvent,
  deleteOutletEvent,
  loadOutletMonth,
  outletGate,
  parseEventFields,
  putOutletTarget,
  updateOutletEvent,
} from "../src/lib/outlet-sales-server"
import { restoreDeletion } from "../src/lib/deletion-snapshot"

if (/nexus_db\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run against nexus_db")

let pass = 0, fail = 0
const ck = (n: string, a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b) ? (pass++, console.log(`  ok   ${n}`))
    : (fail++, console.log(`  FAIL ${n}\n    got =${JSON.stringify(a)}\n    want=${JSON.stringify(b)}`))

async function main() {
  // ── Pure rules ──
  ck("pct 2.000.000/2.000.000 = 100", pctOf(2_000_000, 2_000_000), 100)
  ck("pct 3000/6000 = 50", pctOf(3000, 6000), 50)
  ck("pct 8jt/20jt = 40", pctOf(8_000_000, 20_000_000), 40)
  ck("pct rounds down (1.999.999/2.000.000 = 99)", pctOf(1_999_999, 2_000_000), 99)
  ck("pct over target", pctOf(2_500_000, 2_000_000), 125)
  ck("pct no target = null", pctOf(5, null), null)
  ck("pct target 0 = null", pctOf(5, 0), null)
  ck("pct nothing filled = null", pctOf(null, 10), null)
  ck("sumFilled none = null", sumFilled([null, undefined, null]), null)
  ck("sumFilled zero counts", sumFilled([0, null]), 0)
  ck("sumFilled", sumFilled([10, 20, null, 5]), 35)
  ck("monthBounds dec", monthBounds("2026-12"), { start: "2026-12-01", next: "2027-01-01" })
  ck("status future", statusOf({ date: "2026-10-12", sales: null, pax: null }, "2026-10-10"), "UPCOMING")
  ck("status today = upcoming", statusOf({ date: "2026-10-10", sales: null, pax: null }, "2026-10-10"), "UPCOMING")
  ck("status yesterday = waiting", statusOf({ date: "2026-10-09", sales: 5, pax: null }, "2026-10-10"), "WAITING_REPORT")
  ck("status reported (zero is a value)", statusOf({ date: "2026-10-09", sales: 0, pax: 0 }, "2026-10-10"), "REPORTED")
  ck("status reported in advance", statusOf({ date: "2026-10-20", sales: 1, pax: 1 }, "2026-10-10"), "REPORTED")
  const sm = summarizeMonth("2026-10", [
    { sales: 2_000_000, pax: 100, status: "REPORTED", rsvpTotal: 50, hostingTotal: 3 },
    { sales: null, pax: null, status: "UPCOMING", rsvpTotal: null, hostingTotal: null },
  ], { salesTarget: 2_000_000, paxTarget: null })
  ck("summary", [sm.sales, sm.pax, sm.salesPct, sm.paxPct, sm.reportedCount, sm.upcomingCount, sm.rsvpTotal], [2_000_000, 100, 100, null, 1, 1, 50])
  ck("WIB today at 18:00 UTC is next day", outletToday(new Date("2026-10-09T18:00:00Z")), "2026-10-10")
  ck("creatable OUTLET_SALES", checkCreatableProjectType("OUTLET_SALES"), { ok: true, type: "OUTLET_SALES" })
  ck("FINANCE still not creatable", checkCreatableProjectType("FINANCE").ok, false)
  ck("no type = TASK (old clients)", checkCreatableProjectType(undefined), { ok: true, type: "TASK" })

  // ── Validation ──
  ck("create needs name", parseEventFields({ date: "2026-10-04" }, "create").ok, false)
  ck("create needs date", parseEventFields({ name: "Noxva" }, "create").ok, false)
  ck("bad date", parseEventFields({ name: "x", date: "2026-02-30" }, "create").ok, false)
  ck("negative pax refused", parseEventFields({ pax: -1 }, "patch").ok, false)
  ck("fraction pax refused", parseEventFields({ pax: 1.5 }, "patch").ok, false)
  const p1 = parseEventFields({ sales: "8.000.000", pax: "", rsvpTeam: null, successWhat: "  DJ  ", extra: 1 }, "patch")
  ck("digits string, empty → null, trim, unknown ignored", p1.ok ? p1.data : null, { sales: 8_000_000, pax: null, rsvpTeam: null, successWhat: "DJ" })
  ck("blank name on patch refused", parseEventFields({ name: "  " }, "patch").ok, false)

  // ── Database ──
  const groups = await prisma.workspaceMember.groupBy({ by: ["workspaceId"], where: { role: "STAFF" }, _count: { _all: true } })
  const best = groups.sort((a, b) => b._count._all - a._count._all)[0]
  if (!best || best._count._all < 3) throw new Error("need a workspace with 3 staff in the test DB")
  const ws = { id: best.workspaceId }
  const [lead, staff, outsider] = await prisma.workspaceMember.findMany({
    where: { workspaceId: ws.id, role: "STAFF" }, take: 3, select: { userId: true },
  })
  const manager = await prisma.workspaceMember.findFirst({ where: { workspaceId: ws.id, role: "MANAGER" }, select: { userId: true } })
  const project = await prisma.project.create({
    data: {
      name: "TEST outlet (test-outlet-sales.ts)", type: "OUTLET_SALES", workspaceId: ws.id,
      members: { create: [{ userId: lead.userId, role: "LEAD" }, { userId: staff.userId, role: "MEMBER" }] },
      taskLists: { create: [{ name: "To Do", position: 0 }] },
    },
  })
  try {
    ck("member may read", (await outletGate(staff.userId, project.id, "read")).ok, true)
    ck("member may write", (await outletGate(staff.userId, project.id, "write")).ok, true)
    ck("non-member staff refused", (await outletGate(outsider.userId, project.id, "read")).ok, false)
    if (manager) ck("manager (not a member) may read", (await outletGate(manager.userId, project.id, "read")).ok, true)
    ck("lead may set targets", await canManageOutletTargets(lead.userId, project.id), true)
    ck("member may not set targets", await canManageOutletTargets(staff.userId, project.id), false)
    if (manager) ck("manager may set targets", await canManageOutletTargets(manager.userId, project.id), true)
    const taskProject = await prisma.project.findFirst({ where: { workspaceId: ws.id, type: "TASK", members: { some: { userId: staff.userId } } }, select: { id: true } })
    if (taskProject) {
      const g = await outletGate(staff.userId, taskProject.id, "read")
      ck("task project → NOT_OUTLET_SALES 400", g.ok ? null : g.response.status, 400)
    }

    const created = await createOutletEvent(staff.userId, project.id, { name: "Noxva", date: "2026-10-04", salesTarget: 20_000_000, paxTarget: 200 })
    if (!created.ok) throw new Error(JSON.stringify(created.body))
    const ev = created.value
    ck("created: no actuals, past date → waiting (today " + outletToday() + ")", ev.status, ev.date < outletToday() ? "WAITING_REPORT" : "UPCOMING")
    ck("created: missing both", ev.missing, ["sales", "pax"])
    ck("created: totals null", [ev.rsvpTotal, ev.hostingTotal, ev.salesPct], [null, null, null])

    const u1 = await updateOutletEvent(staff.userId, project.id, ev.id, { sales: 8_000_000, rsvpWalkIn: 10, rsvpTeam: 20, rsvpPr: 5, rsvpEo: 0, hostingTeam: 2 })
    if (!u1.ok) throw new Error(JSON.stringify(u1.body))
    ck("partial report: 40%", u1.value.salesPct, 40)
    ck("partial report: still missing pax", u1.value.missing, ["pax"])
    ck("rsvp total", u1.value.rsvpTotal, 35)
    ck("hosting total", u1.value.hostingTotal, 2)
    ck("not reported yet", u1.value.reportedAt, null)

    const u2 = await updateOutletEvent(lead.userId, project.id, ev.id, { pax: 50, failWhat: "Sound" })
    if (!u2.ok) throw new Error(JSON.stringify(u2.body))
    ck("reported", u2.value.status, "REPORTED")
    ck("pax 25%", u2.value.paxPct, 25)
    ck("reportedBy = who completed it", u2.value.reportedBy?.id, lead.userId)
    ck("sales kept from first patch", u2.value.sales, 8_000_000)

    const audits = await prisma.auditLog.findMany({ where: { entityId: ev.id }, orderBy: { createdAt: "asc" }, select: { action: true, metadata: true } })
    ck("audit: create + 2 updates", audits.map((a) => a.action), ["create", "update", "update"])
    const noop = await updateOutletEvent(lead.userId, project.id, ev.id, { pax: 50 })
    ck("no-op patch writes no audit", (await prisma.auditLog.count({ where: { entityId: ev.id } })), 3)
    ck("no-op patch answers the event", noop.ok && noop.value.pax, 50)

    const bad = await updateOutletEvent(lead.userId, project.id, ev.id, { pax: -3 })
    ck("invalid → 400 INVALID_FIELD", bad.ok ? null : [bad.status, bad.body.code, bad.body.field], [400, "INVALID_FIELD", "pax"])

    const second = await createOutletEvent(staff.userId, project.id, { name: "Second same day", date: "2026-10-04", sales: 1_000_000, pax: 10 })
    ck("two events on one date allowed, reported at once", second.ok && second.value.status, "REPORTED")
    const nov = await createOutletEvent(staff.userId, project.id, { name: "Next month", date: "2026-11-02" })
    ck("next month created", nov.ok, true)
    const sep = await createOutletEvent(staff.userId, project.id, { name: "Forgotten", date: "2026-09-20" })
    ck("september (unreported) created", sep.ok, true)

    const t1 = await putOutletTarget(lead.userId, project.id, { month: "2026-10", salesTarget: "18.000.000", paxTarget: 6000 })
    ck("target set", t1.ok && [t1.value.salesTarget, t1.value.paxTarget], [18_000_000, 6000])
    const t2 = await putOutletTarget(lead.userId, project.id, { month: "2026-10", paxTarget: null })
    ck("clear pax target only", t2.ok && [t2.value.salesTarget, t2.value.paxTarget], [18_000_000, null])
    ck("bad month", (await putOutletTarget(lead.userId, project.id, { month: "2026-13" })).ok, false)

    const oct = await loadOutletMonth(project.id, "2026-10")
    ck("october: 2 events", oct.events.map((e) => e.name), ["Noxva", "Second same day"])
    ck("october sums", [oct.summary.sales, oct.summary.pax], [9_000_000, 60])
    ck("october pct (9jt/18jt = 50, pax no target)", [oct.summary.salesPct, oct.summary.paxPct], [50, null])
    ck("october: september's unreported night is in waitingEarlier", oct.waitingEarlier.map((e) => e.name), ["Forgotten"])
    const novM = await loadOutletMonth(project.id, "2026-11")
    ck("november has no target", novM.target, null)

    // Move a date across months: it leaves October.
    await updateOutletEvent(staff.userId, project.id, second.ok ? second.value.id : "", { date: "2026-11-05" })
    ck("moved to november", (await loadOutletMonth(project.id, "2026-11")).events.length, 2)

    // Delete and restore from Audit.
    const del = await deleteOutletEvent(staff.userId, project, ev.id)
    ck("deleted", del.ok, true)
    ck("gone", await prisma.outletSalesEvent.count({ where: { id: ev.id } }), 0)
    const delAudit = await prisma.auditLog.findFirst({ where: { entityId: ev.id, action: "delete" }, orderBy: { createdAt: "desc" }, select: { id: true } })
    const restored = await restoreDeletion(delAudit!.id, lead.userId)
    ck("restore ok", (restored as { ok?: boolean }).ok, true)
    const back = await prisma.outletSalesEvent.findUnique({ where: { id: ev.id } })
    ck("restored with its report", back && [back.name, back.sales, back.pax, back.failWhat, back.rsvpTeam], ["Noxva", 8_000_000, 50, "Sound", 20])
    ck("delete of a missing event → 404", (await deleteOutletEvent(staff.userId, project, "nope")).ok, false)
  } finally {
    await prisma.project.delete({ where: { id: project.id } })
  }
  console.log(`\n${pass} ok, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
