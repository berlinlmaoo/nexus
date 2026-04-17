"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  formatCustomFieldNumberValue,
  getNumberCustomFieldFormat,
  normalizeCustomFieldOptions,
  SUPPORTED_CUSTOM_FIELD_TYPES,
  type CustomFieldOptionConfig,
  type NumberCustomFieldFormat,
  type SupportedCustomFieldType,
} from "@/lib/custom-fields"
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Hash,
  Loader2,
  MapPin,
  Plus,
  Save,
  Settings2,
  Tag,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

interface ManagedField {
  id: string
  name: string
  type: SupportedCustomFieldType
  position: number
  options: CustomFieldOptionConfig | null
}

const TYPE_META: Record<
  SupportedCustomFieldType,
  {
    label: string
    description: string
    icon: typeof Hash
  }
> = {
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
    numberFormat = "plain",
  }: {
    options?: string[]
    numberFormat?: NumberCustomFieldFormat
  } = {}
) {
  return normalizeCustomFieldOptions(type, {
    ...(options.length > 0 ? { options } : {}),
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

function FieldTypePicker({
  value,
  onChange,
}: {
  value: SupportedCustomFieldType
  onChange: (value: SupportedCustomFieldType) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
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
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
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
  const [loading, setLoading] = useState(true)
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null)
  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)

  const [draftName, setDraftName] = useState("")
  const [draftType, setDraftType] = useState<SupportedCustomFieldType>("SELECT")
  const [draftOptionInput, setDraftOptionInput] = useState("")
  const [draftOptionList, setDraftOptionList] = useState<string[]>([])
  const [draftNumberFormat, setDraftNumberFormat] = useState<NumberCustomFieldFormat>("plain")
  const [creating, setCreating] = useState(false)

  const [fieldOptionInputs, setFieldOptionInputs] = useState<Record<string, string>>({})

  const fetchFields = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/custom-fields?projectId=${projectId}`)
      const data = await res.json()
      const nextFields = Array.isArray(data.fields) ? data.fields : []
      setFields(nextFields)
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
    () => buildOptions(draftType, { options: draftOptionList, numberFormat: draftNumberFormat }),
    [draftNumberFormat, draftOptionList, draftType]
  )

  const resetDraft = () => {
    setDraftName("")
    setDraftType("SELECT")
    setDraftOptionInput("")
    setDraftOptionList([])
    setDraftNumberFormat("plain")
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
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to create field")
      }

      const data = await res.json()
      setFields((prev) => [...prev, data.field])
      setFieldOptionInputs((prev) => ({
        ...prev,
        [data.field.id]: "",
      }))
      resetDraft()
      toast.success("Custom field created")
    } catch (error) {
      console.error("Failed to create custom field:", error)
      toast.error(error instanceof Error ? error.message : "Failed to create custom field")
    } finally {
      setCreating(false)
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
              <FieldTypePicker value={draftType} onChange={setDraftType} />
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
                  setDraftOptionList((prev) => removeOptionFromList(prev, value))
                }
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
              <p className="text-sm text-muted-foreground">
                {selectedDraftMeta.description}
              </p>
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
                      <p className="text-xs text-muted-foreground">
                        Saved per project. This field will appear automatically on all tasks in this project.
                      </p>

                      <div className="flex items-center gap-2">
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
                          Delete
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
