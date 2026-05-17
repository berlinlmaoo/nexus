export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { nasLogin, nasLogout, NasError } from "@/lib/nas"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { action } = body

    if (action === "logout" && body.sid) {
      await nasLogout(body.sid)
      return NextResponse.json({ success: true })
    }

    // Login — use server-side credentials (don't expose to frontend)
    const account = process.env.NAS_USERNAME
    const passwd = process.env.NAS_PASSWORD

    if (!account || !passwd) {
      return NextResponse.json({ error: "NAS credentials not configured" }, { status: 500 })
    }

    const result = await nasLogin(account, passwd)
    return NextResponse.json({ sid: result.sid })
  } catch (error) {
    console.error("NAS auth error:", error)
    if (error instanceof NasError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "NAS authentication failed" }, { status: 500 })
  }
}
