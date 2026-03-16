import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import type { InputJsonValue } from "@prisma/client/runtime/client"

interface BundleConfig {
  sections?: { name: string; position?: number }[]
  customFields?: { name: string; type: string; options?: unknown }[]
  automations?: { name: string; trigger: unknown; action: unknown; condition?: unknown }[]
  taskTemplates?: { title: string; description?: string; status?: string; priority?: string; sectionIndex?: number }[]
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { projectId } = await params
    const { bundleId } = await req.json()

    if (!bundleId) return NextResponse.json({ error: "bundleId required" }, { status: 400 })

    // Verify project access
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { members: { where: { userId: session.user.id } } },
    })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
    if (project.members.length === 0) return NextResponse.json({ error: "Access denied" }, { status: 403 })

    // Get bundle
    const bundle = await prisma.workflowBundle.findUnique({ where: { id: bundleId } })
    if (!bundle) return NextResponse.json({ error: "Bundle not found" }, { status: 404 })

    const config = bundle.config as unknown as BundleConfig
    const results: { sections: number; customFields: number; automations: number; tasks: number } = {
      sections: 0, customFields: 0, automations: 0, tasks: 0,
    }

    // Create sections (TaskLists)
    const createdSections: string[] = []
    if (config.sections?.length) {
      for (let i = 0; i < config.sections.length; i++) {
        const section = config.sections[i]
        const taskList = await prisma.taskList.create({
          data: {
            name: section.name,
            position: section.position ?? i,
            projectId,
          },
        })
        createdSections.push(taskList.id)
        results.sections++
      }
    }

    // Create custom fields
    if (config.customFields?.length) {
      for (const field of config.customFields) {
        await prisma.customField.create({
          data: {
            name: field.name,
            type: (field.type || "TEXT") as "TEXT" | "NUMBER" | "DATE" | "DROPDOWN" | "PEOPLE" | "CHECKBOX" | "RATING",
            options: field.options ? (field.options as InputJsonValue) : undefined,
            projectId,
          },
        })
        results.customFields++
      }
    }

    // Create automation rules
    if (config.automations?.length) {
      for (const auto of config.automations) {
        await prisma.automation.create({
          data: {
            name: auto.name,
            trigger: auto.trigger as InputJsonValue,
            action: auto.action as InputJsonValue,
            condition: auto.condition ? (auto.condition as InputJsonValue) : undefined,
            projectId,
          },
        })
        results.automations++
      }
    }

    // Create task templates
    if (config.taskTemplates?.length) {
      for (const tmpl of config.taskTemplates) {
        const targetListId = tmpl.sectionIndex !== undefined && createdSections[tmpl.sectionIndex]
          ? createdSections[tmpl.sectionIndex]
          : createdSections[0]

        if (!targetListId) {
          // Need at least one section; get existing or skip
          const existingList = await prisma.taskList.findFirst({
            where: { projectId },
            orderBy: { position: "asc" },
          })
          if (!existingList) continue

          await prisma.task.create({
            data: {
              title: tmpl.title,
              description: tmpl.description,
              status: (tmpl.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED") || "TODO",
              priority: (tmpl.priority as "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE") || "MEDIUM",
              taskListId: existingList.id,
              creatorId: session.user.id,
            },
          })
        } else {
          await prisma.task.create({
            data: {
              title: tmpl.title,
              description: tmpl.description,
              status: (tmpl.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED") || "TODO",
              priority: (tmpl.priority as "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE") || "MEDIUM",
              taskListId: targetListId,
              creatorId: session.user.id,
            },
          })
        }
        results.tasks++
      }
    }

    logAudit({
      action: "create",
      entityType: "workflow_bundle_apply",
      entityId: projectId,
      entityName: bundle.name,
      userId: session.user.id,
      request: req,
      metadata: { bundleId, results },
    })

    return NextResponse.json({ success: true, applied: bundle.name, results })
  } catch (error) {
    console.error("Apply bundle error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
