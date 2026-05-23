import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

export const dynamic = "force-dynamic"

const OPS_DASHBOARD_HOSTS = new Set([
  "dashboard.nexus.patsgroup.id",
  "dashboard-nexus.patsgroup.id",
])

export default async function Home() {
  const headerList = headers()
  const forwardedHost = headerList.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = (forwardedHost ?? headerList.get("host"))?.split(":")[0]?.toLowerCase()

  if (host && OPS_DASHBOARD_HOSTS.has(host)) {
    redirect("/ops-dashboard")
  }

  const session = await auth().catch((err) => {
    console.warn('[auth] session read failed, treating as signed out:', err)
    return null
  })

  if (session?.user) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
