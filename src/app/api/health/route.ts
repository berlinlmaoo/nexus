export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { leaderInfo } from "@/lib/bluegreen"
import { dbPoolStats } from "@/lib/db-pool"

/**
 * Where this instance is running. The office VM and the VPS warm standby run the same image; the
 * standby is the one pointed at the replica ("nexus-standby"), and it keeps that address after a
 * failover promotes it. NEXUS_SITE overrides the guess if it is ever set. The public status page
 * reads this to say where NEXUS is being served from right now.
 */
function site(): "office" | "vps" {
  const forced = process.env.NEXUS_SITE?.trim().toLowerCase()
  if (forced === "office" || forced === "vps") return forced
  return /@nexus-standby[:/]/.test(process.env.DATABASE_URL ?? "") ? "vps" : "office"
}

export async function GET() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1")

    return NextResponse.json(
      {
        ok: true,
        app: "Nexus",
        status: "healthy",
        site: site(),
        // Blue-green (lib/bluegreen.ts): which slot answered, whether nginx points at it, and whether
        // it runs the once-per-system clocks. Read by the deploy script and its zero-downtime test.
        ...leaderInfo(),
        checks: {
          database: "up",
        },
        // Connections this process holds (one pool per process, lib/db-pool.ts): counts only.
        db: dbPoolStats(),
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
        site: site(),
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
