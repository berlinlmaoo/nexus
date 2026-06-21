import prisma from "@/lib/prisma"
import { checkWorkspaceAccess } from "@/lib/rbac"

/**
 * P&L dashboard access gate: BoD and above ONLY (workspace role BOD / ONE_ABOVE_ALL, or system
 * ADMIN via checkWorkspaceAccess's built-in bypass). Managers and staff are excluded by the
 * user's explicit decision — financial data is the most sensitive thing in the workspace.
 * Returns the project (id + workspaceId + flag) so callers don't re-fetch it.
 */
export async function checkPnlAccess(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, workspaceId: true, enablePnlDashboard: true },
  })
  if (!project) return { allowed: false as const, status: 404 as const, error: "Project not found", project: null }
  const { allowed } = await checkWorkspaceAccess(userId, project.workspaceId, "BOD")
  if (!allowed) return { allowed: false as const, status: 403 as const, error: "Forbidden", project: null }
  return { allowed: true as const, status: 200 as const, error: null, project }
}

/** Resolve an expense and gate it behind P&L access to its project. */
export async function checkPnlExpenseAccess(userId: string, expenseId: string) {
  const expense = await prisma.pnlExpense.findUnique({
    where: { id: expenseId },
    select: { id: true, projectId: true },
  })
  if (!expense) return { allowed: false as const, status: 404 as const, error: "Expense not found", expense: null }
  const gate = await checkPnlAccess(userId, expense.projectId)
  if (!gate.allowed) return { allowed: false as const, status: gate.status, error: gate.error, expense: null }
  return { allowed: true as const, status: 200 as const, error: null, expense }
}

/** Resolve an income deal and gate it behind P&L access to its project. */
export async function checkPnlIncomeAccess(userId: string, incomeId: string) {
  const income = await prisma.pnlIncome.findUnique({
    where: { id: incomeId },
    select: { id: true, projectId: true },
  })
  if (!income) return { allowed: false as const, status: 404 as const, error: "Income not found", income: null }
  const gate = await checkPnlAccess(userId, income.projectId)
  if (!gate.allowed) return { allowed: false as const, status: gate.status, error: gate.error, income: null }
  return { allowed: true as const, status: 200 as const, error: null, income }
}

/** Money amounts: finite, non-negative, and inside Postgres float-safe integer range. */
export function validAmount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e15
}

/** Parse "YYYY-MM-DD" (or ISO) into a UTC-midnight Date; null if invalid. Year is bounded to
 *  2000–2100 so a typo like 0206/20026 can't create an entry no year-scoped view will ever show. */
