"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Plus,
  X,
  Search,
  Loader2,
  Link2,
  ArrowRight,
  ArrowLeft,
  Copy,
  GitBranch,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface RelatedTask {
  id: string
  title: string
  status: string
  project?: { id: string; name: string }
}

interface TaskRelation {
  id: string
  type: string
  sourceTaskId: string
  targetTaskId: string
  sourceTask: RelatedTask
  targetTask: RelatedTask
}

interface TaskRelationsProps {
  taskId: string
}

const RELATION_TYPES = [
  { value: "RELATED_TO", label: "Related to", icon: Link2 },
  { value: "BLOCKS", label: "Blocks", icon: ArrowRight },
  { value: "BLOCKED_BY", label: "Blocked by", icon: ArrowLeft },
  { value: "DUPLICATES", label: "Duplicates", icon: Copy },
  { value: "PARENT_OF", label: "Parent of", icon: GitBranch },
]

const STATUS_COLORS: Record<string, string> = {
  TODO: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  IN_REVIEW: "bg-amber-50 text-amber-700",
  DONE: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-red-50 text-red-700",
}

export function TaskRelations({ taskId }: TaskRelationsProps) {
  const [relations, setRelations] = useState<TaskRelation[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<RelatedTask[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedType, setSelectedType] = useState("RELATED_TO")
  const [adding, setAdding] = useState(false)

  const fetchRelations = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/relations`)
      if (res.ok) {
        const data = await res.json()
        setRelations(data.relations || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    fetchRelations()
  }, [fetchRelations])

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json()
        setSearchResults(
          (data.tasks || [])
            .filter((t: any) => t.id !== taskId)
            .map((t: any) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              project: t.taskList?.project
                ? { id: t.taskList.projectId, name: t.taskList.project.name }
                : undefined,
            }))
        )
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSearching(false)
    }
  }, [taskId])

  useEffect(() => {
    const timer = setTimeout(() => handleSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, handleSearch])

  const handleAddRelation = async (targetId: string) => {
    setAdding(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTaskId: targetId, type: selectedType }),
      })
      if (res.ok) {
        fetchRelations()
        setShowAdd(false)
        setSearchQuery("")
        setSearchResults([])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setAdding(false)
    }
  }

  const handleRemoveRelation = async (relationId: string) => {
    try {
      await fetch(`/api/tasks/${taskId}/relations/${relationId}`, {
        method: "DELETE",
      })
      setRelations((prev) => prev.filter((r) => r.id !== relationId))
    } catch (e) {
      console.error(e)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Related Tasks
        </h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setShowAdd(!showAdd)}
        >
          <Plus className="h-3 w-3 mr-1" /> Link Task
        </Button>
      </div>

      {/* Add relation panel */}
      {showAdd && (
        <div className="rounded-lg border p-3 space-y-3 animate-slide-down">
          {/* Relation type */}
          <div className="flex flex-wrap gap-1.5">
            {RELATION_TYPES.map((rt) => {
              const Icon = rt.icon
              return (
                <button
                  key={rt.value}
                  onClick={() => setSelectedType(rt.value)}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-all",
                    selectedType === rt.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-input hover:bg-muted"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {rt.label}
                </button>
              )
            })}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tasks across projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>

          {/* Results */}
          {searching && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {searchResults.map((task) => (
                <button
                  key={task.id}
                  onClick={() => handleAddRelation(task.id)}
                  disabled={adding}
                  className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors"
                >
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[9px] px-1.5",
                      STATUS_COLORS[task.status] || ""
                    )}
                  >
                    {task.status.replace("_", " ")}
                  </Badge>
                  <span className="truncate flex-1 text-left">{task.title}</span>
                  {task.project && (
                    <Badge variant="outline" className="text-[9px] px-1.5">
                      {task.project.name}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Existing relations */}
      {relations.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">
          No linked tasks
        </p>
      ) : (
        <div className="space-y-1.5">
          {relations.map((rel) => {
            const isSource = rel.sourceTaskId === taskId
            const linkedTask = isSource ? rel.targetTask : rel.sourceTask
            const typeInfo = RELATION_TYPES.find((rt) => rt.value === rel.type)
            const Icon = typeInfo?.icon || Link2

            return (
              <div
                key={rel.id}
                className="flex items-center gap-2 rounded-md border px-2.5 py-2 group"
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      {typeInfo?.label || rel.type}
                    </span>
                  </div>
                  <p className="text-xs font-medium truncate">{linkedTask.title}</p>
                </div>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[9px] shrink-0",
                    STATUS_COLORS[linkedTask.status] || ""
                  )}
                >
                  {linkedTask.status.replace("_", " ")}
                </Badge>
                {linkedTask.project && (
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {linkedTask.project.name}
                  </Badge>
                )}
                <button
                  onClick={() => handleRemoveRelation(rel.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
