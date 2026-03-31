import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { DashboardContent } from "./dashboard-content"

export const metadata = { title: "Dashboard | Nexus" }

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
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
