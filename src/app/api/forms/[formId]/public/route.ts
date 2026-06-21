export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getFormAccessStatus } from "@/lib/form-access-schedule"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { formId } = await params

    const form = await prisma.form.findFirst({
      where: {
        OR: [
          { id: formId },
          { slug: formId },
        ],
      },
      select: {
        id: true,
        name: true,
        description: true,
        fields: true,
        branding: true,
        accessSchedule: true,
        isPublic: true,
        requireAuth: true,
        project: {
          select: {
            taskLists: {
              orderBy: { position: "asc" },
              select: { id: true, name: true },
            },
          },
        },
      },
    })

    if (!form) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 })
    }

    if (!form.isPublic) {
      return NextResponse.json({ error: "This form is not publicly accessible" }, { status: 403 })
    }

    const accessStatus = getFormAccessStatus(form.accessSchedule)
    if (!accessStatus.allowed) {
      return NextResponse.json(
        {
          error: accessStatus.message ?? "This form is not available right now.",
          accessSchedule: accessStatus.schedule,
        },
        { status: 403 }
      )
    }

    return NextResponse.json({
      ...form,
      taskLists: form.project.taskLists,
      project: undefined,
    })
  } catch (error) {
    console.error("Error fetching public form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
