import prisma from "../src/lib/prisma"

type FormMappingTarget =
  | "none"
  | "task_title"
  | "task_description"
  | "task_due_date"
  | "task_status"
  | "task_priority"
  | "task_list"
  | "custom_field"

interface IntakeFormField {
  id: string
  name: string
  mapping?: {
    target?: FormMappingTarget
  }
  showIf?: {
    fieldId: string
    operator: "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty"
    value: string
  }
}

function getFieldValue(data: Record<string, unknown>, field: IntakeFormField) {
  return data[field.id] ?? data[field.name]
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return ""
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value).trim()
}

function normalizeValueList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean)
  return [normalizeText(value)]
}

function evaluateCondition(field: IntakeFormField, data: Record<string, unknown>) {
  if (!field.showIf) return true
  const fieldValues = normalizeValueList(data[field.showIf.fieldId])
  const fieldValue = fieldValues.join(", ")
  const expected = String(field.showIf.value ?? "")

  switch (field.showIf.operator) {
    case "equals":
      return fieldValues.includes(expected)
    case "not_equals":
      return !fieldValues.includes(expected)
    case "contains":
      return fieldValue.toLowerCase().includes(expected.toLowerCase())
    case "is_empty":
      return !fieldValue
    case "is_not_empty":
      return !!fieldValue
    default:
      return true
  }
}

function buildSubmissionSummary(fields: IntakeFormField[], data: Record<string, unknown>) {
  return fields
    .filter((field) => field.mapping?.target !== "task_title" && field.mapping?.target !== "task_description")
    .map((field) => {
      const value = normalizeText(getFieldValue(data, field))
      return value ? `- ${field.name}: ${value}` : null
    })
    .filter(Boolean)
    .join("\n")
}

function buildTaskDescriptionFromFields(fields: IntakeFormField[], data: Record<string, unknown>) {
  const descriptionFields = fields.filter((field) => field.mapping?.target === "task_description")
  const filledDescriptions = descriptionFields
    .map((field) => {
      const value = normalizeText(getFieldValue(data, field))
      if (!value) return null
      return descriptionFields.length === 1 ? value : `${field.name}:\n${value}`
    })
    .filter(Boolean)

  return filledDescriptions.join("\n\n")
}

async function main() {
  const formName = process.argv.slice(2).join(" ").trim()
  if (!formName) {
    throw new Error("Usage: npx tsx scripts/backfill-form-core-intelligence.ts <form name contains>")
  }

  const forms = await prisma.form.findMany({
    where: { name: { contains: formName, mode: "insensitive" } },
    include: {
      submissions: {
        where: { taskId: { not: null } },
        include: { task: { select: { id: true, title: true, description: true } } },
      },
    },
  })

  let updated = 0

  for (const form of forms) {
    const fields = Array.isArray(form.fields) ? (form.fields as unknown as IntakeFormField[]) : []

    for (const submission of form.submissions) {
      if (!submission.task) continue
      const data = submission.data as Record<string, unknown>
      const visibleFields = fields.filter((field) => evaluateCondition(field, data))
      const descriptionFromField = buildTaskDescriptionFromFields(visibleFields, data)
      const summary = buildSubmissionSummary(visibleFields, data)
      const nextDescription = [
        descriptionFromField,
        summary ? `Submitted via form "${form.name}"\n\n${summary}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")

      if (!nextDescription || nextDescription === submission.task.description) continue

      await prisma.task.update({
        where: { id: submission.task.id },
        data: { description: nextDescription },
      })
      updated += 1
      console.log(`Updated ${submission.task.title} (${submission.task.id})`)
    }
  }

  console.log(`Backfill complete. Updated ${updated} task(s).`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
