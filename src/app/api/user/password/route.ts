export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'
import { isWebClientTag } from '@/lib/session-version'
import { reissueSessionCookie } from '@/lib/session-issue'

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { currentPassword, newPassword } = await req.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current password and new password are required' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    })

    if (!user?.password) {
      return NextResponse.json({ error: 'Password login not configured for this account' }, { status: 400 })
    }

    const isValid = await bcrypt.compare(currentPassword, user.password)
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12)
    // From the web, a password change also ends every OTHER session (lib/session-version.ts) and hands
    // this browser a fresh cookie at the new version, so the person who changed it stays signed in.
    // From the app, no bump: no iOS build (0.1.4–0.1.6) reads a new token out of this response, so a
    // bump would sign out the very person who just changed their password. A password reset always
    // bumps.
    const fromWeb = isWebClientTag(req.headers.get('x-nexus-client'))
    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: { password: hashedPassword, ...(fromWeb && { sessionVersion: { increment: 1 } }) },
      select: { id: true, name: true, email: true, avatar: true, sessionVersion: true },
    })

    logAudit({ action: "update", entityType: "user_password", entityId: session.user.id, userId: session.user.id, request: req, metadata: { otherSessionsEnded: fromWeb } })

    const res = NextResponse.json({ success: true, message: 'Password updated successfully' })
    if (fromWeb) {
      try {
        await reissueSessionCookie(res, updated, updated.sessionVersion)
      } catch (error) {
        // The password IS changed; at worst this browser signs in again with it.
        console.error('password change: session re-issue failed', error)
      }
    }
    return res
  } catch (error) {
    console.error("Error changing password:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Both clients have always sent PATCH — the web's changePassword and the iOS app's alike — while
// this route only answered POST. Every password change from either one came back 405 and changed
// nothing. Accepting PATCH here fixes the apps already installed, which no client change could.
export const PATCH = POST
