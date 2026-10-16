/**
 * Demo Studio: a self-contained workspace with obviously fake but realistic data, for screenshots, the UI
 * tour and walkthroughs. Nothing in it comes from a real person, company, address or database.
 *
 *   npx tsx scripts/seed-demo-workspace.ts            create, or refresh (wipe what it owns + build again)
 *   npx tsx scripts/seed-demo-workspace.ts --remove   delete everything it owns, and nothing else
 *
 * Ownership. Every row this script writes is reachable from one of two anchors, and --remove / refresh only
 * ever start from those anchors:
 *   - the workspace with id DEMO_WS ("demo-studio"): projects, sections, tasks, forms, chat rooms,
 *     attendance, offices, room bookings… all hang off it (FK cascade);
 *   - the users with id prefix "demo-user-" (emails demo.*@example.com): their XP, sessions,
 *     notifications and audit rows.
 * Rows the script creates directly also carry a "demo-" id prefix. A non-demo user that already holds one
 * of the demo emails stops the script before anything is written.
 *
 * Login: only demo.owner@example.com gets a password, read from the DEMO_PASSWORD env var (never stored in
 * the repo, never printed). Every other member is a profile without a password.
 *
 * Isolation: the demo members belong to the Demo Studio workspace only, and no real user is added to it.
 * Workspace scoping in the API (projects, chat, leaderboard, directory, attendance) does the rest. The
 * workspace has no join code, so nobody can join it by signing up.
 *
 * Not seeded: Legal (companies, series and documents are global to the company workspace, not
 * per-workspace, and documents need real .docx templates), Z Vault files, selfies and live location.
 *
 * Run it against the DEV database the way the other scripts run (builder image + DATABASE_URL), e.g.:
 *   docker run --rm -v <checkout>:/w:ro --network <db network> -e DATABASE_URL=postgresql://… \
 *     -e DEMO_PASSWORD=… --entrypoint sh <builder image> -c 'cp -r /w /t && cd /t && rm -rf node_modules \
 *       && ln -s /app/node_modules node_modules && npx prisma generate >/dev/null \
 *       && npx tsx scripts/seed-demo-workspace.ts [--remove]'
 */
import bcrypt from "bcryptjs"
import prisma from "../src/lib/prisma"
import { DEAL_CODE_PREFIX } from "../src/lib/pipeline-server"

const DEMO_WS = "demo-studio"
const USER_PREFIX = "demo-user-"
const OWNER_EMAIL = "demo.owner@example.com"

