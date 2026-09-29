export const dynamic = "force-dynamic"

import { createHmac, randomBytes } from "crypto"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

/**
 * "Sign in with NEXUS" for the 3D agents office on status.znetworks.id/agents/3d.
 *
 * The office lives on another host (the status VPS), so it cannot read the NEXUS session cookie.
 * This route is the bridge: a signed-in member of the Z Networks workspace is sent back to the
 * office with a one-shot ticket (id + name, valid two minutes, HMAC-SHA256 with STATUS_SSO_SECRET,
 * the same secret the office's small auth gateway holds). The office turns it into its own cookie.
 *
 * `state` is the office's anti-CSRF value, echoed back untouched. Signed out → the SPA login page,
 * which comes back through /sso/agents/<state> (the SPA cannot navigate to an /api path by itself,
 * so that route does a full page load to this one). No consent screen, unlike /api/sso/authorize for
 * hiring: the office is our own page and only learns the name. The destination is fixed, never taken
 * from the request, so nothing here works as an open redirect or mints tickets for another site.
 */
const OFFICE_CALLBACK = "https://status.znetworks.id/agents/3d/auth/callback"
const WORKSPACE_SLUG = process.env.STATUS_SSO_WORKSPACE_SLUG?.trim() || "z-networks"
const TICKET_SECONDS = 120

const b64url = (buf: Buffer) => buf.toString("base64url")

function back(params: Record<string, string>) {
  const url = new URL(OFFICE_CALLBACK)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } })
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("state") || ""
  const state = /^[A-Za-z0-9_-]{16,64}$/.test(raw) ? raw : ""
  if (!state) return back({ error: "failed" })

  const secret = process.env.STATUS_SSO_SECRET?.trim()
  if (!secret || secret.length < 32) return back({ error: "unavailable", state })

  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    const login = new URL("/login", req.url)
    login.searchParams.set("callbackUrl", `/sso/agents/${state}`)
    return NextResponse.redirect(login, { status: 302, headers: { "Cache-Control": "no-store" } })
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { userId, workspace: { slug: WORKSPACE_SLUG } },
    select: { user: { select: { id: true, name: true } } },
  })
  if (!member) return back({ error: "not_member", state })

  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        aud: "status-agents",
        sub: member.user.id,
        name: member.user.name,
        iat: now,
        exp: now + TICKET_SECONDS,
        jti: b64url(randomBytes(12)),
      }),
    ),
  )
  const sig = b64url(createHmac("sha256", secret).update(payload).digest())
  return back({ t: `${payload}.${sig}`, state })
}
