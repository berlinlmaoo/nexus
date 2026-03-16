"use client"

import Link from "next/link"
import {
  Plus,
  FolderPlus,
  FileText,
  Target,
  BarChart3,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface QuickActionsWidgetProps {
  data?: any
}

const actions = [
  {
    label: "New Task",
    href: "/my-tasks?new=true",
    icon: Plus,
  },
  {
    label: "New Project",
    href: "/projects?new=true",
    icon: FolderPlus,
  },
  {
    label: "New Doc",
    href: "/docs?new=true",
    icon: FileText,
  },
  {
    label: "Go to Goals",
    href: "/goals",
    icon: Target,
  },
  {
    label: "Go to Reports",
    href: "/reports",
    icon: BarChart3,
  },
  {
    label: "Go to Teams",
    href: "/teams",
    icon: Users,
  },
]

export function QuickActionsWidget({ data }: QuickActionsWidgetProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="outline"
          asChild
          className="h-auto flex-col gap-1.5 py-3 px-2 text-muted-foreground hover:text-foreground hover:bg-accent border-border"
        >
          <Link href={action.href}>
            <action.icon className="h-4 w-4" />
            <span className="text-xs font-medium">{action.label}</span>
          </Link>
        </Button>
      ))}
    </div>
  )
}
