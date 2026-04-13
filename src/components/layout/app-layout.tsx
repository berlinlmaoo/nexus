"use client"

import { Suspense, useEffect } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { LoadingBar } from "@/components/layout/loading-bar"
import { PageTransition } from "@/components/ui/page-transition"
import { GideonChat } from "@/components/gideon/gideon-chat"
import { MobileNav } from "@/components/layout/mobile-nav"
import { SearchDialog } from "@/components/layout/search-dialog"
import { ShortcutsHelpProvider } from "@/components/layout/shortcuts-help"
import { useAppStore } from "@/stores/app-store"
import { cn } from "@/lib/utils"

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
    canAccessUserManagement?: boolean
  }
}

export function AppLayout({ children, title, breadcrumbs, user }: AppLayoutProps) {
  const { sidebarOpen, toggleSidebar } = useAppStore()

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
      <div className="flex h-screen overflow-hidden bg-surface">
        <Suspense fallback={null}>
          <LoadingBar />
        </Suspense>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-primary/20 backdrop-blur-sm md:hidden"
            onClick={toggleSidebar}
          />
        )}

        <Sidebar user={user} />

        <div className="flex flex-1 flex-col min-w-0 bg-surface relative">
          <Header title={title} breadcrumbs={breadcrumbs} user={user} />

          <main className="flex-1 overflow-y-auto overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0 scroll-smooth">
            <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-6 md:p-12">
              <PageTransition>
                {children}
              </PageTransition>
            </div>
          </main>
        </div>

        <GideonChat />
        <MobileNav />
        <SearchDialog />
      </div>
    </ShortcutsHelpProvider>
  )
}
