"use client"

import dynamic from "next/dynamic"
import { Suspense, useEffect } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { LoadingBar } from "@/components/layout/loading-bar"
import { DesktopNotificationPrompt } from "@/components/layout/desktop-notification-prompt"
import { PhoneNumberPrompt } from "@/components/layout/phone-number-prompt"
import { PageTransition } from "@/components/ui/page-transition"
import { ShortcutsHelpProvider } from "@/components/layout/shortcuts-help"
import { useAppStore } from "@/stores/app-store"
import { cn } from "@/lib/utils"

const GideonChat = dynamic(
  () => import("@/components/gideon/gideon-chat").then((mod) => mod.GideonChat),
  { ssr: false }
)

const MobileNav = dynamic(
  () => import("@/components/layout/mobile-nav").then((mod) => mod.MobileNav),
  { ssr: false }
)

const SearchDialog = dynamic(
  () => import("@/components/layout/search-dialog").then((mod) => mod.SearchDialog),
  { ssr: false }
)

interface Breadcrumb {
  label: string
  href: string
}

interface AppLayoutProps {
  children: React.ReactNode
  title?: string
  breadcrumbs?: Breadcrumb[]
  user: {
    id: string
    name: string
    email: string
    image?: string | null
    phoneNumber?: string | null
    canAccessUserManagement?: boolean
  }
}

export function AppLayout({ children, title, breadcrumbs, user }: AppLayoutProps) {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)

  // Auto-collapse sidebar on mobile
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)")
    if (mq.matches && sidebarOpen) {
      toggleSidebar()
    }
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches && sidebarOpen) toggleSidebar()
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ShortcutsHelpProvider>
      <div className="flex h-[100dvh] min-h-[100svh] overflow-hidden bg-surface safe-area-x">
        <Suspense fallback={null}>
          <LoadingBar />
        </Suspense>
        <DesktopNotificationPrompt />
        <PhoneNumberPrompt userId={user.id} initialPhoneNumber={user.phoneNumber ?? null} />

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-50 bg-primary/20 backdrop-blur-sm md:hidden"
            onClick={toggleSidebar}
          />
        )}

        <Sidebar user={user} />

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
          <Header title={title} breadcrumbs={breadcrumbs} user={user} />

          <main className="mobile-scroll-area min-h-0 flex-1 overflow-auto pb-[calc(5.5rem_+_env(safe-area-inset-bottom))] scroll-smooth md:pb-0">
            <div className="mx-auto min-h-full min-w-0 max-w-[1600px] px-3 py-3 sm:px-6 sm:py-6 md:p-12">
              <PageTransition>
                {children}
              </PageTransition>
            </div>
          </main>
        </div>

        <div className={cn(sidebarOpen && "hidden md:block")}>
          <GideonChat />
        </div>
        <div className={cn(sidebarOpen && "hidden md:block")}>
          <MobileNav />
        </div>
        <SearchDialog />
      </div>
    </ShortcutsHelpProvider>
  )
}
