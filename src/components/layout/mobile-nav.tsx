"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, CheckSquare, FolderKanban, Settings, Clock3, Inbox } from "lucide-react"
import { cn } from "@/lib/utils"

const tabs = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Home" },
  { href: "/my-tasks", icon: CheckSquare, label: "Tasks" },
  { href: "/attendance", icon: Clock3, label: "Attendance" },
  { href: "/projects", icon: FolderKanban, label: "Projects" },
  { href: "/inbox", icon: Inbox, label: "Inbox" },
  { href: "/settings", icon: Settings, label: "Settings" },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-on-surface-variant/10 bg-surface/95 pb-[max(env(safe-area-inset-bottom),0.35rem)] shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl md:hidden">
      <div className="mx-auto flex h-[3.85rem] max-w-md items-center justify-around gap-1 px-1.5">
        {tabs.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || pathname?.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 text-[9px] font-medium transition-all",
                isActive
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/15"
                  : "text-on-surface-variant/55 hover:text-on-surface"
              )}
            >
              <Icon className={cn("h-4 w-4 transition-transform", isActive && "scale-110")} />
              <span className="truncate">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
