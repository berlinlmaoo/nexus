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

function getCurrentHost() {
  const headerList = headers()
  const forwardedHost = headerList.get("x-forwarded-host")?.split(",")[0]?.trim()
  return (forwardedHost ?? headerList.get("host"))?.split(":")[0]?.toLowerCase()
}

export default async function DashboardPage() {
  const host = getCurrentHost()
  if (host && DASHBOARD_HOSTS.has(host)) {
    redirect("/ops-dashboard")
  }

  const session = await auth().catch(() => null)

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <div className="p-6">
      <DashboardContent
        userName={session.user.name ?? "User"}
      />
    </div>
  )
}
