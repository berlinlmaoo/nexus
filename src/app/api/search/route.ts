export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const q = request.nextUrl.searchParams.get("q")
    if (!q || q.trim().length === 0) {
      return NextResponse.json({ tasks: [], projects: [], comments: [], docs: [], members: [], goals: [], forms: [], sprints: [] })
    }

    const query = q.trim()

    // Optional filters
    const projectId = request.nextUrl.searchParams.get("projectId")
    const assigneeId = request.nextUrl.searchParams.get("assigneeId")
    const status = request.nextUrl.searchParams.get("status")
    const startDate = request.nextUrl.searchParams.get("startDate")
    const endDate = request.nextUrl.searchParams.get("endDate")

    // Build task filters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taskWhere: any = {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    }
    if (projectId) {
      taskWhere.taskList = { projectId }
    }
    if (assigneeId) {
      taskWhere.assignees = { some: { userId: assigneeId } }
    }
    const VALID_TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]
    if (status && VALID_TASK_STATUSES.includes(status)) {
      taskWhere.status = status
    }
    if (startDate || endDate) {
      taskWhere.createdAt = {}
      if (startDate) taskWhere.createdAt.gte = new Date(startDate)
      if (endDate) taskWhere.createdAt.lte = new Date(endDate)
    }

    // Build project filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projectWhere: any = {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    }
    if (projectId) {
      projectWhere.id = projectId
    }

    // Goal filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const goalWhere: any = {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    }
    if (status) {
      goalWhere.status = status
    }

    // Sprint filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sprintWhere: any = {
      name: { contains: query, mode: "insensitive" },
    }
    if (projectId) {
      sprintWhere.projectId = projectId
    }
    if (status) {
      sprintWhere.status = status
    }

    // Form filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formWhere: any = {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    }
    if (projectId) {
      formWhere.projectId = projectId
    }

    const [tasks, projects, comments, docs, members, goals, forms, sprints] = await Promise.all([
      prisma.task.findMany({
        where: taskWhere,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          taskList: { select: { projectId: true, project: { select: { name: true } } } },
        },
        take: 10,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.project.findMany({
        where: projectWhere,
        select: { id: true, name: true, color: true, icon: true, status: true },
        take: 10,
      }),
      prisma.comment.findMany({
        where: { content: { contains: query, mode: "insensitive" } },
        select: {
          id: true,
          content: true,
          taskId: true,
          task: { select: { title: true } },
          user: { select: { id: true, name: true } },
        },
        take: 10,
      }),
      prisma.doc.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { contentText: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { name: true } },
        },
        take: 10,
      }),
      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, email: true, avatar: true },
        take: 5,
      }),
      prisma.goal.findMany({
        where: goalWhere,
        select: {
          id: true,
          title: true,
          status: true,
          progress: true,
          owner: { select: { name: true } },
        },
        take: 10,
      }),
      prisma.form.findMany({
        where: formWhere,
        select: {
          id: true,
          name: true,
          projectId: true,
          project: { select: { name: true } },
          isPublic: true,
        },
        take: 10,
      }),
      prisma.sprint.findMany({
        where: sprintWhere,
        select: {
          id: true,
          name: true,
          status: true,
          startDate: true,
          endDate: true,
          projectId: true,
          project: { select: { name: true } },
        },
        take: 10,
      }),
    ])

    // Add relevance hints: exact matches first, then partial
    const addRelevance = <T extends { [key: string]: unknown }>(
      items: T[],
      field: string
    ): (T & { relevance: "exact" | "partial" })[] => {
      const lowerQuery = query.toLowerCase()
      return items.map((item) => {
        const value = String((item as Record<string, unknown>)[field] ?? "").toLowerCase()
        return {
          ...item,
          relevance: value === lowerQuery ? "exact" as const : "partial" as const,
        }
      }).sort((a, b) => (a.relevance === "exact" ? -1 : 1) - (b.relevance === "exact" ? -1 : 1))
    }

    return NextResponse.json({
      tasks: addRelevance(tasks, "title"),
      projects: addRelevance(projects, "name"),
      comments,
      docs: addRelevance(docs, "title"),
      members: addRelevance(members, "name"),
      goals: addRelevance(goals, "title"),
      forms: addRelevance(forms, "name"),
      sprints: addRelevance(sprints, "name"),
    })
  } catch (error) {
    console.error("Error searching:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
