"use client"

import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  GripVertical,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  Save,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Type,
  Hash,
  Calendar,
  ChevronDown,
  Paperclip,
  Mail,
  CheckSquare,
  AlignLeft,
  GitBranch,
  X,
  ClipboardList,
  ImagePlus,
  Activity,
  UserPlus,
  Copy,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CustomFieldOptionConfig, SupportedCustomFieldType } from "@/lib/custom-fields"

export interface FormFieldCondition {
  fieldId: string
  operator: "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty"
  value: string
}

export type FormFieldMappingTarget =
  | "none"
  | "task_title"
  | "task_description"
  | "task_due_date"
  | "task_status"
  | "task_priority"
  | "task_list"
  | "custom_field"

export interface FormFieldMapping {
  target: FormFieldMappingTarget
  customFieldId?: string
}

export type FormRoutingAction = "set_task_list" | "assign_user"

export interface FormRoutingRule {
  id: string
  operator: FormFieldCondition["operator"]
  value: string
  action: FormRoutingAction
  targetTaskListId?: string
  targetUserId?: string
  targetUserIds?: string[]
}

export interface FormField {
  id: string
  name: string
  type:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "dropdown"
    | "multi_select"
    | "file"
    | "email"
    | "checkbox"
  required: boolean
  options?: string[]
  attachmentEnabled?: boolean
  branchEnabled?: boolean
  showIf?: FormFieldCondition
  routingRules?: FormRoutingRule[]
  mapping?: FormFieldMapping
}

interface FormBuilderProps {
  projectId: string
  form?: {
    id: string
    name: string
    description: string | null
    fields: FormField[]
    isPublic: boolean
  }
  onSave?: () => void
}

interface ProjectCustomField {
  id: string
  name: string
  type: SupportedCustomFieldType
  options?: CustomFieldOptionConfig | null
}

interface TaskListOption {
  id: string
  name: string
}

interface ProjectMemberOption {
  userId: string
  name: string
  email: string
}

const CONDITION_OPERATORS: {
  value: FormFieldCondition["operator"]
  label: string
}[] = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "contains", label: "Contains" },
  { value: "is_empty", label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
]

const FIELD_TYPES: {
  value: FormField["type"]
  label: string
  icon: React.ElementType
}[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "textarea", label: "Textarea", icon: AlignLeft },
  { value: "number", label: "Number", icon: Hash },
  { value: "date", label: "Date", icon: Calendar },
  { value: "dropdown", label: "Dropdown", icon: ChevronDown },
  { value: "multi_select", label: "Multi-select", icon: CheckSquare },
  { value: "file", label: "File", icon: Paperclip },
  { value: "email", label: "Email", icon: Mail },
  { value: "checkbox", label: "Checkbox", icon: CheckSquare },
]

const ROUTING_ACTIONS: { value: FormRoutingAction; label: string }[] = [
  { value: "set_task_list", label: "Move to section" },
  { value: "assign_user", label: "Assign to member" },
]

