export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import crypto from "crypto"

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const samlResponse = formData.get("SAMLResponse") as string
    const relayState = formData.get("RelayState") as string | null

    if (!samlResponse) {
      return NextResponse.json({ error: "Missing SAMLResponse" }, { status: 400 })
    }

    // Decode the SAML response (base64)
    const decoded = Buffer.from(samlResponse, "base64").toString("utf-8")

    // Extract NameID (email) from SAML assertion
    // In production, this should use a proper SAML library (saml2-js, passport-saml)
    // for full signature verification and assertion validation
    const nameIdMatch = decoded.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/i)
      || decoded.match(/<NameID[^>]*>([^<]+)<\/NameID>/i)

    if (!nameIdMatch?.[1]) {
      return NextResponse.json({ error: "Could not extract identity from SAML assertion" }, { status: 400 })
    }

    const email = nameIdMatch[1].trim().toLowerCase()

    // Find workspace with SSO enabled that matches
    const ssoConfig = await prisma.ssoConfig.findFirst({
      where: { enabled: true },
      include: { workspace: true },
    })

    if (!ssoConfig) {
      return NextResponse.redirect(new URL("/login?error=SsoNotConfigured", req.url))
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email } })

    if (!user) {
      // Extract name from SAML attributes if available
      const firstNameMatch = decoded.match(/FirstName[^>]*>([^<]+)</i)
      const lastNameMatch = decoded.match(/LastName[^>]*>([^<]+)</i)
      const displayNameMatch = decoded.match(/DisplayName[^>]*>([^<]+)</i)

      const name = displayNameMatch?.[1]
        || [firstNameMatch?.[1], lastNameMatch?.[1]].filter(Boolean).join(" ")
        || email.split("@")[0]

      user = await prisma.user.create({
        data: { name, email },
      })

      // Auto-add to workspace
      await prisma.workspaceMember.create({
        data: {
          userId: user.id,
          workspaceId: ssoConfig.workspaceId,
          role: "MEMBER",
        },
      })
    } else {
      // Ensure user is a member of the workspace
      const existingMember = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId: ssoConfig.workspaceId } },
      })
      if (!existingMember) {
        await prisma.workspaceMember.create({
          data: {
            userId: user.id,
            workspaceId: ssoConfig.workspaceId,
            role: "MEMBER",
          },
        })
      }
    }

    // Create a session token for the user
    const sessionToken = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    await prisma.userSession.create({
      data: {
        userId: user.id,
        token: sessionToken,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
        userAgent: req.headers.get("user-agent") || undefined,
        expiresAt,
      },
    })

    logAudit({
      action: "login",
      entityType: "user",
      entityId: user.id,
      entityName: user.name,
      userId: user.id,
      request: req,
      metadata: { provider: "saml", workspaceId: ssoConfig.workspaceId },
    })

    // Redirect to dashboard with session info
    // In production, this would set the NextAuth session cookie properly
    const redirectUrl = relayState || "/dashboard"
    const response = NextResponse.redirect(new URL(redirectUrl, req.url))
    response.cookies.set("saml-session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    })

    return response
  } catch (error) {
    console.error("SAML callback error:", error)
    return NextResponse.redirect(new URL("/login?error=SamlError", req.url))
  }
}
