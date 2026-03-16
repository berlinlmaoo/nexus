'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { FormPublic } from '@/components/forms/form-public'
import type { FormField as BuilderFormField } from '@/components/forms/form-builder'
import { Loader2 } from 'lucide-react'

interface FormField {
  id: string
  name: string
  type: string
  required: boolean
  options?: string[]
}

interface FormData {
  id: string
  name: string
  description: string | null
  fields: FormField[]
  isPublic: boolean
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
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (error || !form) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
        <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-zinc-900">Form Not Available</h2>
          <p className="mt-2 text-sm text-zinc-500">
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
    />
  )
}
