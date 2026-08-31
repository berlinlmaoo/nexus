import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { MessagesClient } from "./messages-client"

export const metadata = { title: "Messages | Nexus" }

export const dynamic = "force-dynamic"

/**
 * Conversations are loaded client-side rather than here on purpose: `GET /api/conversations` also
 * provisions the PROJECT rooms for whoever is asking (see `provisionProjectRooms`), so going
 * through the route keeps that behaviour in one place instead of duplicating it in a server
 * component that would drift.
 */
export default async function MessagesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  return (
    <MessagesClient
      meId={session.user.id}
      meName={session.user.name ?? ""}
      meAvatar={session.user.image ?? null}
    />
  )
}
