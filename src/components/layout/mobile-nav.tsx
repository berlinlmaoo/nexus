"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, CheckSquare, FolderKanban, Clock3, MoreHorizontal } from "lucide-react"
import { useAppStore } from "@/stores/app-store"
import { cn } from "@/lib/utils"

const tabs = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Home" },
  { href: "/my-tasks", icon: CheckSquare, label: "Tasks" },
  { href: "/attendance", icon: Clock3, label: "Attendance" },
  { href: "/projects", icon: FolderKanban, label: "Projects" },
]

export function MobileNav() {
  const pathname = usePathname()
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const moreActiveRoutes = ["/settings", "/teams", "/user-management", "/inbox", "/docs", "/reports", "/goals"]
  const isMoreActive = moreActiveRoutes.some((href) => pathname === href || pathname?.startsWith(href + "/"))

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-on-surface-variant/10 bg-surface/90 pb-[max(env(safe-area-inset-bottom),0.45rem)] shadow-[0_-12px_34px_rgba(15,23,42,0.10)] backdrop-blur-2xl md:hidden"
    >
      <div className="mx-auto grid h-[4.25rem] max-w-md grid-cols-5 items-center gap-1 px-2">
        {tabs.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || pathname?.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "touch-target flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-[10px] font-bold transition-all active:scale-[0.96]",
                isActive
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/15"
                  : "text-on-surface-variant/60 hover:bg-surface-container-low hover:text-on-surface"
              )}
            >
              <Icon className={cn("h-5 w-5 transition-transform", isActive && "scale-110")} />
              <span className="truncate">{label}</span>
            </Link>
          )
        })}
        <button
          type="button"
          aria-label="More navigation"
          aria-pressed={isMoreActive}
          onClick={toggleSidebar}
          className={cn(
            "touch-target flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-[10px] font-bold transition-all active:scale-[0.96]",
            isMoreActive
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/15"
              : "text-on-surface-variant/60 hover:bg-surface-container-low hover:text-on-surface"
          )}
        >
          <MoreHorizontal className={cn("h-5 w-5 transition-transform", isMoreActive && "scale-110")} />
          <span className="truncate">More</span>
        </button>
      </div>
    </nav>
  )
}