// ─── dates (Asia/Jakarta, UTC+7, no DST) ─────────────────────────────────────────────────────────────────
const WIB_MS = 7 * 3600_000
const todayKey = new Date(Date.now() + WIB_MS).toISOString().slice(0, 10)
function dayKey(offset: number): string {
  const d = new Date(`${todayKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
/** A wall-clock time in Jakarta on the day `offset` days from today. */
function at(offset: number, hhmm = "17:00"): Date {
  const [h, m] = hhmm.split(":").map(Number)
  const [y, mo, d] = dayKey(offset).split("-").map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h, m) - WIB_MS)
}
function isoWeekday(key: string): number {
  const wd = new Date(`${key}T00:00:00Z`).getUTCDay()
  return wd === 0 ? 7 : wd
}
function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

/** Deterministic pseudo-random numbers, so a refresh rebuilds the same workspace. */
let seed = 20261014
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]
}

// ─── people ──────────────────────────────────────────────────────────────────────────────────────────────
type Role = "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF"
const PEOPLE: { key: string; name: string; email: string; role: Role; approver?: string; xp: number }[] = [
  { key: "owner", name: "Nadia Kusuma", email: OWNER_EMAIL, role: "ONE_ABOVE_ALL", xp: 0 },
  { key: "bod", name: "Arief Santoso", email: "demo.bod@example.com", role: "BOD", xp: 0 },
  { key: "creative", name: "Maya Lestari", email: "demo.manager@example.com", role: "MANAGER", xp: 140 },
  { key: "sales", name: "Doni Prasetyo", email: "demo.sales@example.com", role: "MANAGER", xp: 95 },
  { key: "designer", name: "Rina Wulandari", email: "demo.designer@example.com", role: "STAFF", approver: "creative", xp: 210 },
  { key: "producer", name: "Yoga Firmansyah", email: "demo.producer@example.com", role: "STAFF", approver: "creative", xp: 60 },
  { key: "content", name: "Sinta Maharani", email: "demo.content@example.com", role: "STAFF", approver: "creative", xp: 175 },
  { key: "finance", name: "Bayu Hidayat", email: "demo.finance@example.com", role: "STAFF", approver: "sales", xp: -40 },
]
const uid = (key: string) => `${USER_PREFIX}${key}`

// ─── remove ──────────────────────────────────────────────────────────────────────────────────────────────
async function removeDemo(): Promise<void> {
  const users = await prisma.user.findMany({ where: { id: { startsWith: USER_PREFIX } }, select: { id: true } })
  const userIds = users.map((u) => u.id)
  const ws = await prisma.workspace.findUnique({ where: { id: DEMO_WS }, select: { id: true } })

  if (ws) {
    // Rooms only SetNull on a workspace delete; project rooms go with their projects anyway.
    await prisma.conversation.deleteMany({ where: { workspaceId: DEMO_WS } })
    // AttendanceRecord → OfficeLocation is RESTRICT: records first.
    await prisma.attendanceRecord.deleteMany({ where: { workspaceId: DEMO_WS } })
    // The only workspace relation without a cascade.
    await prisma.portfolio.deleteMany({ where: { workspaceId: DEMO_WS } })
    await prisma.deletionSnapshot.deleteMany({ where: { workspaceId: DEMO_WS } })
    await prisma.workspace.delete({ where: { id: DEMO_WS } })
  }
  if (userIds.length) {
    // Rooms the demo people opened outside the workspace (none expected), then rows that point at a user
    // without a cascade.
    await prisma.conversation.deleteMany({ where: { workspaceId: null, members: { some: { userId: { in: userIds } } }, NOT: { members: { some: { userId: { notIn: userIds } } } } } })
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.deletionSnapshot.deleteMany({ where: { deletedById: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }
  console.log(`removed: workspace ${ws ? "yes" : "none"}, ${userIds.length} demo users`)
}

// ─── seed ────────────────────────────────────────────────────────────────────────────────────────────────
async function seedDemo(password: string): Promise<void> {
  // A real account holding a demo email would be taken over by a refresh: stop instead.
  const clash = await prisma.user.findMany({
    where: { email: { in: PEOPLE.map((p) => p.email), mode: "insensitive" }, NOT: { id: { startsWith: USER_PREFIX } } },
    select: { email: true },
  })
  if (clash.length) throw new Error(`not a demo account, refusing to touch: ${clash.map((c) => c.email).join(", ")}`)
  const slugTaken = await prisma.workspace.findFirst({ where: { slug: "demo-studio", NOT: { id: DEMO_WS } }, select: { id: true } })
  if (slugTaken) throw new Error("slug demo-studio belongs to another workspace, refusing to continue")

  await removeDemo()

  const hash = await bcrypt.hash(password, 12)
  const now = new Date()

  // People + workspace
  await prisma.user.createMany({
    data: PEOPLE.map((p) => ({
      id: uid(p.key),
      name: p.name,
      email: p.email,
      password: p.key === "owner" ? hash : null,
      avatar: null, // the apps draw initials
      uiLanguage: "en",
      onboardedAt: now,
    })),
  })
  await prisma.workspace.create({
    data: { id: DEMO_WS, name: "Demo Studio", slug: "demo-studio", description: "A fictional creative studio, used for demos and screenshots.", joinCode: null },
  })
  await prisma.workspaceMember.createMany({
    data: PEOPLE.map((p, i) => ({
      id: `demo-wm-${p.key}`,
      userId: uid(p.key),
      workspaceId: DEMO_WS,
      role: p.role,
      attendanceRole: p.role === "MANAGER" ? "SUPERVISOR" : "NONE",
      approverId: p.approver ? uid(p.approver) : null,
      restDays: [6, 7],
      // The fictional office is at sea: the owner (the demo login) may check in from anywhere.
      noGeofenceMode: p.key === "owner",
      employmentStartDate: at(-400 - i * 37, "09:00"),
      joinedAt: at(-60 + i, "09:00"),
    })),
  })

  // ── Projects ───────────────────────────────────────────────────────────────────────────────────────────
  const statusSections = [
    { key: "todo", name: "To Do", taskStatus: "TODO" as const, color: "gray" },
    { key: "doing", name: "In Progress", taskStatus: "IN_PROGRESS" as const, color: "sky" },
    { key: "review", name: "In Review", taskStatus: "IN_REVIEW" as const, color: "amber" },
    { key: "done", name: "Done", taskStatus: "DONE" as const, color: "emerald" },
  ]
  type TaskSeed = {
    title: string; section: string; who: string[]; start?: number; due?: number; priority?: "URGENT" | "HIGH" | "MEDIUM" | "LOW"
    amount?: number; category?: string; tags?: string[]; description?: string
  }
  async function makeProject(p: {
    id: string; name: string; description: string; color: string; icon: string; lead: string; members: string[]
    categories: string[]; tasks: TaskSeed[]
  }) {
    await prisma.project.create({
      data: {
        id: p.id, name: p.name, description: p.description, color: p.color, icon: p.icon, workspaceId: DEMO_WS, type: "TASK",
        members: {
          create: [
            { userId: uid(p.lead), role: "LEAD", accessLevel: "FULL" },
            ...p.members.filter((m) => m !== p.lead).map((m) => ({ userId: uid(m), role: "MEMBER" as const, accessLevel: "EDIT" })),
          ],
        },
        taskLists: { create: statusSections.map((s, i) => ({ id: `${p.id}-list-${s.key}`, name: s.name, position: i, taskStatus: s.taskStatus, color: s.color })) },
        customFields: {
          create: [
            { id: `${p.id}-cf-amount`, name: "Amount", type: "NUMBER", position: 0, options: { format: "currency-idr" } },
            { id: `${p.id}-cf-category`, name: "Category", type: "SELECT", position: 1, options: { options: p.categories, optionColors: Object.fromEntries(p.categories.map((c, i) => [c, ["violet", "sky", "emerald", "amber", "rose", "orange"][i % 6]])) } },
          ],
        },
      },
    })
    await prisma.project.update({
      where: { id: p.id },
      data: { tableColumns: ["status", "assignee", "dueDate", "priority", `cf:${p.id}-cf-amount`, `cf:${p.id}-cf-category`] },
    })
    for (const [i, t] of p.tasks.entries()) {
      const section = statusSections.find((s) => s.key === t.section)!
      const id = `${p.id}-t${String(i + 1).padStart(2, "0")}`
      await prisma.task.create({
        data: {
          id,
          title: t.title,
          description: t.description ?? null,
          status: section.taskStatus,
          priority: t.priority ?? "MEDIUM",
          position: i,
          tags: t.tags ?? [],
          startDate: t.start !== undefined ? at(t.start, "09:00") : null,
          dueDate: t.due !== undefined ? at(t.due) : null,
          taskListId: `${p.id}-list-${section.key}`,
          creatorId: uid(p.lead),
          completedById: section.taskStatus === "DONE" ? uid(t.who[0] ?? p.lead) : null,
          assignees: { create: t.who.map((w) => ({ userId: uid(w) })) },
          customFieldValues: {
            create: [
              ...(t.amount !== undefined ? [{ customFieldId: `${p.id}-cf-amount`, value: String(t.amount) }] : []),
              ...(t.category ? [{ customFieldId: `${p.id}-cf-category`, value: t.category }] : []),
            ],
          },
        },
      })
    }
    // The project's chat room, with exactly its members (same rule as lib/chat-membership.ts).
    await prisma.conversation.create({
      data: {
        id: `${p.id}-room`, type: "PROJECT", projectId: p.id, name: p.name, workspaceId: DEMO_WS,
        members: { create: Array.from(new Set([p.lead, ...p.members])).map((m) => ({ userId: uid(m), lastReadAt: now })) },
      },
    })
  }

  await makeProject({
    id: "demo-proj-brand", name: "Brand Refresh 2027", color: "#7B2FBE", icon: "sparkles", lead: "creative",
    description: "New identity for a fictional coffee chain: research, logo, packaging and launch assets.",
    members: ["owner", "designer", "producer", "content", "finance"],
    categories: ["Research", "Design", "Copy", "Production", "Media"],
    tasks: [
      { title: "Stakeholder interviews", section: "done", who: ["creative"], start: -24, due: -19, category: "Research", amount: 4_500_000, priority: "HIGH" },
      { title: "Competitor moodboard", section: "done", who: ["designer"], start: -20, due: -15, category: "Research", amount: 2_000_000 },
      { title: "Logo exploration: three routes", section: "done", who: ["designer"], start: -14, due: -6, category: "Design", amount: 12_000_000, priority: "HIGH" },
      { title: "Brand voice guide", section: "review", who: ["content"], start: -8, due: -1, category: "Copy", amount: 5_500_000 },
      { title: "Colour and type system", section: "review", who: ["designer"], start: -5, due: 1, category: "Design", amount: 6_000_000 },
      { title: "Packaging mockups (cups, sleeves, bags)", section: "doing", who: ["designer", "producer"], start: -3, due: 6, category: "Design", amount: 18_500_000, priority: "URGENT" },
      { title: "Launch film storyboard", section: "doing", who: ["producer"], start: -2, due: 5, category: "Production", amount: 9_000_000, priority: "HIGH" },
      { title: "Website hero copy", section: "doing", who: ["content"], start: 0, due: 4, category: "Copy", amount: 3_000_000 },
      { title: "Production budget sign-off", section: "todo", who: ["finance", "creative"], start: 2, due: 7, category: "Production", priority: "HIGH" },
      { title: "Launch film shoot (2 days)", section: "todo", who: ["producer"], start: 9, due: 10, category: "Production", amount: 45_000_000, priority: "HIGH" },
      { title: "Social launch kit", section: "todo", who: ["content", "designer"], start: 8, due: 15, category: "Media", amount: 7_500_000 },
      { title: "Paid media plan", section: "todo", who: ["content"], start: 12, due: 18, category: "Media", amount: 25_000_000 },
      { title: "Launch day", section: "todo", who: ["creative"], start: 21, due: 21, category: "Media", priority: "URGENT", tags: ["milestone"] },
    ],
  })
  await makeProject({
    id: "demo-proj-content", name: "Content Calendar Q4", color: "#0EA5E9", icon: "calendar", lead: "content",
    description: "Weekly posts and videos for the studio's own channels.",
    members: ["creative", "designer", "producer"],
    categories: ["Instagram", "TikTok", "YouTube", "Blog", "Newsletter"],
    tasks: [
      { title: "Behind the scenes: packaging shoot", section: "done", who: ["content"], due: -9, category: "Instagram" },
      { title: "Studio tour reel", section: "done", who: ["producer"], due: -6, category: "TikTok" },
      { title: "Case study: rebrand in 30 days", section: "done", who: ["content"], due: -3, category: "Blog", amount: 1_500_000 },
      { title: "Monthly newsletter", section: "review", who: ["content"], due: 1, category: "Newsletter" },
      { title: "Designer Q&A carousel", section: "doing", who: ["designer", "content"], due: 2, category: "Instagram" },
      { title: "Process timelapse", section: "doing", who: ["producer"], due: 3, category: "TikTok" },
      { title: "Long-form interview", section: "todo", who: ["producer", "content"], due: 8, category: "YouTube", amount: 6_000_000, priority: "HIGH" },
      { title: "Client spotlight post", section: "todo", who: ["content"], due: 6, category: "Instagram" },
      { title: "Tools we use (blog)", section: "todo", who: ["content"], due: 11, category: "Blog" },
      { title: "Year-in-review teaser", section: "todo", who: ["designer"], due: 15, category: "TikTok" },
    ],
  })
  await makeProject({
    id: "demo-proj-ops", name: "Studio Ops & Requests", color: "#10B981", icon: "inbox", lead: "bod",
    description: "Equipment, purchases and office requests. New requests arrive through the request form.",
    members: ["owner", "finance", "creative", "sales", "designer", "producer", "content"],
    categories: ["Equipment", "Software", "Travel", "Office"],
    tasks: [
      { title: "Renew design software seats", section: "done", who: ["finance"], due: -10, category: "Software", amount: 8_400_000 },
      { title: "Replace meeting room display", section: "doing", who: ["bod"], due: 3, category: "Office", amount: 6_750_000 },
    ],
  })

  // A few comments, so task detail is not empty.
  const comments: [string, string, string, number][] = [
    ["demo-proj-brand-t06", "creative", "Let's keep the sleeve print to two colours, it halves the print cost.", -1],
    ["demo-proj-brand-t06", "designer", "Agreed. Route B works in two colours, I'll share the revised file today.", 0],
    ["demo-proj-brand-t07", "producer", "Location scout is booked for Thursday morning.", -1],
    ["demo-proj-brand-t09", "finance", "Waiting on the final shoot quote before I can sign this off.", 0],
  ]
  for (const [i, [taskId, who, content, day]] of comments.entries()) {
    await prisma.comment.create({ data: { id: `demo-comment-${i + 1}`, taskId, userId: uid(who), content, createdAt: at(day, "10:30") } })
  }

  // Status update on the showcase project.
  await prisma.statusUpdate.create({
    data: { id: "demo-status-1", projectId: "demo-proj-brand", authorId: uid("creative"), status: "ON_TRACK", text: "Logo route B approved. Packaging mockups due next week, shoot locked for the week after.", createdAt: at(-1, "16:00") },
  })

  // ── Form + submissions (each submission makes a task in Studio Ops, as the real submit route does) ─────
  const formFields = [
    { id: "f_item", name: "What do you need?", label: "What do you need?", type: "text", required: true, mapping: { target: "task_title" } },
    { id: "f_category", name: "Category", label: "Category", type: "dropdown", required: true, options: ["Equipment", "Software", "Travel", "Office"], mapping: { target: "custom_field", customFieldId: "demo-proj-ops-cf-category" } },
    { id: "f_amount", name: "Estimated cost", label: "Estimated cost", type: "number", numberFormat: "currency-idr", required: false, mapping: { target: "custom_field", customFieldId: "demo-proj-ops-cf-amount" } },
    { id: "f_needed", name: "Needed by", label: "Needed by", type: "date", required: false, mapping: { target: "task_due_date" } },
    { id: "f_why", name: "Why", label: "Why", type: "textarea", required: false, mapping: { target: "task_description" } },
  ]
  await prisma.form.create({
    data: {
      id: "demo-form-request", name: "Studio request", slug: "demo-studio-request", projectId: "demo-proj-ops", requireAuth: true, isPublic: false,
      description: "Ask for equipment, software, travel or anything for the office.", fields: formFields,
      settings: { confirmationTitle: "Request received", confirmationMessage: "Ops will pick it up within one working day.", submitLabel: "Send request" },
    },
  })
  const submissions = [
    { who: "producer", item: "Second camera battery grip", category: "Equipment", amount: 2_350_000, needed: 5, why: "The two-day shoot runs longer than one battery set lasts.", section: "todo", day: -2 },
    { who: "designer", item: "Font licence for the new brand", category: "Software", amount: 3_900_000, needed: 3, why: "Needed before packaging files go to print.", section: "doing", day: -3 },
    { who: "sales", item: "Train tickets for the client pitch", category: "Travel", amount: 1_200_000, needed: 9, why: "Pitch meeting with a prospect in another city.", section: "todo", day: -1 },
    { who: "content", item: "Ring light for the podcast corner", category: "Equipment", amount: 850_000, needed: 12, why: "Video podcast episodes start next month.", section: "todo", day: 0 },
  ]
  for (const [i, s] of submissions.entries()) {
    const taskId = `demo-proj-ops-req${i + 1}`
    const section = statusSections.find((x) => x.key === s.section)!
    await prisma.task.create({
      data: {
        id: taskId, title: s.item, description: s.why, status: section.taskStatus, position: 10 + i,
        dueDate: at(s.needed), taskListId: `demo-proj-ops-list-${s.section}`, creatorId: uid(s.who), createdAt: at(s.day, "11:00"),
        assignees: { create: [{ userId: uid("finance") }] },
        customFieldValues: { create: [{ customFieldId: "demo-proj-ops-cf-category", value: s.category }, { customFieldId: "demo-proj-ops-cf-amount", value: String(s.amount) }] },
      },
    })
    await prisma.formSubmission.create({
      data: {
        id: `demo-sub-${i + 1}`, formId: "demo-form-request", taskId, submitterId: uid(s.who), createdAt: at(s.day, "11:00"),
        data: { f_item: s.item, f_category: s.category, f_amount: s.amount, f_needed: dayKey(s.needed), f_why: s.why },
      },
    })
  }

  // ── Pipeline board ─────────────────────────────────────────────────────────────────────────────────────
  await prisma.project.create({
    data: {
      id: "demo-proj-pipeline", name: "Sales Pipeline", description: "Every deal of the studio, from first call to closing.", type: "PIPELINE",
      color: "#F59E0B", icon: "chart", workspaceId: DEMO_WS,
      members: { create: [{ userId: uid("sales"), role: "LEAD", accessLevel: "FULL" }, { userId: uid("owner"), role: "MEMBER", accessLevel: "EDIT" }, { userId: uid("bod"), role: "MEMBER", accessLevel: "EDIT" }, { userId: uid("finance"), role: "MEMBER", accessLevel: "EDIT" }] },
      // The default sections every project gets, so an app that does not know PIPELINE opens an empty task project.
      taskLists: { create: [{ name: "To Do", position: 0 }, { name: "In Progress", position: 1 }, { name: "Done", position: 2 }] },
    },
  })
  await prisma.conversation.create({
    data: {
      id: "demo-proj-pipeline-room", type: "PROJECT", projectId: "demo-proj-pipeline", name: "Sales Pipeline", workspaceId: DEMO_WS,
      members: { create: ["sales", "owner", "bod", "finance"].map((m) => ({ userId: uid(m), lastReadAt: now })) },
    },
  })
  const yy = todayKey.slice(2, 4)
  type DealSeed = {
    name: string; brand: string; services: string[]; stage: string; prob: number; contract: number; net: number
    bd: string; pm?: string; costs?: [string, number][]; contractStatus?: string; deliverableStatus?: string; deliverableRisk?: string
    closingStatus?: string; mainDate?: number; nextAction?: string; nextActionDate?: number; blocker?: string
    terms?: { label: string; pct: number; due: number; paid?: boolean; invoiced?: boolean }[]
  }
  const deals: DealSeed[] = [
    { name: "Coffee chain rebrand", brand: "Kopi Contoh", services: ["Creative", "Production"], stage: "Won – In Execution", prob: 1, contract: 185_000_000, net: 166_500_000, bd: "sales", pm: "creative",
      costs: [["Packaging print run", 28_000_000], ["Film crew (2 days)", 31_500_000], ["Freelance illustrator", 9_000_000]], contractStatus: "Fully Executed", deliverableStatus: "In Progress", mainDate: 21,
      nextAction: "Packaging mockups to client", nextActionDate: 6, terms: [{ label: "DP 40%", pct: 0.4, due: -20, paid: true, invoiced: true }, { label: "Termin 2 (40%)", pct: 0.4, due: 25, invoiced: true }, { label: "Final 20%", pct: 0.2, due: 50 }] },
    { name: "Year-end gala for a fintech", brand: "Fintek Demo", services: ["Event", "Production"], stage: "Won – Contract Pending", prob: 0.9, contract: 420_000_000, net: 378_000_000, bd: "sales", pm: "producer",
      costs: [["Venue", 95_000_000], ["Stage and lighting", 72_000_000], ["Catering", 64_000_000], ["Talent", 40_000_000]], contractStatus: "Client Review", deliverableStatus: "Briefing", mainDate: 48,
      nextAction: "Chase signed contract", nextActionDate: 2, blocker: "Contract still with the client's legal team" },
    { name: "Product launch livestream", brand: "Gadget Fiktif", services: ["Multimedia", "Digital Campaign"], stage: "Negotiation", prob: 0.5, contract: 150_000_000, net: 135_000_000, bd: "sales",
      costs: [["Streaming crew", 22_000_000], ["Host fee", 15_000_000]], nextAction: "Send revised quote (two cameras, not three)", nextActionDate: 1 },
    { name: "Retail pop-up booth", brand: "Sepatu Sampel", services: ["Exhibition", "Activation"], stage: "Proposal / Quotation", prob: 0.25, contract: 95_000_000, net: 85_500_000, bd: "owner",
      costs: [["Booth build (estimate)", 38_000_000]], nextAction: "Pitch meeting", nextActionDate: 9 },
    { name: "Social retainer (6 months)", brand: "Teh Ilustrasi", services: ["Digital Campaign", "Creative"], stage: "Incoming", prob: 0.1, contract: 240_000_000, net: 216_000_000, bd: "sales",
      nextAction: "Discovery call", nextActionDate: 3 },
    { name: "Annual report design", brand: "Yayasan Rekaan", services: ["Creative"], stage: "Closing", prob: 1, contract: 60_000_000, net: 54_000_000, bd: "owner", pm: "designer",
      costs: [["Printing (500 copies)", 14_500_000], ["Photography", 6_000_000]], contractStatus: "Fully Executed", deliverableStatus: "Completed", closingStatus: "Waiting Client Payment", mainDate: -12,
      terms: [{ label: "DP 50%", pct: 0.5, due: -45, paid: true, invoiced: true }, { label: "Pelunasan 50%", pct: 0.5, due: -5, invoiced: true }] },
    { name: "Music festival stage branding", brand: "Festival Imajiner", services: ["Event", "Creative"], stage: "Closed", prob: 1, contract: 310_000_000, net: 279_000_000, bd: "sales", pm: "producer",
      costs: [["Stage fabrication", 120_000_000], ["LED screens", 58_000_000], ["Crew", 35_000_000]], contractStatus: "Fully Executed", deliverableStatus: "Completed", closingStatus: "Closed", mainDate: -40,
      terms: [{ label: "DP 50%", pct: 0.5, due: -70, paid: true, invoiced: true }, { label: "Pelunasan 50%", pct: 0.5, due: -30, paid: true, invoiced: true }] },
    { name: "Corporate video series", brand: "Logistik Contoh", services: ["Production"], stage: "Lost / Cancelled", prob: 0, contract: 130_000_000, net: 117_000_000, bd: "owner",
      blocker: "Client moved the budget to next year" },
  ]
  const stageOrder = new Map<string, number>()
  for (const [i, d] of deals.entries()) {
    const pos = (stageOrder.get(d.stage) ?? 0) + 1024
    stageOrder.set(d.stage, pos)
    const id = `demo-deal-${i + 1}`
    const paidTerms = (d.terms ?? []).filter((t) => t.paid).reduce((a, t) => a + Math.round(d.contract * t.pct), 0)
    const invoicedTerms = (d.terms ?? []).filter((t) => t.invoiced).reduce((a, t) => a + Math.round(d.contract * t.pct), 0)
    await prisma.pipelineDeal.create({
      data: {
        id, projectId: "demo-proj-pipeline", code: `${DEAL_CODE_PREFIX}${yy}${String(i + 1).padStart(3, "0")}`, position: pos,
        name: d.name, brand: d.brand, service: d.services[0], services: d.services,
        bdUserId: uid(d.bd), pmUserId: d.pm ? uid(d.pm) : null,
        stage: d.stage, probability: d.prob, contractValue: d.contract, netValue: d.net, invoiceValue: invoicedTerms,
        contractStatus: d.contractStatus ?? "Not Started", deliverableStatus: d.deliverableStatus ?? "Not Started", deliverableRisk: d.deliverableRisk ?? "Aman",
        paymentStatus: d.terms ? (paidTerms >= d.contract ? "Paid" : paidTerms > 0 ? "Partial" : "Not Yet") : "Not Yet",
        outstandingReceivable: invoicedTerms - paidTerms,
        closingStatus: d.closingStatus ?? "Not Ready",
        mainDate: d.mainDate !== undefined ? at(d.mainDate, "09:00") : null,
        nextAction: d.nextAction ?? "", nextActionDate: d.nextActionDate !== undefined ? at(d.nextActionDate, "09:00") : null,
        blocker: d.blocker ?? "",
        costs: (d.costs ?? []).map(([label, amount], j) => ({ id: `${id}-cost-${j + 1}`, label, amount })),
        createdById: uid(d.bd), updatedById: uid(d.bd), createdAt: at(-30 + i * 3, "10:00"),
        terms: d.terms
          ? {
              create: d.terms.map((t, j) => ({
                id: `${id}-term-${j + 1}`, position: (j + 1) * 1024, label: t.label, amount: Math.round(d.contract * t.pct), dueDate: at(t.due, "09:00"),
                invoiceNo: t.invoiced ? `INV/DEMO/${yy}/${String(i + 1).padStart(2, "0")}${j + 1}` : "", invoiceDate: t.invoiced ? at(t.due - 14, "09:00") : null,
                paidAmount: t.paid ? Math.round(d.contract * t.pct) : 0, paidAt: t.paid ? at(t.due - 2, "14:00") : null,
              })),
            }
          : undefined,
      },
    })
  }

  // ── Chat ───────────────────────────────────────────────────────────────────────────────────────────────
  const everyone = PEOPLE.map((p) => p.key)
  await prisma.conversation.create({
    data: {
      id: "demo-chat-general", type: "GROUP", name: "Studio General", description: "Announcements and everyday chatter.", workspaceId: DEMO_WS,
      members: { create: everyone.map((k) => ({ userId: uid(k), lastReadAt: at(0, "08:00") })) },
    },
  })
  await prisma.conversation.create({
    data: {
      id: "demo-chat-dm", type: "DM", workspaceId: DEMO_WS,
      members: { create: ["owner", "creative"].map((k) => ({ userId: uid(k), lastReadAt: at(0, "08:00") })) },
    },
  })
  const messages: [string, string, string, number, string][] = [
    ["demo-chat-general", "owner", "Morning all! Reminder: town hall on Friday at 4 pm in the meeting room.", -1, "08:45"],
    ["demo-chat-general", "creative", "Logo route B is approved by the client 🎉", -1, "11:20"],
    ["demo-chat-general", "designer", "Finally! Packaging mockups next.", -1, "11:22"],
    ["demo-chat-general", "finance", "Please log receipts for last week's shoot before Thursday.", -1, "14:05"],
    ["demo-chat-general", "producer", "Studio is booked Tuesday afternoon for the timelapse.", 0, "09:10"],
    ["demo-chat-general", "content", "Newsletter draft is in review, comments welcome.", 0, "10:02"],
    ["demo-chat-dm", "owner", "Can we show the brand refresh in Monday's client review?", 0, "09:30"],
    ["demo-chat-dm", "creative", "Yes, I'll prepare a 10-minute walkthrough with the mockups.", 0, "09:34"],
    ["demo-proj-brand-room", "creative", "Shoot dates are locked, see the timeline.", -1, "15:00"],
    ["demo-proj-brand-room", "producer", "Crew confirmed. Call sheet goes out Friday.", -1, "15:12"],
    ["demo-proj-pipeline-room", "sales", "Gala contract is with their legal team, following up tomorrow.", 0, "13:40"],
  ]
  for (const [i, [room, who, content, day, time]] of messages.entries()) {
    await prisma.message.create({ data: { id: `demo-msg-${String(i + 1).padStart(2, "0")}`, conversationId: room, userId: uid(who), content, createdAt: at(day, time) } })
  }
  for (const room of ["demo-chat-general", "demo-chat-dm", "demo-proj-brand-room", "demo-proj-pipeline-room"]) {
    const last = messages.filter((m) => m[0] === room).map((m) => at(m[3], m[4])).sort((a, b) => b.getTime() - a.getTime())[0]
    if (last) await prisma.conversation.update({ where: { id: room }, data: { updatedAt: last } })
  }

  // ── Attendance: a fictional office (open sea, far from any real office), three weeks of history ───────
  await prisma.officeLocation.create({
    data: {
      id: "demo-office", name: "Demo Studio HQ (fictional)", address: null, latitude: -5.5, longitude: 110.0, radiusMeters: 150,
      workdays: [1, 2, 3, 4, 5], shiftStartTime: "09:00", shiftEndTime: "18:00", lateGraceMinutes: 15, workspaceId: DEMO_WS,
    },
  })
  const reflections = [
    "Finished the revisions the client asked for this morning and shared the files with the team. Spent the afternoon on the next deliverable and cleared two small requests from the board. Tomorrow I want to wrap up the open review comments first.",
    "Worked through the task list for the brand project: two items moved to review and one is blocked on feedback. Joined the planning call and updated the timeline. Next up is preparing material for the shoot and checking the budget numbers.",
    "Most of today went into production prep: confirmed the crew, checked equipment and wrote the call sheet. Also answered questions in the project chat. Tomorrow I will finish the storyboard notes and send them for review before noon.",
    "Reviewed the content calendar, scheduled three posts and drafted the newsletter. Had a short sync with design about the carousel. No blockers right now; tomorrow I will record the voice-over and update the posting schedule for next week.",
  ]
  const attendance: object[] = []
  for (let off = -21; off <= -1; off++) {
    const key = dayKey(off)
    if (isoWeekday(key) > 5) continue
    for (const k of everyone) {
      if (rnd() < 0.06) continue // the odd day off / leave
      const inMin = 9 * 60 - 25 + Math.floor(rnd() * 50) // 08:35 … 09:24
      const outMin = 18 * 60 - 10 + Math.floor(rnd() * 70) // 17:50 … 18:59
      const late = inMin > 9 * 60 + 15 ? inMin - 9 * 60 : 0
      const early = outMin < 18 * 60 ? 18 * 60 - outMin : 0
      attendance.push({
        id: `demo-att-${k}-${key}`,
        attendanceDate: new Date(`${key}T00:00:00Z`),
        checkInAt: at(off, hhmm(inMin)), checkOutAt: at(off, hhmm(outMin)),
        effectiveShiftSource: "OFFICE", effectiveShiftStartTime: "09:00", effectiveShiftEndTime: "18:00",
        checkInStatus: late ? "LATE" : "ON_TIME", checkOutStatus: early ? "EARLY_LEAVE" : outMin > 18 * 60 + 30 ? "OVERTIME" : "ON_TIME",
        lateMinutes: late, earlyLeaveMinutes: early, workedMinutes: outMin - inMin,
        checkOutReflection: pick(reflections), checkOutReflectionAt: at(off, hhmm(outMin)),
        checkInClient: "web", locationTrackingState: "web",
        status: "COMPLETED", userId: uid(k), workspaceId: DEMO_WS, officeLocationId: "demo-office",
      })
    }
  }
  await prisma.attendanceRecord.createMany({ data: attendance as never })
  await prisma.attendanceRequest.createMany({
    data: [
      { id: "demo-req-leave", type: "LEAVE", status: "APPROVED", reason: "Family trip, planned two months ago.", startDate: new Date(`${dayKey(10)}T00:00:00Z`), endDate: new Date(`${dayKey(11)}T00:00:00Z`), userId: uid("designer"), workspaceId: DEMO_WS, reviewedById: uid("creative"), reviewedAt: at(-2, "10:00"), approvalSource: "DIRECT_MANAGER" },
      { id: "demo-req-sick", type: "SICK", status: "PENDING", reason: "Fever since last night, resting today.", startDate: new Date(`${dayKey(1)}T00:00:00Z`), endDate: new Date(`${dayKey(1)}T00:00:00Z`), userId: uid("producer"), workspaceId: DEMO_WS },
    ],
  })

  // ── Room bookings ──────────────────────────────────────────────────────────────────────────────────────
  const bookings: [string, string, string, number, string, string][] = [
    ["Ruang Meeting VIP", "Client review: brand refresh", "creative", 0, "14:00", "15:00"],
    ["Studio", "Process timelapse shoot", "producer", 1, "13:00", "17:00"],
    ["Ruang Meeting", "Weekly content planning", "content", 1, "10:00", "11:00"],
    ["Ruang Meeting", "Pipeline review", "sales", 2, "09:30", "10:30"],
    ["Ruang Meeting VIP", "Pitch rehearsal", "sales", 3, "15:00", "16:30"],
    ["Ruang Meeting", "Town hall", "owner", 3, "16:00", "17:00"],
    ["Studio", "Podcast pilot recording", "content", 6, "10:00", "12:00"],
  ]
  await prisma.roomBooking.createMany({
    data: bookings.map(([room, title, who, day, from, to], i) => ({
      id: `demo-booking-${i + 1}`, room, title, startsAt: at(day, from), endsAt: at(day, to), workspaceId: DEMO_WS, createdById: uid(who),
    })),
  })

  // ── XP for the leaderboard (this period; BoD and owner are not ranked) ─────────────────────────────────
  const xpRows: object[] = []
  for (const p of PEOPLE) {
    if (!p.xp) continue
    const parts = p.xp > 0 ? [Math.round(p.xp * 0.6), p.xp - Math.round(p.xp * 0.6)] : [p.xp]
    parts.forEach((amount, j) => xpRows.push({ id: `demo-xp-${p.key}-${j + 1}`, userId: uid(p.key), amount, reason: amount > 0 ? (j ? "quest" : "task_done") : "late", createdAt: at(-1 - j * 2, "17:00") }))
  }
  await prisma.xpTransaction.createMany({ data: xpRows as never })
  await prisma.userXp.createMany({ data: PEOPLE.map((p) => ({ id: `demo-userxp-${p.key}`, userId: uid(p.key), totalXp: 1000 + p.xp })) })

  console.log(`seeded Demo Studio: ${PEOPLE.length} members, 4 projects, ${deals.length} deals, ${submissions.length} form submissions, ${messages.length} messages, ${attendance.length} attendance days, ${bookings.length} room bookings`)
  console.log(`login: ${OWNER_EMAIL} (password from DEMO_PASSWORD)`)
}

async function main() {
  if (process.argv.includes("--remove")) {
    await removeDemo()
    return
  }
  const password = process.env.DEMO_PASSWORD ?? ""
  if (password.length < 12) throw new Error("DEMO_PASSWORD (at least 12 characters) is required to seed")
  await seedDemo(password)
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
