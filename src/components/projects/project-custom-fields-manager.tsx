"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  formatCustomFieldNumberValue,
  getCustomStatusToneClassName,
  getNumberCustomFieldFormat,
  normalizeCustomFieldOptions,
  SUPPORTED_CUSTOM_FIELD_TYPES,
  type CustomFieldOptionConfig,
  type NumberCustomFieldFormat,
  type SupportedCustomFieldType,
} from "@/lib/custom-fields"
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calendar,
  CheckCircle2,
  Hash,
  Link2,
  Loader2,
  MapPin,
  Paperclip,
  Plus,
  Save,
  Settings2,
  Tag,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

interface ManagedField {
  id: string
  projectId?: string
  libraryId?: string | null
  libraryName?: string | null
  libraryUsageCount?: number
  name: string
  type: SupportedCustomFieldType
  position: number
  options: CustomFieldOptionConfig | null
}

interface LibraryField {
  id: string
  name: string
  type: SupportedCustomFieldType
  options: CustomFieldOptionConfig | null
  usageCount: number
  attachedFieldId: string | null
  isAttached: boolean
}

const TYPE_META: Record<
  SupportedCustomFieldType,
  {
    label: string
    description: string
    icon: typeof Hash
  }
> = {
  TEXT: {
    label: "Text",
    description: "Free-form short or long text.",
    icon: AlignLeft,
  },
  URL: {
    label: "URL",
    description: "A web link.",
    icon: Link2,
  },
  FILE: {
    label: "Files & media",
    description: "Attach files, images, or media.",
    icon: Paperclip,
  },
  NUMBER: {
    label: "Number",
    description: "For budget, quota, score, or any numeric value.",
    icon: Hash,
  },
  SELECT: {
    label: "Select",
    description: "Single choice from a controlled list.",
    icon: Tag,
  },
  MULTI_SELECT: {
    label: "Multi-select",
    description: "Pick multiple labels for one task.",
    icon: Tag,
  },
  STATUS: {
    label: "Status",
    description: "Independent workflow status, separate from task status.",
    icon: CheckCircle2,
  },
  DATE: {
    label: "Date",
    description: "Set a date or date-time for this property.",
    icon: Calendar,
  },
  CREATED: {
    label: "Created",
    description: "Prefills from task creation time but stays editable.",
    icon: Calendar,
  },
  PLACE: {
    label: "Place",
    description: "Stores place name and map link together.",
    icon: MapPin,
  },
}

function supportsOptions(type: SupportedCustomFieldType) {
  return type === "SELECT" || type === "MULTI_SELECT" || type === "STATUS"
}

function supportsConfiguration(type: SupportedCustomFieldType) {
  return supportsOptions(type) || type === "NUMBER"
}

function extractOptions(options: ManagedField["options"]) {
  return options?.options ?? []
}

function buildOptions(
  type: SupportedCustomFieldType,
  {
    options = [],
    optionTemplates = {},
    numberFormat = "plain",
  }: {
    options?: string[]
    optionTemplates?: Record<string, string>
    numberFormat?: NumberCustomFieldFormat
  } = {}
) {
  return normalizeCustomFieldOptions(type, {
    ...(options.length > 0 ? { options } : {}),
    ...(type === "SELECT" && Object.keys(optionTemplates).length > 0 ? { optionTemplates } : {}),
    ...(type === "NUMBER" && numberFormat !== "plain" ? { format: numberFormat } : {}),
  })
}

