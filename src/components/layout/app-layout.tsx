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
      <div className="flex h-screen overflow-hidden bg-background">
        <Suspense fallback={null}>
          <LoadingBar />
        </Suspense>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={toggleSidebar}
          />
        )}

        <Sidebar user={user} />

        <div
          className={cn(
            "flex flex-1 flex-col transition-all duration-300 ease-in-out min-w-0",
            sidebarOpen ? "md:ml-[260px] ml-0" : "ml-0"
          )}
        >
          <Header title={title} breadcrumbs={breadcrumbs} user={user} />

          <main className="flex-1 overflow-auto p-3 sm:p-6 pb-16 md:pb-6">
            <PageTransition>
              {children}
            </PageTransition>
          </main>
        </div>

        <GideonChat />
        <MobileNav />
        <SearchDialog />
      </div>
    </ShortcutsHelpProvider>
  )
}
