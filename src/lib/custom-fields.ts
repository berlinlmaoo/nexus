export const SUPPORTED_CUSTOM_FIELD_TYPES = [
  "TEXT",
  "URL",
  "FILE",
  "NUMBER",
  "SELECT",
  "MULTI_SELECT",
  "STATUS",
  "DATE",
  "CREATED",
  "PLACE",
] as const

export type SupportedCustomFieldType = (typeof SUPPORTED_CUSTOM_FIELD_TYPES)[number]
export type NumberCustomFieldFormat = "plain" | "currency-idr"
export type CustomFieldDisplayFormat = "name-and-map-link" | "currency-idr"
export type CustomStatusTone = "yellow" | "green" | "red" | "gray" | "blue"

export interface CustomFieldOptionConfig {
  options?: string[]
  optionTemplates?: Record<string, string>
  defaultSource?: "taskCreatedAt"
  editable?: boolean
  format?: CustomFieldDisplayFormat
}

export interface CreatedFieldMetadata {
  userName: string
  timestamp: string
}

const CREATED_FIELD_TIMEZONE = "Asia/Jakarta"

export interface PlaceFieldValue {
  label: string
  mapUrl: string
}

export interface FileFieldEntry {
  url: string
  name: string
}
export type FileFieldValue = FileFieldEntry[]

