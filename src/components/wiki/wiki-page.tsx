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
  Calendar,
  Clock,
  History,
  Share2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

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
  const daysSinceUpdate = Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24))
  if (daysSinceUpdate > 90) return { label: "Stale", className: "bg-red-50 text-red-700" }
  if (daysSinceUpdate > 30) return { label: "Needs Review", className: "bg-amber-50 text-amber-700" }
  if (status === "VERIFIED" || verifiedAt) return { label: "Verified", className: "bg-emerald-50 text-emerald-700" }
  return { label: "Needs Review", className: "bg-amber-50 text-amber-700" }
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
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (activeDocId) fetchDoc(activeDocId)
    else setDoc(null)
  }, [activeDocId, fetchDoc])

  const handleSelect = (docId: string) => setActiveDocId(docId)

  const save = useCallback(async (newTitle?: string, newContent?: any) => {
    if (!activeDocId) return
    setSaving(true); setSaved(false)
    try {
      const body: Record<string, any> = {}
      if (newTitle !== undefined) body.title = newTitle
      if (newContent !== undefined) body.content = newContent
      await fetch(`/api/docs/${activeDocId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }, [activeDocId])

  const handleContentChange = useCallback((newContent: any) => {
    setContent(newContent)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => save(undefined, newContent), 1500)
  }, [save])

  const handleDelete = async () => {
    if (!activeDocId || !confirm("Delete this page?")) return
    try {
      await fetch(`/api/docs/${activeDocId}`, { method: "DELETE" })
      setActiveDocId(null); setDoc(null)
    } catch (e) { console.error(e) }
  }

  const badge = doc ? getVerificationBadge(doc.verificationStatus, doc.verifiedAt, doc.updatedAt) : null

  return (
    <div className="flex h-full bg-surface">
      <div className="w-72 shrink-0 h-full bg-surface-container-low/50 border-r border-on-surface-variant/5">
        <WikiSidebar projectId={projectId} activeDocId={activeDocId} onSelect={handleSelect} />
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {!activeDocId ? (
          <div className="h-full flex flex-col items-center justify-center p-12 text-center space-y-6">
            <div className="w-20 h-20 rounded-2xl bg-surface-container flex items-center justify-center text-on-surface-variant/20"><FileText className="h-10 w-10" /></div>
            <div className="space-y-2">
              <h2 className="text-2xl font-headline font-extrabold text-primary">Select a document</h2>
              <p className="text-on-surface-variant/60 max-w-xs mx-auto">Choose a page from the sidebar to start editing.</p>
            </div>
          </div>
        ) : loading ? (
          <div className="h-full flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary/20" /></div>
        ) : doc ? (
          <div className="max-w-5xl mx-auto px-12 py-16 w-full animate-fade-in">
            <div className="flex items-center justify-between mb-16 border-b border-on-surface-variant/5 pb-6">
              <div className="flex items-center gap-3 text-on-surface-variant/60 text-[13px] font-bold font-headline uppercase tracking-widest"><ChevronRight className="h-4 w-4" /><span>Documentation</span></div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="font-bold text-xs text-on-surface-variant/60 hover:text-primary"><Share2 className="h-4 w-4 mr-2" /> Share</Button>
                <Button variant="ghost" size="sm" className="font-bold text-xs text-on-surface-variant/60 hover:text-primary"><History className="h-4 w-4 mr-2" /> History</Button>
                <Button variant="ghost" size="sm" className="font-bold text-xs text-red-500/60 hover:text-red-600" onClick={handleDelete}><Trash2 className="h-4 w-4 mr-2" /> Delete</Button>
              </div>
            </div>
            <div className="mb-16 space-y-12">
              <div className="w-full h-64 rounded-3xl bg-surface-container-high relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-t from-primary/10 to-transparent opacity-50" />
                {doc.coverImage ? <img src={doc.coverImage} alt="Cover" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-primary/5"><FileText className="h-12 w-12 text-primary/10" /></div>}
              </div>
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  {badge && <span className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest", badge.className)}>{badge.label}</span>}
                  <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40"><Clock className="h-3 w-3" />{Math.ceil((JSON.stringify(doc.content)?.length || 0) / 500) || 1} min read</span>
                </div>
                <input value={title} onChange={(e) => { setTitle(e.target.value); if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = setTimeout(() => save(e.target.value), 1500); }} className="w-full bg-transparent border-none p-0 text-6xl font-headline font-black text-primary tracking-tighter focus:ring-0 placeholder:text-on-surface-variant/10" placeholder="Untitled Document" />
                <div className="flex items-center gap-4 pt-4">
                  <div className="flex items-center gap-2">
                    <UserAvatar user={{ name: doc.author.name || "Unknown", image: doc.author.avatar }} size="sm" />
                    <div><p className="text-xs font-bold text-primary">{doc.author.name || "Unknown"}</p><p className="text-[10px] text-on-surface-variant/40 font-medium">Last edited {format(new Date(doc.updatedAt), "MMM d, yyyy")}</p></div>
                  </div>
                  {doc.owner && <div className="flex items-center gap-2"><UserAvatar user={{ name: doc.owner.name || "Unknown", image: doc.owner.avatar }} size="sm" /><div><p className="text-xs font-bold text-primary">{doc.owner.name || "Unknown"}</p><p className="text-[10px] text-on-surface-variant/40 font-medium">Owner</p></div></div>}
                </div>
              </div>
            </div>
            <div className="prose prose-slate prose-lg max-w-none prose-headings:font-headline prose-headings:font-black prose-p:text-on-surface-variant/80">
              <DocEditor content={content} onChange={handleContentChange} editable={true} />
            </div>
            {(saving || saved) && (
              <div className="fixed bottom-12 right-12 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 animate-slide-up-in ring-4 ring-primary/10">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                <span className="text-[10px] font-black uppercase tracking-widest">{saving ? "Saving..." : "Saved to Cloud"}</span>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
