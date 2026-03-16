"use client"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2 } from "lucide-react"

const COLUMNS = [
  { status: "TODO", label: "To Do" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "IN_REVIEW", label: "In Review" },
  { status: "DONE", label: "Done" },
]

export function SprintBoard({ tasks }: { tasks: { id: string; title: string; status: string; priority: string }[] }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {COLUMNS.map(col => (
        <div key={col.status}>
          <h4 className="font-medium text-sm mb-2 text-muted-foreground">{col.label} ({tasks.filter(t => t.status === col.status).length})</h4>
          <div className="space-y-2">
            {tasks.filter(t => t.status === col.status).map(task => (
              <Card key={task.id} className="p-3">
                <div className="flex items-start gap-2">
                  {task.status === "DONE" ? <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" /> : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 mt-0.5 shrink-0" />}
                  <span className="text-sm">{task.title}</span>
                </div>
                <Badge variant="secondary" className="mt-2 text-[10px]">{task.priority}</Badge>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
