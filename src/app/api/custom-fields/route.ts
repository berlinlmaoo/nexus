import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import type { InputJsonValue } from "@prisma/client/runtime/client"
import {
  coerceCustomFieldValueForType,
  type CustomFieldOptionConfig,
  type PlaceFieldValue,
  type SupportedCustomFieldType,
  normalizeCustomFieldOptions,
  normalizeCustomFieldType,
  parseCustomFieldValue,
  serializeCustomFieldValue,
} from "@/lib/custom-fields"
import { seedTaskCustomFieldValues } from "@/lib/custom-field-sync"

interface CustomFieldResponseItem {
  id: string
  name: string
  type: SupportedCustomFieldType
  position: number
  options: CustomFieldOptionConfig | null
  value: string | string[] | PlaceFieldValue | null
}

async function requireProjectMember(userId: string, projectId: string) {
  return checkProjectAccess(userId, projectId, ["MEMBER"])
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get("projectId")
    const taskId = searchParams.get("taskId")

    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 })
    }

    const { allowed } = await requireProjectMember(session.user.id, projectId)
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let taskCreatedAt: Date | null = null
    if (taskId) {
      const task = await prisma.task.findFirst({
        where: {
          id: taskId,
          OR: [
            { taskList: { projectId } },
            { taskProjects: { some: { projectId } } },
          ],
        },
        select: { createdAt: true },
      })

      if (!task) {
        return NextResponse.json({ error: "Task not found in this project" }, { status: 404 })
      }

      taskCreatedAt = task.createdAt
      await seedTaskCustomFieldValues(taskId, projectId, task.createdAt)
    }

    const fields = taskId
      ? await prisma.customField.findMany({
          where: { projectId },
          include: {
            values: {
              where: { taskId },
              take: 1,
            },
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        })
      : await prisma.customField.findMany({
          where: { projectId },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        })

    const normalizedFields = fields
      .map((field) => {
        const normalizedType = normalizeCustomFieldType(field.type)
        if (!normalizedType) return null

        const currentValue = taskId
          ? ((field as typeof field & { values?: Array<{ value: string }> }).values?.[0]?.value ?? null)
          : null

        return {
          id: field.id,
          name: field.name,
          type: normalizedType,
          position: field.position,
          options: normalizeCustomFieldOptions(normalizedType, field.options),
          value: taskId
            ? parseCustomFieldValue(normalizedType, currentValue, taskCreatedAt)
            : null,
        }
      })
      .filter((field): field is CustomFieldResponseItem => field !== null)

    return NextResponse.json({ fields: normalizedFields })
  } catch (error) {
    console.error("Error fetching custom fields:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { name, type, projectId, options } = await req.json()
    if (!name || !type || !projectId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    const normalizedType = normalizeCustomFieldType(type)
    if (!normalizedType) {
      return NextResponse.json({ error: "Unsupported custom field type" }, { status: 400 })
    }

    const { allowed } = await requireProjectMember(session.user.id, projectId)
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const lastField = await prisma.customField.findFirst({
      where: { projectId },
      orderBy: [{ position: "desc" }, { id: "desc" }],
      select: { position: true },
    })

    const normalizedOptions = normalizeCustomFieldOptions(normalizedType, options)
    const normalizedOptionsJson = (normalizedOptions ?? undefined) as InputJsonValue | undefined

    const field = await prisma.customField.create({
      data: {
        name: String(name).trim(),
        type: normalizedType,
        options: normalizedOptionsJson,
        projectId,
        position: (lastField?.position ?? -1) + 1,
      },
    })

    logAudit({
      action: "create",
      entityType: "custom_field",
      entityId: field.id,
      entityName: field.name,
      userId: session.user.id,
      request: req,
      metadata: { projectId, type: normalizedType },
    })

    return NextResponse.json(
      {
        field: {
          id: field.id,
          name: field.name,
          type: normalizedType,
          position: field.position,
          options: normalizedOptions,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Error creating custom field:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()

    if (Array.isArray(body?.reorder) && body.projectId) {
      const { allowed } = await requireProjectMember(session.user.id, body.projectId)
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const orderedIds = body.reorder
        .map((item: { id?: string }) => item.id)
        .filter((id: unknown): id is string => Boolean(id))

      const fields = await prisma.customField.findMany({
        where: {
          projectId: body.projectId,
          id: { in: orderedIds },
        },
        select: { id: true },
      })

      if (fields.length !== orderedIds.length) {
        return NextResponse.json({ error: "Invalid field reorder request" }, { status: 400 })
      }

      await prisma.$transaction(
        orderedIds.map((id: string, index: number) =>
          prisma.customField.update({
            where: { id },
            data: { position: index },
          })
        )
      )

      return NextResponse.json({ success: true })
    }

    const { id, taskId, value, name, type, options, position } = body
    if (!id) {
      return NextResponse.json({ error: "Missing field id" }, { status: 400 })
    }

    const existingField = await prisma.customField.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        projectId: true,
      },
    })

    if (!existingField) {
      return NextResponse.json({ error: "Custom field not found" }, { status: 404 })
    }

    const { allowed } = await requireProjectMember(session.user.id, existingField.projectId)
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const normalizedType = normalizeCustomFieldType(type ?? existingField.type)
    if (!normalizedType) {
      return NextResponse.json({ error: "Unsupported custom field type" }, { status: 400 })
    }

    const normalizedOptionsJson =
      options !== undefined
        ? (normalizeCustomFieldOptions(normalizedType, options) ?? undefined) as InputJsonValue | undefined
        : undefined

    if (taskId) {
      const task = await prisma.task.findFirst({
        where: {
          id: taskId,
          OR: [
            { taskList: { projectId: existingField.projectId } },
            { taskProjects: { some: { projectId: existingField.projectId } } },
          ],
        },
        select: { id: true, createdAt: true },
      })

      if (!task) {
        return NextResponse.json({ error: "Task not found in this project" }, { status: 404 })
      }

      const fieldValue = await prisma.customFieldValue.upsert({
        where: {
          customFieldId_taskId: {
            customFieldId: id,
            taskId,
          },
        },
        update: {
          value: serializeCustomFieldValue(normalizedType, value, task.createdAt),
        },
        create: {
          customFieldId: id,
          taskId,
          value: serializeCustomFieldValue(normalizedType, value, task.createdAt),
        },
      })

      logAudit({
        action: "update",
        entityType: "custom_field_value",
        entityId: fieldValue.id,
        entityName: existingField.name,
        userId: session.user.id,
        request: req,
        metadata: { taskId, fieldId: id },
      })

      return NextResponse.json({
        fieldValue: {
          id: fieldValue.id,
          value: parseCustomFieldValue(normalizedType, fieldValue.value, task.createdAt),
        },
      })
    }

    const previousFieldType = normalizeCustomFieldType(existingField.type)

    const updatedField = await prisma.$transaction(async (tx) => {
      const nextField = await tx.customField.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: String(name).trim() } : {}),
          ...(type !== undefined ? { type: normalizedType } : {}),
          ...(options !== undefined ? { options: normalizedOptionsJson } : {}),
          ...(position !== undefined ? { position: Number(position) } : {}),
        },
      })

      if (type !== undefined && previousFieldType && previousFieldType !== normalizedType) {
        const existingValues = await tx.customFieldValue.findMany({
          where: { customFieldId: id },
          include: {
            task: {
              select: {
                createdAt: true,
              },
            },
          },
        })

        for (const fieldValue of existingValues) {
          const previousValue = parseCustomFieldValue(
            previousFieldType,
            fieldValue.value,
            fieldValue.task.createdAt
          )

          await tx.customFieldValue.update({
            where: { id: fieldValue.id },
            data: {
              value: serializeCustomFieldValue(
                normalizedType,
                coerceCustomFieldValueForType(
                  normalizedType,
                  previousValue,
                  fieldValue.task.createdAt
                ),
                fieldValue.task.createdAt
              ),
            },
          })
        }
      }

      return nextField
    })

    logAudit({
      action: "update",
      entityType: "custom_field",
      entityId: updatedField.id,
      entityName: updatedField.name,
      userId: session.user.id,
      request: req,
      metadata: { projectId: existingField.projectId },
    })

    const updatedFieldType = normalizeCustomFieldType(updatedField.type) || normalizedType

    return NextResponse.json({
      field: {
        id: updatedField.id,
        name: updatedField.name,
        type: updatedFieldType,
        position: updatedField.position,
        options: normalizeCustomFieldOptions(
          updatedFieldType,
          updatedField.options
        ),
      },
    })
  } catch (error) {
    console.error("Error updating custom field:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 })
    }

    const existingField = await prisma.customField.findUnique({
      where: { id },
      select: { id: true, name: true, projectId: true },
    })

    if (!existingField) {
      return NextResponse.json({ error: "Custom field not found" }, { status: 404 })
    }

    const { allowed } = await requireProjectMember(session.user.id, existingField.projectId)
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    await prisma.customField.delete({
      where: { id },
    })

    logAudit({
      action: "delete",
      entityType: "custom_field",
      entityId: id,
      entityName: existingField.name,
      userId: session.user.id,
      request: req,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting custom field:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
