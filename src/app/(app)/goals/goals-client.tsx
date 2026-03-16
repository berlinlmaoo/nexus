"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Target, Plus, Calendar, CheckCircle2, Loader2, ChevronDown, ChevronRight, CornerDownRight } from "lucide-react"
import { toast } from "sonner"

interface Goal {
  id: string
  title: string
  description: string | null
  status: string
  progress: number
  dueDate: string | null
  parentId?: string | null
  createdAt: string
  owner: { id: string; name: string | null; avatar: string | null }
  milestones: { id: string; title: string; completed: boolean }[]
  children?: Goal[]
}

function GoalCard({
  goal,
  depth,
  expanded,
  onToggle,
  onNavigate,
  onAddSubGoal,
}: {
  goal: Goal
  depth: number
  expanded: Record<string, boolean>
  onToggle: (id: string) => void
  onNavigate: (id: string) => void
  onAddSubGoal: (parentId: string) => void
}) {
  const statusConfig = STATUS_CONFIG[goal.status] || STATUS_CONFIG.ON_TRACK
  const completedMilestones = goal.milestones.filter(m => m.completed).length
  const totalMilestones = goal.milestones.length
  const hasChildren = goal.children && goal.children.length > 0
  const isExpanded = expanded[goal.id] || false

  return (
    <div style={{ marginLeft: depth > 0 ? `${depth * 24}px` : undefined }}>
      <Card
        className="p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4"
        style={{ borderLeftColor: goal.status === "COMPLETED" ? "#3b82f6" : goal.status === "BEHIND" ? "#ef4444" : goal.status === "AT_RISK" ? "#eab308" : "#22c55e" }}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {hasChildren && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggle(goal.id) }}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              )}
              {depth > 0 && !hasChildren && (
                <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
              )}
              <h3
                className="font-semibold text-sm truncate hover:underline"
                onClick={() => onNavigate(goal.id)}
              >
                {goal.title}
              </h3>
              <Badge variant="outline" className={`text-[10px] shrink-0 ${statusConfig.color} ${statusConfig.bg}`}>
                {statusConfig.label}
              </Badge>
            </div>
            {goal.description && (
              <p className="text-xs text-muted-foreground line-clamp-1 mb-2">{goal.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {goal.dueDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(goal.dueDate).toLocaleDateString()}
                </span>
              )}
              {totalMilestones > 0 && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {completedMilestones}/{totalMilestones} milestones
                </span>
              )}
              {hasChildren && (
                <span className="text-[10px]">{goal.children!.length} sub-goal{goal.children!.length !== 1 ? "s" : ""}</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onAddSubGoal(goal.id) }}
                className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <Plus className="h-3 w-3" /> Sub-goal
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 ml-4">
            <div className="text-right">
              <span className="text-sm font-semibold text-[#18181B]">{goal.progress}%</span>
              <div className="w-24 h-1.5 bg-muted rounded-full mt-1">
                <div
                  className="h-full rounded-full bg-[#18181B] transition-all"
                  style={{ width: `${goal.progress}%` }}
                />
              </div>
            </div>
            <UserAvatar user={{ name: goal.owner.name || "?", avatar: goal.owner.avatar }} size="sm" />
          </div>
        </div>
      </Card>
      {isExpanded && hasChildren && (
        <div className="mt-2 space-y-2">
          {goal.children!.map(child => (
            <GoalCard
              key={child.id}
              goal={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onNavigate={onNavigate}
              onAddSubGoal={onAddSubGoal}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  ON_TRACK: { label: "On Track", color: "text-green-700", bg: "bg-green-50 border-green-200" },
  AT_RISK: { label: "At Risk", color: "text-yellow-700", bg: "bg-yellow-50 border-yellow-200" },
  BEHIND: { label: "Behind", color: "text-red-700", bg: "bg-red-50 border-red-200" },
  COMPLETED: { label: "Completed", color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
}

export function GoalsPageClient({ goals: initialGoals, workspaceId }: { goals: Goal[]; workspaceId: string }) {
  const router = useRouter()
  const [goals, setGoals] = useState<Goal[]>(initialGoals)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [parentGoalId, setParentGoalId] = useState<string>("")
  const [expandedGoals, setExpandedGoals] = useState<Record<string, boolean>>({})

  // Only show top-level goals (no parentId)
  const topLevelGoals = goals.filter(g => !g.parentId)

  const toggleExpand = (goalId: string) => {
    setExpandedGoals(prev => ({ ...prev, [goalId]: !prev[goalId] }))
  }

  const handleCreate = async (overrideParentId?: string) => {
    if (!title.trim()) return
    setCreating(true)
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: description || null, dueDate: dueDate || null, workspaceId, parentId: overrideParentId || parentGoalId || null }),
      })
      if (res.ok) {
        const data = await res.json()
        if (overrideParentId || parentGoalId) {
          // Add as child
          const pid = overrideParentId || parentGoalId
          setGoals(prev => prev.map(g => g.id === pid ? { ...g, children: [...(g.children || []), data.goal] } : g))
          setExpandedGoals(prev => ({ ...prev, [pid]: true }))
        } else {
          setGoals([data.goal, ...goals])
        }
        setTitle("")
        setDescription("")
        setDueDate("")
        setParentGoalId("")
        setOpen(false)
        toast.success(overrideParentId || parentGoalId ? "Sub-goal created" : "Goal created")
      } else {
        toast.error("Failed to create goal")
      }
    } catch (e) {
      console.error(e)
      toast.error("Failed to create goal")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Goals</h1>
          <p className="text-sm text-muted-foreground mt-1">Track and manage team objectives</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setParentGoalId("") }}>
          <DialogTrigger asChild>
            <Button className="bg-foreground text-background hover:bg-foreground/90">
              <Plus className="h-4 w-4 mr-2" /> New Goal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{parentGoalId ? "Create Sub-Goal" : "Create Goal"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {parentGoalId && (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  Parent: <span className="font-medium text-foreground">{goals.find(g => g.id === parentGoalId)?.title || "..."}</span>
                </div>
              )}
              <div className="space-y-2">
                <Label>Title</Label>
                <Input placeholder="Goal title..." value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea placeholder="Describe the goal..." value={description} onChange={e => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <Button onClick={() => handleCreate()} disabled={creating || !title.trim()} className="w-full bg-foreground text-background hover:bg-foreground/90">
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                {parentGoalId ? "Create Sub-Goal" : "Create Goal"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {topLevelGoals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Target className="h-8 w-8 text-[#18181B]" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No goals yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create your first goal to start tracking objectives</p>
          <Button onClick={() => setOpen(true)} className="bg-foreground text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4 mr-2" /> Create Goal
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {topLevelGoals.map(goal => (
            <GoalCard
              key={goal.id}
              goal={goal}
              depth={0}
              expanded={expandedGoals}
              onToggle={toggleExpand}
              onNavigate={(id) => router.push(`/goals/${id}`)}
              onAddSubGoal={(parentId) => {
                setParentGoalId(parentId)
                setOpen(true)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