function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let result = ""
  for (let i = 0; i < 21; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function createEmptyField(): FormField {
  return {
    id: generateId(),
    name: "",
    type: "text",
    required: false,
  }
}

function createRoutingRule(): FormRoutingRule {
  return {
    id: generateId(),
    operator: "equals",
    value: "",
    action: "set_task_list",
  }
}

function getRuleTargetUserIds(rule: FormRoutingRule) {
  return Array.from(new Set([...(rule.targetUserIds ?? []), ...(rule.targetUserId ? [rule.targetUserId] : [])]))
}

function isChoiceField(type: FormField["type"]) {
  return type === "dropdown" || type === "multi_select"
}

function createTaskTitleField(): FormField {
  return {
    id: generateId(),
    name: "Task title",
    type: "text",
    required: true,
    mapping: { target: "task_title" },
  }
}

function createTaskSectionField(taskLists: TaskListOption[]): FormField {
  return {
    id: generateId(),
    name: "Section / Division",
    type: "dropdown",
    required: true,
    options: taskLists.map((taskList) => taskList.name),
    mapping: { target: "task_list" },
  }
}

function createFileUploadField(): FormField {
  return {
    id: generateId(),
    name: "Document / Photo",
    type: "file",
    required: false,
    mapping: { target: "none" },
  }
}

function createCoreIntelligenceField(): FormField {
  return {
    id: generateId(),
    name: "Core Intelligence",
    type: "textarea",
    required: false,
    mapping: { target: "task_description" },
  }
}

function getOptionsFromConfig(options?: CustomFieldOptionConfig | null) {
  return Array.isArray(options?.options) ? options.options : []
}

function mapCustomFieldTypeToFormField(field: ProjectCustomField): FormField {
  const options = getOptionsFromConfig(field.options)
  const type: FormField["type"] =
    field.type === "NUMBER"
      ? "number"
      : field.type === "DATE" || field.type === "CREATED"
        ? "date"
        : field.type === "SELECT" || field.type === "STATUS"
          ? "dropdown"
          : field.type === "MULTI_SELECT"
            ? "multi_select"
          : field.type === "PLACE"
            ? "textarea"
            : "text"

  return {
    id: generateId(),
    name: field.name,
    type,
    required: false,
    ...(options.length > 0 ? { options } : {}),
    mapping: { target: "custom_field", customFieldId: field.id },
  }
}

function getConditionSummary(field: FormField, fields: FormField[]) {
  if (!field.showIf) return null
  const source = fields.find((item) => item.id === field.showIf?.fieldId)
  const operator = CONDITION_OPERATORS.find((item) => item.value === field.showIf?.operator)?.label.toLowerCase()
  const value = field.showIf.operator === "is_empty" || field.showIf.operator === "is_not_empty"
    ? ""
    : ` "${field.showIf.value || "..."}"`
  return `${source?.name || "Parent question"} ${operator || field.showIf.operator}${value}`
}

export function FormBuilder({ projectId, form, onSave }: FormBuilderProps) {
  const [name, setName] = useState(form?.name ?? "")
  const [description, setDescription] = useState(form?.description ?? "")
  const [isPublic, setIsPublic] = useState(form?.isPublic ?? true)
  const [fields, setFields] = useState<FormField[]>(
    form?.fields ?? [createTaskTitleField()]
  )
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customFields, setCustomFields] = useState<ProjectCustomField[]>([])
  const [taskLists, setTaskLists] = useState<TaskListOption[]>([])
  const [projectMembers, setProjectMembers] = useState<ProjectMemberOption[]>([])

  // Drag state
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const branchDepthByFieldId = useMemo(() => {
    const byId = new Map(fields.map((field) => [field.id, field]))
    const depths = new Map<string, number>()

    const getDepth = (field: FormField, trail = new Set<string>()): number => {
      if (!field.showIf?.fieldId || trail.has(field.id)) return 0
      const parent = byId.get(field.showIf.fieldId)
      if (!parent) return 1
      trail.add(field.id)
      return 1 + getDepth(parent, trail)
    }

    for (const field of fields) {
      depths.set(field.id, getDepth(field))
    }

    return depths
  }, [fields])

  useEffect(() => {
    let cancelled = false

    async function loadProjectContext() {
      try {
        const [customFieldsRes, projectRes] = await Promise.all([
          fetch(`/api/custom-fields?projectId=${projectId}`, { cache: "no-store" }),
          fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
        ])

        if (customFieldsRes.ok) {
          const data = await customFieldsRes.json()
          if (!cancelled) setCustomFields(Array.isArray(data.fields) ? data.fields : [])
        }

        if (projectRes.ok) {
          const project = await projectRes.json()
          const lists = Array.isArray(project.taskLists)
            ? project.taskLists.map((taskList: { id: string; name: string }) => ({
                id: taskList.id,
                name: taskList.name,
              }))
            : []
          const members = Array.isArray(project.members)
            ? project.members
                .map((member: { userId?: string; user?: { id?: string; name?: string | null; email?: string | null } }) => {
                  const userId = member.user?.id ?? member.userId
                  const email = member.user?.email ?? ""
                  if (!userId) return null
                  return {
                    userId,
                    name: member.user?.name || email || "Unnamed member",
                    email,
                  }
                })
                .filter((member: ProjectMemberOption | null): member is ProjectMemberOption => Boolean(member))
            : []
          if (!cancelled) {
            setTaskLists(lists)
            setProjectMembers(members)
          }
        }
      } catch {
        if (!cancelled) {
          setCustomFields([])
          setTaskLists([])
          setProjectMembers([])
        }
      }
    }

    loadProjectContext()

    return () => {
      cancelled = true
    }
  }, [projectId])

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      dragIndexRef.current = index
      e.dataTransfer.effectAllowed = "move"
      // Make the drag image semi-transparent
      if (e.currentTarget) {
        e.dataTransfer.setDragImage(e.currentTarget, 0, 0)
      }
    },
    []
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      setDragOverIndex(index)
    },
    []
  )

  const handleDragEnd = useCallback(() => {
    const from = dragIndexRef.current
    const to = dragOverIndex

    if (from !== null && to !== null && from !== to) {
      setFields((prev) => {
        const updated = [...prev]
        const [moved] = updated.splice(from, 1)
        updated.splice(to, 0, moved)
        return updated
      })
    }

    dragIndexRef.current = null
    setDragOverIndex(null)
  }, [dragOverIndex])

  const addField = useCallback(() => {
    setFields((prev) => [...prev, createEmptyField()])
  }, [])

  const addCustomField = useCallback((customField: ProjectCustomField) => {
    setFields((prev) => [...prev, mapCustomFieldTypeToFormField(customField)])
  }, [])

  const addTaskSectionField = useCallback(() => {
    setFields((prev) => [...prev, createTaskSectionField(taskLists)])
  }, [taskLists])

  const addFileUploadField = useCallback(() => {
    setFields((prev) => [...prev, createFileUploadField()])
  }, [])

  const addCoreIntelligenceField = useCallback(() => {
    setFields((prev) => [...prev, createCoreIntelligenceField()])
  }, [])

  const duplicateField = useCallback((fieldId: string) => {
    setFields((prev) => {
      const index = prev.findIndex((field) => field.id === fieldId)
      if (index === -1) return prev
      const source = prev[index]
      const duplicate: FormField = {
        ...source,
        id: generateId(),
        name: source.name ? `${source.name} copy` : "",
        options: source.options ? [...source.options] : undefined,
        routingRules: source.routingRules?.map((rule) => ({ ...rule, id: generateId() })),
      }
      const next = [...prev]
      next.splice(index + 1, 0, duplicate)
      return next
    })
  }, [])

  const addBranchField = useCallback((parentFieldId: string, optionValue: string) => {
    const normalizedOption = optionValue.trim()
    if (!normalizedOption) return

    setFields((prev) => {
      const parentIndex = prev.findIndex((field) => field.id === parentFieldId)
      if (parentIndex === -1) return prev

      const parentField = prev[parentIndex]
      const branchField: FormField = {
        id: generateId(),
        name: "",
        type: "text",
        required: false,
        showIf: {
          fieldId: parentFieldId,
          operator: parentField.type === "multi_select" ? "contains" : "equals",
          value: normalizedOption,
        },
        mapping: { target: "none" },
      }

      const next = [...prev]
      next.splice(parentIndex + 1, 0, branchField)
      return next
    })
  }, [])

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const updateField = useCallback(
    (id: string, updates: Partial<FormField>) => {
      setFields((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
      )
    },
    []
  )

  const addDropdownOption = useCallback((fieldId: string) => {
    setFields((prev) =>
      prev.map((field) =>
        field.id === fieldId
          ? { ...field, options: [...(field.options ?? []), ""] }
          : field
      )
    )
  }, [])

  const updateDropdownOption = useCallback(
    (fieldId: string, optionIndex: number, value: string) => {
      setFields((prev) =>
        prev.map((field) => {
          if (field.id !== fieldId) return field
          const options = [...(field.options ?? [])]
          options[optionIndex] = value
          return { ...field, options }
        })
      )
    },
    []
  )

  const removeDropdownOption = useCallback(
    (fieldId: string, optionIndex: number) => {
      setFields((prev) =>
        prev.map((field) =>
          field.id === fieldId
            ? {
                ...field,
                options: (field.options ?? []).filter((_, index) => index !== optionIndex),
              }
            : field
        )
      )
    },
    []
  )

  const addRoutingRule = useCallback((fieldId: string) => {
    setFields((prev) =>
      prev.map((field) =>
        field.id === fieldId
          ? { ...field, routingRules: [...(field.routingRules ?? []), createRoutingRule()] }
          : field
      )
    )
  }, [])

  const updateRoutingRule = useCallback(
    (fieldId: string, ruleId: string, updates: Partial<FormRoutingRule>) => {
      setFields((prev) =>
        prev.map((field) => {
          if (field.id !== fieldId) return field
          return {
            ...field,
            routingRules: (field.routingRules ?? []).map((rule) =>
              rule.id === ruleId ? { ...rule, ...updates } : rule
            ),
          }
        })
      )
    },
    []
  )

  const removeRoutingRule = useCallback((fieldId: string, ruleId: string) => {
    setFields((prev) =>
      prev.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              routingRules: (field.routingRules ?? []).filter((rule) => rule.id !== ruleId),
            }
          : field
      )
    )
  }, [])

  const handleSave = async () => {
    setError(null)

    if (!name.trim()) {
      setError("Form name is required.")
      return
    }

    if (fields.length === 0) {
      setError("Add at least one field.")
      return
    }

    if (!fields.some((field) => field.mapping?.target === "task_title")) {
      setError("Map one field to Task title so each submission can create a clear task.")
      return
    }

    const emptyField = fields.find((f) => !f.name.trim())
    if (emptyField) {
      setError("All fields must have a name.")
      return
    }

    const invalidRoutingRule = fields
      .flatMap((field) => (field.routingRules ?? []).map((rule) => ({ field, rule })))
      .find(({ rule }) => {
        const needsValue = rule.operator !== "is_empty" && rule.operator !== "is_not_empty"
        const missingValue = needsValue && !rule.value.trim()
        const missingTarget =
          rule.action === "set_task_list" ? !rule.targetTaskListId : getRuleTargetUserIds(rule).length === 0
        return missingValue || missingTarget
      })

    if (invalidRoutingRule) {
      setError(`Complete the automation routing rule for "${invalidRoutingRule.field.name}".`)
      return
    }

    setSaving(true)

    try {
      const normalizedFields = fields.map((field) =>
        isChoiceField(field.type)
          ? {
                          ...field,
                          options: (field.options ?? [])
                            .map((option) => option.trim())
                            .filter(Boolean),
                          routingRules: (field.routingRules ?? []).map((rule) =>
                            rule.action === "assign_user"
                              ? { ...rule, targetUserIds: getRuleTargetUserIds(rule), targetUserId: undefined }
                              : rule
                          ),
                        }
          : {
              ...field,
              routingRules: (field.routingRules ?? []).map((rule) =>
                rule.action === "assign_user"
                  ? { ...rule, targetUserIds: getRuleTargetUserIds(rule), targetUserId: undefined }
                  : rule
              ),
            }
      )

      const payload = {
        projectId,
        name: name.trim(),
        description: description.trim() || null,
        fields: normalizedFields,
        isPublic,
      }

      const isEdit = !!form?.id
      const url = isEdit ? `/api/forms/${form.id}` : "/api/forms"
      const method = isEdit ? "PATCH" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? "Failed to save form.")
      }

      onSave?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setSaving(false)
    }
  }

  // ---------- Preview mode ----------
  if (preview) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">
            {name || "Untitled Form"}
          </h2>
          <button
            type="button"
            onClick={() => setPreview(false)}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
          >
            <EyeOff className="h-4 w-4" />
            Exit Preview
          </button>
        </div>

        {description && (
          <p className="text-sm text-zinc-500">{description}</p>
        )}

        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <label className="block text-sm font-medium text-zinc-700">
                {field.name || "Unnamed field"}
                {field.required && (
                  <span className="ml-1 text-zinc-400">*</span>
                )}
              </label>

              {field.type === "text" && (
                <input
                  type="text"
                  disabled
                  placeholder="Short text answer"
                  className="block w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400 placeholder:text-zinc-300"
                />
              )}
              {field.type === "textarea" && (
                <textarea
                  disabled
                  rows={3}
                  placeholder="Long text answer"
                  className="block w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400 placeholder:text-zinc-300"
                />
              )}
              {field.type === "number" && (
                <input
                  type="number"
                  disabled
                  placeholder="0"
                  className="block w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400 placeholder:text-zinc-300"
                />
              )}
              {field.type === "date" && (
                <input
                  type="date"
                  disabled
                  className="block w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400"
                />
              )}
              {field.type === "email" && (
                <input
                  type="email"
                  disabled
                  placeholder="email@example.com"
                  className="block w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400 placeholder:text-zinc-300"
                />
              )}
              {field.type === "dropdown" && (
                <select
                  disabled
                  className="block w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400"
                >
                  <option>Select an option</option>
                  {field.options?.filter(Boolean).map((opt, optionIndex) => (
                    <option key={`${opt}-${optionIndex}`}>{opt}</option>
                  ))}
                </select>
              )}
              {field.type === "multi_select" && (
                <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                  {(field.options?.filter(Boolean) ?? ["Option 1"]).map((opt, optionIndex) => (
                    <label key={`${opt}-${optionIndex}`} className="flex items-center gap-2 text-sm text-zinc-400">
                      <input type="checkbox" disabled className="h-4 w-4 rounded border-zinc-300" />
                      {opt}
                    </label>
                  ))}
                </div>
              )}
              {field.type === "file" && (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm text-zinc-400">
                  <Paperclip className="h-4 w-4" />
                  Choose file
                </div>
              )}
              {field.attachmentEnabled && field.type !== "file" && (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm text-zinc-400">
                  <Paperclip className="h-4 w-4" />
                  Optional attachment
                </div>
              )}
              {field.type === "checkbox" && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span className="text-sm text-zinc-400">
                    {field.name || "Checkbox"}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ---------- Builder mode ----------
  return (
    <div className="space-y-6">
      {/* Form metadata */}
      <div className="space-y-4">
        <div>
          <label
            htmlFor="form-name"
            className="block text-sm font-medium text-zinc-700"
          >
            Form Name
          </label>
          <input
            id="form-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled Form"
            className="mt-1 block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          />
        </div>

        <div>
          <label
            htmlFor="form-description"
            className="block text-sm font-medium text-zinc-700"
          >
            Description
          </label>
          <textarea
            id="form-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional description"
            className="mt-1 block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={isPublic}
            onClick={() => setIsPublic((v) => !v)}
            className="focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 rounded-full"
          >
            {isPublic ? (
              <ToggleRight className="h-6 w-6 text-zinc-900" />
            ) : (
              <ToggleLeft className="h-6 w-6 text-zinc-400" />
            )}
          </button>
          <div>
            <span className="text-sm text-zinc-700">Public form</span>
            <p className="text-xs text-zinc-500">
              Public forms can be opened from one URL without signing in to Nexus.
            </p>
          </div>
        </div>

      </div>

      {/* Divider */}
      <div className="border-t border-zinc-200" />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">Fields</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addField}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
            >
              <Plus className="h-4 w-4" />
              Blank field
            </button>
          <button
            type="button"
            onClick={addFileUploadField}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
          >
            <ImagePlus className="h-4 w-4" />
            Document / photo
          </button>
          <button
            type="button"
            onClick={addCoreIntelligenceField}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
          >
            <Activity className="h-4 w-4" />
            Core Intelligence
          </button>
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
          >
            <Eye className="h-4 w-4" />
            Preview
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          <ClipboardList className="h-3.5 w-3.5" />
          Add project fields and task routing
        </div>
        {customFields.length > 0 || taskLists.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {taskLists.length > 0 && (
              <button
                type="button"
                onClick={addTaskSectionField}
                className="rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-800"
              >
                + Section / Division picker
              </button>
            )}
            {customFields.map((customField) => (
              <button
                key={customField.id}
                type="button"
                onClick={() => addCustomField(customField)}
                className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-900 hover:text-zinc-950"
              >
                + {customField.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            No custom fields or sections yet. Add project sections/custom fields first, then this form can write into them.
          </p>
        )}
      </div>

      {/* Fields list */}
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {fields.map((field, index) => {
            const isExpanded = expandedFieldId === field.id
            const branchDepth = branchDepthByFieldId.get(field.id) ?? 0
            const conditionSummary = getConditionSummary(field, fields)
            const FieldTypeIcon =
              FIELD_TYPES.find((ft) => ft.value === field.type)?.icon ?? Type

            return (
              <motion.div
                key={field.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex gap-2">
                  {branchDepth > 0 && (
                    <div
                      className="flex shrink-0 justify-end gap-1 pt-3"
                      style={{ width: branchDepth * 14 }}
                      aria-hidden="true"
                    >
                      {Array.from({ length: branchDepth }).map((_, lineIndex) => (
                        <div
                          key={`${field.id}-branch-line-${lineIndex}`}
                          className={cn(
                            "min-h-full w-px rounded-full",
                            lineIndex === branchDepth - 1 ? "bg-zinc-900/35" : "bg-zinc-200"
                          )}
                        />
                      ))}
                    </div>
                  )}
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white shadow-sm",
                      branchDepth > 0 && "border-l-zinc-900/30 bg-zinc-50/40",
                      dragOverIndex === index && "border-zinc-900"
                    )}
                  >
                  {conditionSummary && (
                    <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 text-[11px] font-medium text-zinc-500">
                      <GitBranch className="h-3 w-3 text-zinc-400" />
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 uppercase tracking-[0.12em] text-zinc-500">
                        Branch level {branchDepth}
                      </span>
                      <span className="truncate">Shown if {conditionSummary}</span>
                    </div>
                  )}
                  {/* Field row */}
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    {/* Drag handle */}
                    <div className="cursor-grab text-zinc-400 hover:text-zinc-600 active:cursor-grabbing">
                      <GripVertical className="h-4 w-4" />
                    </div>

                    {/* Field name input */}
                    <input
                      type="text"
                      value={field.name}
                      onChange={(e) =>
                        updateField(field.id, { name: e.target.value })
                      }
                      placeholder="Field name"
                      className="min-w-0 flex-1 basis-[calc(100%_-_2.5rem)] rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:basis-auto sm:py-1.5"
                    />

                    {/* Type selector */}
                    <div className="relative w-full sm:w-auto">
                      <FieldTypeIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                      <select
                        value={field.type}
                        onChange={(e) => {
                          const newType = e.target.value as FormField["type"]
                          const updates: Partial<FormField> = { type: newType }
                          if (isChoiceField(newType) && !field.options) {
                            updates.options = []
                          }
                          if (!isChoiceField(newType)) {
                            updates.options = undefined
                            updates.branchEnabled = undefined
                          }
                          updateField(field.id, updates)
                          if (isChoiceField(newType)) {
                            setExpandedFieldId(field.id)
                          }
                        }}
                        className="h-10 w-full appearance-none rounded-md border border-zinc-200 bg-white py-1 pl-7 pr-7 text-sm text-zinc-700 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:h-8 sm:w-auto"
                      >
                        {FIELD_TYPES.map((ft) => (
                          <option key={ft.value} value={ft.value}>
                            {ft.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    </div>

                    {/* Required toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={field.required}
                      aria-label="Required"
                      onClick={() =>
                        updateField(field.id, { required: !field.required })
                      }
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
                        field.required ? "bg-zinc-900" : "bg-zinc-200"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
                          field.required ? "translate-x-4" : "translate-x-0"
                        )}
                      />
                    </button>
                    <span className="hidden text-xs text-zinc-500 sm:inline">
                      Required
                    </span>

                    {field.type !== "file" && (
                      <button
                        type="button"
                        onClick={() =>
                          updateField(field.id, {
                            attachmentEnabled: !field.attachmentEnabled,
                          })
                        }
                        className={cn(
                          "inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 sm:h-8 sm:w-auto",
                          field.attachmentEnabled
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900"
                        )}
                        title="Allow attachment upload for this answer"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        Attachment
                      </button>
                    )}

                    <select
                      value={
                        field.mapping?.target === "custom_field"
                          ? `custom_field:${field.mapping.customFieldId ?? ""}`
                          : field.mapping?.target ?? "none"
                      }
                      onChange={(e) => {
                        const value = e.target.value
                        if (value.startsWith("custom_field:")) {
                          const customFieldId = value.replace("custom_field:", "")
                          const customField = customFields.find((item) => item.id === customFieldId)
                          updateField(field.id, {
                            ...(customField ? mapCustomFieldTypeToFormField(customField) : {}),
                            id: field.id,
                            attachmentEnabled: field.attachmentEnabled,
                            branchEnabled: field.branchEnabled,
                            mapping: { target: "custom_field", customFieldId },
                          })
                          return
                        }

                        const mappedTarget = value as FormFieldMappingTarget
                        updateField(field.id, {
                          mapping: { target: mappedTarget },
                          ...(mappedTarget === "task_description" ? { type: "textarea" as const } : {}),
                          ...(mappedTarget === "task_due_date" ? { type: "date" as const } : {}),
                          ...(mappedTarget === "task_status"
                            ? { type: "dropdown" as const, options: ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] }
                            : {}),
                          ...(mappedTarget === "task_priority"
                            ? { type: "dropdown" as const, options: ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] }
                            : {}),
                          ...(mappedTarget === "task_list"
                            ? { type: "dropdown" as const, options: taskLists.map((taskList) => taskList.name) }
                            : {}),
                        })
                      }}
                      className="h-10 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:h-8 sm:max-w-[220px]"
                      aria-label="Task mapping"
                    >
                      <option value="none">No mapping</option>
                      <option value="task_title">Task title</option>
                      <option value="task_description">Core Intelligence</option>
                      <option value="task_due_date">Due date</option>
                      <option value="task_status">Task status</option>
                      <option value="task_priority">Priority</option>
                      <option value="task_list">Task section</option>
                      {customFields.length > 0 && (
                        <optgroup label="Custom fields">
                          {customFields.map((customField) => (
                            <option key={customField.id} value={`custom_field:${customField.id}`}>
                              {customField.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    {/* Expand options (choice fields only) */}
                    {isChoiceField(field.type) && field.mapping?.target !== "task_list" && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedFieldId(isExpanded ? null : field.id)
                        }
                        className="touch-target rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-900 sm:min-h-0 sm:min-w-0"
                        aria-label="Edit options"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            isExpanded && "rotate-180"
                          )}
                        />
                      </button>
                    )}

                    {/* Duplicate */}
                    <button
                      type="button"
                      onClick={() => duplicateField(field.id)}
                      className="touch-target rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 sm:min-h-0 sm:min-w-0"
                      aria-label="Duplicate field"
                    >
                      <Copy className="h-4 w-4" />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      className="touch-target rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-zinc-900 sm:min-h-0 sm:min-w-0"
                      aria-label="Delete field"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {field.mapping?.target === "task_description" && (
                    <div className="border-t border-zinc-100 px-3 py-2.5">
                      <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                        <Activity className="h-3 w-3" />
                        Core Intelligence
                      </label>
                      <p className="text-xs text-zinc-500">
                        The submitter's answer will fill the task Core Intelligence panel.
                      </p>
                    </div>
                  )}

                  {field.mapping?.target === "task_status" && (
                    <div className="border-t border-zinc-100 px-3 py-2.5">
                      <label className="mb-1 block text-xs font-medium text-zinc-500">
                        Task status options
                      </label>
                      <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                        TODO · IN_PROGRESS · IN_REVIEW · DONE · CANCELLED
                      </div>
                    </div>
                  )}

                  {field.mapping?.target === "task_priority" && (
                    <div className="border-t border-zinc-100 px-3 py-2.5">
                      <label className="mb-1 block text-xs font-medium text-zinc-500">
                        Priority options
                      </label>
                      <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                        URGENT · HIGH · MEDIUM · LOW · NONE
                      </div>
                    </div>
                  )}

                  {field.mapping?.target === "task_list" && taskLists.length > 0 && (
                    <div className="border-t border-zinc-100 px-3 py-2.5">
                      <label className="mb-1 block text-xs font-medium text-zinc-500">
                        Task section options
                      </label>
                      <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                        {taskLists.map((taskList) => taskList.name).join(" · ")}
                      </div>
                    </div>
                  )}

                  {/* Choice options editor */}
                  {isChoiceField(field.type) && isExpanded && (
                    <div className="border-t border-zinc-100 px-3 py-2.5">
                      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <label className="block text-xs font-medium text-zinc-500">
                            {field.type === "multi_select" ? "Multi-select options" : "Dropdown options"}
                          </label>
                          <p className="mt-0.5 text-[11px] text-zinc-400">
                            Optional: enable branch questions to add follow-up fields per answer.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!!field.branchEnabled}
                            onClick={() =>
                              updateField(field.id, { branchEnabled: !field.branchEnabled })
                            }
                            className={cn(
                              "inline-flex h-10 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 sm:h-auto",
                              field.branchEnabled
                                ? "border-zinc-900 bg-zinc-900 text-white"
                                : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900"
                            )}
                          >
                            <GitBranch className="h-3 w-3" />
                            Branch
                          </button>
                          <button
                            type="button"
                            onClick={() => addDropdownOption(field.id)}
                            className="inline-flex h-10 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 sm:h-auto"
                          >
                            <Plus className="h-3 w-3" />
                            Add option
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {(field.options ?? []).length > 0 ? (
                          (field.options ?? []).map((option, optionIndex) => (
                            <div key={`${field.id}-option-${optionIndex}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <input
                                type="text"
                                value={option}
                                onChange={(e) =>
                                  updateDropdownOption(field.id, optionIndex, e.target.value)
                                }
                                placeholder={`Option ${optionIndex + 1}`}
                                className="block min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:py-1.5"
                              />
                              {field.branchEnabled && (
                                <button
                                  type="button"
                                  onClick={() => addBranchField(field.id, option)}
                                  disabled={!option.trim()}
                                  className="inline-flex h-10 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 sm:h-8"
                                  title="Add a follow-up question shown only for this answer"
                                >
                                  <GitBranch className="h-3 w-3" />
                                  Add branch question
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => removeDropdownOption(field.id, optionIndex)}
                                className="touch-target self-end rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-zinc-900 sm:self-auto sm:min-h-0 sm:min-w-0"
                                aria-label={`Delete option ${optionIndex + 1}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))
                        ) : (
                          <button
                            type="button"
                            onClick={() => addDropdownOption(field.id)}
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-500 hover:border-zinc-400 hover:bg-white"
                          >
                            <Plus className="h-4 w-4" />
                            Add first option
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-zinc-100 px-3 py-2.5">
                    <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                          <GitBranch className="h-3 w-3" />
                          Automation routing
                        </span>
                        <p className="mt-0.5 text-[11px] text-zinc-400">
                          IF this answer matches, THEN route the created task.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addRoutingRule(field.id)}
                        className="inline-flex h-10 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 sm:h-auto"
                      >
                        <Plus className="h-3 w-3" />
                        Add rule
                      </button>
                    </div>

                    {field.routingRules && field.routingRules.length > 0 ? (
                      <div className="space-y-2">
                        {field.routingRules.map((rule) => (
                          <div
                            key={rule.id}
                            className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-2"
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                                IF / THEN
                              </span>
                              <button
                                type="button"
                                onClick={() => removeRoutingRule(field.id, rule.id)}
                                className="touch-target rounded p-0.5 text-zinc-400 hover:text-red-600 sm:min-h-0 sm:min-w-0"
                                aria-label="Delete automation rule"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="grid gap-2 lg:grid-cols-[auto_minmax(120px,1fr)_minmax(120px,1fr)]">
                              <div className="flex h-8 items-center text-xs font-semibold text-zinc-500">
                                IF answer
                              </div>
                              <select
                                value={rule.operator}
                                onChange={(e) =>
                                  updateRoutingRule(field.id, rule.id, {
                                    operator: e.target.value as FormFieldCondition["operator"],
                                  })
                                }
                                className="h-10 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:h-8"
                              >
                                {CONDITION_OPERATORS.map((op) => (
                                  <option key={op.value} value={op.value}>
                                    {op.label}
                                  </option>
                                ))}
                              </select>
                              {rule.operator !== "is_empty" && rule.operator !== "is_not_empty" ? (
                                <input
                                  type="text"
                                  value={rule.value}
                                  onChange={(e) =>
                                    updateRoutingRule(field.id, rule.id, { value: e.target.value })
                                  }
                                  placeholder="Value, e.g. Fotografer"
                                  className="h-10 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:h-8"
                                />
                              ) : (
                                <div className="h-10 rounded-md border border-zinc-100 bg-white px-2 py-2 text-xs text-zinc-400 sm:h-8">
                                  No value needed
                                </div>
                              )}
                            </div>
                            <div className="mt-2 grid gap-2 lg:grid-cols-[auto_minmax(150px,1fr)_minmax(150px,1fr)]">
                              <div className="flex h-8 items-center gap-1.5 text-xs font-semibold text-zinc-500">
                                <UserPlus className="h-3 w-3" />
                                THEN
                              </div>
                              <select
                                value={rule.action}
                                onChange={(e) =>
                                  updateRoutingRule(field.id, rule.id, {
                                    action: e.target.value as FormRoutingAction,
                                    targetTaskListId: undefined,
                                    targetUserId: undefined,
                                    targetUserIds: undefined,
                                  })
                                }
                                className="h-10 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:h-8"
                              >
                                {ROUTING_ACTIONS.map((action) => (
                                  <option key={action.value} value={action.value}>
                                    {action.label}
                                  </option>
                                ))}
                              </select>
                              {rule.action === "set_task_list" ? (
                                <select
                                  value={rule.targetTaskListId ?? ""}
                                  onChange={(e) =>
                                    updateRoutingRule(field.id, rule.id, {
                                      targetTaskListId: e.target.value || undefined,
                                    })
                                  }
                                  className="h-10 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:h-8"
                                >
                                  <option value="">Select section...</option>
                                  {taskLists.map((taskList) => (
                                    <option key={taskList.id} value={taskList.id}>
                                      {taskList.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="rounded-md border border-zinc-200 bg-white p-2">
                                  {projectMembers.length > 0 ? (
                                    <div className="mobile-scroll-area max-h-44 space-y-1 overflow-y-auto pr-1 sm:max-h-36">
                                      {projectMembers.map((member) => {
                                        const selectedIds = getRuleTargetUserIds(rule)
                                        const selected = selectedIds.includes(member.userId)

                                        return (
                                          <label
                                            key={member.userId}
                                            className={cn(
                                              "touch-target flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors sm:min-h-0",
                                              selected ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-50"
                                            )}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={selected}
                                              onChange={() => {
                                                const nextIds = selected
                                                  ? selectedIds.filter((id) => id !== member.userId)
                                                  : [...selectedIds, member.userId]
                                                updateRoutingRule(field.id, rule.id, {
                                                  targetUserIds: nextIds,
                                                  targetUserId: undefined,
                                                })
                                              }}
                                              className="h-3.5 w-3.5 rounded border-zinc-300"
                                            />
                                            <span className="min-w-0 flex-1 truncate">
                                              {member.name}
                                              {member.email ? ` · ${member.email}` : ""}
                                            </span>
                                          </label>
                                        )
                                      })}
                                    </div>
                                  ) : (
                                    <p className="px-2 py-1 text-xs text-zinc-400">
                                      No project members yet.
                                    </p>
                                  )}
                                  {getRuleTargetUserIds(rule).length > 0 && (
                                    <div className="mt-2 border-t border-zinc-100 pt-2 text-[11px] font-medium text-zinc-500">
                                      {getRuleTargetUserIds(rule).length} member{getRuleTargetUserIds(rule).length === 1 ? "" : "s"} selected
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400">
                        No routing rule yet. Add one to auto-move or auto-assign tasks from form answers.
                      </p>
                    )}
                  </div>

                  {/* Condition editor */}
                  {field.showIf ? (
                    <div className="border-t border-zinc-100 px-3 py-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                          <GitBranch className="h-3 w-3" />
                          Show if condition
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateField(field.id, { showIf: undefined })
                          }
                          className="rounded p-0.5 text-zinc-400 hover:text-zinc-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,auto)]">
                        <select
                          value={field.showIf.fieldId}
                          onChange={(e) =>
                            updateField(field.id, {
                              showIf: {
                                ...field.showIf!,
                                fieldId: e.target.value,
                              },
                            })
                          }
                          className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:h-7"
                        >
                          <option value="">Select field...</option>
                          {fields
                            .filter((f) => f.id !== field.id)
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name || "Unnamed"}
                              </option>
                            ))}
                        </select>
                        <select
                          value={field.showIf.operator}
                          onChange={(e) =>
                            updateField(field.id, {
                              showIf: {
                                ...field.showIf!,
                                operator: e.target
                                  .value as FormFieldCondition["operator"],
                              },
                            })
                          }
                          className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:h-7"
                        >
                          {CONDITION_OPERATORS.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>
                        {field.showIf.operator !== "is_empty" &&
                          field.showIf.operator !== "is_not_empty" && (
                            <input
                              type="text"
                              value={field.showIf.value}
                              onChange={(e) =>
                                updateField(field.id, {
                                  showIf: {
                                    ...field.showIf!,
                                    value: e.target.value,
                                  },
                                })
                              }
                              placeholder="Value"
                              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 sm:h-7 sm:w-32"
                            />
                          )}
                      </div>
                    </div>
                  ) : (
                    <div className="border-t border-zinc-100 px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateField(field.id, {
                            showIf: {
                              fieldId: "",
                              operator: "equals",
                              value: "",
                            },
                          })
                        }
                        className="touch-target flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 sm:min-h-0"
                      >
                        <GitBranch className="h-3 w-3" />
                        Add condition
                      </button>
                    </div>
                  )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Add field */}
      <button
        type="button"
        onClick={addField}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-2.5 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
      >
        <Plus className="h-4 w-4" />
        Add Field
      </button>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {/* Save */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-50 sm:w-auto"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "Saving..." : "Save Form"}
        </button>
      </div>
    </div>
  )
}