function normalizeOptionLabel(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function uniqueOptions(values: string[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const normalized = value.toLowerCase()
    if (!value || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function addOptionToList(list: string[], rawValue: string) {
  const nextValue = normalizeOptionLabel(rawValue)
  if (!nextValue) return list
  return uniqueOptions([...list, nextValue])
}

function removeOptionFromList(list: string[], target: string) {
  return list.filter((item) => item !== target)
}

function extractOptionTemplates(options: ManagedField["options"]) {
  return options?.optionTemplates ?? {}
}

function normalizeOptionTemplates(options: string[], templates: Record<string, string>) {
  return options.reduce<Record<string, string>>((acc, option) => {
    const template = String(templates[option] ?? "").trim()
    if (template) {
      acc[option] = template
    }
    return acc
  }, {})
}

function FieldTypePicker({
  value,
  onChange,
}: {
  value: SupportedCustomFieldType
  onChange: (value: SupportedCustomFieldType) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
      {SUPPORTED_CUSTOM_FIELD_TYPES.map((type) => {
        const meta = TYPE_META[type]
        const Icon = meta.icon

        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={cn(
              "rounded-xl border px-2.5 py-2.5 text-left transition-all",
              value === type
                ? "border-foreground bg-foreground text-background shadow-sm"
                : "border-border/80 bg-background hover:border-foreground/20 hover:bg-muted/50"
            )}
          >
            <div className="flex items-start gap-2">
              <div
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border",
                  value === type
                    ? "border-background/15 bg-background/10 text-background/90"
                    : "border-border/80 bg-muted/50 text-muted-foreground"
                )}
              >
                <Icon className="h-2.5 w-2.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-tight">{meta.label}</p>
                <p
                  className={cn(
                    "mt-1 text-[11px] leading-snug",
                    value === type ? "text-background/75" : "text-muted-foreground"
                  )}
                >
                  {meta.description}
                </p>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function OptionBuilder({
  label,
  options,
  inputValue,
  onInputChange,
  onAddOption,
  onRemoveOption,
}: {
  label: string
  options: string[]
  inputValue: string
  onInputChange: (value: string) => void
  onAddOption: () => void
  onRemoveOption: (value: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
          {label}
        </Label>
        <span className="text-[11px] font-medium text-muted-foreground">
          {options.length} option{options.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-border/80 bg-background px-3 py-3">
        {options.length > 0 ? (
          options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onRemoveOption(option)}
              className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/60 px-3 py-1.5 text-xs font-semibold text-foreground transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <span>{option}</span>
              <span className="text-[10px] opacity-60">remove</span>
            </button>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Add a few options so this field feels useful right away.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onAddOption()
            }
          }}
          placeholder="Type one option, then press Enter"
          className="h-11 rounded-xl"
        />
        <Button
          type="button"
          variant="outline"
          onClick={onAddOption}
          className="rounded-xl"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add option
        </Button>
      </div>
    </div>
  )
}

function OptionTemplateBuilder({
  options,
  templates,
  onChange,
}: {
  options: string[]
  templates: Record<string, string>
  onChange: (templates: Record<string, string>) => void
}) {
  if (options.length === 0) return null

  return (
    <div className="space-y-3 rounded-2xl border border-dashed border-border/80 bg-background/70 p-4">
      <div className="space-y-1">
        <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
          Core Intelligence Templates
        </Label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Optional. When a select option is chosen on a task, its template will be inserted into Core Intelligence.
        </p>
      </div>

      <div className="space-y-3">
        {options.map((option) => (
          <div key={option} className="space-y-1.5">
            <Label className="text-xs font-bold text-foreground">{option}</Label>
            <textarea
              value={templates[option] ?? ""}
              onChange={(event) => {
                const nextTemplates = {
                  ...templates,
                  [option]: event.target.value,
                }
                if (!event.target.value.trim()) {
                  delete nextTemplates[option]
                }
                onChange(normalizeOptionTemplates(options, nextTemplates))
              }}
              placeholder={`Template Core Intelligence untuk "${option}"...`}
              className="min-h-[92px] w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm leading-6 outline-none transition-all placeholder:text-muted-foreground/50 focus:border-foreground/30 focus:ring-2 focus:ring-foreground/10"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function NumberFormatPicker({
  value,
  onChange,
}: {
  value: NumberCustomFieldFormat
  onChange: (value: NumberCustomFieldFormat) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => onChange("plain")}
        className={cn(
          "rounded-xl border px-3 py-3 text-left transition-all",
          value === "plain"
            ? "border-foreground bg-foreground text-background shadow-sm"
            : "border-border/80 bg-background hover:border-foreground/20 hover:bg-muted/50"
        )}
      >
        <p className="text-sm font-semibold">Plain number</p>
        <p className={cn("mt-1 text-xs", value === "plain" ? "text-background/75" : "text-muted-foreground")}>
          Keep the field as a regular number.
        </p>
      </button>
      <button
        type="button"
        onClick={() => onChange("currency-idr")}
        className={cn(
          "rounded-xl border px-3 py-3 text-left transition-all",
          value === "currency-idr"
            ? "border-foreground bg-foreground text-background shadow-sm"
            : "border-border/80 bg-background hover:border-foreground/20 hover:bg-muted/50"
        )}
      >
        <p className="text-sm font-semibold">Rupiah (IDR)</p>
        <p className={cn("mt-1 text-xs", value === "currency-idr" ? "text-background/75" : "text-muted-foreground")}>
          Show the value as Indonesian currency with `Rp`.
        </p>
      </button>
    </div>
  )
}

function FieldPreview({
  type,
  name,
  options,
  numberFormat,
}: {
  type: SupportedCustomFieldType
  name: string
  options: string[]
  numberFormat: NumberCustomFieldFormat
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-background/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
            Task Detail Preview
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {name.trim() || "Untitled field"}
          </p>
        </div>
        <span className="rounded-full border border-border/80 bg-muted/60 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {TYPE_META[type].label}
        </span>
      </div>

      {(type === "SELECT" || type === "MULTI_SELECT" || type === "STATUS") && (
        <div className="flex flex-wrap gap-2">
          {(options.length > 0 ? options : ["Option 1", "Option 2"]).map((option) => (
            <span
              key={option}
              className={cn(
                "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
                type === "STATUS"
                  ? getCustomStatusToneClassName(option)
                  : "border-border/80 bg-muted/60 text-foreground"
              )}
            >
              {option}
            </span>
          ))}
        </div>
      )}

      {type === "NUMBER" && (
        <div className="rounded-xl border border-border/80 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {numberFormat === "currency-idr"
            ? formatCustomFieldNumberValue("1250000", { format: "currency-idr" })
            : "1250000"}
        </div>
      )}

      {(type === "DATE" || type === "CREATED") && (
        <div className="rounded-xl border border-border/80 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          10 Apr 2026 • 09:00
        </div>
      )}

      {type === "PLACE" && (
        <div className="space-y-2">
          <div className="rounded-xl border border-border/80 bg-muted/40 px-3 py-2 text-sm text-foreground">
            Studio PATS BSD
          </div>
          <div className="rounded-xl border border-border/80 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            https://maps.google.com/...
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectCustomFieldsManager({ projectId }: { projectId: string }) {
  const [fields, setFields] = useState<ManagedField[]>([])
  const [libraryFields, setLibraryFields] = useState<LibraryField[]>([])
  const [loading, setLoading] = useState(true)
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null)
  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null)
  const [attachingLibraryId, setAttachingLibraryId] = useState<string | null>(null)
  const [promotingFieldId, setPromotingFieldId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)

  const [draftName, setDraftName] = useState("")
  const [draftType, setDraftType] = useState<SupportedCustomFieldType>("SELECT")
  const [draftOptionInput, setDraftOptionInput] = useState("")
  const [draftOptionList, setDraftOptionList] = useState<string[]>([])
  const [draftOptionTemplates, setDraftOptionTemplates] = useState<Record<string, string>>({})
  const [draftNumberFormat, setDraftNumberFormat] = useState<NumberCustomFieldFormat>("plain")
  const [saveDraftToLibrary, setSaveDraftToLibrary] = useState(true)
  const [creating, setCreating] = useState(false)

  const [fieldOptionInputs, setFieldOptionInputs] = useState<Record<string, string>>({})

  const notifyCustomFieldsChanged = useCallback(() => {
    if (typeof window === "undefined") return

    window.dispatchEvent(
      new CustomEvent("nexus:custom-fields-changed", {
        detail: { projectId },
      })
    )
  }, [projectId])

  const fetchFields = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/custom-fields?projectId=${projectId}&includeLibrary=1`, {
        cache: "no-store",
      })
      const data = await res.json()
      const nextFields = Array.isArray(data.fields) ? data.fields : []
      const nextLibraryFields = Array.isArray(data.libraryFields) ? data.libraryFields : []
      setFields(nextFields)
      setLibraryFields(nextLibraryFields)
      setFieldOptionInputs(
        Object.fromEntries(nextFields.map((field: ManagedField) => [field.id, ""]))
      )
    } catch (error) {
      console.error("Failed to fetch custom fields:", error)
      toast.error("Failed to load custom fields")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchFields()
  }, [fetchFields])

  const hasFields = fields.length > 0
  const draftOptions = useMemo(
    () =>
      buildOptions(draftType, {
        options: draftOptionList,
        optionTemplates: normalizeOptionTemplates(draftOptionList, draftOptionTemplates),
        numberFormat: draftNumberFormat,
      }),
    [draftNumberFormat, draftOptionList, draftOptionTemplates, draftType]
  )

  const resetDraft = () => {
    setDraftName("")
    setDraftType("SELECT")
    setDraftOptionInput("")
    setDraftOptionList([])
    setDraftOptionTemplates({})
    setDraftNumberFormat("plain")
    setSaveDraftToLibrary(true)
  }

  const createField = async () => {
    if (!draftName.trim()) {
      toast.error("Field name is required")
      return
    }

    setCreating(true)
    try {
      const res = await fetch("/api/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draftName.trim(),
          type: draftType,
          options: supportsConfiguration(draftType) ? draftOptions : undefined,
          projectId,
          saveToLibrary: saveDraftToLibrary,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to create field")
      }

      const data = await res.json()
      setFields((prev) => [...prev, data.field])
      fetchFields()
      setFieldOptionInputs((prev) => ({
        ...prev,
        [data.field.id]: "",
      }))
      notifyCustomFieldsChanged()
      resetDraft()
      toast.success("Custom field created")
    } catch (error) {
      console.error("Failed to create custom field:", error)
      toast.error(error instanceof Error ? error.message : "Failed to create custom field")
    } finally {
      setCreating(false)
    }
  }

  const attachLibraryField = async (libraryField: LibraryField) => {
    setAttachingLibraryId(libraryField.id)
    try {
      const res = await fetch("/api/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          libraryId: libraryField.id,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to add library field")
      }

      const data = await res.json()
      setFields((prev) => [...prev, data.field])
      await fetchFields()
      notifyCustomFieldsChanged()
      toast.success("Library field added to this project")
    } catch (error) {
      console.error("Failed to attach library field:", error)
      toast.error(error instanceof Error ? error.message : "Failed to add library field")
    } finally {
      setAttachingLibraryId(null)
    }
  }

  const promoteFieldToLibrary = async (field: ManagedField) => {
    setPromotingFieldId(field.id)
    try {
      const res = await fetch("/api/custom-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: field.id,
          name: field.name.trim(),
          type: field.type,
          options: supportsConfiguration(field.type) ? field.options : undefined,
          promoteToLibrary: true,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to add field to library")
      }

      const data = await res.json()
      setFields((prev) =>
        prev.map((item) => (item.id === field.id ? data.field : item))
      )
      await fetchFields()
      notifyCustomFieldsChanged()
      toast.success("Field added to workspace library")
    } catch (error) {
      console.error("Failed to promote custom field:", error)
      toast.error(error instanceof Error ? error.message : "Failed to add field to library")
    } finally {
      setPromotingFieldId(null)
    }
  }

  const updateField = async (field: ManagedField) => {
    setSavingFieldId(field.id)
    try {
      const res = await fetch("/api/custom-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: field.id,
          name: field.name.trim(),
          type: field.type,
          options: supportsConfiguration(field.type) ? field.options : undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to save field")
      }

      const data = await res.json()
      setFields((prev) =>
        prev.map((item) => (item.id === field.id ? data.field : item))
      )
      fetchFields()
      notifyCustomFieldsChanged()
      toast.success("Field updated")
    } catch (error) {
      console.error("Failed to update custom field:", error)
      toast.error(error instanceof Error ? error.message : "Failed to update field")
    } finally {
      setSavingFieldId(null)
    }
  }

  const deleteField = async (fieldId: string) => {
    setDeletingFieldId(fieldId)
    try {
      const res = await fetch(`/api/custom-fields?id=${fieldId}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to delete field")
      }

      setFields((prev) => prev.filter((field) => field.id !== fieldId))
      setFieldOptionInputs((prev) => {
        const next = { ...prev }
        delete next[fieldId]
        return next
      })
      notifyCustomFieldsChanged()
      fetchFields()
      toast.success("Field deleted")
    } catch (error) {
      console.error("Failed to delete custom field:", error)
      toast.error(error instanceof Error ? error.message : "Failed to delete field")
    } finally {
      setDeletingFieldId(null)
    }
  }

  const reorderFields = async (nextFields: ManagedField[]) => {
    const nextOrderedFields = nextFields.map((field, index) => ({
      ...field,
      position: index,
    }))
    setFields(nextOrderedFields)
    setReordering(true)
    try {
      const res = await fetch("/api/custom-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          reorder: nextOrderedFields.map((field) => ({ id: field.id })),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to reorder fields")
      }
      notifyCustomFieldsChanged()
    } catch (error) {
      console.error("Failed to reorder custom fields:", error)
      toast.error(error instanceof Error ? error.message : "Failed to reorder fields")
      fetchFields()
    } finally {
      setReordering(false)
    }
  }

  const moveField = (fieldId: string, direction: "up" | "down") => {
    const index = fields.findIndex((field) => field.id === fieldId)
    if (index === -1) return
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= fields.length) return

    const nextFields = [...fields]
    const [moved] = nextFields.splice(index, 1)
    nextFields.splice(targetIndex, 0, moved)
    reorderFields(nextFields)
  }

  const updateFieldOptionList = (fieldId: string, nextOptions: string[]) => {
    setFields((prev) =>
      prev.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              options: buildOptions(field.type, {
                options: nextOptions,
                optionTemplates: normalizeOptionTemplates(
                  nextOptions,
                  extractOptionTemplates(field.options)
                ),
                numberFormat: getNumberCustomFieldFormat(field.options),
              }),
            }
          : field
      )
    )
  }

  const selectedDraftMeta = TYPE_META[draftType]

  return (
    <div className="rounded-[1.75rem] border bg-card/80 p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Settings2 className="h-4 w-4" />
            Custom Fields
          </p>
          <p className="text-xs text-muted-foreground">
            Build task metadata per project. Every field you define here will appear on every task detail inside this project.
          </p>
        </div>
        <div className="rounded-full border border-border/80 bg-background px-3 py-1 text-[11px] font-semibold text-muted-foreground">
          {fields.length} field{fields.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-border/80 bg-gradient-to-br from-background via-background to-muted/30 p-4 shadow-sm">
        <div className="grid gap-5 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Field Name
              </Label>
              <Input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="e.g. Shooting Location"
                className="h-12 rounded-2xl"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Type
              </Label>
              <FieldTypePicker
                value={draftType}
                onChange={(nextType) => {
                  setDraftType(nextType)
                  if (nextType !== "SELECT") {
                    setDraftOptionTemplates({})
                  }
                  if (nextType === "STATUS" && draftOptionList.length === 0) {
                    setDraftOptionList(["On Progress", "Done"])
                  }
                }}
              />
            </div>

            {supportsOptions(draftType) && (
              <OptionBuilder
                label="Options"
                options={draftOptionList}
                inputValue={draftOptionInput}
                onInputChange={setDraftOptionInput}
                onAddOption={() => {
                  setDraftOptionList((prev) => addOptionToList(prev, draftOptionInput))
                  setDraftOptionInput("")
                }}
                onRemoveOption={(value) =>
                  setDraftOptionList((prev) => {
                    const nextOptions = removeOptionFromList(prev, value)
                    setDraftOptionTemplates((templates) =>
                      normalizeOptionTemplates(nextOptions, templates)
                    )
                    return nextOptions
                  })
                }
              />
            )}

            {draftType === "SELECT" && draftOptionList.length > 0 && (
              <OptionTemplateBuilder
                options={draftOptionList}
                templates={draftOptionTemplates}
                onChange={setDraftOptionTemplates}
              />
            )}

            {draftType === "NUMBER" && (
              <div className="space-y-3">
                <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                  Number Format
                </Label>
                <NumberFormatPicker
                  value={draftNumberFormat}
                  onChange={setDraftNumberFormat}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border/80 bg-background/80 px-4 py-3">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {selectedDraftMeta.description}
                </p>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={saveDraftToLibrary}
                    onChange={(event) => setSaveDraftToLibrary(event.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                  Save to workspace custom field library
                </label>
              </div>
              <Button
                type="button"
                onClick={createField}
                disabled={creating || !draftName.trim()}
                className="rounded-xl bg-foreground text-background hover:bg-foreground/90"
              >
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add field
              </Button>
            </div>
          </div>

          <FieldPreview
            type={draftType}
            name={draftName}
            options={draftOptionList}
            numberFormat={draftNumberFormat}
          />
        </div>
      </div>

      <div className="mt-5 rounded-[1.5rem] border border-border/80 bg-background/80 p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BookOpen className="h-4 w-4" />
              Workspace custom field library
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Reuse linked fields across projects. Editing a linked field updates every project using that library field.
            </p>
          </div>
          <div className="rounded-full border border-border/80 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            {libraryFields.length} library field{libraryFields.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {libraryFields.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground md:col-span-2">
              Belum ada library field. Field baru bisa langsung disimpan ke library, atau field lama bisa kamu promote dari list di bawah.
            </div>
          ) : (
            libraryFields.map((field) => {
              const meta = TYPE_META[field.type]
              const Icon = meta.icon

              return (
                <div key={field.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background text-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{field.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {meta.label} · used in {field.usageCount} project{field.usageCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant={field.isAttached ? "outline" : "default"}
                    onClick={() => attachLibraryField(field)}
                    disabled={field.isAttached || attachingLibraryId === field.id}
                    className="shrink-0 rounded-xl"
                  >
                    {attachingLibraryId === field.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" />
                    )}
                    {field.isAttached ? "In project" : "Use field"}
                  </Button>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 px-4 py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading custom fields...
          </div>
        ) : !hasFields ? (
          <div className="rounded-2xl border border-dashed border-border/70 px-4 py-12 text-center text-sm text-muted-foreground">
            No custom fields yet for this project.
          </div>
        ) : (
          fields.map((field, index) => {
            const options = extractOptions(field.options)
            const numberFormat = getNumberCustomFieldFormat(field.options)
            const meta = TYPE_META[field.type]
            const Icon = meta.icon

            return (
              <div
                key={field.id}
                className="rounded-[1.5rem] border bg-background/80 p-4 shadow-sm"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3 xl:max-w-[220px]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {field.name || "Untitled field"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {meta.label}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {meta.description}
                    </p>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => moveField(field.id, "up")}
                        disabled={index === 0 || reordering}
                        className="h-10 w-10 rounded-xl"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => moveField(field.id, "down")}
                        disabled={index === fields.length - 1 || reordering}
                        className="h-10 w-10 rounded-xl"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4">
                    <div className="space-y-2">
                      <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                        Property Name
                      </Label>
                      <Input
                        value={field.name}
                        onChange={(event) =>
                          setFields((prev) =>
                            prev.map((item) =>
                              item.id === field.id ? { ...item, name: event.target.value } : item
                            )
                          )
                        }
                        className="h-12 rounded-2xl"
                      />
                    </div>

                    <div className="space-y-3">
                      <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                        Type
                      </Label>
                      <FieldTypePicker
                        value={field.type}
                        onChange={(nextType) => {
                          const nextOptions = supportsOptions(nextType)
                            ? buildOptions(nextType, { options })
                            : nextType === "NUMBER"
                              ? buildOptions(nextType, { numberFormat: "plain" })
                            : null
                          setFields((prev) =>
                            prev.map((item) =>
                              item.id === field.id
                                ? {
                                    ...item,
                                    type: nextType,
                                    options: nextOptions,
                                  }
                                : item
                            )
                          )
                        }}
                      />
                    </div>

                    {supportsOptions(field.type) && (
                      <OptionBuilder
                        label="Options"
                        options={options}
                        inputValue={fieldOptionInputs[field.id] ?? ""}
                        onInputChange={(value) =>
                          setFieldOptionInputs((prev) => ({
                            ...prev,
                            [field.id]: value,
                          }))
                        }
                        onAddOption={() => {
                          updateFieldOptionList(
                            field.id,
                            addOptionToList(options, fieldOptionInputs[field.id] ?? "")
                          )
                          setFieldOptionInputs((prev) => ({
                            ...prev,
                            [field.id]: "",
                          }))
                        }}
                        onRemoveOption={(value) =>
                          updateFieldOptionList(field.id, removeOptionFromList(options, value))
                        }
                      />
                    )}

                    {field.type === "SELECT" && options.length > 0 && (
                      <OptionTemplateBuilder
                        options={options}
                        templates={extractOptionTemplates(field.options)}
                        onChange={(nextTemplates) =>
                          setFields((prev) =>
                            prev.map((item) =>
                              item.id === field.id
                                ? {
                                    ...item,
                                    options: buildOptions(item.type, {
                                      options,
                                      optionTemplates: nextTemplates,
                                      numberFormat,
                                    }),
                                  }
                                : item
                            )
                          )
                        }
                      />
                    )}

                    {field.type === "NUMBER" && (
                      <div className="space-y-3">
                        <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                          Number Format
                        </Label>
                        <NumberFormatPicker
                          value={numberFormat}
                          onChange={(nextFormat) =>
                            setFields((prev) =>
                              prev.map((item) =>
                                item.id === field.id
                                  ? {
                                      ...item,
                                      options: buildOptions(item.type, { numberFormat: nextFormat }),
                                    }
                                  : item
                              )
                            )
                          }
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-3">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {field.libraryId
                            ? `Linked library field. Updates sync to ${field.libraryUsageCount ?? 1} project${(field.libraryUsageCount ?? 1) === 1 ? "" : "s"}.`
                            : "Local project field. Add it to the workspace library if you want to reuse it in other projects."}
                        </p>
                        {field.libraryId && (
                          <p className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                            <Link2 className="h-3 w-3" />
                            Library linked
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {!field.libraryId && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => promoteFieldToLibrary(field)}
                            disabled={promotingFieldId === field.id || !field.name.trim()}
                            className="rounded-xl"
                          >
                            {promotingFieldId === field.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <BookOpen className="mr-2 h-4 w-4" />
                            )}
                            Add to library
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => deleteField(field.id)}
                          disabled={deletingFieldId === field.id}
                          className="rounded-xl text-red-600 hover:text-red-600"
                        >
                          {deletingFieldId === field.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          {field.libraryId ? "Remove" : "Delete"}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => updateField(field)}
                          disabled={savingFieldId === field.id || !field.name.trim()}
                          className="rounded-xl bg-foreground text-background hover:bg-foreground/90"
                        >
                          {savingFieldId === field.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
