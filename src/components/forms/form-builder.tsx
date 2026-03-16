"use client"

import { useState, useRef, useCallback } from "react"
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
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface FormField {
  id: string
  name: string
  type:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "dropdown"
    | "file"
    | "email"
    | "checkbox"
  required: boolean
  options?: string[]
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
  { value: "file", label: "File", icon: Paperclip },
  { value: "email", label: "Email", icon: Mail },
  { value: "checkbox", label: "Checkbox", icon: CheckSquare },
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

export function FormBuilder({ projectId, form, onSave }: FormBuilderProps) {
  const [name, setName] = useState(form?.name ?? "")
  const [description, setDescription] = useState(form?.description ?? "")
  const [isPublic, setIsPublic] = useState(form?.isPublic ?? false)
  const [fields, setFields] = useState<FormField[]>(
    form?.fields ?? [createEmptyField()]
  )
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Drag state
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

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

    const emptyField = fields.find((f) => !f.name.trim())
    if (emptyField) {
      setError("All fields must have a name.")
      return
    }

    setSaving(true)

    try {
      const payload = {
        projectId,
        name: name.trim(),
        description: description.trim() || null,
        fields,
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
                  {field.options?.map((opt) => (
                    <option key={opt}>{opt}</option>
                  ))}
                </select>
              )}
              {field.type === "file" && (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm text-zinc-400">
                  <Paperclip className="h-4 w-4" />
                  Choose file
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
          <span className="text-sm text-zinc-700">Public form</span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-zinc-200" />

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900">Fields</h3>
        <button
          type="button"
          onClick={() => setPreview(true)}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
        >
          <Eye className="h-4 w-4" />
          Preview
        </button>
      </div>

      {/* Fields list */}
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {fields.map((field, index) => {
            const isExpanded = expandedFieldId === field.id
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
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "rounded-lg border border-zinc-200 bg-white shadow-sm",
                    dragOverIndex === index && "border-zinc-900"
                  )}
                >
                  {/* Field row */}
                  <div className="flex items-center gap-2 px-3 py-2.5">
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
                      className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                    />

                    {/* Type selector */}
                    <div className="relative">
                      <FieldTypeIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                      <select
                        value={field.type}
                        onChange={(e) => {
                          const newType = e.target.value as FormField["type"]
                          const updates: Partial<FormField> = { type: newType }
                          if (newType === "dropdown" && !field.options) {
                            updates.options = []
                          }
                          if (newType !== "dropdown") {
                            updates.options = undefined
                          }
                          updateField(field.id, updates)
                          if (newType === "dropdown") {
                            setExpandedFieldId(field.id)
                          }
                        }}
                        className="h-8 appearance-none rounded-md border border-zinc-200 bg-white py-1 pl-7 pr-7 text-sm text-zinc-700 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
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

                    {/* Expand options (dropdown only) */}
                    {field.type === "dropdown" && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedFieldId(isExpanded ? null : field.id)
                        }
                        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-900"
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

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      aria-label="Delete field"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Dropdown options editor */}
                  {field.type === "dropdown" && isExpanded && (
                    <div className="border-t border-zinc-100 px-3 py-2.5">
                      <label className="mb-1 block text-xs font-medium text-zinc-500">
                        Options (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={field.options?.join(", ") ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value
                          const options = raw
                            .split(",")
                            .map((o) => o.trim())
                            .filter(Boolean)
                          updateField(field.id, { options })
                        }}
                        placeholder="Option 1, Option 2, Option 3"
                        className="block w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                      />
                    </div>
                  )}
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
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-50"
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
