"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Link2, X, Plus, Loader2, ArrowRight, Ban } from "lucide-react"

interface Dependency {
  id: string
  type: string
  dependsOnTask: { id: string; title: string; status: string }
}

interface DependedOnBy {
  id: string
  type: string
  task: { id: string; title: string; status: string }
}

export function TaskDependencies({ taskId, projectTasks = [] }: { taskId: string; projectTasks?: { id: string; title: string }[] }) {
  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [dependedOnBy, setDependedOnBy] = useState<DependedOnBy[]>([])
  const [adding, setAdding] = useState(false)
  const [selectedTask, setSelectedTask] = useState("")
  const [depType, setDepType] = useState("BLOCKING")

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/dependencies`)
      .then(r => r.json())
      .then(data => { setDependencies(data.dependencies || []); setDependedOnBy(data.dependedOnBy || []) })
      .catch(() => {})
  }, [taskId])

  const addDependency = async () => {
    if (!selectedTask) return
    setAdding(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependsOnTaskId: selectedTask, type: depType }),
      })
      if (res.ok) { const data = await res.json(); setDependencies([...dependencies, data.dependency]); setSelectedTask("") }
    } catch (e) { console.error(e) } finally { setAdding(false) }
  }

  const removeDependency = async (depId: string) => {
    await fetch(`/api/tasks/${taskId}/dependencies?id=${depId}`, { method: "DELETE" })
    setDependencies(dependencies.filter(d => d.id !== depId))
  }

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        <Link2 className="h-3 w-3" /> Dependencies
      </Label>
      {dependencies.length > 0 && (
        <div className="space-y-1.5">
          {dependencies.map(dep => (
            <div key={dep.id} className="flex items-center gap-2 text-sm py-1 px-2 rounded-md bg-muted/50">
              <Ban className="h-3.5 w-3.5 text-orange-500 shrink-0" />
              <Badge variant="secondary" className="text-[10px]">{dep.type === "BLOCKING" ? "Blocked by" : "Waiting on"}</Badge>
              <span className="truncate">{dep.dependsOnTask.title}</span>
              <Badge variant="outline" className="text-[10px] ml-auto">{dep.dependsOnTask.status}</Badge>
              <button onClick={() => removeDependency(dep.id)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      {dependedOnBy.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">BLOCKING</span>
          {dependedOnBy.map(dep => (
            <div key={dep.id} className="flex items-center gap-2 text-sm py-1 px-2 rounded-md bg-red-50">
              <ArrowRight className="h-3.5 w-3.5 text-red-500 shrink-0" />
              <span className="truncate">{dep.task.title}</span>
              <Badge variant="outline" className="text-[10px] ml-auto">{dep.task.status}</Badge>
            </div>
          ))}
        </div>
      )}
      {dependencies.length === 0 && dependedOnBy.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-2">No dependencies</p>
      )}
    </div>
  )
}
