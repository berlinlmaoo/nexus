export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import type { InputJsonValue } from "@prisma/client/runtime/client"
import {
  coerceCustomFieldValueForType,
  type CreatedFieldMetadata,
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
  projectId: string
  libraryId?: string | null
  libraryName?: string | null
  libraryUsageCount?: number
  name: string
  type: SupportedCustomFieldType
  position: number
  options: CustomFieldOptionConfig | null
  value: string | string[] | PlaceFieldValue | null
  createdMeta?: CreatedFieldMetadata | null
}

async function requireProjectMember(userId: string, projectId: string) {
  return checkProjectAccess(userId, projectId, ["MEMBER"])
}

async function getProjectWorkspace(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, workspaceId: true },
  })
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
    const includeLibrary = searchParams.get("includeLibrary") === "1"

    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 })
    }

    const { allowed } = await requireProjectMember(session.user.id, projectId)
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const project = await getProjectWorkspace(projectId)
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    let taskCreatedAt: Date | null = null
    let taskCreatorName: string | null = null
    if (taskId) {
      const task = await prisma.task.findFirst({
        where: {
          id: taskId,
          OR: [
            { taskList: { projectId } },
            { taskProjects: { some: { projectId } } },
          ],
        },
        select: {
          createdAt: true,
          creator: {
            select: {
              name: true,
            },
          },
        },
      })

      if (!task) {
        return NextResponse.json({ error: "Task not found in this project" }, { status: 404 })
      }

      taskCreatedAt = task.createdAt
      taskCreatorName = task.creator.name
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
            library: {
              select: {
                id: true,
                name: true,
                _count: { select: { fields: true } },
              },
            },
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        })
      : await prisma.customField.findMany({
          where: { projectId },
          include: {
            library: {
              select: {
                id: true,
                name: true,
                _count: { select: { fields: true } },
              },
            },
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        })

    const normalizedFields = fields
      .map((field: any) => {
        const normalizedType = normalizeCustomFieldType(field.type)
        if (!normalizedType) return null

        const currentValue = taskId
          ? ((field as typeof field & { values?: Array<{ value: string }> }).values?.[0]?.value ?? null)
          : null

        return {
          id: field.id,
          projectId,
          libraryId: field.libraryId ?? null,
          libraryName: field.library?.name ?? null,
          libraryUsageCount: field.library?._count?.fields ?? 0,
          name: field.name,
          type: normalizedType,
          position: field.position,
          options: normalizeCustomFieldOptions(normalizedType, field.options),
          value: taskId
            ? parseCustomFieldValue(normalizedType, currentValue, taskCreatedAt)
            : null,
          ...(taskId && normalizedType === "CREATED"
            ? {
                createdMeta: {
                  userName: taskCreatorName || "Unknown",
                  timestamp: taskCreatedAt?.toISOString() || "",
                },
              }
            : {}),
        }
      })
      .filter((field: CustomFieldResponseItem | null): field is CustomFieldResponseItem => field !== null)

    const libraryFields = includeLibrary
      ? await prisma.customFieldLibrary.findMany({
          where: { workspaceId: project.workspaceId },
          select: {
            id: true,
            name: true,
            type: true,
            options: true,
            sourceProjectId: true,
            _count: { select: { fields: true } },
            fields: {
              where: { projectId },
              select: { id: true },
              take: 1,
            },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        })
      : []

    const normalizedLibraryFields = libraryFields
      .map((field: any) => {
        const normalizedType = normalizeCustomFieldType(field.type)
        if (!normalizedType) return null
        return {
          id: field.id,
          name: field.name,
          type: normalizedType,
          options: normalizeCustomFieldOptions(normalizedType, field.options),
          sourceProjectId: field.sourceProjectId,
          usageCount: field._count?.fields ?? 0,
          attachedFieldId: field.fields?.[0]?.id ?? null,
          isAttached: Boolean(field.fields?.[0]),
        }
      })
      .filter(Boolean)

    return NextResponse.json({ fields: normalizedFields, libraryFields: normalizedLibraryFields })
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

    const { name, type, projectId, options, libraryId, saveToLibrary } = await req.json()
    if ((!libraryId && (!name || !type)) || !projectId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    const { allowed } = await requireProjectMember(session.user.id, projectId)
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const project = await getProjectWorkspace(projectId)
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const lastField = await prisma.customField.findFirst({
      where: { projectId },
      orderBy: [{ position: "desc" }, { id: "desc" }],
      select: { position: true },
    })

    let fieldName = String(name ?? "").trim()
    let normalizedType = normalizeCustomFieldType(type)
    let normalizedOptions: CustomFieldOptionConfig | null = null
    let linkedLibraryId: string | null = null

    if (libraryId) {
      const libraryField = await prisma.customFieldLibrary.findFirst({
        where: { id: String(libraryId), workspaceId: project.workspaceId },
        select: { id: true, name: true, type: true, options: true },
      })

      if (!libraryField) {
        return NextResponse.json({ error: "Library field not found" }, { status: 404 })
      }

      const existingLinkedField = await prisma.customField.findFirst({
        where: { projectId, libraryId: libraryField.id },
        select: { id: true },
      })

      if (existingLinkedField) {
        return NextResponse.json({ error: "Library field already used in this project" }, { status: 409 })
      }

      fieldName = libraryField.name
      normalizedType = normalizeCustomFieldType(libraryField.type)
      normalizedOptions = normalizedType ? normalizeCustomFieldOptions(normalizedType, libraryField.options) : null
      linkedLibraryId = libraryField.id
    } else {
      if (!normalizedType) {
        return NextResponse.json({ error: "Unsupported custom field type" }, { status: 400 })
      }
      normalizedOptions = normalizeCustomFieldOptions(normalizedType, options)

      if (saveToLibrary) {
        const libraryField = await prisma.customFieldLibrary.create({
          data: {
            name: fieldName,
            type: normalizedType,
            options: (normalizedOptions ?? undefined) as InputJsonValue | undefined,
            workspaceId: project.workspaceId,
            sourceProjectId: projectId,
          },
          select: { id: true },
        })
        linkedLibraryId = libraryField.id
      }
    }

    if (!normalizedType) {
      return NextResponse.json({ error: "Unsupported custom field type" }, { status: 400 })
    }

    const normalizedOptionsJson = (normalizedOptions ?? undefined) as InputJsonValue | undefined

    const field = await prisma.customField.create({
      data: {
        name: fieldName,
        type: normalizedType,
        options: normalizedOptionsJson,
        projectId,
        libraryId: linkedLibraryId,
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
      metadata: { projectId, type: normalizedType, libraryId: linkedLibraryId },
    })

    return NextResponse.json(
      {
        field: {
          id: field.id,
          projectId,
          libraryId: field.libraryId,
          libraryName: linkedLibraryId ? field.name : null,
          libraryUsageCount: linkedLibraryId ? 1 : 0,
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

    const { id, taskId, value, name, type, options, position, promoteToLibrary } = body
    if (!id) {
      return NextResponse.json({ error: "Missing field id" }, { status: 400 })
    }

    const existingField = await prisma.customField.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        options: true,
        projectId: true,
        libraryId: true,
        project: {
          select: {
            workspaceId: true,
          },
        },
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
        select: {
          id: true,
          createdAt: true,
          creator: {
            select: {
              name: true,
            },
          },
        },
      })

      if (!task) {
        return NextResponse.json({ error: "Task not found in this project" }, { status: 404 })
      }

      const serializedValue =
        normalizedType === "CREATED"
          ? serializeCustomFieldValue(normalizedType, undefined, task.createdAt)
          : serializeCustomFieldValue(normalizedType, value, task.createdAt)

      const fieldValue = await prisma.customFieldValue.upsert({
        where: {
          customFieldId_taskId: {
            customFieldId: id,
            taskId,
          },
        },
        update: {
          value: serializedValue,
        },
        create: {
          customFieldId: id,
          taskId,
          value: serializedValue,
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
          ...(normalizedType === "CREATED"
            ? {
                createdMeta: {
                  userName: task.creator.name,
                  timestamp: task.createdAt.toISOString(),
                },
              }
            : {}),
        },
      })
    }

    const previousFieldType = normalizeCustomFieldType(existingField.type)
    const nextName = name !== undefined ? String(name).trim() : existingField.name

    const updatedField = await prisma.$transaction(async (tx: any) => {
      let libraryId = existingField.libraryId

      if (promoteToLibrary && !libraryId) {
        const libraryField = await tx.customFieldLibrary.create({
          data: {
            name: nextName,
            type: normalizedType,
            options: normalizedOptionsJson ?? (existingField.options as InputJsonValue | undefined),
            workspaceId: existingField.project.workspaceId,
            sourceProjectId: existingField.projectId,
          },
          select: { id: true },
        })
        libraryId = libraryField.id
      }

      if (libraryId && (name !== undefined || type !== undefined || options !== undefined || promoteToLibrary)) {
        await tx.customFieldLibrary.update({
          where: { id: libraryId },
          data: {
            ...(name !== undefined || promoteToLibrary ? { name: nextName } : {}),
            ...(type !== undefined || promoteToLibrary ? { type: normalizedType } : {}),
            ...(options !== undefined || promoteToLibrary ? { options: normalizedOptionsJson } : {}),
          },
        })
      }

      const linkedFieldIds = libraryId
        ? (await tx.customField.findMany({
            where: { libraryId },
            select: { id: true },
          })).map((field: { id: string }) => field.id)
        : [id]

      if (!linkedFieldIds.includes(id)) linkedFieldIds.push(id)

      await tx.customField.updateMany({
        where: { id: { in: linkedFieldIds } },
        data: {
          ...(name !== undefined || promoteToLibrary ? { name: nextName } : {}),
          ...(type !== undefined || promoteToLibrary ? { type: normalizedType } : {}),
          ...(options !== undefined || promoteToLibrary ? { options: normalizedOptionsJson } : {}),
          ...(promoteToLibrary ? { libraryId } : {}),
        },
      })

      if (position !== undefined) {
        await tx.customField.update({
          where: { id },
          data: { position: Number(position) },
        })
      }

      if (type !== undefined && previousFieldType && previousFieldType !== normalizedType) {
        const existingValues = await tx.customFieldValue.findMany({
          where: { customFieldId: { in: linkedFieldIds } },
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

      return tx.customField.findUnique({
        where: { id },
        include: {
          library: {
            select: {
              id: true,
              name: true,
              _count: { select: { fields: true } },
            },
          },
        },
      })
    })

    logAudit({
      action: "update",
      entityType: "custom_field",
      entityId: updatedField.id,
      entityName: updatedField.name,
      userId: session.user.id,
      request: req,
      metadata: { projectId: existingField.projectId, libraryId: updatedField?.libraryId ?? null },
    })

    const updatedFieldType = normalizeCustomFieldType(updatedField?.type) || normalizedType

    return NextResponse.json({
      field: {
        id: updatedField?.id ?? id,
        projectId: existingField.projectId,
        libraryId: updatedField?.libraryId ?? null,
        libraryName: updatedField?.library?.name ?? null,
        libraryUsageCount: updatedField?.library?._count?.fields ?? 0,
        name: updatedField?.name ?? nextName,
        type: updatedFieldType,
        position: updatedField?.position ?? Number(position ?? 0),
        options: normalizeCustomFieldOptions(
          updatedFieldType,
          updatedField?.options
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
