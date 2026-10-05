// Seeds the THROWAWAY compat database with the smallest world the attendance paths need.
//
// Runs inside the CANDIDATE image (`docker run ... --entrypoint node <image> /compat/seed.cjs`), so it
// talks to the database through the candidate's own generated Prisma client. That is deliberate: a
// raw-SQL seed breaks the day a column becomes required, while the client fills every default the
// candidate schema declares and only needs the handful of fields that are genuinely required.
//
// Refuses to run unless DATABASE_URL points at the compat database host (`db`) — a guard against
// ever being pointed at a real database by a copy-paste.
//
// Prints one JSON line (the "world": ids, logins, office coordinates) as the LAST line of stdout.
"use strict"

const { createRequire } = require("node:module")
const appRequire = createRequire("/app/package.json")

const url = process.env.DATABASE_URL || ""
if (!/^postgres(ql)?:\/\/compat:[^@]+@db:5432\/compat(\?|$)/.test(url)) {
  console.error("seed.cjs: refusing — DATABASE_URL is not the throwaway compat database (compat@db:5432/compat).")
  process.exit(2)
}

const { PrismaClient, Prisma } = appRequire("/app/src/generated/prisma")

// Only send fields the candidate schema actually has. A field this seed sets but the schema has since
// dropped (or not yet added, on an older image) is left out instead of crashing the seed — the
// fixtures, not the seed, are what should decide whether the candidate is compatible.
const MODELS = new Map((Prisma?.dmmf?.datamodel?.models ?? []).map((m) => [m.name, new Set(m.fields.map((f) => f.name))]))
function fit(model, data) {
  const fields = MODELS.get(model)
  if (!fields) return data
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    if (fields.has(k)) out[k] = v
    else console.error(`seed: ${model}.${k} not in candidate schema — skipped`)
  }
  return out
}
const { PrismaPg } = appRequire("@prisma/adapter-pg")
const pg = appRequire("pg")
const bcrypt = appRequire("bcryptjs")

const PASSWORD = process.env.COMPAT_PASSWORD || "Compat-Only-Pass-2026!"
// Profiles that get their own staff users. Each profile needs its own people: a check-in is once per
// person per day, and requests may not overlap — sharing users would make fixtures depend on order.
const PROFILES = (process.env.COMPAT_PROFILES || "ios-0.1.3,ios-0.1.4,ios-0.1.5,ios-0.1.6,web,android-0.1.0").split(",")

// Kantor fiktif di Jakarta. Titik absen di fixtures ada ~10 m dari sini, jauh di dalam radius.
const OFFICE = { lat: -6.2253, lng: 106.829, radiusMeters: 150 }

