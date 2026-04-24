import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { AttendancePageClient } from "@/components/attendance/attendance-page-client"

export const metadata = { title: "Attendance | Nexus" }

export const dynamic = "force-dynamic"

export default async function AttendancePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const context = await getAttendanceWorkspaceContext(session.user.id)
  if (!context.user) redirect("/login")

  return (
    <div className="p-6">
      <AttendancePageClient
        user={{
          id: context.user.id,
          name: context.user.name,
          email: context.user.email,
        }}
        workspace={context.workspace}
      />
    </div>
  )
}
