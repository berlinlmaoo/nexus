export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getFormAccessStatus } from "@/lib/form-access-schedule"
import { numberFieldFormat } from "@/lib/custom-field-number"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { formResponseLimit, publicFormSettings, RESPONSE_LIMIT_MESSAGE } from "@/lib/form-settings"
import { categoryFieldForQuestion, isChoiceQuestion, questionOptions, selectFieldChoices } from "@/lib/form-category"

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
        settings: true,
        projectId: true,
        project: {
          select: {
            taskLists: {
              orderBy: { position: "asc" },
              select: { id: true, name: true },
            },
            customFields: { where: { type: { in: ["NUMBER", "SELECT"] } }, select: { id: true, name: true, type: true, options: true } },
          },
        },
      },
    })

    if (!form) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 })
    }

    if (!form.isPublic) {
      // "Project members only" (builder rebuild, 12 Oct 2026): the link opens for a signed-in member of the
      // form's project — submit/route.ts already let members send a private form. Everyone else: 403 as before.
      const session = await auth().catch(() => null)
      const userId = session?.user?.id
      const member = userId ? (await checkProjectAccess(userId, form.projectId, ["MEMBER"]).catch(() => ({ allowed: false }))).allowed : false
      if (!member) return NextResponse.json({ error: "This form is not publicly accessible" }, { status: 403 })
    }

    // Public but sign-in required (owner, 26 Oct 2026): a signed-out request gets the title and description only,
    // never the questions. The web shows "Sign in to fill in this form"; the apps always send a session.
    let signInRequired = false
    if (form.isPublic && form.requireAuth) {
      const session = await auth().catch(() => null)
      signInRequired = !session?.user?.id
    }

    const accessStatus = getFormAccessStatus(form.accessSchedule)
    // Response cap: shaped like a schedule refusal (`accessSchedule` present) so the web and the released
    // apps show it as "not open" with this message instead of "private or gone".
    const limit = formResponseLimit(form.settings)
    if (accessStatus.allowed && limit !== null && (await prisma.formSubmission.count({ where: { formId: form.id } })) >= limit) {
      return NextResponse.json({ error: RESPONSE_LIMIT_MESSAGE, accessSchedule: accessStatus.schedule, code: "RESPONSE_LIMIT" }, { status: 403 })
    }
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
      form.project.customFields.filter((cf) => cf.type === "NUMBER" && numberFieldFormat(cf.options) === "currency-idr").map((cf) => cf.id),
    )
    const fields = Array.isArray(form.fields)
      ? (form.fields as Array<Record<string, unknown>>).map((f) => {
          const mapping = f?.mapping as { target?: string; customFieldId?: string } | undefined
          // Except a question whose options are categories, not sections (sections became statuses, 12 Oct
          // 2026): it keeps its own options and submit/route.ts files the answer in the category field
          // (lib/form-category.ts). Without this the sender saw "To Do / On Progress / Done".
          if (mapping?.target === "task_list") {
            const categoryField = isChoiceQuestion(f.type) ? categoryFieldForQuestion(f.options, form.project.taskLists, form.project.customFields) : null
            if (!categoryField) return { ...f, options: liveSectionNames }
            return questionOptions(f.options).length ? f : { ...f, options: selectFieldChoices(categoryField.options) }
          }
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

    if (signInRequired) {
      return NextResponse.json({
        id: form.id,
        name: form.name,
        description: form.description,
        branding: form.branding,
        isPublic: form.isPublic,
        requireAuth: form.requireAuth,
        fields: [],
        settings: publicFormSettings(form.settings),
        taskLists: [],
        signInRequired: true,
      })
    }

    return NextResponse.json({
      ...form,
      fields,
      // Only what a respondent may see (never the notify list). Released apps ignore it.
      settings: publicFormSettings(form.settings),
      taskLists: form.project.taskLists,
      project: undefined,
      projectId: undefined,
    })
  } catch (error) {
    console.error("Error fetching public form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