async function main() {
  const pool = new pg.Pool({ connectionString: url, max: 2 })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const hash = await bcrypt.hash(PASSWORD, 10)

  const workspace = await prisma.workspace.create({
    // The company workspace id (lib/org.ts ORG_WORKSPACE_ID): company-level powers (XP adjust,
    // announcements, Control Room) come only from a role in it, so the fixtures must live in it.
    data: fit("Workspace", { id: "cmmroq7dk0001vewe92nk1g0w", name: "Compat Workspace", slug: "compat-ws", joinCode: "COMPAT1" }),
  })
  const office = await prisma.officeLocation.create({
    data: fit("OfficeLocation", {
      name: "Compat Office",
      address: "Jl. Uji Kompatibilitas 1, Jakarta",
      latitude: OFFICE.lat,
      longitude: OFFICE.lng,
      radiusMeters: OFFICE.radiusMeters,
      timezone: "Asia/Jakarta",
      shiftStartTime: "09:00",
      shiftEndTime: "18:00",
      lateGraceMinutes: 15,
      workspaceId: workspace.id,
    }),
  })

  // joinedAt spaced one minute apart in creation order so "oldest membership wins" is deterministic.
  let t = Date.now() - 24 * 60 * 60 * 1000
  const nextJoin = () => new Date((t += 60 * 1000))

  async function person(key, name, role, approverId) {
    const user = await prisma.user.create({
      data: { name, email: `${key}@compat.invalid`, password: hash },
    })
    await prisma.workspaceMember.create({
      data: fit("WorkspaceMember", {
        userId: user.id,
        workspaceId: workspace.id,
        role,
        joinedAt: nextJoin(),
        employmentStartDate: new Date("2024-01-01T00:00:00.000Z"),
        ...(approverId ? { approverId } : {}),
      }),
    })
    return { id: user.id, email: user.email, name }
  }

  const bod = await person("bod", "Compat BoD", "BOD")
  const manager = await person("manager", "Compat Manager", "MANAGER")
  const staff = {}
  for (const p of PROFILES) {
    const slug = p.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
    staff[p] = {
      a: await person(`staff-${slug}-a`, `Staff ${p} A`, "STAFF", manager.id),
      b: await person(`staff-${slug}-b`, `Staff ${p} B`, "STAFF", manager.id),
    }
  }

  // One project everyone is in, one list, one task assigned to each staff user — so "projects" and
  // "tasks" come back non-empty and their item shape can be checked, not just the status.
  const project = await prisma.project.create({ data: { name: "Compat Project", workspaceId: workspace.id } })
  const allPeople = [bod, manager, ...Object.values(staff).flatMap((s) => [s.a, s.b])]
  for (const u of allPeople) {
    await prisma.projectMember.create({ data: { userId: u.id, projectId: project.id } })
  }
  const list = await prisma.taskList.create({ data: { name: "To do", projectId: project.id } })
  for (const u of Object.values(staff).flatMap((s) => [s.a, s.b])) {
    const task = await prisma.task.create({
      data: { title: `Compat task for ${u.name}`, taskListId: list.id, creatorId: manager.id },
    })
    await prisma.taskAssignee.create({ data: { taskId: task.id, userId: u.id } })
  }

  const calendar = await seedCalendar(prisma, { workspace, project, list, bod, manager, staff })

  await prisma.$disconnect()
  await pool.end()

  const world = {
    password: PASSWORD,
    workspaceId: workspace.id,
    joinCode: "COMPAT1",
    office: { id: office.id, ...OFFICE },
    projectId: project.id,
    taskListId: list.id,
    bod,
    manager,
    staff,
    calendar,
  }
  process.stdout.write("\n" + JSON.stringify(world) + "\n")
}

// Jakarta calendar date (UTC+7, no DST), offset in days — the same helper as fixtures.mjs jktDate.
function jktDate(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10)
}

