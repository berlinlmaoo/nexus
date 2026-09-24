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
const PROFILES = (process.env.COMPAT_PROFILES || "ios-0.1.3,ios-0.1.4,ios-0.1.5,ios-0.1.6,web").split(",")

// Kantor fiktif di Jakarta. Titik absen di fixtures ada ~10 m dari sini, jauh di dalam radius.
const OFFICE = { lat: -6.2253, lng: 106.829, radiusMeters: 150 }

async function main() {
  const pool = new pg.Pool({ connectionString: url, max: 2 })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const hash = await bcrypt.hash(PASSWORD, 10)

  const workspace = await prisma.workspace.create({
    data: fit("Workspace", { name: "Compat Workspace", slug: "compat-ws", joinCode: "COMPAT1" }),
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
  }
  process.stdout.write("\n" + JSON.stringify(world) + "\n")
}

main().catch((e) => {
  console.error("seed.cjs failed:", e)
  process.exit(1)
})
