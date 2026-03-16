"use client"

import * as React from "react"
import { useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowRight,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Zap,
  CheckCircle2,
  X,
  Play,
  Filter,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutomationTrigger {
  type: string
  value?: string
}

interface AutomationCondition {
  type: string
  value?: string
}

interface AutomationAction {
  type: string
  value?: string
}

export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  action: AutomationAction
  condition?: AutomationCondition
}

export interface AutomationBuilderProps {
  projectId: string
  automations: Automation[]
  onUpdate: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIGGERS: Record<string, string> = {
  TASK_CREATED: "Task created",
  TASK_MOVED: "Task moved to section",
  STATUS_CHANGED: "Status changed",
  DUE_DATE_APPROACHING: "Due date approaching",
  TASK_COMPLETED: "Task completed",
  FORM_SUBMITTED: "Form submitted",
  CUSTOM_FIELD_CHANGED: "Custom field changed",
}

const CONDITIONS: Record<string, string> = {
  PRIORITY_IS: "If priority is",
  ASSIGNEE_IS: "If assignee is",
  CUSTOM_FIELD_EQUALS: "If custom field equals",
}

const ACTIONS: Record<string, string> = {
  MOVE_TO_SECTION: "Move to section",
  CHANGE_STATUS: "Change status",
  ASSIGN_TO: "Assign to",
  SET_DUE_DATE: "Set due date",
  ADD_COMMENT: "Add comment",
  SEND_NOTIFICATION: "Send notification",
  MARK_COMPLETE: "Mark complete",
}

const PRIORITY_VALUES = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const
const STATUS_VALUES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const

const TRIGGERS_NEEDING_VALUE = new Set([
  "TASK_MOVED",
  "CUSTOM_FIELD_CHANGED",
])

const ACTIONS_NEEDING_VALUE = new Set([
  "MOVE_TO_SECTION",
  "CHANGE_STATUS",
  "ASSIGN_TO",
  "SET_DUE_DATE",
  "ADD_COMMENT",
  "SEND_NOTIFICATION",
])

// ---------------------------------------------------------------------------
// Draft state used inside the builder form
// ---------------------------------------------------------------------------

interface DraftAction {
  id: string
  type: string
  value?: string
}

interface DraftState {
  name: string
  trigger: AutomationTrigger
  condition?: AutomationCondition
  actions: DraftAction[]
  hasCondition: boolean
}

function emptyDraft(): DraftState {
  return {
    name: "",
    trigger: { type: "" },
    actions: [{ id: crypto.randomUUID(), type: "", value: undefined }],
    hasCondition: false,
  }
}

function draftFromAutomation(a: Automation): DraftState {
  return {
    name: a.name,
    trigger: { ...a.trigger },
    condition: a.condition ? { ...a.condition } : undefined,
    actions: [{ id: crypto.randomUUID(), type: a.action.type, value: a.action.value }],
    hasCondition: !!a.condition,
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function triggerLabel(type: string): string {
  return TRIGGERS[type] ?? type
}

function actionLabel(type: string): string {
  return ACTIONS[type] ?? type
}

function conditionLabel(type: string): string {
  return CONDITIONS[type] ?? type
}

// ---------------------------------------------------------------------------
// Toast notification (lightweight, no external dependency)
// ---------------------------------------------------------------------------

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      <CheckCircle2 className="h-4 w-4 text-zinc-400" />
      {message}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Value input for a given action / trigger / condition type
// ---------------------------------------------------------------------------

function ValueInput({
  parentType,
  value,
  onChange,
  context,
}: {
  parentType: string
  value: string
  onChange: (v: string) => void
  context: "trigger" | "action" | "condition"
}) {
  // Select-based inputs
  if (context === "condition" && parentType === "PRIORITY_IS") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-40">
          <SelectValue placeholder="Select priority" />
        </SelectTrigger>
        <SelectContent>
          {PRIORITY_VALUES.map((p) => (
            <SelectItem key={p} value={p}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (context === "action" && parentType === "CHANGE_STATUS") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-40">
          <SelectValue placeholder="Select status" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_VALUES.map((s) => (
            <SelectItem key={s} value={s}>
              {s.replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // Text-based inputs
  return (
    <Input
      className="h-9 w-40"
      placeholder="Enter value"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

// ---------------------------------------------------------------------------
// ActionRow – a single action inside the builder form
// ---------------------------------------------------------------------------

function ActionRow({
  action,
  index,
  canRemove,
  onUpdate,
  onRemove,
}: {
  action: DraftAction
  index: number
  canRemove: boolean
  onUpdate: (updated: DraftAction) => void
  onRemove: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-end gap-3"
    >
      <div className="flex-1 space-y-1.5">
        <Label className="text-xs text-zinc-500">
          {index === 0 ? "THEN" : "AND"}
        </Label>
        <Select
          value={action.type}
          onValueChange={(v) => onUpdate({ ...action, type: v, value: undefined })}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Select action" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACTIONS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {action.type && ACTIONS_NEEDING_VALUE.has(action.type) && (
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs text-zinc-500">Value</Label>
          <ValueInput
            parentType={action.type}
            value={action.value ?? ""}
            onChange={(v) => onUpdate({ ...action, value: v })}
            context="action"
          />
        </div>
      )}

      {canRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-zinc-400 hover:text-zinc-900"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// BuilderForm – inline expandable card for creating / editing a rule
// ---------------------------------------------------------------------------

function BuilderForm({
  initial,
  editingId,
  projectId,
  onDone,
  onCancel,
  showToast,
}: {
  initial: DraftState
  editingId: string | null
  projectId: string
  onDone: () => void
  onCancel: () => void
  showToast: (msg: string) => void
}) {
  const [draft, setDraft] = useState<DraftState>(initial)
  const [saving, setSaving] = useState(false)

  const updateTrigger = useCallback(
    (patch: Partial<AutomationTrigger>) =>
      setDraft((d) => ({ ...d, trigger: { ...d.trigger, ...patch } })),
    [],
  )

  const updateCondition = useCallback(
    (patch: Partial<AutomationCondition>) =>
      setDraft((d) => ({
        ...d,
        condition: { ...(d.condition ?? { type: "" }), ...patch },
      })),
    [],
  )

  const updateAction = useCallback(
    (id: string, updated: DraftAction) =>
      setDraft((d) => ({
        ...d,
        actions: d.actions.map((a) => (a.id === id ? updated : a)),
      })),
    [],
  )

  const removeAction = useCallback(
    (id: string) =>
      setDraft((d) => ({
        ...d,
        actions: d.actions.filter((a) => a.id !== id),
      })),
    [],
  )

  const addAction = useCallback(
    () =>
      setDraft((d) => ({
        ...d,
        actions: [
          ...d.actions,
          { id: crypto.randomUUID(), type: "", value: undefined },
        ],
      })),
    [],
  )

  const toggleCondition = useCallback(() => {
    setDraft((d) => ({
      ...d,
      hasCondition: !d.hasCondition,
      condition: d.hasCondition ? undefined : { type: "" },
    }))
  }, [])

  const canSave =
    draft.name.trim() !== "" &&
    draft.trigger.type !== "" &&
    draft.actions.length > 0 &&
    draft.actions.every((a) => a.type !== "") &&
    (!draft.hasCondition || (draft.condition?.type ?? "") !== "")

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)

    const primaryAction = draft.actions[0]
    const body: Record<string, unknown> = {
      name: draft.name,
      projectId,
      trigger: draft.trigger,
      action: { type: primaryAction.type, value: primaryAction.value },
    }
    if (draft.hasCondition && draft.condition) {
      body.condition = draft.condition
    }

    try {
      if (editingId) {
        await fetch("/api/automations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...body }),
        })
      } else {
        await fetch("/api/automations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }
      onDone()
    } catch {
      showToast("Failed to save automation")
    } finally {
      setSaving(false)
    }
  }

  const handleTestRule = () => {
    showToast("Rule test passed")
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="border-zinc-300 p-5 space-y-5">
        {/* Name */}
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-500">Rule name</Label>
          <Input
            className="h-9"
            placeholder="e.g. Move completed tasks to Done"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>

        {/* Visual flow header */}
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
          <span className="rounded bg-zinc-100 px-2 py-1">WHEN</span>
          <ArrowRight className="h-3 w-3 text-zinc-400" />
          {draft.hasCondition && (
            <>
              <span className="rounded bg-zinc-100 px-2 py-1">IF</span>
              <ArrowRight className="h-3 w-3 text-zinc-400" />
            </>
          )}
          <span className="rounded bg-zinc-100 px-2 py-1">THEN</span>
        </div>

        {/* Trigger */}
        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs text-zinc-500">WHEN</Label>
              <Select
                value={draft.trigger.type}
                onValueChange={(v) => updateTrigger({ type: v, value: undefined })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select trigger" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRIGGERS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {draft.trigger.type && TRIGGERS_NEEDING_VALUE.has(draft.trigger.type) && (
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs text-zinc-500">Value</Label>
                <ValueInput
                  parentType={draft.trigger.type}
                  value={draft.trigger.value ?? ""}
                  onChange={(v) => updateTrigger({ value: v })}
                  context="trigger"
                />
              </div>
            )}
          </div>
        </div>

        {/* Condition (optional) */}
        <AnimatePresence>
          {draft.hasCondition && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs text-zinc-500">IF (condition)</Label>
                  <Select
                    value={draft.condition?.type ?? ""}
                    onValueChange={(v) => updateCondition({ type: v, value: undefined })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select condition" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CONDITIONS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {draft.condition?.type && (
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs text-zinc-500">Value</Label>
                    <ValueInput
                      parentType={draft.condition.type}
                      value={draft.condition.value ?? ""}
                      onChange={(v) => updateCondition({ value: v })}
                      context="condition"
                    />
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-zinc-400 hover:text-zinc-900"
                  onClick={toggleCondition}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!draft.hasCondition && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-zinc-500 hover:text-zinc-900"
            onClick={toggleCondition}
          >
            <Filter className="h-3.5 w-3.5" />
            + Add Condition
          </Button>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {draft.actions.map((action, idx) => (
              <ActionRow
                key={action.id}
                action={action}
                index={idx}
                canRemove={draft.actions.length > 1}
                onUpdate={(u) => updateAction(action.id, u)}
                onRemove={() => removeAction(action.id)}
              />
            ))}
          </AnimatePresence>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-zinc-500 hover:text-zinc-900"
            onClick={addAction}
          >
            <Plus className="h-3.5 w-3.5" />
            + Add Action
          </Button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 pt-4">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleTestRule}
            disabled={!canSave}
          >
            <Play className="h-3.5 w-3.5" />
            Test Rule
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleSave}
              disabled={!canSave || saving}
            >
              {saving ? "Saving..." : editingId ? "Update Rule" : "Create Rule"}
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// RuleCard – displays a single automation rule in the list
// ---------------------------------------------------------------------------

function RuleCard({
  automation,
  onToggle,
  onEdit,
  onDelete,
}: {
  automation: Automation
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className={cn(
          "group border transition-all duration-200 hover:border-zinc-400",
          !automation.enabled && "opacity-60",
        )}
      >
        <div className="flex items-center gap-4 p-4">
          {/* Toggle */}
          <Switch
            checked={automation.enabled}
            onCheckedChange={onToggle}
            className="shrink-0"
          />

          {/* Content */}
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-medium text-zinc-900">
              {automation.name}
            </h4>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              {/* Trigger badge */}
              <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-zinc-700">
                <Zap className="h-3 w-3" />
                {triggerLabel(automation.trigger.type)}
                {automation.trigger.value && (
                  <span className="text-zinc-500">: {automation.trigger.value}</span>
                )}
              </span>

              <ArrowRight className="h-3 w-3 text-zinc-400" />

              {/* Condition badge (if present) */}
              {automation.condition?.type && (
                <>
                  <span className="inline-flex items-center gap-1 rounded bg-zinc-50 px-2 py-0.5 text-zinc-600 ring-1 ring-inset ring-zinc-200">
                    <Filter className="h-3 w-3" />
                    {conditionLabel(automation.condition.type)}
                    {automation.condition.value && (
                      <span className="text-zinc-500">
                        : {automation.condition.value}
                      </span>
                    )}
                  </span>
                  <ArrowRight className="h-3 w-3 text-zinc-400" />
                </>
              )}

              {/* Action badge */}
              <span className="inline-flex items-center gap-1 rounded bg-zinc-900 px-2 py-0.5 text-zinc-100">
                {actionLabel(automation.action.type)}
                {automation.action.value && (
                  <span className="text-zinc-400">: {automation.action.value}</span>
                )}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-400 hover:text-zinc-900"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-400 hover:text-red-600"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// AutomationBuilder (main export)
// ---------------------------------------------------------------------------

export function AutomationBuilder({
  projectId,
  automations,
  onUpdate,
}: AutomationBuilderProps) {
  const [showBuilder, setShowBuilder] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => setToastMessage(msg), [])

  // Toggle automation enabled/disabled
  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetch("/api/automations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      })
      onUpdate()
    } catch {
      showToast("Failed to update automation")
    }
  }

  // Delete automation
  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/automations?id=${id}`, { method: "DELETE" })
      onUpdate()
    } catch {
      showToast("Failed to delete automation")
    }
  }

  // Open builder for editing
  const handleEdit = (automation: Automation) => {
    setEditingId(automation.id)
    setShowBuilder(true)
  }

  // Close builder
  const handleBuilderDone = () => {
    setShowBuilder(false)
    setEditingId(null)
    onUpdate()
  }

  const handleBuilderCancel = () => {
    setShowBuilder(false)
    setEditingId(null)
  }

  const editingAutomation = editingId
    ? automations.find((a) => a.id === editingId) ?? null
    : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900">Automations</h3>
          <p className="text-sm text-zinc-500">
            Automate repetitive tasks with rules
          </p>
        </div>

        {!showBuilder && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditingId(null)
              setShowBuilder(true)
            }}
          >
            <Plus className="h-4 w-4" />
            New Automation
          </Button>
        )}
      </div>

      {/* Inline builder panel */}
      <AnimatePresence>
        {showBuilder && (
          <BuilderForm
            key={editingId ?? "new"}
            initial={
              editingAutomation
                ? draftFromAutomation(editingAutomation)
                : emptyDraft()
            }
            editingId={editingId}
            projectId={projectId}
            onDone={handleBuilderDone}
            onCancel={handleBuilderCancel}
            showToast={showToast}
          />
        )}
      </AnimatePresence>

      {/* Automation list */}
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {automations.map((automation) => (
            <RuleCard
              key={automation.id}
              automation={automation}
              onToggle={(enabled) => handleToggle(automation.id, enabled)}
              onEdit={() => handleEdit(automation)}
              onDelete={() => handleDelete(automation.id)}
            />
          ))}
        </AnimatePresence>

        {automations.length === 0 && !showBuilder && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 py-12 text-center">
            <Zap className="h-8 w-8 text-zinc-300" />
            <p className="mt-3 text-sm font-medium text-zinc-500">
              No automations yet
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Create your first automation to get started
            </p>
            <Button
              size="sm"
              className="mt-4 gap-1.5"
              onClick={() => setShowBuilder(true)}
            >
              <Plus className="h-4 w-4" />
              New Automation
            </Button>
          </div>
        )}
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toastMessage && (
          <Toast
            message={toastMessage}
            onClose={() => setToastMessage(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
