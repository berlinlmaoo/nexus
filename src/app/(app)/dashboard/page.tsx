import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { DashboardContent } from "./dashboard-content"

export const metadata = { title: "Dashboard | Nexus" }

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <DashboardContent
      userName={session.user.name ?? "User"}
    />
  )
}
