"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { SprintBoard } from "@/components/sprints/sprint-board"
import { Plus, Loader2, Play, CheckCircle2, Clock, ArrowLeft, ChevronDown, ChevronUp, Zap } from "lucide-react"

interface SprintTask {
  id: string
  task: { id: string; title: string; status: string; priority: string; assignees?: { user: { id: string; name: string } }[] }
}

interface Sprint {
  id: string
  name: string
  status: string
  startDate: string
  endDate: string
  tasks: SprintTask[]
}

interface AvailableTask {
  id: string
  title: string
  status: string
  priority: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PLANNING: { label: "Planning", color: "bg-muted text-muted-foreground", icon: <Clock className="h-3 w-3" /> },
  ACTIVE: { label: "Active", color: "bg-green-100 text-green-700", icon: <Play className="h-3 w-3" /> },
  COMPLETED: { label: "Completed", color: "bg-blue-100 text-blue-700", icon: <CheckCircle2 className="h-3 w-3" /> },
}

export function SprintsClient({
  project,
  sprints: initialSprints,
  availableTasks: initialAvailable,
}: {
  project: { id: string; name: string; color: string | null }
  sprints: Sprint[]
  availableTasks: AvailableTask[]
}) {
  const router = useRouter()
  const [sprints, setSprints] = useState<Sprint[]>(initialSprints)
  const [availableTasks, setAvailableTasks] = useState<AvailableTask[]>(initialAvailable)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [expandedSprint, setExpandedSprint] = useState<string | null>(sprints.find(s => s.status === "ACTIVE")?.id || sprints[0]?.id || null)
  const [addingTask, setAddingTask] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim() || !startDate || !endDate) return
    setCreating(true)
    try {
      const res = await fetch("/api/sprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, projectId: project.id, startDate, endDate }),
      })
      if (res.ok) {
        const data = await res.json()
        setSprints([data.sprint, ...sprints])
        setName("")
        setStartDate("")
        setEndDate("")
        setOpen(false)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  const updateSprintStatus = async (sprintId: string, status: string) => {
    try {
      const res = await fetch("/api/sprints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sprintId, status }),
      })
      if (res.ok) {
        const data = await res.json()
        setSprints(sprints.map(s => s.id === sprintId ? { ...s, ...data.sprint } : s))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const addTaskToSprint = async (sprintId: string, taskId: string) => {
    try {
      const res = await fetch("/api/sprints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sprintId, addTaskId: taskId }),
      })
      if (res.ok) {
        const data = await res.json()
        setSprints(sprints.map(s => s.id === sprintId ? { ...s, ...data.sprint } : s))
        setAvailableTasks(availableTasks.filter(t => t.id !== taskId))
        setAddingTask(null)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const getNextStatus = (current: string) => {
    if (current === "PLANNING") return "ACTIVE"
    if (current === "ACTIVE") return "COMPLETED"
    return null
  }

  const getProgress = (sprint: Sprint) => {
    if (sprint.tasks.length === 0) return 0
    const done = sprint.tasks.filter(t => t.task.status === "DONE").length
    return Math.round((done / sprint.tasks.length) * 100)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => router.push(`/projects/${project.id}`)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {project.name}
        </button>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Sprints</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage sprint cycles and track progress</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-foreground text-background hover:bg-foreground/90">
              <Plus className="h-4 w-4 mr-2" /> New Sprint
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Sprint</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Sprint Name</Label>
                <Input placeholder="Sprint 1..." value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
              <Button onClick={handleCreate} disabled={creating || !name.trim() || !startDate || !endDate} className="w-full bg-foreground text-background hover:bg-foreground/90">
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Create Sprint
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {sprints.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Zap className="h-8 w-8 text-[#18181B]" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No sprints yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create your first sprint to organize work into cycles</p>
          <Button onClick={() => setOpen(true)} className="bg-foreground text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4 mr-2" /> Create Sprint
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {sprints.map(sprint => {
            const progress = getProgress(sprint)
            const statusConfig = STATUS_CONFIG[sprint.status] || STATUS_CONFIG.PLANNING
            const nextStatus = getNextStatus(sprint.status)
            const isExpanded = expandedSprint === sprint.id
            const tasks = sprint.tasks.map(st => st.task)

            return (
              <Card key={sprint.id} className="overflow-hidden">
                <div
                  className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedSprint(isExpanded ? null : sprint.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      <div>
                        <h3 className="font-semibold text-sm">{sprint.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
                          </span>
                          <Badge className={`text-[10px] ${statusConfig.color}`}>
                            <span className="mr-1">{statusConfig.icon}</span> {statusConfig.label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="text-xs font-medium">{sprint.tasks.length} tasks</span>
                        <div className="w-20 h-1.5 bg-muted rounded-full mt-1">
                          <div className="h-full rounded-full bg-[#18181B] transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-[#18181B]">{progress}%</span>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        {nextStatus && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); updateSprintStatus(sprint.id, nextStatus) }}
                          >
                            {nextStatus === "ACTIVE" ? <Play className="h-3 w-3 mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                            {nextStatus === "ACTIVE" ? "Start Sprint" : "Complete Sprint"}
                          </Button>
                        )}
                      </div>
                      <div className="relative">
                        {addingTask === sprint.id ? (
                          <div className="flex items-center gap-2">
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-[200px]"
                              onChange={e => { if (e.target.value) addTaskToSprint(sprint.id, e.target.value) }}
                              defaultValue=""
                            >
                              <option value="">Select a task...</option>
                              {availableTasks.map(t => (
                                <option key={t.id} value={t.id}>{t.title}</option>
                              ))}
                            </select>
                            <Button size="sm" variant="ghost" onClick={() => setAddingTask(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setAddingTask(sprint.id)} disabled={availableTasks.length === 0}>
                            <Plus className="h-3 w-3 mr-1" /> Add Task
                          </Button>
                        )}
                      </div>
                    </div>

                    {tasks.length > 0 ? (
                      <SprintBoard tasks={tasks} />
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">No tasks in this sprint. Add tasks to get started.</p>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
