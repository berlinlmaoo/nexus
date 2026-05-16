"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  type CreatedFieldMetadata,
  CustomFieldOptionConfig,
  formatCreatedFieldTimestamp,
  formatCustomFieldNumberValue,
  formatCreatedFieldValue,
  getCustomStatusToneClassName,
  getNumberCustomFieldFormat,
  normalizeCustomFieldNumberInput,
  type PlaceFieldValue,
  type SupportedCustomFieldType,
} from "@/lib/custom-fields"
import { cn } from "@/lib/utils"
import {
  Calendar,
  Check,
  ChevronDown,
  Hash,
  ListFilter,
  Loader2,
  MapPin,
  Settings2,
} from "lucide-react"
import { format } from "date-fns"
import { toast } from "sonner"

interface CustomFieldRecord {
  id: string
  projectId: string
  name: string
  type: SupportedCustomFieldType
  position: number
  options: CustomFieldOptionConfig | null
  value: string | string[] | PlaceFieldValue
  createdMeta?: CreatedFieldMetadata | null
}

const FIELD_ICONS: Record<SupportedCustomFieldType, typeof Hash> = {
  NUMBER: Hash,
  SELECT: ListFilter,
  MULTI_SELECT: ListFilter,
  STATUS: ListFilter,
  DATE: Calendar,
  CREATED: Calendar,
  PLACE: MapPin,
}

function hasOptions(field: CustomFieldRecord) {
  return field.type === "SELECT" || field.type === "MULTI_SELECT" || field.type === "STATUS"
}

function getSelectOptionTemplate(field: CustomFieldRecord, value: string) {
  if (field.type !== "SELECT") return ""
  return String(field.options?.optionTemplates?.[value] ?? "").trim()
}

