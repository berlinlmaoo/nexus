export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID, isOrgBodPlus } from "@/lib/org"
import { logAudit } from "@/lib/audit"
import { auditDiff } from "@/lib/audit-describe"
import {
  CREDIT_ROLES, MAX_LIMIT, creditKeys, creditsEnforced, getCreditPolicy, limitsFrom, periodInfo, saveCreditPolicy,
  type CreditPolicy, type CreditRole,
} from "@/lib/gideon-credits"

/**
 * Control Room › GIDEON › Credits (owner, 18 Oct 2026). BoD / One Above All of the company workspace only.
 *   GET ?period=YYYY-MM   role defaults, and every member's limits and usage for that period (default: now)
 *   PUT { policy }        change the role defaults (audited)
 * Counts and credits only — never what anybody asked.
 */
async function guard() {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!(await isOrgBodPlus(session.user.id))) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { userId: session.user.id }
}

export async function GET(req: NextRequest) {
  const g = await guard()
  if ("error" in g) return g.error
  try {
    const now = creditKeys()
    const asked = new URL(req.url).searchParams.get("period")
    const periodKey = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : now.periodKey
    const isCurrent = periodKey === now.periodKey
    const [policy, enforced, members, overrides, bonuses, periodUse, tierUse, todayUse] = await Promise.all([
      getCreditPolicy(),
      creditsEnforced(),
      prisma.workspaceMember.findMany({
        where: { workspaceId: ORG_WORKSPACE_ID },
        select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } } },
      }),
      prisma.gideonCreditOverride.findMany(),
      prisma.gideonCreditBonus.groupBy({ by: ["userId"], where: { periodKey }, _sum: { credits: true } }),
      prisma.gideonCreditUsage.groupBy({
        by: ["userId"], where: { periodKey, billable: true },
        _sum: { credits: true, poolCredits: true, overCredits: true, costMicroUsd: true }, _count: { _all: true },
      }),
      prisma.gideonCreditUsage.groupBy({ by: ["userId", "tier"], where: { periodKey, billable: true }, _sum: { credits: true }, _count: { _all: true } }),
      isCurrent
        ? prisma.gideonCreditUsage.groupBy({ by: ["userId"], where: { dayKey: now.dayKey, billable: true }, _sum: { credits: true, dailyCredits: true }, _count: { _all: true } })
        : Promise.resolve([] as { userId: string; _sum: { credits: number | null; dailyCredits: number | null }; _count: { _all: number } }[]),
    ])
    const overrideOf = new Map(overrides.map((o) => [o.userId, o]))
    const bonusOf = new Map(bonuses.map((b) => [b.userId, b._sum.credits ?? 0]))
    const periodOf = new Map(periodUse.map((u) => [u.userId, u]))
    const todayOf = new Map(todayUse.map((u) => [u.userId, u]))
    const tiersOf = new Map<string, Record<string, { credits: number; answers: number }>>()
    for (const t of tierUse) {
      const m = tiersOf.get(t.userId) ?? {}
      m[t.tier] = { credits: t._sum.credits ?? 0, answers: t._count._all }
      tiersOf.set(t.userId, m)
    }

    // Members, plus anyone billed this period who is no longer one (offboarded mid-period).
    const people = members.map((m) => ({ ...m.user, role: m.role as CreditRole | null }))
    const known = new Set(people.map((p) => p.id))
    const extraIds = periodUse.map((u) => u.userId).filter((id) => !known.has(id))
    if (extraIds.length) {
      const extra = await prisma.user.findMany({ where: { id: { in: extraIds } }, select: { id: true, name: true, email: true, avatar: true } })
      people.push(...extra.map((u) => ({ ...u, role: null })))
    }

    const rows = people.map((p) => {
      const o = overrideOf.get(p.id) ?? null
      const limits = limitsFrom(p.role, policy, o, bonusOf.get(p.id) ?? 0)
      const pu = periodOf.get(p.id)
      const tu = todayOf.get(p.id)
      return {
        id: p.id, name: p.name, email: p.email, avatar: p.avatar, role: p.role,
        limits,
        override: o ? { dailyLimit: o.dailyLimit, monthlyLimit: o.monthlyLimit, unlimited: o.unlimited, note: o.note, updatedAt: o.updatedAt } : null,
        today: isCurrent ? { used: tu?._sum.credits ?? 0, daily: tu?._sum.dailyCredits ?? 0, answers: tu?._count._all ?? 0 } : null,
        period: {
          used: pu?._sum.credits ?? 0, pool: pu?._sum.poolCredits ?? 0, over: pu?._sum.overCredits ?? 0,
          answers: pu?._count._all ?? 0, costMicroUsd: pu?._sum.costMicroUsd ?? 0,
        },
        tiers: tiersOf.get(p.id) ?? {},
      }
    })
    rows.sort((a, b) => b.period.used - a.period.used || (a.name || "").localeCompare(b.name || ""))

    const byRole = Object.fromEntries(CREDIT_ROLES.map((r) => {
      const of = rows.filter((x) => x.role === r)
      return [r, { people: of.length, used: of.reduce((s, x) => s + x.period.used, 0), answers: of.reduce((s, x) => s + x.period.answers, 0) }]
    }))
    return NextResponse.json({
      policy, enforced, periodKey, currentPeriodKey: now.periodKey, dayKey: now.dayKey, period: periodInfo(periodKey), isCurrent,
      people: rows, byRole,
      totals: { used: rows.reduce((s, x) => s + x.period.used, 0), answers: rows.reduce((s, x) => s + x.period.answers, 0), costMicroUsd: rows.reduce((s, x) => s + x.period.costMicroUsd, 0) },
    })
  } catch (error) {
    console.error("gideon credits admin error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const g = await guard()
  if ("error" in g) return g.error
  const body = (await req.json().catch(() => null)) as { policy?: Partial<CreditPolicy> } | null
  const incoming = body?.policy
  if (!incoming || typeof incoming !== "object" || !incoming.roles || typeof incoming.roles !== "object") {
    return NextResponse.json({ error: "policy.roles is required" }, { status: 400 })
  }
  for (const r of CREDIT_ROLES) {
    const v = (incoming.roles as Record<string, unknown>)[r] as Record<string, unknown> | undefined
    if (!v) continue
    for (const k of ["daily", "monthly"] as const) {
      const n = v[k]
      if (n !== undefined && (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_LIMIT)) {
        return NextResponse.json({ error: `${r}.${k} must be a whole number between 0 and ${MAX_LIMIT}` }, { status: 400 })
      }
    }
    if (v.unlimited !== undefined && typeof v.unlimited !== "boolean") return NextResponse.json({ error: `${r}.unlimited must be true or false` }, { status: 400 })
  }
  try {
    const before = await getCreditPolicy()
    const merged: CreditPolicy = {
      roles: Object.fromEntries(CREDIT_ROLES.map((r) => [r, { ...before.roles[r], ...((incoming.roles as Record<string, object>)[r] ?? {}) }])) as CreditPolicy["roles"],
      fallbackPerDay: typeof incoming.fallbackPerDay === "number" ? incoming.fallbackPerDay : before.fallbackPerDay,
    }
    const saved = await saveCreditPolicy(merged)
    const flat = (p: CreditPolicy) => Object.fromEntries([
      ...CREDIT_ROLES.flatMap((r) => [[`${r}.unlimited`, p.roles[r].unlimited], [`${r}.daily`, p.roles[r].daily], [`${r}.monthly`, p.roles[r].monthly]]),
      ["fallbackPerDay", p.fallbackPerDay],
    ])
    await logAudit({
      action: "GIDEON_CREDITS_POLICY_UPDATED",
      entityType: "GideonCredits",
      entityId: "policy",
      entityName: "GIDEON credits · role defaults",
      userId: g.userId,
      metadata: { changes: auditDiff(flat(before), flat(saved)) },
      request: req,
    })
    return NextResponse.json({ policy: saved })
  } catch (error) {
    console.error("gideon credits policy error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
