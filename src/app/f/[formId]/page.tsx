'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { FormPublic } from '@/components/forms/form-public'
import type { FormField as BuilderFormField } from '@/components/forms/form-builder'
import { Loader2 } from 'lucide-react'
import type { FormAccessSchedule } from '@/lib/form-access-schedule'

interface FormField {
  id: string
  name: string
  type: string
  required: boolean
  options?: string[]
}

interface FormBranding {
  logoUrl?: string
  primaryColor?: string
  backgroundColor?: string
  headerImage?: string
}

interface TaskListOption {
  id: string
  name: string
}

interface FormData {
  id: string
  name: string
  description: string | null
  fields: FormField[]
  isPublic: boolean
  accessSchedule?: FormAccessSchedule | null
  branding?: FormBranding | null
  taskLists?: TaskListOption[]
}

export default function PublicFormPage() {
  const params = useParams()
  const formId = params?.formId as string
  const [form, setForm] = useState<FormData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!formId) return

    fetch(`/api/forms/${formId}/public`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error || 'Form not found')
        }
        return res.json()
      })
      .then((data) => setForm(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [formId])

  if (loading) {
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !form) {
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-background p-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-on-surface">Form Not Available</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {error || 'This form does not exist or is not publicly accessible.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <FormPublic
      formId={form.id}
      formName={form.name}
      formDescription={form.description}
      fields={form.fields as BuilderFormField[]}
      accessSchedule={form.accessSchedule}
      branding={form.branding}
      taskLists={form.taskLists ?? []}
    />
  )
}
