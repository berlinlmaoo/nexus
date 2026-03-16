"use client"

import { useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DocEditor } from "@/components/docs/doc-editor"
import { DocHeader } from "@/components/docs/doc-header"
import { ArrowLeft, Save, Trash2, Loader2, Check } from "lucide-react"

interface Doc {
  id: string
  title: string
  content: any
  icon: string | null
  coverImage: string | null
  createdAt: string
  updatedAt: string
  author: { id: string; name: string | null; avatar: string | null }
  owner?: { id: string; name: string | null; avatar: string | null } | null
  project: { id: string; name: string; color: string | null }
}

export function DocEditorPage({ doc: initialDoc }: { doc: Doc }) {
  const router = useRouter()
  const [title, setTitle] = useState(initialDoc.title)
  const [content, setContent] = useState<any>(initialDoc.content)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const save = useCallback(async (newTitle?: string, newContent?: any) => {
    setSaving(true)
    setSaved(false)
    try {
      const body: Record<string, any> = {}
      if (newTitle !== undefined) body.title = newTitle
      if (newContent !== undefined) body.content = newContent
      await fetch(`/api/docs/${initialDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }, [initialDoc.id])

  const handleContentChange = useCallback((newContent: any) => {
    setContent(newContent)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => save(undefined, newContent), 1500)
  }, [save])

  const handleUpdate = async (updates: Record<string, any>) => {
    try {
      await fetch(`/api/docs/${initialDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
    } catch (e) {
      console.error(e)
    }
  }

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this document?")) return
    setDeleting(true)
    try {
      await fetch(`/api/docs/${initialDoc.id}`, { method: "DELETE" })
      router.push("/docs")
    } catch (e) {
      console.error(e)
      setDeleting(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push("/docs")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Documents
        </button>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {saved && <span className="flex items-center gap-1 text-xs text-green-600"><Check className="h-3 w-3" /> Saved</span>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => save(title, content)}
            disabled={saving}
          >
            <Save className="h-4 w-4 mr-1" /> Save
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Doc header with cover, icon, breadcrumbs */}
      <div className="mb-6">
        <DocHeader
          docId={initialDoc.id}
          title={title}
          icon={initialDoc.icon}
          coverImage={initialDoc.coverImage}
          projectName={initialDoc.project.name}
          projectColor={initialDoc.project.color}
          onTitleChange={setTitle}
          onTitleBlur={() => save(title)}
          onUpdate={handleUpdate}
        />
      </div>

      <DocEditor content={content} onChange={handleContentChange} editable />
    </div>
  )
}
