import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getMasterCalendarTeamsForUser } from "@/lib/master-calendar"
import { MasterCalendarPageClient } from "@/components/master-calendar/master-calendar-page-client"

export default async function MasterCalendarPage() {
  const session = await auth().catch(() => null)

  if (!session?.user?.id) {
    redirect("/login")
  }

  const teams = await getMasterCalendarTeamsForUser(session.user.id)

  return (
    <MasterCalendarPageClient
      initialTeams={teams}
      initialTeamId={teams[0]?.id ?? null}
    />
  )
}
