"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, ChevronRight, Menu, User, LogOut, Settings, Moon, Sun, Star } from "lucide-react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { NotificationsBell } from "@/components/layout/notifications-bell"
import { useAppStore } from "@/stores/app-store"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/components/layout/theme-provider"

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
  const { toggleSidebar, sidebarOpen } = useAppStore()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <header className="flex h-12 items-center justify-between border-b border-neutral-200 bg-white px-4 shrink-0">
      {/* Left: hamburger + breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={toggleSidebar}
          className={cn(
            "rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-all duration-150",
            sidebarOpen ? "md:hidden" : ""
          )}
        >
          <Menu className="h-4 w-4" />
        </button>

        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav className="flex items-center gap-1 text-sm min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.href} className="flex items-center gap-1 min-w-0">
                {i > 0 && (
                  <ChevronRight className="h-3 w-3 text-neutral-400 shrink-0" />
                )}
                <Link
                  href={crumb.href}
                  className={cn(
                    "transition-colors duration-150 truncate",
                    i === breadcrumbs.length - 1
                      ? "font-semibold text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900"
                  )}
                >
                  {crumb.label}
                </Link>
              </span>
            ))}
          </nav>
        ) : title ? (
          <h1 className="text-sm font-semibold text-neutral-900 truncate">{title}</h1>
        ) : null}
      </div>

      {/* Center: search bar */}
      <div className="hidden md:flex items-center justify-center flex-1 max-w-md mx-4">
        <button
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
          }}
          className="flex items-center gap-2 h-8 w-full max-w-xs rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-400 hover:bg-neutral-100 hover:border-neutral-300 transition-all duration-150"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left text-xs">Search...</span>
          <kbd className="hidden lg:inline-flex h-5 items-center gap-0.5 rounded border border-neutral-200 bg-white px-1.5 text-[10px] font-mono text-neutral-400">
            <span className="text-[10px]">&#8984;</span>K
          </kbd>
        </button>
      </div>

      {/* Center: injected content (view tabs) — only when no search shown */}
      {children && (
        <div className="hidden md:flex items-center">
          {children}
        </div>
      )}

      {/* Right: actions + user */}
      <div className="flex items-center gap-1">
        {/* Mobile search */}
        <button
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
          }}
          className="md:hidden rounded p-1.5 text-neutral-400 hover:bg-neutral-100 transition-all duration-150"
        >
          <Search className="h-4 w-4" />
        </button>

        {/* Dark mode toggle */}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-all duration-150"
          title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {resolvedTheme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>

        {/* Notifications */}
        <NotificationsBell userId={user?.id} userName={user?.name} />

        {/* User dropdown */}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-0.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 transition-transform duration-150 hover:scale-105">
                <UserAvatar
                  user={{ name: user.name, image: user.image }}
                  size="sm"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-neutral-500">{user.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  router.push("/settings")
                  setTimeout(() => {
                    document.getElementById("profile-section")?.scrollIntoView({ behavior: "smooth" })
                  }, 100)
                }}
              >
                <User className="h-4 w-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  window.location.href = "/api/auth/signout"
                }}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  )
}
