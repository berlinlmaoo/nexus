import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getAuthUrl,
  exchangeCodeForTokens,
  storeTokens,
  hasTokens,
} from "@/lib/google-drive"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    const action = searchParams.get("action")

    // Check connection status
    if (action === "status") {
      return NextResponse.json({
        connected: hasTokens(session.user.id as string),
      })
    }

    // If we have a code, exchange it for tokens (callback)
    if (code) {
      const tokens = await exchangeCodeForTokens(code)
      storeTokens(session.user.id as string, tokens)

      // Redirect back to the app
      const redirectTo = state || "/dashboard"
      return NextResponse.redirect(new URL(redirectTo, request.url))
    }

    // Initiate OAuth flow
    const authUrl = getAuthUrl("/dashboard")
    return NextResponse.json({ authUrl })
  } catch (error) {
    console.error("Drive auth error:", error)
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    )
  }
}
