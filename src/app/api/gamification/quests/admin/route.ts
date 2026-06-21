import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

async function canManage(userId: string, workspaceId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role === "ADMIN") return true
  const m = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } }, select: { role: true } })
  return m?.role === "BOD" || m?.role === "MANAGER" || m?.role === "ONE_ABOVE_ALL"
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const workspaceId = req.nextUrl.searchParams.get("workspaceId")
    if (!workspaceId) return NextResponse.json({ quests: [] })
    const member = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: session.user.id, workspaceId } }, select: { id: true } })
    if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
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
    const { workspaceId, title, description, requirementType, requiredCount, xpReward, teamIds, taskIds, deadline } = await req.json()
    if (!title || !requirementType) return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    // Hadiah XP di-cap maks 50.
    const xp = Number.isFinite(Number(xpReward)) ? Math.max(0, Math.min(50, Math.trunc(Number(xpReward)))) : 50
    const teams = Array.isArray(teamIds) ? teamIds.filter((t: unknown): t is string => typeof t === "string" && t.length > 0) : []
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

    const quest = await prisma.quest.create({
      data: { workspaceId: wsId, title: String(title).trim(), description: description || null, requirementType, requiredCount: reqCount, xpReward: xp, teamIds: teams, taskIds: tasks, deadline: deadlineDate, createdById: session.user.id },
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
    const quest = await prisma.quest.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!quest) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canManage(session.user.id, quest.workspaceId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    await prisma.quest.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("admin quests DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
