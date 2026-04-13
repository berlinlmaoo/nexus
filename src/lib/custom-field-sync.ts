import prisma from "@/lib/prisma"
import {
  normalizeCustomFieldType,
  serializeCustomFieldValue,
} from "@/lib/custom-fields"

export async function seedTaskCustomFieldValues(
  taskId: string,
  projectId: string,
  taskCreatedAt?: Date | string | null
) {
  const customFields = await prisma.customField.findMany({
    where: { projectId },
    select: {
      id: true,
      type: true,
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  })

  if (customFields.length === 0) return

  const existingValues = await prisma.customFieldValue.findMany({
    where: {
      taskId,
      customFieldId: {
        in: customFields.map((field) => field.id),
      },
    },
    select: { customFieldId: true },
  })

  const existingFieldIds = new Set(existingValues.map((value) => value.customFieldId))

  const valuesToCreate = customFields
    .map((field) => {
      const normalizedType = normalizeCustomFieldType(field.type)
      if (!normalizedType || existingFieldIds.has(field.id)) return null

      return {
        customFieldId: field.id,
        taskId,
        value: serializeCustomFieldValue(normalizedType, undefined, taskCreatedAt),
      }
    })
    .filter((value): value is { customFieldId: string; taskId: string; value: string } => Boolean(value))

  if (valuesToCreate.length === 0) return

  await prisma.customFieldValue.createMany({
    data: valuesToCreate,
    skipDuplicates: true,
  })
}
