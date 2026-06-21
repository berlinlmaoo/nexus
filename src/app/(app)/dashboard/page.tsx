import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { DashboardContent } from "./dashboard-content"

export const metadata = { title: "Dashboard | Nexus" }

export const dynamic = "force-dynamic"

const DASHBOARD_HOSTS = new Set([
  "dashboard.nexus.patsgroup.id",
  "dashboard-nexus.patsgroup.id",
])

async function getCurrentHost() {
  const headerList = await headers()
  const forwardedHost = headerList.get("x-forwarded-host")?.split(",")[0]?.trim()
  return (forwardedHost ?? headerList.get("host"))?.split(":")[0]?.toLowerCase()
}

export default async function DashboardPage() {
  const host = await getCurrentHost()
  if (host && DASHBOARD_HOSTS.has(host)) {
    redirect("/ops-dashboard")
  }

  const session = await auth().catch(() => null)

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <div className="px-0 py-1 sm:px-2 md:p-0">
      <DashboardContent
        userName={session.user.name ?? "User"}
      />
    </div>
  )
}
