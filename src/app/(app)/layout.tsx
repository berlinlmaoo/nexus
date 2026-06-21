import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { AppLayout } from "@/components/layout/app-layout"
import prisma from "@/lib/prisma"
import { getAdminAccessContext } from "@/lib/admin-access"

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
  const adminAccess = await getAdminAccessContext(session.user.id!)

  if (!dbUser) {
    redirect("/login")
  }

  const user = {
    id: session.user.id!,
    name: dbUser.name ?? session.user.name ?? "User",
    email: dbUser.email ?? session.user.email ?? "",
    image: dbUser.avatar ?? null,
    phoneNumber: null,
    canAccessUserManagement: adminAccess.canAccessUserManagement,
  }

  return <AppLayout user={user}>{children}</AppLayout>
}
