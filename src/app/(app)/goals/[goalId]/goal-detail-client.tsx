"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, Plus, Trash2, Loader2, Target, Calendar, FolderKanban, CheckSquare, X, Search, Link2 } from "lucide-react"

interface Milestone {
  id: string
  title: string
  completed: boolean
  dueDate: string | null
}

interface LinkedProject {
  id: string
  name: string
  color: string
  status: string
}

interface LinkedTask {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  project: { id: string; name: string; color: string } | null
}

interface Goal {
  id: string
  title: string
  description: string | null
  status: string
  progress: number
  dueDate: string | null
  owner: { id: string; name: string | null; avatar: string | null }
  milestones: Milestone[]
  linkedProjects: LinkedProject[]
  linkedTasks: LinkedTask[]
  taskStats: { total: number; completed: number }
}

interface WorkspaceProject {
  id: string
  name: string
  color: string
}

interface WorkspaceTask {
  id: string
  title: string
  status: string
  project: { id: string; name: string; color: string } | null
}

const STATUSES = [
  { value: "ON_TRACK", label: "On Track", color: "bg-green-500" },
  { value: "AT_RISK", label: "At Risk", color: "bg-yellow-500" },
  { value: "BEHIND", label: "Behind", color: "bg-red-500" },
  { value: "COMPLETED", label: "Completed", color: "bg-blue-500" },
]

const STATUS_COLORS: Record<string, string> = {
  TODO: "bg-gray-400",
  IN_PROGRESS: "bg-blue-500",
  IN_REVIEW: "bg-yellow-500",
  DONE: "bg-green-500",
  CANCELLED: "bg-red-400",
}

