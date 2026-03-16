import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { InboxClient } from "./inbox-client"

export default async function InboxPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return <InboxClient notifications={JSON.parse(JSON.stringify(notifications))} />
}