function toFileEntries(value: unknown): FileFieldValue {
  if (!Array.isArray(value)) return []
  return value
    .map((v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? { url: String((v as { url?: unknown }).url ?? "").trim(), name: String((v as { name?: unknown }).name ?? "").trim() }
        : null,
    )
    .filter((v): v is FileFieldEntry => !!v && v.url.length > 0)
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
  if (type === "NUMBER") {
    const rawFormat =
      typeof options === "string"
        ? options
        : typeof (options as { format?: unknown } | null)?.format === "string"
          ? String((options as { format: string }).format)
          : ""

    const normalizedFormat = rawFormat.toLowerCase().trim()
    if (normalizedFormat === "currency-idr" || normalizedFormat === "idr" || normalizedFormat === "rupiah") {
      return { format: "currency-idr" }
    }

    return null
  }

  if (type === "SELECT" || type === "MULTI_SELECT" || type === "STATUS") {
    const rawOptions = Array.isArray(options)
      ? options
      : Array.isArray((options as { options?: unknown[] } | null)?.options)
        ? (options as { options: unknown[] }).options
        : []
    const rawOptionTemplates =
      typeof (options as { optionTemplates?: unknown } | null)?.optionTemplates === "object" &&
      (options as { optionTemplates?: unknown } | null)?.optionTemplates !== null &&
      !Array.isArray((options as { optionTemplates?: unknown } | null)?.optionTemplates)
        ? ((options as { optionTemplates: Record<string, unknown> }).optionTemplates)
        : {}

    const normalizedOptions = rawOptions
      .map((option) => String(option).trim())
      .filter(Boolean)

    if (type === "STATUS" && normalizedOptions.length === 0) {
      return {
        options: ["On Progress", "Done"],
      }
    }

    if (type !== "SELECT") {
      return { options: normalizedOptions }
    }

    const optionTemplates = normalizedOptions.reduce<Record<string, string>>((acc, option) => {
      const template = String(rawOptionTemplates[option] ?? "").trim()
      if (template) {
        acc[option] = template
      }
      return acc
    }, {})

    return {
      options: normalizedOptions,
      ...(Object.keys(optionTemplates).length > 0 ? { optionTemplates } : {}),
    }
  }

  if (type === "CREATED") {
    return {
      defaultSource: "taskCreatedAt",
      editable: false,
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
): string | string[] | PlaceFieldValue | FileFieldValue {
  if (type === "MULTI_SELECT") return []
  if (type === "FILE") return []
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

  if (type === "FILE") {
    return JSON.stringify(toFileEntries(nextValue))
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
): string | string[] | PlaceFieldValue | FileFieldValue {
  if (value === null || value === undefined || value === "") {
    return getDefaultCustomFieldValue(type, taskCreatedAt)
  }

  if (type === "FILE") {
    return toFileEntries(value)
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
): string | string[] | PlaceFieldValue | FileFieldValue {
  if (!value) {
    return getDefaultCustomFieldValue(type, taskCreatedAt)
  }

  if (type === "FILE") {
    try {
      return toFileEntries(JSON.parse(value))
    } catch {
      return []
    }
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

  if (Array.isArray(parsed)) {
    return parsed
      .map((p) => (p && typeof p === "object" ? (p as FileFieldEntry).name || (p as FileFieldEntry).url : String(p)))
      .join("; ")
  }
  if (typeof parsed === "object" && parsed !== null) {
    const place = parsed as PlaceFieldValue
    return [place.label, place.mapUrl].filter(Boolean).join(" - ")
  }
  return parsed
}

export function getNumberCustomFieldFormat(options: CustomFieldOptionConfig | null | undefined): NumberCustomFieldFormat {
  return options?.format === "currency-idr" ? "currency-idr" : "plain"
}

export function normalizeCustomFieldNumberInput(
  value: string | null | undefined,
  options: CustomFieldOptionConfig | null | undefined
): string {
  const raw = String(value ?? "")

  if (getNumberCustomFieldFormat(options) === "currency-idr") {
    return raw.replace(/\D+/g, "")
  }

  return raw
}

export function getCustomStatusTone(value: string | null | undefined): CustomStatusTone {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")

  if (!normalized) return "gray"

  if (
    normalized === "done" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "selesai"
  ) {
    return "green"
  }

  if (
    normalized === "on progress" ||
    normalized === "in progress" ||
    normalized === "progress" ||
    normalized === "ongoing" ||
    normalized === "sedang berjalan"
  ) {
    return "yellow"
  }

  if (normalized === "blocked" || normalized === "stuck" || normalized === "terhambat") {
    return "red"
  }

  if (normalized === "not started" || normalized === "todo" || normalized === "to do") {
    return "gray"
  }

  return "blue"
}

export function getCustomStatusToneClassName(value: string | null | undefined): string {
  const tone = getCustomStatusTone(value)

  if (tone === "green") return "border-emerald-200 bg-emerald-100 text-emerald-800"
  if (tone === "yellow") return "border-amber-200 bg-amber-100 text-amber-800"
  if (tone === "red") return "border-red-200 bg-red-100 text-red-700"
  if (tone === "blue") return "border-sky-200 bg-sky-100 text-sky-700"
  return "border-border/80 bg-muted/70 text-muted-foreground"
}

export function formatCreatedFieldValue(
  value: string | null | undefined,
  metadata?: CreatedFieldMetadata | null
): string {
  const timestamp = String(value ?? metadata?.timestamp ?? "").trim()
  const actorName = String(metadata?.userName ?? "").trim()

  if (!timestamp) {
    return actorName || ""
  }

  const date = new Date(timestamp)
  const timeLabel = Number.isNaN(date.getTime())
    ? timestamp
    : formatCreatedFieldTimestamp(timestamp)

  return actorName ? `${actorName} • ${timeLabel}` : timeLabel
}

export function formatCreatedFieldTimestamp(value: string | null | undefined): string {
  const timestamp = String(value ?? "").trim()
  if (!timestamp) return ""

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return timestamp
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: CREATED_FIELD_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${lookup.day} ${lookup.month} ${lookup.year} • ${lookup.hour}:${lookup.minute}`
}

export function formatCustomFieldNumberValue(
  value: string | number | null | undefined,
  options: CustomFieldOptionConfig | null | undefined
): string {
  const raw = String(value ?? "").trim()
  if (!raw) return ""

  if (getNumberCustomFieldFormat(options) === "currency-idr") {
    const digits = normalizeCustomFieldNumberInput(raw, options)
    if (!digits) return ""

    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(Number(digits))
  }

  return raw
}
