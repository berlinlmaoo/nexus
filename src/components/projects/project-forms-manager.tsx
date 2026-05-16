"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, ClipboardList, Copy, ExternalLink, FileText, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FormBuilder, type FormField } from "@/components/forms/form-builder"
import { FormSubmissions } from "@/components/forms/form-submissions"

interface ProjectForm {
  id: string
  name: string
  slug?: string | null
  description: string | null
  fields: FormField[]
  isPublic: boolean
  createdAt: string
  _count?: {
    submissions: number
  }
}

export function ProjectFormsManager({ projectId }: { projectId: string }) {
  const [forms, setForms] = useState<ProjectForm[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedForm, setSelectedForm] = useState<ProjectForm | null>(null)
  const [creating, setCreating] = useState(false)
  const [origin, setOrigin] = useState("")
  const [deleting, setDeleting] = useState(false)

  const loadForms = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/forms?projectId=${projectId}`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load forms")
      const data = await res.json()
      setForms(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error("Failed to load project forms:", error)
      toast.error("Failed to load project forms")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadForms()
  }, [loadForms])

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const publicUrl = selectedForm && origin ? `${origin}/forms/${selectedForm.slug || selectedForm.id}` : ""

  const handleSaved = () => {
    setCreating(false)
    setSelectedForm(null)
    loadForms()
  }

  const handleDelete = async () => {
    if (!selectedForm) return

    const confirmed = window.confirm(
      `Delete form "${selectedForm.name}"? This will also remove its submission history.`
    )
    if (!confirmed) return

    try {
      setDeleting(true)
      const res = await fetch(`/api/forms/${selectedForm.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? "Failed to delete form")
      }

      toast.success("Form deleted")
      setSelectedForm(null)
      setCreating(false)
      await loadForms()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete form")
    } finally {
      setDeleting(false)
    }
  }

  if (creating || selectedForm) {
    return (
      <section className="rounded-2xl border bg-card/80 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setCreating(false)
              setSelectedForm(null)
            }}
            className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to forms
          </button>

          {selectedForm?.isPublic && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 rounded-full"
                onClick={() => {
                  navigator.clipboard?.writeText(publicUrl)
                  toast.success("Form link copied")
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy link
              </Button>
              <Button asChild type="button" size="sm" className="gap-2 rounded-full">
                <a href={publicUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
              </Button>
            </div>
          )}

          {selectedForm && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Delete form
            </Button>
          )}
        </div>

        <FormBuilder
          projectId={projectId}
          form={
            selectedForm
              ? {
                  id: selectedForm.id,
                  name: selectedForm.name,
                  description: selectedForm.description,
                  fields: selectedForm.fields,
                  isPublic: selectedForm.isPublic,
                }
              : undefined
          }
          onSave={handleSaved}
        />

        {selectedForm && (
          <div className="mt-6">
            <FormSubmissions formId={selectedForm.id} fields={selectedForm.fields} />
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="rounded-2xl border bg-card/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Task intake forms</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Build Google Form-style intake forms that create tasks and fill this project's custom fields automatically.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="gap-2 rounded-full"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          New form
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border bg-background/70 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading forms...
          </div>
        ) : forms.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-background/70 px-4 py-6 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-semibold text-foreground">No intake forms yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Start with a task title field, then add project custom fields with one click.
            </p>
          </div>
        ) : (
          forms.map((form) => (
            <button
              key={form.id}
              type="button"
              onClick={() => setSelectedForm(form)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border bg-background px-3 py-3 text-left transition-colors",
                "hover:border-foreground/20 hover:bg-muted/30"
              )}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                <FileText className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{form.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {form.description || "No description"}
                </p>
              </div>
              <Badge variant="secondary" className="rounded-full text-[10px]">
                {form._count?.submissions ?? 0} submissions
              </Badge>
              <Badge variant={form.isPublic ? "default" : "outline"} className="rounded-full text-[10px]">
                {form.isPublic ? "Public" : "Private"}
              </Badge>
            </button>
          ))
        )}
      </div>
    </section>
  )
}
