export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import type { Prisma, SystemRole } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"

const SYSTEM_ROLES: SystemRole[] = ["ADMIN", "MEMBER"]
const MEMBERSHIP_FILTERS = ["all", "workspace-members", "non-members", "system-admins"] as const

export async function GET(request: NextRequest) {
  try {
    const { context } = await getAdminSessionContext()

    if (!context?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!context.canAccessUserManagement) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""
    const membershipFilter = request.nextUrl.searchParams.get("membershipFilter") ?? "all"
    const systemRole = request.nextUrl.searchParams.get("systemRole") ?? "all"
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || "1"))
    const pageSize = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || "20")))

    const where: Prisma.UserWhereInput = {}

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ]
    }

    if (SYSTEM_ROLES.includes(systemRole as SystemRole)) {
      where.role = systemRole as SystemRole
    }

    if ((MEMBERSHIP_FILTERS as readonly string[]).includes(membershipFilter)) {
      if (membershipFilter === "workspace-members") {
        where.workspaceMembers = { some: {} }
      } else if (membershipFilter === "non-members") {
        where.workspaceMembers = { none: {} }
      } else if (membershipFilter === "system-admins") {
        where.role = "ADMIN"
      }
    }

    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          role: true,
          createdAt: true,
          workspaceMembers: {
            select: { joinedAt: true },
            orderBy: { joinedAt: "asc" },
            take: 1,
          },
          _count: {
            select: { workspaceMembers: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return NextResponse.json({
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        createdAt: user.createdAt,
        firstJoinedAt: user.workspaceMembers[0]?.joinedAt ?? null,
        workspaceMembershipCount: user._count.workspaceMembers,
      })),
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      filters: {
        q,
        membershipFilter,
        systemRole,
      },
    })
  } catch (error) {
    console.error("Error fetching admin users:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
