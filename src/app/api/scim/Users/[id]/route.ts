import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

const SCIM_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scimAuth = await authenticateScim(req)
    if (!scimAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, createdAt: true },
    })

    if (!user) {
      return NextResponse.json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "User not found",
        status: "404",
      }, { status: 404 })
    }

    // Check membership
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: id, workspaceId: scimAuth.workspaceId } },
    })

    return NextResponse.json(toScimUser(user, !!member))
  } catch (error) {
    console.error("SCIM GET User error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scimAuth = await authenticateScim(req)
    if (!scimAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const body = await req.json()

    const data: Record<string, unknown> = {}

    // Handle SCIM PATCH operations
    if (body.Operations) {
      for (const op of body.Operations) {
        if (op.path === "active" || op.value?.active !== undefined) {
          const active = op.value?.active ?? op.value
          if (active === false) {
            // Deactivate: remove from workspace
            await prisma.workspaceMember.deleteMany({
              where: { userId: id, workspaceId: scimAuth.workspaceId },
            })

            logAudit({
              action: "delete",
              entityType: "workspace_member",
              entityId: id,
              userId: id,
              request: req,
              metadata: { provider: "scim", workspaceId: scimAuth.workspaceId },
            })
          } else {
            // Reactivate: add back to workspace
            await prisma.workspaceMember.upsert({
              where: { userId_workspaceId: { userId: id, workspaceId: scimAuth.workspaceId } },
              create: { userId: id, workspaceId: scimAuth.workspaceId, role: "MEMBER" },
              update: {},
            })
          }
        }

        if (op.path === "name" || op.value?.name) {
          const nameVal = op.value?.name || op.value
          if (nameVal?.formatted) data.name = nameVal.formatted
          else if (nameVal?.givenName || nameVal?.familyName) {
            data.name = [nameVal.givenName, nameVal.familyName].filter(Boolean).join(" ")
          }
        }

        if (op.path === "userName" || op.value?.userName) {
          data.email = op.value?.userName || op.value
        }
      }
    } else {
      // Direct attribute update
      if (body.name?.formatted) data.name = body.name.formatted
      if (body.userName) data.email = body.userName
    }

    let user
    if (Object.keys(data).length > 0) {
      user = await prisma.user.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, createdAt: true },
      })
    } else {
      user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, email: true, createdAt: true },
      })
    }

    if (!user) {
      return NextResponse.json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "User not found",
        status: "404",
      }, { status: 404 })
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: id, workspaceId: scimAuth.workspaceId } },
    })

    return NextResponse.json(toScimUser(user, !!member))
  } catch (error) {
    console.error("SCIM PATCH User error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scimAuth = await authenticateScim(req)
    if (!scimAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params

    // Deactivate: remove from workspace (don't delete user)
    await prisma.workspaceMember.deleteMany({
      where: { userId: id, workspaceId: scimAuth.workspaceId },
    })

    logAudit({
      action: "delete",
      entityType: "workspace_member",
      entityId: id,
      userId: id,
      request: req,
      metadata: { provider: "scim", deactivated: true, workspaceId: scimAuth.workspaceId },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error("SCIM DELETE User error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
