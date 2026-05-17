export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import crypto from "crypto"

async function getWorkspaceAdmin(userId: string) {
  const member = await prisma.workspaceMember.findFirst({
    where: { userId },
    include: { workspace: true },
  })
  if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
    return null
  }
  return member
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const member = await getWorkspaceAdmin(session.user.id)
    if (!member) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const ssoConfig = await prisma.ssoConfig.findUnique({
      where: { workspaceId: member.workspaceId },
      select: {
        id: true,
        provider: true,
        entityId: true,
        ssoUrl: true,
        certificate: true,
        metadataUrl: true,
        enabled: true,
        scimToken: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ ssoConfig })
  } catch (error) {
    console.error("SSO GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const member = await getWorkspaceAdmin(session.user.id)
    if (!member) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const existing = await prisma.ssoConfig.findUnique({ where: { workspaceId: member.workspaceId } })
    if (existing) return NextResponse.json({ error: "SSO config already exists. Use PATCH to update." }, { status: 409 })

    const { provider, entityId, ssoUrl, certificate, metadataUrl } = await req.json()

    const ssoConfig = await prisma.ssoConfig.create({
      data: {
        workspaceId: member.workspaceId,
        provider: provider || "SAML",
        entityId,
        ssoUrl,
        certificate,
        metadataUrl,
        scimToken: crypto.randomBytes(32).toString("hex"),
      },
    })

    logAudit({ action: "create", entityType: "sso_config", entityId: ssoConfig.id, userId: session.user.id, request: req })

    return NextResponse.json({ ssoConfig }, { status: 201 })
  } catch (error) {
    console.error("SSO POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const member = await getWorkspaceAdmin(session.user.id)
    if (!member) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const body = await req.json()
    const { provider, entityId, ssoUrl, certificate, metadataUrl, enabled, regenerateScimToken } = body

    const data: Record<string, unknown> = {}
    if (provider !== undefined) data.provider = provider
    if (entityId !== undefined) data.entityId = entityId
    if (ssoUrl !== undefined) data.ssoUrl = ssoUrl
    if (certificate !== undefined) data.certificate = certificate
    if (metadataUrl !== undefined) data.metadataUrl = metadataUrl
    if (enabled !== undefined) data.enabled = enabled
    if (regenerateScimToken) data.scimToken = crypto.randomBytes(32).toString("hex")

    const ssoConfig = await prisma.ssoConfig.update({
      where: { workspaceId: member.workspaceId },
      data,
    })

    logAudit({ action: "update", entityType: "sso_config", entityId: ssoConfig.id, userId: session.user.id, request: req, metadata: { fields: Object.keys(data) } })

    return NextResponse.json({ ssoConfig })
  } catch (error) {
    console.error("SSO PATCH error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
