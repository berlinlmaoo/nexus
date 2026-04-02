import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { AppLayout } from "@/components/layout/app-layout"
import prisma from "@/lib/prisma"

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth().catch((err) => {
    console.warn('[auth] session read failed, treating as signed out:', err)
    return null
  })

  if (!session?.user) {
    redirect("/login")
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id! },
    select: { name: true, email: true, avatar: true },
  })

  if (!dbUser) {
    redirect("/login")
  }

  const user = {
    id: session.user.id!,
    name: dbUser.name ?? session.user.name ?? "User",
    email: dbUser.email ?? session.user.email ?? "",
    image: dbUser.avatar ?? null,
  }

  return <AppLayout user={user}>{children}</AppLayout>
}
