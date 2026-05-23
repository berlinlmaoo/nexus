import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getAdminAccessContext } from "@/lib/admin-access"
import { getOpsDashboardTasks } from "@/lib/ops-dashboard/tasks"
import { OpsDashboardClient } from "@/components/ops-dashboard/ops-dashboard-client"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

export const metadata: Metadata = {
  title: "Nexus Ops Dashboard",
  description: "All ongoing tasks across active Nexus projects.",
}

export default async function OpsDashboardPage() {
  const session = await auth().catch(() => null)

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/ops-dashboard")
  }

  const context = await getAdminAccessContext(session.user.id)

  if (!context.user) {
    redirect("/login?callbackUrl=/ops-dashboard")
  }

  if (!context.canAccessUserManagement) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-white">
        <section className="max-w-lg rounded-[32px] bg-white/10 p-8 text-center shadow-2xl shadow-black/30">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-white/45">Access restricted</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.05em]">Ops dashboard is admin-only.</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-white/55">
            Dashboard ini menampilkan semua project dan semua task aktif, jadi aksesnya dikunci untuk owner/admin workspace.
          </p>
        </section>
      </main>
    )
  }

  const workspaceIds = context.isSystemAdmin
    ? context.workspaceMemberships.map((membership) => membership.workspaceId)
    : context.workspaceMemberships
        .filter((membership) => membership.role === "OWNER" || membership.role === "ADMIN")
        .map((membership) => membership.workspaceId)

  if (workspaceIds.length === 0) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-white">
        <section className="max-w-lg rounded-[32px] bg-white/10 p-8 text-center shadow-2xl shadow-black/30">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-white/45">No workspace</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.05em]">No admin workspace found.</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-white/55">
            User ini belum punya workspace admin yang bisa dipakai untuk dashboard lintas project.
          </p>
        </section>
      </main>
    )
  }

  const data = await getOpsDashboardTasks(workspaceIds)

  return <OpsDashboardClient data={data} viewerName={context.user.name ?? session.user.name ?? "Admin"} />
}
