import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { restorableSoftDelete } from "@/lib/deletion-snapshot"

/** Quests are made and managed by BoD and up (owner, 16 Oct 2026; Manager could before). */
async function canManage(userId: string, workspaceId: string): Promise<boolean> {
  const m = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } }, select: { role: true } })
  return m?.role === "BOD" || m?.role === "ONE_ABOVE_ALL"
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const workspaceId = req.nextUrl.searchParams.get("workspaceId")
    if (!workspaceId) return NextResponse.json({ quests: [] })
    // The admin list (every quest in the workspace, with its audience and the delete action) is for the
    // people who may manage quests — the same rule as POST/DELETE. Any member passed before, so Staff got
    // the whole list (QA 13 Oct 2026). A member's own quests come from GET /api/gamification/me. The
    // released apps call this only from their admin screens and treat a failure as an empty list.
    if (!(await canManage(session.user.id, workspaceId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const quests = await prisma.quest.findMany({ where: { workspaceId, isActive: true }, orderBy: { createdAt: "desc" } })
    return NextResponse.json({ quests })
  } catch (error) {
    console.error("admin quests GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { workspaceId, title, description, requirementType, requiredCount, xpReward, teamIds, unitIds, userIds, taskIds, deadline } = await req.json()
    if (!title || !requirementType) return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    // Hadiah XP di-cap maks 50.
    const xp = Number.isFinite(Number(xpReward)) ? Math.max(0, Math.min(50, Math.trunc(Number(xpReward)))) : 50
    const teams = Array.isArray(teamIds) ? teamIds.filter((t: unknown): t is string => typeof t === "string" && t.length > 0) : []
    // Divisions / units of the IP & Division Chart (13 Oct 2026). Older clients send no unitIds = everyone.
    const units = Array.isArray(unitIds) ? [...new Set(unitIds.filter((t: unknown): t is string => typeof t === "string" && t.length > 0))] : []
    // Chosen people (owner, 16 Oct 2026). Older clients send no userIds = not per person.
    const people = Array.isArray(userIds) ? [...new Set(userIds.filter((t: unknown): t is string => typeof t === "string" && t.length > 0))] : []
    let deadlineDate: Date | null = null
    if (deadline) {
      const d = new Date(deadline)
      if (!Number.isNaN(d.getTime())) deadlineDate = d
    }

    // specific_tasks: the quest is a bundle of exact tasks. Derive the workspace FROM the tasks (so the
    // "Jadiin quest" button only needs taskIds), require they all live in ONE workspace, pin requiredCount.
    let wsId: string | null = typeof workspaceId === "string" && workspaceId ? workspaceId : null
    let tasks: string[] = []
    let reqCount = Number(requiredCount) || 1
    if (requirementType === "specific_tasks") {
      tasks = Array.isArray(taskIds) ? [...new Set(taskIds.filter((t: unknown): t is string => typeof t === "string" && t.length > 0))] : []
      if (tasks.length === 0) return NextResponse.json({ error: "Pilih minimal 1 task buat quest ini." }, { status: 400 })
      const taskRows = await prisma.task.findMany({ where: { id: { in: tasks } }, select: { id: true, taskList: { select: { project: { select: { workspaceId: true } } } } } })
      if (taskRows.length !== tasks.length) return NextResponse.json({ error: "Ada task yang gak ketemu." }, { status: 400 })
      const wsSet = new Set(taskRows.map((r) => r.taskList?.project?.workspaceId).filter((w): w is string => !!w))
      if (wsSet.size !== 1) return NextResponse.json({ error: "Semua task harus dari workspace yang sama." }, { status: 400 })
      wsId = [...wsSet][0]
      reqCount = tasks.length
    }

    if (!wsId) return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    if (!(await canManage(session.user.id, wsId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (units.length) {
      const found = await prisma.orgUnit.count({ where: { id: { in: units }, workspaceId: wsId } })
      if (found !== units.length) return NextResponse.json({ error: "Divisi tidak ditemukan di workspace ini.", code: "UNKNOWN_UNIT" }, { status: 400 })
    }
    if (people.length && !tasks.length) {
      const found = await prisma.workspaceMember.count({ where: { userId: { in: people }, workspaceId: wsId } })
      if (found !== people.length) return NextResponse.json({ error: "Ada orang yang bukan anggota workspace ini.", code: "UNKNOWN_USER" }, { status: 400 })
    }

    const quest = await prisma.quest.create({
      data: { workspaceId: wsId, title: String(title).trim(), description: description || null, requirementType, requiredCount: reqCount, xpReward: xp, teamIds: teams, unitIds: tasks.length ? [] : units, userIds: tasks.length ? [] : people, taskIds: tasks, deadline: deadlineDate, createdById: session.user.id },
    })
    return NextResponse.json({ quest }, { status: 201 })
  } catch (error) {
    console.error("admin quests POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const id = req.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
    const quest = await prisma.quest.findUnique({ where: { id }, select: { workspaceId: true, title: true } })
    if (!quest) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canManage(session.user.id, quest.workspaceId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    // In the audit now, with a copy of the flag so Control Room → Audit can switch it back on.
    await restorableSoftDelete({
      entityType: "quest", entityId: id, entityName: quest.title, workspaceId: quest.workspaceId,
      userId: session.user.id, request: req, meta: { open: null },
      apply: (tx) => tx.quest.update({ where: { id }, data: { isActive: false } }),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("admin quests DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
