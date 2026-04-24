import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"

export async function GET() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1")

    return NextResponse.json(
      {
        ok: true,
        app: "Nexus",
        status: "healthy",
        checks: {
          database: "up",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        app: "Nexus",
        status: "unhealthy",
        checks: {
          database: "down",
        },
        error: error instanceof Error ? error.message : "Unknown healthcheck error",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}
