export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

const SCIM_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse"

async function authenticateScim(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null

  const token = authHeader.slice(7)
  const ssoConfig = await prisma.ssoConfig.findFirst({
    where: { scimToken: token, enabled: true },
    select: { workspaceId: true },
  })

  return ssoConfig
}

function toScimUser(user: { id: string; name: string; email: string; createdAt: Date }, active: boolean = true) {
  const [givenName, ...familyParts] = user.name.split(" ")
  return {
    schemas: [SCIM_SCHEMA],
    id: user.id,
    userName: user.email,
    name: {
      givenName: givenName || "",
      familyName: familyParts.join(" ") || "",
      formatted: user.name,
    },
    emails: [{ value: user.email, primary: true, type: "work" }],
    active,
    meta: {
      resourceType: "User",
      created: user.createdAt.toISOString(),
      location: `/api/scim/Users/${user.id}`,
    },
  }
}

export async function GET(req: NextRequest) {
  try {
    const scimAuth = await authenticateScim(req)
    if (!scimAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const startIndex = parseInt(searchParams.get("startIndex") || "1")
    const count = parseInt(searchParams.get("count") || "100")
    const filter = searchParams.get("filter")

    let where: Record<string, unknown> = {
      workspaceMembers: { some: { workspaceId: scimAuth.workspaceId } },
    }

    // Support filter by userName (email)
    if (filter) {
      const emailMatch = filter.match(/userName\s+eq\s+"([^"]+)"/i)
      if (emailMatch) {
        where = { ...where, email: emailMatch[1] }
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, createdAt: true },
        skip: startIndex - 1,
        take: count,
        orderBy: { createdAt: "asc" },
      }),
      prisma.user.count({ where }),
    ])

    return NextResponse.json({
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: count,
      Resources: users.map((u) => toScimUser(u)),
    })
  } catch (error) {
    console.error("SCIM GET Users error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const scimAuth = await authenticateScim(req)
    if (!scimAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const email = body.userName || body.emails?.[0]?.value
    const name = body.name?.formatted || [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ") || email?.split("@")[0]

    if (!email) {
      return NextResponse.json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "userName or emails required",
        status: "400",
      }, { status: 400 })
    }

    // Check if user already exists
    let user = await prisma.user.findUnique({ where: { email } })

    if (user) {
      // Ensure they're a member of the workspace
      await prisma.workspaceMember.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: scimAuth.workspaceId } },
        create: { userId: user.id, workspaceId: scimAuth.workspaceId, role: "STAFF" },
        update: {},
      })

      return NextResponse.json(toScimUser(user), { status: 200 })
    }

    // Create new user
    user = await prisma.user.create({
      data: { name, email },
    })

    await prisma.workspaceMember.create({
      data: { userId: user.id, workspaceId: scimAuth.workspaceId, role: "STAFF" },
    })

    logAudit({
      action: "create",
      entityType: "user",
      entityId: user.id,
      entityName: name,
      userId: user.id,
      request: req,
      metadata: { provider: "scim", workspaceId: scimAuth.workspaceId },
    })

    return NextResponse.json(toScimUser(user), { status: 201 })
  } catch (error) {
    console.error("SCIM POST User error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
