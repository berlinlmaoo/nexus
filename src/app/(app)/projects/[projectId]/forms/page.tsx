"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  Plus,
  ArrowLeft,
  FileText,
  Globe,
  Lock,
  Loader2,
  ClipboardList,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FormBuilder, type FormField } from "@/components/forms/form-builder"
import { FormSubmissions } from "@/components/forms/form-submissions"
import type { FormAccessSchedule } from "@/lib/form-access-schedule"

interface Form {
  id: string
  name: string
  slug?: string | null
  description: string | null
  fields: FormField[]
  isPublic: boolean
  accessSchedule?: FormAccessSchedule | null
  createdAt: string
  _count: {
    submissions: number
  }
}

export default function FormsPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = (params?.projectId ?? "") as string
  const [forms, setForms] = useState<Form[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedForm, setSelectedForm] = useState<Form | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchForms = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/forms?projectId=${projectId}`)
      if (!res.ok) throw new Error("Failed to fetch forms")
      const data = await res.json()
      setForms(data)
    } catch {
      // silently handle
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectId) fetchForms()
  }, [projectId, fetchForms])

  const showDetail = selectedForm !== null || isCreating

  const handleBack = () => {
    setSelectedForm(null)
    setIsCreating(false)
  }

  const handleSave = () => {
    handleBack()
    fetchForms()
  }

  const handleNewForm = () => {
    setSelectedForm(null)
    setIsCreating(true)
  }

  const handleSelectForm = (form: Form) => {
    setIsCreating(false)
    setSelectedForm(form)
  }

  const handleDeleteForm = async () => {
    if (!selectedForm) return

    const confirmed = window.confirm(
      `Delete form "${selectedForm.name}"? This will also remove its submission history.`
    )
    if (!confirmed) return

    try {
      setIsDeleting(true)
      const res = await fetch(`/api/forms/${selectedForm.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? "Failed to delete form")
      }
      handleBack()
      fetchForms()
    } catch {
      // silently handle, matching the page's existing fetch behavior
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <AnimatePresence mode="wait">
        {showDetail ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-6"
          >
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-xl font-semibold text-on-surface">
                {isCreating ? "New Form" : selectedForm?.name}
              </h1>
              {selectedForm && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteForm}
                  disabled={isDeleting}
                  className="ml-auto border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
                >
                  {isDeleting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
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
                      accessSchedule: selectedForm.accessSchedule,
                    }
                  : undefined
              }
              onSave={handleSave}
            />

            {selectedForm && (
              <div className="mt-4">
                <FormSubmissions
                  formId={selectedForm.id}
                  fields={selectedForm.fields}
                />
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-6"
          >
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-semibold text-on-surface">Forms</h1>
              <Button
                onClick={handleNewForm}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Form
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : forms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <ClipboardList className="h-12 w-12 mb-4 text-muted-foreground/50" />
                <p className="text-sm font-medium text-on-surface">
                  No forms yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create a form to start collecting responses.
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {forms.map((form) => (
                  <motion.div
                    key={form.id}
                    whileHover={{ scale: 1.005 }}
                    whileTap={{ scale: 0.995 }}
                    onClick={() => handleSelectForm(form)}
                    className={cn(
                      "flex items-center gap-4 rounded-lg border border-border bg-card p-4",
                      "cursor-pointer transition-colors hover:border-primary/30 hover:bg-accent"
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-container-high text-on-surface-variant">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">
                        {form.name}
                      </p>
                      {form.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {form.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className="text-xs">
                        {form._count.submissions}{" "}
                        {form._count.submissions === 1
                          ? "submission"
                          : "submissions"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-border text-xs gap-1",
                          form.isPublic
                            ? "text-on-surface-variant"
                            : "text-muted-foreground"
                        )}
                      >
                        {form.isPublic ? (
                          <Globe className="h-3 w-3" />
                        ) : (
                          <Lock className="h-3 w-3" />
                        )}
                        {form.isPublic ? "Public" : "Private"}
                      </Badge>
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {new Date(form.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
