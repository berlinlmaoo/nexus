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
    <header className="flex h-[52px] items-center justify-between border-b border-border/50 bg-surface-1 dark:bg-surface-1 px-4 shrink-0">
      {/* Left: hamburger + breadcrumb */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          onClick={toggleSidebar}
          className={cn(
            "rounded-md p-1.5 text-muted-foreground/60 hover:bg-surface-2 hover:text-foreground transition-all duration-200",
            sidebarOpen ? "md:hidden" : ""
          )}
        >
          <Menu className="h-4 w-4" />
        </button>

        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav className="flex items-center gap-1 text-[13px] min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.href} className="flex items-center gap-1 min-w-0">
                {i > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                )}
                <Link
                  href={crumb.href}
                  className={cn(
                    "transition-colors duration-200 truncate",
                    i === breadcrumbs.length - 1
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {crumb.label}
                </Link>
              </span>
            ))}
          </nav>
        ) : title ? (
          <h1 className="text-[13px] font-semibold text-foreground truncate">{title}</h1>
        ) : null}

        {/* Star/favorite button */}
        {(breadcrumbs || title) && (
          <button className="rounded-md p-1 text-muted-foreground/30 hover:text-amber-500 transition-colors duration-200 shrink-0">
            <Star className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Center: injected content (view tabs) */}
      {children && (
        <div className="hidden md:flex items-center">
          {children}
        </div>
      )}

      {/* Right: search + actions + user */}
      <div className="flex items-center gap-1">
        {/* Search trigger — Plane style: subtle surface bg */}
        <button
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
          }}
          className="hidden sm:flex items-center gap-2 h-[30px] w-48 rounded-md border border-border/40 bg-surface-2/50 dark:bg-surface-2/50 px-2.5 text-xs text-muted-foreground/60 hover:bg-surface-2 hover:text-muted-foreground transition-all duration-200"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="hidden lg:inline-flex h-4 items-center gap-0.5 rounded border border-border/40 bg-card px-1 text-[10px] font-mono text-muted-foreground/50">
            <span className="text-[10px]">&#8984;</span>K
          </kbd>
        </button>
        <button
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
          }}
          className="sm:hidden rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 transition-all duration-200"
        >
          <Search className="h-4 w-4" />
        </button>

        {/* Dark mode toggle */}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="rounded-md p-1.5 text-muted-foreground/60 hover:bg-surface-2 hover:text-foreground transition-all duration-200"
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
              <button className="ml-0.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 transition-transform duration-200 hover:scale-105">
                <UserAvatar
                  user={{ name: user.name, image: user.image }}
                  size="sm"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5">
                <p className="text-[13px] font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
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
