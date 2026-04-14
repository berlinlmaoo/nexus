import { format } from "date-fns"
import {
  normalizeCustomFieldType,
  parseCustomFieldValue,
  type SupportedCustomFieldType,
} from "@/lib/custom-fields"

export interface TaskCardCustomFieldChip {
  id: string
  fieldId: string
  fieldName: string
  fieldType: SupportedCustomFieldType
  label: string
}

export function buildTaskCardCustomFieldChips(
  values: Array<{
    customFieldId: string
    value: string
    customField: {
      name: string
      type: string
    }
  }>,
  taskCreatedAt?: Date | string | null
): TaskCardCustomFieldChip[] {
  const chips: TaskCardCustomFieldChip[] = []

  for (const fieldValue of values) {
    const normalizedType = normalizeCustomFieldType(fieldValue.customField.type)
    if (!normalizedType) continue

    const parsed = parseCustomFieldValue(normalizedType, fieldValue.value, taskCreatedAt)
    const fieldName = fieldValue.customField.name

    if (Array.isArray(parsed)) {
      for (const option of parsed.filter(Boolean)) {
        chips.push({
          id: `${fieldValue.customFieldId}:${option}`,
          fieldId: fieldValue.customFieldId,
          fieldName,
          fieldType: normalizedType,
          label: option,
        })
      }
      continue
    }

    if (typeof parsed === "object" && parsed !== null) {
      if ("label" in parsed && typeof parsed.label === "string" && parsed.label.trim()) {
        chips.push({
          id: fieldValue.customFieldId,
          fieldId: fieldValue.customFieldId,
          fieldName,
          fieldType: normalizedType,
          label: parsed.label.trim(),
        })
      }
      continue
    }

    const raw = String(parsed ?? "").trim()
    if (!raw) continue

    let label = raw
    if ((normalizedType === "DATE" || normalizedType === "CREATED") && !Number.isNaN(new Date(raw).getTime())) {
      const date = new Date(raw)
      label = date.getHours() !== 0 || date.getMinutes() !== 0
        ? format(date, "MMM d • HH:mm")
        : format(date, "MMM d")
    }

    chips.push({
      id: fieldValue.customFieldId,
      fieldId: fieldValue.customFieldId,
      fieldName,
      fieldType: normalizedType,
      label,
    })
  }

  return chips
}
