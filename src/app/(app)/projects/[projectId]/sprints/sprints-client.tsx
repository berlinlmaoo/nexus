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
import { Plus, Loader2, Play, CheckCircle2, Clock, ArrowLeft, ChevronDown, ChevronUp, Zap, AlertTriangle, Archive, ArrowRight, FolderPlus } from "lucide-react"
import { toast } from "sonner"

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

interface IncompleteTask {
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

  // Sprint completion dialog state
  const [completionDialog, setCompletionDialog] = useState<{ sprintId: string; incompleteTasks: IncompleteTask[] } | null>(null)
  const [completing, setCompleting] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || !startDate || !endDate) return
    if (new Date(endDate) <= new Date(startDate)) {
      toast.error("End date must be after start date")
      return
    }
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
        toast.success("Sprint created")
      } else {
        toast.error("Failed to create sprint")
      }
    } catch (e) {
      console.error(e)
      toast.error("Failed to create sprint")
    } finally {
      setCreating(false)
    }
  }

  const updateSprintStatus = async (sprintId: string, status: string, moveIncompleteTo?: string) => {
    try {
      const res = await fetch("/api/sprints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sprintId, status, ...(moveIncompleteTo && { moveIncompleteTo }) }),
      })
      if (res.ok) {
        const data = await res.json()
        // If API returns incomplete tasks requiring action, show dialog
        if (data.requiresAction && data.incompleteTasks) {
          setCompletionDialog({ sprintId, incompleteTasks: data.incompleteTasks })
          return
        }
        setSprints(sprints.map(s => s.id === sprintId ? { ...s, ...data.sprint } : s))
        toast.success(`Sprint ${status === "ACTIVE" ? "started" : status === "COMPLETED" ? "completed" : "updated"}`)
      } else {
        toast.error("Failed to update sprint status")
      }
    } catch (e) {
      console.error(e)
      toast.error("Failed to update sprint status")
    }
  }

  const handleCompleteSprint = async (moveIncompleteTo: 'backlog' | 'next_sprint' | 'new_sprint') => {
    if (!completionDialog) return
    setCompleting(true)
    try {
      await updateSprintStatus(completionDialog.sprintId, 'COMPLETED', moveIncompleteTo)
      setCompletionDialog(null)
      router.refresh()
    } catch (e) {
      console.error(e)
      toast.error("Failed to complete sprint")
    } finally {
      setCompleting(false)
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
        toast.success("Task added to sprint")
      } else {
        toast.error("Failed to add task to sprint")
      }
    } catch (e) {
      console.error(e)
      toast.error("Failed to add task to sprint")
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

      {/* Sprint Completion Dialog */}
      <Dialog open={!!completionDialog} onOpenChange={(open) => { if (!open) setCompletionDialog(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-blue-500" />
              Complete Sprint
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Completion summary */}
            {completionDialog && (() => {
              const sprint = sprints.find(s => s.id === completionDialog.sprintId)
              const totalTasks = sprint?.tasks.length ?? 0
              const completedTasks = totalTasks - completionDialog.incompleteTasks.length
              return (
                <div className="flex gap-4 rounded-lg border p-3">
                  <div className="flex-1 text-center">
                    <p className="text-2xl font-bold text-green-600">{completedTasks}</p>
                    <p className="text-[11px] text-muted-foreground">Completed</p>
                  </div>
                  <div className="w-px bg-border" />
                  <div className="flex-1 text-center">
                    <p className="text-2xl font-bold text-amber-500">{completionDialog.incompleteTasks.length}</p>
                    <p className="text-[11px] text-muted-foreground">Incomplete</p>
                  </div>
                  <div className="w-px bg-border" />
                  <div className="flex-1 text-center">
                    <p className="text-2xl font-bold">{totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0}%</p>
                    <p className="text-[11px] text-muted-foreground">Velocity</p>
                  </div>
                </div>
              )
            })()}

            <p className="text-sm text-muted-foreground">
              What should happen to the {completionDialog?.incompleteTasks.length} incomplete task{completionDialog?.incompleteTasks.length !== 1 ? 's' : ''}?
            </p>

            <div className="max-h-36 overflow-y-auto space-y-1.5 rounded-md border p-2">
              {completionDialog?.incompleteTasks.map(task => (
                <div key={task.id} className="flex items-center gap-2 text-sm py-1">
                  <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="flex-1 truncate">{task.title}</span>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{task.priority}</Badge>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={() => handleCompleteSprint('backlog')}
                disabled={completing}
                className="w-full flex items-center justify-center gap-2"
              >
                {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                Move to Backlog
              </Button>
              <Button
                variant="outline"
                onClick={() => handleCompleteSprint('next_sprint')}
                disabled={completing}
                className="w-full flex items-center justify-center gap-2"
              >
                {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Move to Next Sprint
              </Button>
              <Button
                onClick={() => handleCompleteSprint('new_sprint')}
                disabled={completing}
                className="w-full flex items-center justify-center gap-2 bg-foreground text-background hover:bg-foreground/90"
              >
                {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                Create New Sprint & Move
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              &ldquo;Next Sprint&rdquo; moves tasks to the next Planning sprint. If none exists, tasks go to backlog.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
