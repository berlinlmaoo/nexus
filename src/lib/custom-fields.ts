export const SUPPORTED_CUSTOM_FIELD_TYPES = [
  "NUMBER",
  "SELECT",
  "MULTI_SELECT",
  "STATUS",
  "DATE",
  "CREATED",
  "PLACE",
] as const

export type SupportedCustomFieldType = (typeof SUPPORTED_CUSTOM_FIELD_TYPES)[number]

export interface CustomFieldOptionConfig {
  options?: string[]
  defaultSource?: "taskCreatedAt"
  editable?: boolean
  format?: "name-and-map-link"
}

export interface PlaceFieldValue {
  label: string
  mapUrl: string
}

const SUPPORTED_TYPE_SET = new Set<string>(SUPPORTED_CUSTOM_FIELD_TYPES)

const TYPE_ALIASES: Record<string, SupportedCustomFieldType> = {
  DROPDOWN: "SELECT",
}

export function normalizeCustomFieldType(type: string | null | undefined): SupportedCustomFieldType | null {
  if (!type) return null
  const normalized = type.toUpperCase().trim()
  if (SUPPORTED_TYPE_SET.has(normalized)) {
    return normalized as SupportedCustomFieldType
  }
  return TYPE_ALIASES[normalized] ?? null
}

export function normalizeCustomFieldOptions(
  type: SupportedCustomFieldType,
  options: unknown
): CustomFieldOptionConfig | null {
  if (type === "SELECT" || type === "MULTI_SELECT" || type === "STATUS") {
    const rawOptions = Array.isArray(options)
      ? options
      : Array.isArray((options as { options?: unknown[] } | null)?.options)
        ? (options as { options: unknown[] }).options
        : []

    const normalizedOptions = rawOptions
      .map((option) => String(option).trim())
      .filter(Boolean)

    if (type === "STATUS" && normalizedOptions.length === 0) {
      return {
        options: ["Not started", "In progress", "Blocked", "Done"],
      }
    }

    return { options: normalizedOptions }
  }

  if (type === "CREATED") {
    return {
      defaultSource: "taskCreatedAt",
      editable: true,
    }
  }

  if (type === "PLACE") {
    return {
      format: "name-and-map-link",
    }
  }

  return null
}

export function getDefaultCustomFieldValue(
  type: SupportedCustomFieldType,
  taskCreatedAt?: Date | string | null
): string | string[] | PlaceFieldValue {
  if (type === "MULTI_SELECT") return []
  if (type === "PLACE") return { label: "", mapUrl: "" }
  if (type === "CREATED") {
    const sourceDate = taskCreatedAt ? new Date(taskCreatedAt) : new Date()
    return sourceDate.toISOString()
  }
  return ""
}

export function serializeCustomFieldValue(
  type: SupportedCustomFieldType,
  value: unknown,
  taskCreatedAt?: Date | string | null
): string {
  const fallback = getDefaultCustomFieldValue(type, taskCreatedAt)
  const nextValue = value === undefined ? fallback : value

  if (type === "MULTI_SELECT") {
    return JSON.stringify(Array.isArray(nextValue) ? nextValue : [])
  }

  if (type === "PLACE") {
    const placeValue = (nextValue ?? fallback) as Partial<PlaceFieldValue> | null
    return JSON.stringify({
      label: placeValue?.label ?? "",
      mapUrl: placeValue?.mapUrl ?? "",
    })
  }

  if (nextValue === null || nextValue === undefined) return ""
  return String(nextValue)
}

export function coerceCustomFieldValueForType(
  type: SupportedCustomFieldType,
  value: unknown,
  taskCreatedAt?: Date | string | null
): string | string[] | PlaceFieldValue {
  if (value === null || value === undefined || value === "") {
    return getDefaultCustomFieldValue(type, taskCreatedAt)
  }

  if (type === "MULTI_SELECT") {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean)
    }

    if (typeof value === "object") {
      const placeValue = value as Partial<PlaceFieldValue>
      if (typeof placeValue.label === "string" && placeValue.label.trim()) {
        return [placeValue.label.trim()]
      }
      return []
    }

    const normalized = String(value).trim()
    return normalized ? [normalized] : []
  }

  if (type === "PLACE") {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const placeValue = value as Partial<PlaceFieldValue>
      return {
        label: typeof placeValue.label === "string" ? placeValue.label : "",
        mapUrl: typeof placeValue.mapUrl === "string" ? placeValue.mapUrl : "",
      }
    }

    if (Array.isArray(value)) {
      return {
        label: String(value[0] ?? "").trim(),
        mapUrl: "",
      }
    }

    return {
      label: String(value).trim(),
      mapUrl: "",
    }
  }

  if (Array.isArray(value)) {
    return String(value[0] ?? "").trim()
  }

  if (typeof value === "object" && value !== null) {
    const placeValue = value as Partial<PlaceFieldValue>
    return typeof placeValue.label === "string" ? placeValue.label.trim() : ""
  }

  return String(value).trim()
}

export function parseCustomFieldValue(
  type: SupportedCustomFieldType,
  value: string | null | undefined,
  taskCreatedAt?: Date | string | null
): string | string[] | PlaceFieldValue {
  if (!value) {
    return getDefaultCustomFieldValue(type, taskCreatedAt)
  }

  if (type === "MULTI_SELECT") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
    } catch {
      return []
    }
  }

  if (type === "PLACE") {
    try {
      const parsed = JSON.parse(value) as Partial<PlaceFieldValue>
      return {
        label: parsed?.label ?? "",
        mapUrl: parsed?.mapUrl ?? "",
      }
    } catch {
      return { label: value, mapUrl: "" }
    }
  }

  return value
}

export function formatCustomFieldValueForExport(
  type: SupportedCustomFieldType,
  value: string | null | undefined
): string {
  const parsed = parseCustomFieldValue(type, value)

  if (Array.isArray(parsed)) return parsed.join("; ")
  if (typeof parsed === "object" && parsed !== null) {
    const place = parsed as PlaceFieldValue
    return [place.label, place.mapUrl].filter(Boolean).join(" - ")
  }
  return parsed
}
