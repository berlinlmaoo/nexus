import { notFound } from "next/navigation"
import prisma from "@/lib/prisma"
import { FormPublic } from "@/components/forms/form-public"
import type { FormField } from "@/components/forms/form-builder"

interface PublicFormPageProps {
  params: {
    formId: string
  }
}

export default async function PublicFormPage({ params }: PublicFormPageProps) {
  const form = await prisma.form.findFirst({
    where: {
      OR: [
        { id: params.formId },
        { slug: params.formId },
      ],
    },
    select: {
      id: true,
      name: true,
      description: true,
      fields: true,
      branding: true,
      isPublic: true,
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

  if (!form || !form.isPublic) {
    notFound()
  }

  return (
    <FormPublic
      formId={form.id}
      formName={form.name}
      formDescription={form.description}
      fields={(Array.isArray(form.fields) ? form.fields : []) as unknown as FormField[]}
      taskLists={form.project.taskLists}
      branding={(form.branding ?? null) as {
        logoUrl?: string
        primaryColor?: string
        backgroundColor?: string
        headerImage?: string
      } | null}
    />
  )
}