export function GoalDetailClient({
  goal: initialGoal,
  workspaceProjects = [],
  workspaceTasks = [],
}: {
  goal: Goal
  workspaceProjects?: WorkspaceProject[]
  workspaceTasks?: WorkspaceTask[]
}) {
  const router = useRouter()
  const [goal, setGoal] = useState<Goal>(initialGoal)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [newMilestoneTitle, setNewMilestoneTitle] = useState("")
  const [newMilestoneDue, setNewMilestoneDue] = useState("")
  const [addingMilestone, setAddingMilestone] = useState(false)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [showTaskPicker, setShowTaskPicker] = useState(false)
  const [projectSearch, setProjectSearch] = useState("")
  const [taskSearch, setTaskSearch] = useState("")

  const update = async (data: Record<string, any>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        const result = await res.json()
        setGoal(result.goal)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const toggleMilestone = async (milestone: Milestone) => {
    await update({ toggleMilestone: { id: milestone.id, completed: !milestone.completed } })
  }

  const addMilestone = async () => {
    if (!newMilestoneTitle.trim()) return
    setAddingMilestone(true)
    await update({ addMilestone: { title: newMilestoneTitle, dueDate: newMilestoneDue || null } })
    setNewMilestoneTitle("")
    setNewMilestoneDue("")
    setAddingMilestone(false)
  }

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this goal?")) return
    setDeleting(true)
    try {
      await fetch(`/api/goals/${goal.id}`, { method: "DELETE" })
      router.push("/goals")
    } catch (e) {
      console.error(e)
      setDeleting(false)
    }
  }

  const linkProject = async (projectId: string) => {
    await update({ linkProject: projectId })
    setShowProjectPicker(false)
    setProjectSearch("")
  }

  const unlinkProject = async (projectId: string) => {
    await update({ unlinkProject: projectId })
  }

  const linkTask = async (taskId: string) => {
    await update({ linkTask: taskId })
    setShowTaskPicker(false)
    setTaskSearch("")
  }

  const unlinkTask = async (taskId: string) => {
    await update({ unlinkTask: taskId })
  }

  const completedMilestones = goal.milestones.filter(m => m.completed).length
  const linkedProjectIds = new Set(goal.linkedProjects.map(p => p.id))
  const linkedTaskIds = new Set(goal.linkedTasks.map(t => t.id))

  const filteredProjects = workspaceProjects.filter(
    p => !linkedProjectIds.has(p.id) && p.name.toLowerCase().includes(projectSearch.toLowerCase())
  )
  const filteredTasks = workspaceTasks.filter(
    t => !linkedTaskIds.has(t.id) && t.title.toLowerCase().includes(taskSearch.toLowerCase())
  )

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={() => router.push("/goals")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Goals
      </button>

      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              <Target className="h-5 w-5 text-[#18181B]" />
            </div>
            <div>
              <Input
                className="text-xl font-bold border-none p-0 h-auto focus-visible:ring-0 shadow-none"
                value={goal.title}
                onChange={e => setGoal({ ...goal, title: e.target.value })}
                onBlur={() => update({ title: goal.title })}
              />
            </div>
          </div>
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Description</Label>
            <Textarea
              placeholder="Add a description..."
              value={goal.description || ""}
              onChange={e => setGoal({ ...goal, description: e.target.value })}
              onBlur={() => update({ description: goal.description })}
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Status</Label>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map(s => (
                  <button
                    key={s.value}
                    onClick={() => update({ status: s.value })}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      goal.status === s.value
                        ? "ring-2 ring-[#18181B] ring-offset-1"
                        : "opacity-60 hover:opacity-100"
                    }`}
                  >
                    <div className={`h-2 w-2 rounded-full ${s.color}`} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Due Date</Label>
              <Input
                type="date"
                value={goal.dueDate ? goal.dueDate.split("T")[0] : ""}
                onChange={e => update({ dueDate: e.target.value || null })}
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">
              Progress - {goal.progress}%
              {goal.taskStats.total > 0 && (
                <span className="ml-2 text-muted-foreground font-normal">
                  ({goal.taskStats.completed}/{goal.taskStats.total} tasks done)
                </span>
              )}
            </Label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={goal.progress}
                onChange={e => setGoal({ ...goal, progress: parseInt(e.target.value) })}
                onMouseUp={() => update({ progress: goal.progress })}
                onTouchEnd={() => update({ progress: goal.progress })}
                className="flex-1 accent-[#18181B]"
              />
              <span className="text-sm font-semibold text-[#18181B] w-12 text-right">{goal.progress}%</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Linked Projects */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Linked Projects</h3>
            <span className="text-xs text-muted-foreground">{goal.linkedProjects.length}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowProjectPicker(!showProjectPicker)}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Project
          </Button>
        </div>

        {showProjectPicker && (
          <div className="mb-4 border rounded-lg p-3 bg-muted/30">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {filteredProjects.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">No projects found</p>
              ) : (
                filteredProjects.map(project => (
                  <button
                    key={project.id}
                    onClick={() => linkProject(project.id)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                    {project.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {goal.linkedProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3">No linked projects</p>
          ) : (
            goal.linkedProjects.map(project => (
              <div key={project.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                  <span className="text-sm font-medium">{project.name}</span>
                  <Badge variant="outline" className="text-[10px] h-5">{project.status}</Badge>
                </div>
                <button
                  onClick={() => unlinkProject(project.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Linked Tasks */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Linked Tasks</h3>
            <span className="text-xs text-muted-foreground">
              {goal.taskStats.completed}/{goal.taskStats.total} done
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowTaskPicker(!showTaskPicker)}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Task
          </Button>
        </div>

        {goal.taskStats.total > 0 && (
          <div className="w-full h-1.5 bg-muted rounded-full mb-4">
            <div
              className="h-full rounded-full bg-[#18181B] transition-all"
              style={{ width: `${(goal.taskStats.completed / goal.taskStats.total) * 100}%` }}
            />
          </div>
        )}

        {showTaskPicker && (
          <div className="mb-4 border rounded-lg p-3 bg-muted/30">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search tasks..."
                value={taskSearch}
                onChange={e => setTaskSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">No tasks found</p>
              ) : (
                filteredTasks.slice(0, 50).map(task => (
                  <button
                    key={task.id}
                    onClick={() => linkTask(task.id)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm hover:bg-muted transition-colors text-left"
                  >
                    <span className="truncate flex-1">{task.title}</span>
                    {task.project && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: task.project.color }} />
                        {task.project.name}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {goal.linkedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3">No linked tasks</p>
          ) : (
            goal.linkedTasks.map(task => (
              <div key={task.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${STATUS_COLORS[task.status] || "bg-gray-400"}`} />
                  <span className="text-sm truncate">{task.title}</span>
                  {task.project && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: task.project.color }} />
                      {task.project.name}
                    </span>
                  )}
                  <Badge variant="outline" className="text-[10px] h-5 shrink-0">
                    {task.status.replace("_", " ")}
                  </Badge>
                </div>
                <button
                  onClick={() => unlinkTask(task.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Milestones */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-sm">Milestones</h3>
            <p className="text-xs text-muted-foreground">
              {completedMilestones} of {goal.milestones.length} completed
            </p>
          </div>
          {goal.milestones.length > 0 && (
            <div className="w-20 h-1.5 bg-muted rounded-full">
              <div
                className="h-full rounded-full bg-[#18181B] transition-all"
                style={{ width: `${goal.milestones.length > 0 ? (completedMilestones / goal.milestones.length) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>

        <div className="space-y-2 mb-4">
          {goal.milestones.map(milestone => (
            <div
              key={milestone.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                milestone.completed ? "bg-green-50" : "bg-muted/30 hover:bg-muted/50"
              }`}
            >
              <Checkbox
                checked={milestone.completed}
                onCheckedChange={() => toggleMilestone(milestone)}
                className="data-[state=checked]:bg-[#18181B] data-[state=checked]:border-[#18181B]"
              />
              <span className={`flex-1 text-sm ${milestone.completed ? "line-through text-muted-foreground" : ""}`}>
                {milestone.title}
              </span>
              {milestone.dueDate && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(milestone.dueDate).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
          {goal.milestones.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No milestones yet. Add one below.</p>
          )}
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Add a milestone..."
            value={newMilestoneTitle}
            onChange={e => setNewMilestoneTitle(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addMilestone()}
            className="h-9"
          />
          <Input
            type="date"
            value={newMilestoneDue}
            onChange={e => setNewMilestoneDue(e.target.value)}
            className="h-9 w-40"
          />
          <Button
            onClick={addMilestone}
            disabled={addingMilestone || !newMilestoneTitle.trim()}
            size="sm"
            className="bg-foreground text-background hover:bg-foreground/90 shrink-0"
          >
            {addingMilestone ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
          {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
          Delete Goal
        </Button>
      </div>
    </div>
  )
}
