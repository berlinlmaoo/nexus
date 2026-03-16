"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, CheckSquare, FolderKanban, Inbox, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

const tabs = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Home" },
  { href: "/my-tasks", icon: CheckSquare, label: "Tasks" },
  { href: "/projects", icon: FolderKanban, label: "Projects" },
  { href: "/inbox", icon: Inbox, label: "Inbox" },
  { href: "/settings", icon: Settings, label: "Settings" },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden">
      <div className="flex items-center justify-around h-14">
        {tabs.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || pathname?.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 w-full h-full text-[10px] font-medium transition-colors",
                isActive ? "text-zinc-900 dark:text-white" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive && "scale-110")} />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