function SingleValueSelect({
  field,
  value,
  onChange,
}: {
  field: CustomFieldRecord
  value: string
  onChange: (value: string) => void
}) {
  const options = field.options?.options ?? []
  const selectedValue = value || ""

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-11 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-medium outline-none transition-all",
            field.type === "STATUS" && selectedValue
              ? getCustomStatusToneClassName(selectedValue)
              : "border-input bg-background",
            field.type === "STATUS" && selectedValue
              ? ""
              : selectedValue
                ? "text-foreground"
                : "text-muted-foreground"
          )}
        >
          <span className="truncate">{selectedValue || "Select an option..."}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder={`Search ${field.name.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>No option found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => onChange(field.type === "SELECT" && selectedValue === option ? "" : option)}
                >
                  <Check className={cn("mr-2 h-4 w-4", selectedValue === option ? "opacity-100" : "opacity-0")} />
                  <span
                    className={cn(
                      "rounded-full px-2 py-1 text-xs font-semibold",
                      field.type === "STATUS" && getCustomStatusToneClassName(option)
                    )}
                  >
                    {option}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function MultiValueSelect({
  field,
  value,
  onChange,
}: {
  field: CustomFieldRecord
  value: string[]
  onChange: (value: string[]) => void
}) {
  const options = field.options?.options ?? []

  const toggleValue = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter((item) => item !== option))
      return
    }
    onChange([...value, option])
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between rounded-xl border border-input bg-background px-3 py-2 text-left text-sm font-medium outline-none transition-all"
        >
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {value.length > 0 ? (
              value.map((item) => (
                <Badge key={item} variant="secondary" className="rounded-full border border-border/70 bg-muted/60 px-2 py-1 text-[11px]">
                  {item}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">Select one or more options...</span>
            )}
          </div>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder={`Search ${field.name.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>No option found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option} value={option} onSelect={() => toggleValue(option)}>
                  <Check className={cn("mr-2 h-4 w-4", value.includes(option) ? "opacity-100" : "opacity-0")} />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function NumberFieldInput({
  field,
  value,
  onChange,
  onCommit,
}: {
  field: CustomFieldRecord
  value: string
  onChange: (value: string) => void
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const numberFormat = getNumberCustomFieldFormat(field.options)

  useEffect(() => {
    if (!focused) {
      setDraft(value)
    }
  }, [focused, value])

  const handleFocus = () => {
    setFocused(true)
    if (numberFormat === "currency-idr") {
      setDraft(normalizeCustomFieldNumberInput(draft, field.options))
    }
  }

  const handleChange = (nextValue: string) => {
    const normalizedValue = normalizeCustomFieldNumberInput(nextValue, field.options)
    setDraft(normalizedValue)
    onChange(normalizedValue)
  }

  const handleBlur = () => {
    const normalizedValue = normalizeCustomFieldNumberInput(draft, field.options)
    setFocused(false)
    setDraft(normalizedValue)
    onCommit(normalizedValue)
  }

  const displayValue =
    numberFormat === "currency-idr" && !focused
      ? formatCustomFieldNumberValue(draft, field.options)
      : draft

  return (
    <div className="space-y-2">
      <Input
        type="text"
        inputMode={numberFormat === "currency-idr" ? "numeric" : "decimal"}
        value={displayValue}
        onFocus={handleFocus}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={handleBlur}
        placeholder={numberFormat === "currency-idr" ? "Masukkan nominal rupiah..." : "Enter a number..."}
        className="h-11 rounded-xl"
      />
      {numberFormat === "currency-idr" && draft && (
        <p className="text-[11px] text-on-surface-variant/45">
          Disimpan sebagai nominal Rupiah.
        </p>
      )}
    </div>
  )
}

export function TaskHeaderStatusFields({
  taskId,
  projectIds,
  onChanged,
}: {
  taskId: string
  projectIds: string[]
  onChanged?: () => void
}) {
  const [fields, setFields] = useState<CustomFieldRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null)

  const uniqueProjectIds = useMemo(
    () => Array.from(new Set(projectIds.filter(Boolean))),
    [projectIds]
  )

  const fetchStatusFields = useCallback(async () => {
    setLoading(true)
    try {
      if (uniqueProjectIds.length === 0) {
        setFields([])
        return
      }

      const responses = await Promise.all(
        uniqueProjectIds.map(async (projectId) => {
          const res = await fetch(`/api/custom-fields?projectId=${projectId}&taskId=${taskId}`, {
            cache: "no-store",
          })
          if (!res.ok) {
            throw new Error(`Failed to load status fields for project ${projectId}`)
          }

          const data = await res.json()
          return Array.isArray(data.fields) ? data.fields : []
        })
      )

      setFields(responses.flat().filter((field: CustomFieldRecord) => field.type === "STATUS"))
    } catch (error) {
      console.error("Failed to load task status fields:", error)
      setFields([])
    } finally {
      setLoading(false)
    }
  }, [taskId, uniqueProjectIds])

  useEffect(() => {
    fetchStatusFields()
  }, [fetchStatusFields])

  const updateStatusValue = async (fieldId: string, value: string) => {
    setSavingFieldId(fieldId)
    try {
      const res = await fetch("/api/custom-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: fieldId,
          taskId,
          value,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to update status")
      }

      const data = await res.json()
      setFields((prev) =>
        prev.map((field) =>
          field.id === fieldId
            ? {
                ...field,
                value: typeof data.fieldValue?.value === "string" ? data.fieldValue.value : value,
              }
            : field
        )
      )
      onChanged?.()
    } catch (error) {
      console.error("Failed to update task custom status:", error)
      toast.error(error instanceof Error ? error.message : "Failed to update status")
      fetchStatusFields()
    } finally {
      setSavingFieldId(null)
    }
  }

  if (loading || fields.length === 0) return null

  return (
    <>
      {fields.map((field) => {
        const options = field.options?.options ?? []
        const selectedValue = typeof field.value === "string" ? field.value : ""
        const isSaving = savingFieldId === field.id

        return (
          <Popover key={field.id}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={isSaving}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest transition-all outline-none focus:ring-2 focus:ring-primary/10 disabled:opacity-60",
                  selectedValue
                    ? getCustomStatusToneClassName(selectedValue)
                    : "border-on-surface-variant/10 bg-surface-container-high text-on-surface-variant/55"
                )}
                title={field.name}
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListFilter className="h-3.5 w-3.5" />}
                <span>{selectedValue || field.name}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[240px] p-0">
              <Command>
                <CommandInput placeholder={`Search ${field.name.toLowerCase()}...`} />
                <CommandList>
                  <CommandEmpty>No status found.</CommandEmpty>
                  <CommandGroup>
                    {options.map((option) => (
                      <CommandItem
                        key={option}
                        value={option}
                        onSelect={() => updateStatusValue(field.id, option)}
                      >
                        <Check className={cn("mr-2 h-4 w-4", selectedValue === option ? "opacity-100" : "opacity-0")} />
                        <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", getCustomStatusToneClassName(option))}>
                          {option}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )
      })}
    </>
  )
}

export function CustomFields({
  taskId,
  projectIds,
  projects = [],
  onSelectTemplate,
  onChanged,
}: {
  taskId: string
  projectIds: string[]
  projects?: Array<{ id: string; name: string; color?: string }>
  onSelectTemplate?: (template: string, meta: { fieldName: string; option: string }) => void
  onChanged?: () => void
}) {
  const [fields, setFields] = useState<CustomFieldRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null)

  const uniqueProjectIds = useMemo(
    () => Array.from(new Set(projectIds.filter(Boolean))),
    [projectIds]
  )

  const projectMetaById = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          project.id,
          {
            name: project.name,
            color: project.color,
          },
        ])
      ),
    [projects]
  )

  const fetchFields = useCallback(async () => {
    setLoading(true)
    try {
      if (uniqueProjectIds.length === 0) {
        setFields([])
        return
      }

      const responses = await Promise.all(
        uniqueProjectIds.map(async (projectId) => {
          const res = await fetch(`/api/custom-fields?projectId=${projectId}&taskId=${taskId}`)
          if (!res.ok) {
            throw new Error(`Failed to load custom fields for project ${projectId}`)
          }

          const data = await res.json()
          return Array.isArray(data.fields) ? data.fields : []
        })
      )

      setFields(responses.flat())
    } catch (error) {
      console.error("Failed to load task custom fields:", error)
      toast.error("Failed to load custom fields")
    } finally {
      setLoading(false)
    }
  }, [taskId, uniqueProjectIds])

  useEffect(() => {
    fetchFields()
  }, [fetchFields])

  const updateFieldValue = async (fieldId: string, value: unknown) => {
    const targetField = fields.find((field) => field.id === fieldId) ?? null
    setSavingFieldId(fieldId)
    try {
      const res = await fetch("/api/custom-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: fieldId,
          taskId,
          value,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to update custom field")
      }

      const data = await res.json()
      setFields((prev) =>
        prev.map((field) =>
          field.id === fieldId
            ? {
                ...field,
                value: data.fieldValue.value,
                createdMeta: data.fieldValue.createdMeta ?? field.createdMeta ?? null,
              }
            : field
        )
      )
      onChanged?.()
      if (targetField && typeof value === "string") {
        const template = getSelectOptionTemplate(targetField, value)
        if (template) {
          onSelectTemplate?.(template, {
            fieldName: targetField.name,
            option: value,
          })
        }
      }
    } catch (error) {
      console.error("Failed to update custom field value:", error)
      toast.error(error instanceof Error ? error.message : "Failed to update custom field")
      fetchFields()
    } finally {
      setSavingFieldId(null)
    }
  }

  const sortedFields = useMemo(() => {
    const projectOrder = new Map(uniqueProjectIds.map((projectId, index) => [projectId, index]))

    return [...fields].sort((a, b) => {
      const projectIndexA = projectOrder.get(a.projectId) ?? Number.MAX_SAFE_INTEGER
      const projectIndexB = projectOrder.get(b.projectId) ?? Number.MAX_SAFE_INTEGER

      if (projectIndexA !== projectIndexB) return projectIndexA - projectIndexB
      if (a.position !== b.position) return a.position - b.position
      return a.name.localeCompare(b.name)
    })
  }, [fields, uniqueProjectIds])

  if (loading) {
    return (
      <div className="rounded-2xl border border-on-surface-variant/5 bg-surface-container-lowest p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-on-surface-variant/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading custom fields...
        </div>
      </div>
    )
  }

  if (sortedFields.length === 0) {
    return (
      <div className="rounded-2xl border border-on-surface-variant/5 bg-surface-container-lowest p-5 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30 flex items-center gap-2">
          <Settings2 className="h-3 w-3" />
          Custom Fields
        </p>
        <p className="mt-3 text-sm text-on-surface-variant/45">
          No custom fields configured for the linked projects yet.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-on-surface-variant/5 bg-surface-container-lowest p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30 flex items-center gap-2">
            <Settings2 className="h-3 w-3" />
            Custom Fields
          </p>
          <p className="mt-2 text-xs text-on-surface-variant/45">
            Project-specific metadata for this task.
          </p>
        </div>
        {savingFieldId && (
          <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant/45">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving
          </span>
        )}
      </div>

      <div className="space-y-3">
        {sortedFields.map((field) => {
          const FieldIcon = FIELD_ICONS[field.type]
          const isSaving = savingFieldId === field.id
          const singleValue = typeof field.value === "string" ? field.value : ""
          const multiValue = Array.isArray(field.value) ? field.value : []
          const placeValue =
            typeof field.value === "object" && field.value !== null && !Array.isArray(field.value)
              ? (field.value as PlaceFieldValue)
              : { label: "", mapUrl: "" }
          const createdLabel = formatCreatedFieldValue(singleValue, field.createdMeta)
          const createdTimestamp =
            field.createdMeta?.timestamp || (singleValue ? String(singleValue) : "")

          return (
            <div
              key={field.id}
              className="rounded-2xl border border-on-surface-variant/5 bg-background/70 p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant/60">
                  <FieldIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-on-surface">{field.name}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30">
                    {field.type.replaceAll("_", " ")}
                  </p>
                </div>
                {uniqueProjectIds.length > 1 && projectMetaById.get(field.projectId) && (
                  <span
                    className="ml-auto inline-flex items-center gap-1 rounded-full border border-on-surface-variant/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-on-surface-variant/45"
                  >
                    {projectMetaById.get(field.projectId)?.color && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: projectMetaById.get(field.projectId)?.color }}
                      />
                    )}
                    {projectMetaById.get(field.projectId)?.name}
                  </span>
                )}
              </div>

              {field.type === "NUMBER" && (
                <NumberFieldInput
                  field={field}
                  value={singleValue}
                  onChange={(value) =>
                    setFields((prev) =>
                      prev.map((item) =>
                        item.id === field.id ? { ...item, value } : item
                      )
                    )
                  }
                  onCommit={(value) => updateFieldValue(field.id, value)}
                />
              )}

              {(field.type === "SELECT" || field.type === "STATUS") && (
                <SingleValueSelect
                  field={field}
                  value={singleValue}
                  onChange={(value) => updateFieldValue(field.id, value)}
                />
              )}

              {field.type === "MULTI_SELECT" && (
                <MultiValueSelect
                  field={field}
                  value={multiValue}
                  onChange={(value) => updateFieldValue(field.id, value)}
                />
              )}

              {field.type === "DATE" && (
                <div className="space-y-2">
                  <DateTimePicker
                    value={singleValue || null}
                    onChange={(value) => updateFieldValue(field.id, value)}
                  />
                  {singleValue && (
                    <p className="text-[11px] text-on-surface-variant/45">
                      {format(new Date(singleValue), "dd MMM yyyy • HH:mm")}
                    </p>
                  )}
                </div>
              )}

              {field.type === "CREATED" && (
                <div className="rounded-2xl border border-on-surface-variant/5 bg-surface-container-low px-4 py-3">
                  <p className="text-sm font-semibold text-on-surface">
                    {field.createdMeta?.userName || "Unknown"}
                  </p>
                  {createdTimestamp && (
                    <p className="mt-1 text-xs text-on-surface-variant/50">
                      {formatCreatedFieldTimestamp(createdTimestamp)}
                    </p>
                  )}
                  {createdLabel && (
                    <p className="mt-3 text-[11px] font-medium text-on-surface-variant/40">
                      Request history is captured automatically from the task creator.
                    </p>
                  )}
                </div>
              )}

              {field.type === "PLACE" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    value={placeValue.label}
                    onChange={(event) =>
                      setFields((prev) =>
                        prev.map((item) =>
                          item.id === field.id
                            ? {
                                ...item,
                                value: {
                                  ...placeValue,
                                  label: event.target.value,
                                },
                              }
                            : item
                        )
                      )
                    }
                    onBlur={(event) =>
                      updateFieldValue(field.id, {
                        ...placeValue,
                        label: event.target.value,
                      })
                    }
                    placeholder="Place name..."
                    className="h-11 rounded-xl"
                  />
                  <Input
                    value={placeValue.mapUrl}
                    onChange={(event) =>
                      setFields((prev) =>
                        prev.map((item) =>
                          item.id === field.id
                            ? {
                                ...item,
                                value: {
                                  ...placeValue,
                                  mapUrl: event.target.value,
                                },
                              }
                            : item
                        )
                      )
                    }
                    onBlur={(event) =>
                      updateFieldValue(field.id, {
                        ...placeValue,
                        mapUrl: event.target.value,
                      })
                    }
                    placeholder="Maps link..."
                    className="h-11 rounded-xl"
                  />
                </div>
              )}

              {hasOptions(field) && field.options?.options?.length === 0 && !isSaving && (
                <p className="mt-2 text-[11px] text-on-surface-variant/45">
                  No options configured yet for this field.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
