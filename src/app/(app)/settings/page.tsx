import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { SettingsClient } from "@/components/settings/settings-client"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      phoneNumber: true,
      role: true,
    },
  })

  if (!user) redirect("/login")

  const workspaceMember = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: {
      workspace: {
        select: { id: true, name: true, slug: true },
      },
    },
  })

  const isAdmin = user.role === "ADMIN" || workspaceMember?.role === "BOD" || workspaceMember?.role === "MANAGER" || workspaceMember?.role === "ONE_ABOVE_ALL"
  const canAccessAttendanceSettings = user.role === "ADMIN" || workspaceMember?.role === "BOD"
  const workspaceRole = workspaceMember?.role || null

  return (
    <div className="p-6">
      <SettingsClient
        user={user}
        workspace={workspaceMember?.workspace || null}
        isAdmin={isAdmin}
        canAccessAttendanceSettings={canAccessAttendanceSettings}
        workspaceRole={workspaceRole}
      />
    </div>
  )
}
