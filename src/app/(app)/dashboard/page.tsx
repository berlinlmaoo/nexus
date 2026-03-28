import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { DashboardContent } from "./dashboard-content"

export const metadata = { title: "Dashboard | Nexus" }

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await auth().catch((err) => {
    console.warn('[auth] session read failed, treating as signed out:', err)
    return null
  })

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <DashboardContent
      userName={session.user.name ?? "User"}
    />
  )
}
