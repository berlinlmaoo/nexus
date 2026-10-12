export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getFormAccessStatus } from "@/lib/form-access-schedule"
import { numberFieldFormat } from "@/lib/custom-field-number"

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
            customFields: { where: { type: "NUMBER" }, select: { id: true, options: true } },
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

    // AUTO-SYNC: any dropdown mapped to `task_list` (the "Divisi" field) gets its options from the
    // project's CURRENT sections — so adding/removing/moving a section is reflected instantly, no need
    // to re-edit the form. (Routing is by section NAME, so live names stay valid.)
    const liveSectionNames = form.project.taskLists.map((tl) => tl.name)
    // A number question that fills a Rupiah custom field is a Rupiah question even when the builder left
    // it "Plain" (the finance forms' "Harga": people typed "369.000" into a bare number box and the board
    // showed Rp 369). Web, iOS and Android all render numberFormat "currency-idr" as an Rp input.
    const rupiahFieldIds = new Set(
      form.project.customFields.filter((cf) => numberFieldFormat(cf.options) === "currency-idr").map((cf) => cf.id),
    )
    const fields = Array.isArray(form.fields)
      ? (form.fields as Array<Record<string, unknown>>).map((f) => {
          const mapping = f?.mapping as { target?: string; customFieldId?: string } | undefined
          if (mapping?.target === "task_list") return { ...f, options: liveSectionNames }
          if (
            f?.type === "number" &&
            !f.numberFormat &&
            mapping?.target === "custom_field" &&
            mapping.customFieldId &&
            rupiahFieldIds.has(mapping.customFieldId)
          ) {
            return { ...f, numberFormat: "currency-idr" }
          }
          return f
        })
      : form.fields

    return NextResponse.json({
      ...form,
      fields,
      taskLists: form.project.taskLists,
      project: undefined,
    })
  } catch (error) {
    console.error("Error fetching public form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
