import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { AppLayout } from "@/components/layout/app-layout"

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

  const user = {
    id: session.user.id!,
    name: session.user.name ?? "User",
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  }

  return <AppLayout user={user}>{children}</AppLayout>
}
