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
import { ArrowLeft, Plus, Trash2, Loader2, Target, Calendar } from "lucide-react"

interface Milestone {
  id: string
  title: string
  completed: boolean
  dueDate: string | null
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
}

const STATUSES = [
  { value: "ON_TRACK", label: "On Track", color: "bg-green-500" },
  { value: "AT_RISK", label: "At Risk", color: "bg-yellow-500" },
  { value: "BEHIND", label: "Behind", color: "bg-red-500" },
  { value: "COMPLETED", label: "Completed", color: "bg-blue-500" },
]

export function GoalDetailClient({ goal: initialGoal }: { goal: Goal }) {
  const router = useRouter()
  const [goal, setGoal] = useState<Goal>(initialGoal)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [newMilestoneTitle, setNewMilestoneTitle] = useState("")
  const [newMilestoneDue, setNewMilestoneDue] = useState("")
  const [addingMilestone, setAddingMilestone] = useState(false)

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

  const completedMilestones = goal.milestones.filter(m => m.completed).length

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