export function parsePnlDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (!m) return null
  const year = Number(m[1])
  if (year < 2000 || year > 2100) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`)
  return isNaN(d.getTime()) ? null : d
}

const pad2 = (n: number) => String(n).padStart(2, "0")

/** Month key ("YYYY-MM") helpers for the recurring cursor. */
export function pnlMonthKey(y: number, m: number) {
  return `${y}-${pad2(m)}`
}
/**
 * The cursor value that makes a recurring template start posting from "now": the CURRENT month
 * key once this month's posting day has been reached (already handled), else the PREVIOUS
 * month's key (so the materializer posts the current month when its day arrives — and never
 * backfills anything earlier). Used at creation AND at pause→resume.
 */
export function pnlRecurringCursorForNow(dayOfMonth: number, now: Date = new Date()) {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const dueDay = Math.min(Math.max(1, dayOfMonth), new Date(Date.UTC(y, m, 0)).getUTCDate())
  if (now.getUTCDate() >= dueDay) return pnlMonthKey(y, m)
  return m === 1 ? pnlMonthKey(y - 1, 12) : pnlMonthKey(y, m - 1)
}

const DEFAULT_STAGES = [
  { name: "Penawaran", color: "#94a3b8", order: 0 },
  { name: "Invoice terkirim", color: "#f59e0b", order: 1 },
  { name: "DP / Termin masuk", color: "#0091ff", order: 2 },
  { name: "Lunas", color: "#16a34a", order: 3 },
]

const DEFAULT_CATEGORIES = [
  { name: "Operasional", color: "#0091ff", order: 0 },
  { name: "Gaji & Freelance", color: "#7b68ee", order: 1 },
  { name: "Produksi", color: "#f59e0b", order: 2 },
  { name: "Transport", color: "#06b6d4", order: 3 },
  { name: "Lain-lain", color: "#94a3b8", order: 4 },
]

/**
 * First-open seeding: give a project a sensible starter pipeline + expense categories so the
 * view isn't empty. Idempotent + race-safe (advisory lock; only seeds when the table is empty
 * for the project — user edits/deletes are never overwritten).
 */
export async function ensurePnlDefaults(projectId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pnlseed|${projectId}`})::int8)`
    const [stageCount, catCount] = await Promise.all([
      tx.pnlIncomeStage.count({ where: { projectId } }),
      tx.pnlCategory.count({ where: { projectId } }),
    ])
    if (stageCount === 0) {
      await tx.pnlIncomeStage.createMany({ data: DEFAULT_STAGES.map((s) => ({ ...s, projectId })) })
    }
    if (catCount === 0) {
      await tx.pnlCategory.createMany({ data: DEFAULT_CATEGORIES.map((c) => ({ ...c, projectId })) })
    }
  })
}

// Backfill safety valve: never materialize more than this many missed months per template
// (protects the dashboard GET from a pathological cursor + keeps the sweep transaction fast).
const MAX_BACKFILL_MONTHS = 24

/**
 * Lazily materialize recurring expenses into real PnlExpense rows — called on dashboard load,
 * so no cron is needed. For each active template, posts one entry per month from the month
 * after `lastPostedKey` (or its creation month) through the current month; the current month
 * only posts once `dayOfMonth` has been reached. Months the app "missed" (nobody opened the
 * dashboard) are backfilled — but months a template spent PAUSED are NOT (the PATCH route
 * advances the cursor on resume). Advisory-locked per project so two simultaneous loads can't
 * double-post; rows are batched per template (one createMany) so the sweep stays fast.
 */
export async function postDueRecurringPnlExpenses(projectId: string, now: Date = new Date()) {
  const nowY = now.getUTCFullYear()
  const nowM = now.getUTCMonth() + 1
  const nowD = now.getUTCDate()

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pnlrecur|${projectId}`})::int8)`
    const templates = await tx.pnlRecurringExpense.findMany({
      where: { projectId, active: true },
      select: { id: true, amount: true, description: true, categoryId: true, dayOfMonth: true, lastPostedKey: true, createdAt: true },
    })
    for (const t of templates) {
      // Start from the month AFTER the cursor; a fresh template starts at its creation month.
      let y: number
      let m: number
      const cur = t.lastPostedKey && /^(\d{4})-(\d{2})$/.exec(t.lastPostedKey)
      if (cur) {
        y = Number(cur[1])
        m = Number(cur[2]) + 1
        if (m > 12) { m = 1; y++ }
      } else {
        y = t.createdAt.getUTCFullYear()
        m = t.createdAt.getUTCMonth() + 1
      }
      const rows: { projectId: string; date: Date; amount: number; description: string; categoryId: string | null; recurringId: string }[] = []
      let lastPosted: string | null = null
      while ((y < nowY || (y === nowY && m <= nowM)) && rows.length < MAX_BACKFILL_MONTHS) {
        const isCurrentMonth = y === nowY && m === nowM
        const day = Math.min(Math.max(1, t.dayOfMonth), new Date(Date.UTC(y, m, 0)).getUTCDate())
        if (isCurrentMonth && nowD < day) break // not due yet this month
        rows.push({
          projectId,
          date: new Date(Date.UTC(y, m - 1, day)),
          amount: t.amount,
          description: t.description,
          categoryId: t.categoryId,
          recurringId: t.id,
        })
        lastPosted = pnlMonthKey(y, m)
        m++
        if (m > 12) { m = 1; y++ }
      }
      if (rows.length > 0 && lastPosted) {
        await tx.pnlExpense.createMany({ data: rows })
        await tx.pnlRecurringExpense.update({ where: { id: t.id }, data: { lastPostedKey: lastPosted } })
      }
    }
  }, { timeout: 30_000 })
}
