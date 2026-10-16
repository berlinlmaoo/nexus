export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import type { Prisma, SystemRole } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { SYSTEM_USER_EMAILS } from "@/lib/system-users"
import { getAdminSessionContext } from "@/lib/admin-access"
import { ORG_WORKSPACE_ID } from "@/lib/org"

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

    // System identities (GIDEON, Automation) sign writes; they are not people to manage here.
    const where: Prisma.UserWhereInput = { email: { notIn: SYSTEM_USER_EMAILS } }

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ]
    }

    // `systemRole` filters on the company role since the system flag was retired (16 Oct 2026):
    // ADMIN = the company's One Above All, MEMBER = everyone else.
    if (SYSTEM_ROLES.includes(systemRole as SystemRole)) {
      const oaa = { some: { workspaceId: ORG_WORKSPACE_ID, role: "ONE_ABOVE_ALL" as const } }
      where.AND = [{ workspaceMembers: systemRole === "ADMIN" ? oaa : { none: oaa.some } }]
    }

    if ((MEMBERSHIP_FILTERS as readonly string[]).includes(membershipFilter)) {
      if (membershipFilter === "workspace-members") {
        where.workspaceMembers = { some: {} }
      } else if (membershipFilter === "non-members") {
        where.workspaceMembers = { none: {} }
      } else if (membershipFilter === "system-admins") {
        where.workspaceMembers = { some: { workspaceId: ORG_WORKSPACE_ID, role: "ONE_ABOVE_ALL" } }
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
          googleWorkspaceEmail: true,
          createdAt: true,
          // Offboarding (lib/offboarding.ts). Additive.
          deactivatedAt: true,
          formerMemberships: {
            select: { workspaceId: true, leftAt: true, reason: true, workspace: { select: { name: true } } },
            orderBy: { leftAt: "desc" },
          },
          // All memberships (a person has a handful at most): the earliest gives firstJoinedAt, the
          // company workspace's gives joinedAt (the Control Room's "Joined" column). Additive.
          workspaceMembers: {
            select: { joinedAt: true, workspaceId: true, role: true },
            orderBy: { joinedAt: "asc" },
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
        // The retired system flag's field, derived from the company role (16 Oct 2026).
        role: user.workspaceMembers.some((m) => m.workspaceId === ORG_WORKSPACE_ID && m.role === "ONE_ABOVE_ALL") ? "ADMIN" : "MEMBER",
        googleWorkspaceEmail: user.googleWorkspaceEmail,
        createdAt: user.createdAt,
        firstJoinedAt: user.workspaceMembers[0]?.joinedAt ?? null,
        joinedAt: user.workspaceMembers.find((m) => m.workspaceId === ORG_WORKSPACE_ID)?.joinedAt ?? null,
        workspaceMembershipCount: user._count.workspaceMembers,
        deactivatedAt: user.deactivatedAt,
        formerMemberships: user.formerMemberships.map((f) => ({
          workspaceId: f.workspaceId,
          workspaceName: f.workspace.name,
          leftAt: f.leftAt,
          reason: f.reason,
        })),
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
