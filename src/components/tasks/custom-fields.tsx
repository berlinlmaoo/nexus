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
  CustomFieldOptionConfig,
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
  name: string
  type: SupportedCustomFieldType
  position: number
  options: CustomFieldOptionConfig | null
  value: string | string[] | PlaceFieldValue
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
            "flex h-11 w-full items-center justify-between rounded-xl border border-input bg-background px-3 text-left text-sm font-medium outline-none transition-all",
            selectedValue ? "text-foreground" : "text-muted-foreground"
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
                <CommandItem key={option} value={option} onSelect={() => onChange(option)}>
                  <Check className={cn("mr-2 h-4 w-4", selectedValue === option ? "opacity-100" : "opacity-0")} />
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

export function CustomFields({ taskId, projectId }: { taskId: string; projectId: string }) {
  const [fields, setFields] = useState<CustomFieldRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null)

  const fetchFields = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/custom-fields?projectId=${projectId}&taskId=${taskId}`)
      const data = await res.json()
      setFields(Array.isArray(data.fields) ? data.fields : [])
    } catch (error) {
      console.error("Failed to load task custom fields:", error)
      toast.error("Failed to load custom fields")
    } finally {
      setLoading(false)
    }
  }, [projectId, taskId])

  useEffect(() => {
    fetchFields()
  }, [fetchFields])

  const updateFieldValue = async (fieldId: string, value: unknown) => {
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
          field.id === fieldId ? { ...field, value: data.fieldValue.value } : field
        )
      )
    } catch (error) {
      console.error("Failed to update custom field value:", error)
      toast.error(error instanceof Error ? error.message : "Failed to update custom field")
      fetchFields()
    } finally {
      setSavingFieldId(null)
    }
  }

  const sortedFields = useMemo(
    () => [...fields].sort((a, b) => a.position - b.position),
    [fields]
  )

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
          No custom fields configured for this project yet.
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
              </div>

              {field.type === "NUMBER" && (
                <Input
                  type="number"
                  value={singleValue}
                  onChange={(event) =>
                    setFields((prev) =>
                      prev.map((item) =>
                        item.id === field.id ? { ...item, value: event.target.value } : item
                      )
                    )
                  }
                  onBlur={(event) => updateFieldValue(field.id, event.target.value)}
                  placeholder="Enter a number..."
                  className="h-11 rounded-xl"
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

              {(field.type === "DATE" || field.type === "CREATED") && (
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
