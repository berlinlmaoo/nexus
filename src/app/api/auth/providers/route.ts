import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  })
}
