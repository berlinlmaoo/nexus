"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, ChevronRight, Menu, User, LogOut, Settings } from "lucide-react"
import { signOut } from "next-auth/react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { NotificationsBell } from "@/components/layout/notifications-bell"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { useAppStore } from "@/stores/app-store"
import { cn } from "@/lib/utils"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Breadcrumb {
  label: string
  href: string
}

interface HeaderProps {
  title?: string
  breadcrumbs?: Breadcrumb[]
  user?: {
    id: string
    name: string
    email: string
    image?: string | null
  }
  children?: React.ReactNode
}

export function Header({ title, breadcrumbs, user, children }: HeaderProps) {
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const router = useRouter()
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut({ callbackUrl: "/login" })
  }

  return (
    <>
      <header className="safe-area-top sticky top-0 z-40 flex min-h-14 shrink-0 items-center justify-between border-b border-on-surface-variant/5 bg-surface/92 px-2.5 backdrop-blur-xl sm:min-h-16 sm:px-6">
        {/* Left: hamburger + breadcrumb */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <button
            onClick={toggleSidebar}
            className={cn(
              "touch-target inline-flex items-center justify-center rounded-xl text-on-surface-variant/60 transition-all duration-200 hover:bg-surface-container-high sm:h-10 sm:w-10",
              sidebarOpen ? "md:hidden" : ""
            )}
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
          >
            <Menu className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
          </button>

          {breadcrumbs && breadcrumbs.length > 0 ? (
            <nav className="flex min-w-0 items-center gap-2 text-sm">
              {breadcrumbs.map((crumb, i) => (
                <span
                  key={crumb.href}
                  className={cn(
                    "min-w-0 items-center gap-2",
                    i === breadcrumbs.length - 1 ? "flex" : "hidden sm:flex"
                  )}
                >
                  {i > 0 && (
                    <ChevronRight className="h-3 w-3 text-on-surface-variant/30 shrink-0" />
                  )}
                  <Link
                    href={crumb.href}
                    className={cn(
                      "transition-all duration-200 truncate font-headline tracking-tight",
                      i === breadcrumbs.length - 1
                        ? "text-sm font-extrabold text-primary sm:text-base"
                        : "text-on-surface-variant hover:text-primary"
                    )}
                  >
                    {crumb.label}
                  </Link>
                </span>
              ))}
            </nav>
          ) : title ? (
            <h1 className="truncate text-[13px] font-headline font-extrabold text-primary tracking-tight sm:text-base">{title}</h1>
          ) : null}
        </div>

        {/* Center: injected content (view tabs) */}
        {children && (
          <div className="hidden lg:flex items-center">
            {children}
          </div>
        )}

        {/* Right: search + actions + user */}
        <div className="ml-2 flex shrink-0 items-center gap-0.5 sm:ml-3 sm:gap-2">
          {/* Search trigger */}
          <button
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
            }}
            className="relative group hidden sm:flex items-center h-9 w-56 lg:w-64 bg-surface-container-low border-none rounded-xl pl-10 pr-4 text-sm text-on-surface-variant/40 hover:bg-surface-container-lowest transition-all duration-200 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-on-surface-variant/40 group-hover:text-primary transition-colors">
              <Search className="h-4 w-4" />
            </span>
            <span className="flex-1 truncate">Search workspace...</span>
            <kbd className="hidden md:inline-flex h-5 select-none items-center gap-1 rounded bg-surface-container px-1.5 font-mono text-[10px] font-medium text-on-surface-variant/30 group-hover:bg-primary/5 group-hover:text-primary/40 transition-colors">
              <span className="text-xs">⌘</span>K
            </kbd>
          </button>

          <button
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
            }}
            className="touch-target inline-flex items-center justify-center rounded-xl text-on-surface-variant/60 transition-all hover:bg-surface-container-high sm:hidden"
            aria-label="Search workspace"
          >
            <Search className="h-4.5 w-4.5" />
          </button>

          <ThemeToggle />

          {/* Notifications */}
          <NotificationsBell userId={user?.id} userName={user?.name} />

          {/* User dropdown */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-transform duration-200 hover:scale-105">
                  <UserAvatar
                    user={{ name: user.name, image: user.image }}
                    size="sm"
                    className="ring-2 ring-white/50"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="mt-2 w-64 max-w-[calc(100vw_-_1rem)] rounded-xl border-none p-2 shadow-2xl shadow-primary/10">
                <div className="px-3 py-3 mb-1">
                  <p className="text-sm font-headline font-bold text-primary">{user.name}</p>
                  <p className="text-xs text-on-surface-variant truncate">{user.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-surface-container-high mx-2 mb-1" />
                <DropdownMenuItem
                  className="rounded-lg px-3 py-2 text-sm font-medium text-on-surface-variant hover:text-primary hover:bg-surface-container focus:bg-surface-container transition-colors cursor-pointer"
                  onClick={() => {
                    router.push("/settings")
                    setTimeout(() => {
                      document.getElementById("profile-section")?.scrollIntoView({ behavior: "smooth" })
                    }, 100)
                  }}
                >
                  <User className="h-4 w-4 mr-3 text-on-surface-variant/60" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-lg px-3 py-2 text-sm font-medium text-on-surface-variant hover:text-primary hover:bg-surface-container focus:bg-surface-container transition-colors cursor-pointer"
                  onClick={() => router.push("/settings")}
                >
                  <Settings className="h-4 w-4 mr-3 text-on-surface-variant/60" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-surface-container-high mx-2 my-1" />
                <DropdownMenuItem
                  className="rounded-lg px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50 focus:bg-red-50 transition-colors cursor-pointer"
                  onClick={() => setShowSignOutConfirm(true)}
                >
                  <LogOut className="h-4 w-4 mr-3" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <ConfirmDialog
        open={showSignOutConfirm}
        onOpenChange={setShowSignOutConfirm}
        title="Sign out of NEXUS?"
        description="You’ll be returned to the login page and your current session will end on this device."
        confirmLabel="Sign out"
        tone="default"
        icon={<LogOut className="h-5 w-5" />}
        isLoading={signingOut}
        onConfirm={handleSignOut}
      />
    </>
  )
}
