"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { WikiSidebar } from "./wiki-sidebar"
import { DocEditor } from "@/components/docs/doc-editor"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/user-avatar"
import {
  Save,
  Loader2,
  Check,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  ChevronRight,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface WikiPageDoc {
  id: string
  title: string
  content: any
  icon: string | null
  coverImage: string | null
  verifiedAt: string | null
  verificationStatus: string | null
  updatedAt: string
  createdAt: string
  author: { id: string; name: string | null; avatar: string | null }
  owner: { id: string; name: string | null; avatar: string | null } | null
  project: { id: string; name: string; color: string | null }
  parentId: string | null
}

interface WikiPageProps {
  projectId: string
  initialDocId?: string
  currentUserId: string
}

function getVerificationBadge(status: string | null, verifiedAt: string | null, updatedAt: string) {
  if (!status) return null

  const now = new Date()
  const lastUpdate = new Date(updatedAt)
  const daysSinceUpdate = Math.floor(
    (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (daysSinceUpdate > 90) {
    return {
      label: "Stale",
      icon: XCircle,
      className: "bg-red-50 text-red-700 border-red-200",
    }
  }
  if (daysSinceUpdate > 30) {
    return {
      label: "Needs Review",
      icon: AlertTriangle,
      className: "bg-amber-50 text-amber-700 border-amber-200",
    }
  }
  if (status === "VERIFIED" || verifiedAt) {
    return {
      label: "Verified",
      icon: ShieldCheck,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    }
  }
  return {
    label: "Needs Review",
    icon: AlertTriangle,
    className: "bg-amber-50 text-amber-700 border-amber-200",
  }
}

export function WikiPage({ projectId, initialDocId, currentUserId }: WikiPageProps) {
  const router = useRouter()
  const [activeDocId, setActiveDocId] = useState<string | null>(initialDocId || null)
  const [doc, setDoc] = useState<WikiPageDoc | null>(null)
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const fetchDoc = useCallback(async (docId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/docs/${docId}`)
      if (res.ok) {
        const data = await res.json()
        setDoc(data.doc)
        setTitle(data.doc.title)
        setContent(data.doc.content)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeDocId) {
      fetchDoc(activeDocId)
    } else {
      setDoc(null)
    }
  }, [activeDocId, fetchDoc])

  const handleSelect = (docId: string) => {
    setActiveDocId(docId)
  }

  const save = useCallback(
    async (newTitle?: string, newContent?: any) => {
      if (!activeDocId) return
      setSaving(true)
      setSaved(false)
      try {
        const body: Record<string, any> = {}
        if (newTitle !== undefined) body.title = newTitle
        if (newContent !== undefined) body.content = newContent
        await fetch(`/api/docs/${activeDocId}`, {
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
    },
    [activeDocId]
  )

  const handleContentChange = useCallback(
    (newContent: any) => {
      setContent(newContent)
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => save(undefined, newContent), 1500)
    },
    [save]
  )

  const handleVerify = async () => {
    if (!activeDocId) return
    setVerifying(true)
    try {
      await fetch(`/api/docs/${activeDocId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationStatus: "VERIFIED",
          verifiedAt: new Date().toISOString(),
        }),
      })
      if (doc) {
        setDoc({
          ...doc,
          verificationStatus: "VERIFIED",
          verifiedAt: new Date().toISOString(),
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setVerifying(false)
    }
  }

  const handleDelete = async () => {
    if (!activeDocId || !confirm("Delete this page?")) return
    try {
      await fetch(`/api/docs/${activeDocId}`, { method: "DELETE" })
      setActiveDocId(null)
      setDoc(null)
    } catch (e) {
      console.error(e)
    }
  }

  const badge = doc
    ? getVerificationBadge(doc.verificationStatus, doc.verifiedAt, doc.updatedAt)
    : null

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <WikiSidebar
        projectId={projectId}
        activeDocId={activeDocId}
        onSelect={handleSelect}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !doc ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="h-16 w-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Select a page</h3>
            <p className="text-sm text-muted-foreground">
              Choose a page from the sidebar or create a new one
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-8 py-6">
            {/* Cover image */}
            {doc.coverImage && (
              <div className="h-48 rounded-xl overflow-hidden mb-6 bg-zinc-100">
                <img
                  src={doc.coverImage}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Header bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge
                  variant="secondary"
                  className="text-[10px]"
                  style={
                    doc.project.color
                      ? {
                          backgroundColor: `${doc.project.color}15`,
                          color: doc.project.color,
                        }
                      : {}
                  }
                >
                  {doc.project.name}
                </Badge>
                <ChevronRight className="h-3 w-3" />
                <span className="text-xs">{doc.title}</span>
              </div>
              <div className="flex items-center gap-2">
                {saving && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {saved && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <Check className="h-3 w-3" /> Saved
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => save(title, content)}
                  disabled={saving}
                >
                  <Save className="h-4 w-4 mr-1" /> Save
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Verification & owner */}
            <div className="flex items-center gap-3 mb-4">
              {badge && (
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
                    badge.className
                  )}
                >
                  <badge.icon className="h-3.5 w-3.5" />
                  {badge.label}
                </div>
              )}

              {(doc.owner || doc.author) && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>Owner:</span>
                  <UserAvatar
                    user={{
                      name: (doc.owner || doc.author).name || "?",
                      avatar: (doc.owner || doc.author).avatar,
                    }}
                    size="xs"
                  />
                  <span>{(doc.owner || doc.author).name}</span>
                </div>
              )}

              {doc.verificationStatus !== "VERIFIED" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={handleVerify}
                  disabled={verifying}
                >
                  {verifying ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <ShieldCheck className="h-3 w-3 mr-1" />
                  )}
                  Verify
                </Button>
              )}

              <span className="text-[10px] text-muted-foreground ml-auto">
                Updated {new Date(doc.updatedAt).toLocaleDateString()}
              </span>
            </div>

            {/* Title */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-3xl">{doc.icon || ""}</span>
                <input
                  className="w-full text-3xl font-bold bg-transparent border-none outline-none focus:ring-0 p-0"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => save(title)}
                  placeholder="Untitled"
                />
              </div>
            </div>

            {/* Editor */}
            <DocEditor
              content={content}
              onChange={handleContentChange}
              editable
            />
          </div>
        )}
      </div>
    </div>
  )
}
