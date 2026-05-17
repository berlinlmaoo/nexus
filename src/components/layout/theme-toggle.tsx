"use client"

import { Laptop, Moon, Sun } from "lucide-react"
import { useTheme, type Theme } from "@/components/layout/theme-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const themeOptions: Array<{
  value: Theme
  label: string
  description: string
  icon: typeof Sun
}> = [
  {
    value: "light",
    label: "Light",
    description: "Bright workspace",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Low-light workspace",
    icon: Moon,
  },
  {
    value: "system",
    label: "System",
    description: "Follow device",
    icon: Laptop,
  },
]

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme, mounted } = useTheme()
  const TriggerIcon = resolvedTheme === "dark" ? Moon : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="touch-target inline-flex items-center justify-center rounded-xl text-on-surface-variant/70 transition-all duration-200 hover:bg-surface-container-high hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          aria-label="Change color theme"
          title="Theme"
        >
          <TriggerIcon className="h-4.5 w-4.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="mt-2 w-52 rounded-2xl border border-border bg-surface-container-lowest p-2 shadow-2xl shadow-primary/10"
      >
        {themeOptions.map((option) => {
          const Icon = option.icon
          const selected = mounted && theme === option.value

          return (
            <DropdownMenuItem
              key={option.value}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors focus:bg-surface-container-high",
                selected
                  ? "bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                  : "text-on-surface hover:bg-surface-container-high"
              )}
              onClick={() => setTheme(option.value)}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-black uppercase tracking-[0.18em]">
                  {option.label}
                </span>
                <span
                  className={cn(
                    "block text-[11px] font-semibold",
                    selected ? "text-primary-foreground/70" : "text-on-surface-variant/60"
                  )}
                >
                  {option.description}
                </span>
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