// The Calendar (/api/calendar/**, 5 Oct 2026): a three-card Bagan, a private project and dated tasks
// whose WIB day is known in advance. Returns what the fixtures need, or null on an image without the
// Bagan / AppSetting tables (the calendar fixtures then SKIP instead of the whole seed failing).
//
// Every row here is invisible to the attendance fixtures: the Bagan grants nothing (lib/org-chart.ts),
// the dated tasks belong to "B" staff and the manager, never to a profile's "a" user, and the private
// project has no staff member at all.
async function seedCalendar(prisma, { workspace, project, list, bod, manager, staff }) {
  if (typeof prisma.orgUnit?.create !== "function" || typeof prisma.orgUnitMember?.create !== "function" || typeof prisma.appSetting?.upsert !== "function") {
    console.error("seed: OrgUnit / OrgUnitMember / AppSetting not in candidate schema — calendar world skipped")
    return null
  }
  // Staff in a Bagan card (their tasks are placed under it) and staff in none (their tasks are "unplaced").
  const unitStaff = staff[PROFILES[0]].b
  const looseStaff = staff[PROFILES[PROFILES.length - 1]].b

  // IP (top) › GROUP › DIVISION. The canvas fields are set on purpose: /api/calendar/structure must
  // never send layoutX / layoutY / boxLayout, and a null would not show a leak as clearly as a value.
  const canvas = (x, y) => ({ layoutX: x, layoutY: y, boxLayout: { bod: { x: x + 10, y: y + 10 }, staff: { x: x + 20, y: y + 40 } } })
  const ip = await prisma.orgUnit.create({
    data: fit("OrgUnit", { workspaceId: workspace.id, name: "Compat IP", kind: "IP", parentId: null, position: 0, ...canvas(120, 40) }),
  })
  const group = await prisma.orgUnit.create({
    data: fit("OrgUnit", { workspaceId: workspace.id, name: "Compat Group", kind: "GROUP", parentId: ip.id, position: 0, ...canvas(80, 220) }),
  })
  // Led by the manager, who sits in the card above the group (a lead must be a BoD/Manager of the parent card).
  const division = await prisma.orgUnit.create({
    data: fit("OrgUnit", { workspaceId: workspace.id, name: "Compat Division", kind: "DIVISION", parentId: group.id, position: 0, leadUserId: manager.id, ...canvas(80, 400) }),
  })
  // A GROUP holds no people: the manager sits in the IP, one staff member in the division.
  await prisma.orgUnitMember.create({ data: fit("OrgUnitMember", { unitId: ip.id, userId: manager.id, workspaceId: workspace.id, title: "Head of Compat" }) })
  await prisma.orgUnitMember.create({ data: fit("OrgUnitMember", { unitId: division.id, userId: unitStaff.id, workspaceId: workspace.id, title: "Designer" }) })

  // Rollout audience: everyone, so the staff profiles get data instead of { access: "off" }. The other
  // settings take their defaults (private name prefixes "finance" and "legal").
  await prisma.appSetting.upsert({
    where: { key: "calendar" },
    create: { key: "calendar", value: { audience: "all" } },
    update: { value: { audience: "all" } },
  })

  async function dated(key, title, listId, due, assigneeId) {
    const task = await prisma.task.create({ data: { title, taskListId: listId, creatorId: manager.id, dueDate: new Date(due) } })
    await prisma.taskAssignee.create({ data: { taskId: task.id, userId: assigneeId } })
    return [key, { id: task.id, title, due, assigneeId }]
  }

  // A private project (name starts with "finance"): only the BoD and the manager are in it, so every
  // staff profile must get its task masked — no id, title or project.
  const finance = await prisma.project.create({ data: { name: "Finance Compat", workspaceId: workspace.id } })
  for (const u of [bod, manager]) await prisma.projectMember.create({ data: { userId: u.id, projectId: finance.id } })
  const financeList = await prisma.taskList.create({ data: { name: "Ledger", projectId: finance.id } })

  // Due dates relative to today in WIB. 17:00:00Z is 00:00 WIB of the NEXT day (how 18 real tasks were
  // stored); 00:00:00Z is a date picked without a time (07:00 WIB the same day). Both are date-only.
  const tasks = Object.fromEntries([
    await dated("wibMidnight", "Compat cal 17:00Z (00:00 WIB next day)", list.id, `${jktDate(3)}T17:00:00.000Z`, unitStaff.id),
    await dated("utcMidnight", "Compat cal 00:00Z (date only)", list.id, `${jktDate(5)}T00:00:00.000Z`, looseStaff.id),
    await dated("timed", "Compat cal 03:30Z (10:30 WIB)", list.id, `${jktDate(5)}T03:30:00.000Z`, manager.id),
    await dated("overdue", "Compat cal overdue (3 days ago)", list.id, `${jktDate(-3)}T00:00:00.000Z`, unitStaff.id),
    await dated("finance", "Compat finance secret payroll", financeList.id, `${jktDate(6)}T00:00:00.000Z`, manager.id),
  ])

  return {
    units: { ip: ip.id, group: group.id, division: division.id },
    unitStaffId: unitStaff.id,
    looseStaffId: looseStaff.id,
    financeProjectId: finance.id,
    financeProjectName: "Finance Compat",
    tasks,
  }
}

main().catch((e) => {
  console.error("seed.cjs failed:", e)
  process.exit(1)
})
