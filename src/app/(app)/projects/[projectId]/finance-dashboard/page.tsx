import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import {
  getAccessibleFinanceProject,
  isFinanceDashboardPasswordConfigured,
} from "@/lib/finance-dashboard-auth"
import { FinanceDashboardClient } from "@/components/finance/finance-dashboard-client"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"
export const metadata = { title: "Finance Dashboard | Nexus" }

export default async function FinanceDashboardPage({
  params,
}: {
  params: { projectId: string }
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const project = await getAccessibleFinanceProject(session.user.id, params.projectId)
  if (!project) notFound()

  return (
    <FinanceDashboardClient
      project={project}
      initialUnlocked={false}
      passwordConfigured={isFinanceDashboardPasswordConfigured()}
    />
  )
}
