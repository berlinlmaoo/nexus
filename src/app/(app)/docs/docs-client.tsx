"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { WikiPage } from "@/components/wiki/wiki-page"
import { FileText, Plus, Loader2, Search, BookOpen, LayoutList, LayoutTemplate } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface DocTemplate {
  id: string
  title: string
  category: string
}

const CATEGORY_LABELS: Record<string, string> = {
  meetings: "Meetings",
  planning: "Planning",
  engineering: "Engineering",
  updates: "Updates",
  general: "General",
}

interface Doc {
  id: string
  title: string
  content: any
  icon: string | null
  coverImage: string | null
  createdAt: string
  updatedAt: string
  verificationStatus: string | null
  author: { id: string; name: string | null; avatar: string | null }
  project: { id: string; name: string; color: string | null }
}

interface Project {
  id: string
  name: string
  color: string | null
}

export function DocsPageClient({
  docs: initialDocs,
  projects,
  currentUserId,
}: {
  docs: Doc[]
  projects: Project[]
  currentUserId: string
}) {
  const router = useRouter()
  const [docs, setDocs] = useState<Doc[]>(initialDocs)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState("")
  const [projectId, setProjectId] = useState("")
  const [search, setSearch] = useState("")
  const [viewMode, setViewMode] = useState<"list" | "wiki">("list")
  const [wikiProjectId, setWikiProjectId] = useState<string>(projects[0]?.id || "")
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [templatesLoaded, setTemplatesLoaded] = useState(false)

  const filteredDocs = docs.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase())
  )

  const fetchTemplates = async () => {
    if (templatesLoaded) return
    try {
      // Get workspace from first project
      const res = await fetch("/api/docs/templates?workspaceId=" + (projects[0]?.id ? "" : ""))
      if (res.ok) {
        const data = await res.json()
        setTemplates(data.templates || [])
      }
    } catch {} finally { setTemplatesLoaded(true) }
  }

  const handleCreate = async () => {
    if (!title.trim() || !projectId) return
    setCreating(true)
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, projectId, templateId: selectedTemplateId || undefined }),
      })
      if (res.ok) {
        const data = await res.json()
        setDocs([data.doc, ...docs])
        setTitle("")
        setProjectId("")
        setOpen(false)
        toast.success("Document created")
        router.push(`/docs/${data.doc.id}`)
      } else {
        toast.error("Failed to create document")
      }
    } catch (e) {
      console.error(e)
      toast.error("Failed to create document")
    } finally {
      setCreating(false)
    }
  }

  // Wiki mode
  if (viewMode === "wiki" && wikiProjectId) {
    return (
      <div className="h-[calc(100vh-3.5rem)]">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewMode("list")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <LayoutList className="h-3.5 w-3.5" />
              List View
            </button>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={wikiProjectId}
              onChange={(e) => setWikiProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <WikiPage
          projectId={wikiProjectId}
          currentUserId={currentUserId}
        />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">Create and manage project documentation</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Wiki mode toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode("wiki")}
            className="transition-all duration-200"
          >
            <BookOpen className="h-4 w-4 mr-1.5" />
            Wiki Mode
          </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) fetchTemplates() }}>
            <DialogTrigger asChild>
              <Button className="bg-foreground text-background hover:bg-foreground/90">
                <Plus className="h-4 w-4 mr-2" /> New Document
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create Document</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input placeholder="Document title..." value={title} onChange={e => setTitle(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Project</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={projectId}
                    onChange={e => setProjectId(e.target.value)}
                  >
                    <option value="">Select a project...</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                {templates.length > 0 && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <LayoutTemplate className="h-3.5 w-3.5" /> Template (optional)
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSelectedTemplateId("")}
                        className={cn(
                          "rounded-lg border p-3 text-left text-xs transition-colors",
                          !selectedTemplateId
                            ? "border-foreground bg-foreground/5"
                            : "border-border hover:border-foreground/30"
                        )}
                      >
                        <div className="font-medium">Blank Document</div>
                        <div className="text-muted-foreground mt-0.5">Start from scratch</div>
                      </button>
                      {templates.map(t => (
                        <button
                          key={t.id}
                          onClick={() => setSelectedTemplateId(t.id)}
                          className={cn(
                            "rounded-lg border p-3 text-left text-xs transition-colors",
                            selectedTemplateId === t.id
                              ? "border-foreground bg-foreground/5"
                              : "border-border hover:border-foreground/30"
                          )}
                        >
                          <div className="font-medium">{t.title}</div>
                          <div className="text-muted-foreground mt-0.5">{CATEGORY_LABELS[t.category] || t.category}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Button onClick={handleCreate} disabled={creating || !title.trim() || !projectId} className="w-full bg-foreground text-background hover:bg-foreground/90">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                  Create Document
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search documents..."
          className="pl-9"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filteredDocs.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fade-in">
          <div className="h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
            <FileText className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold mb-1">{search ? "No documents found" : "No documents yet"}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {search ? "Try a different search term" : "Create your first document to get started"}
          </p>
          {!search && (
            <Button onClick={() => setOpen(true)} className="bg-foreground text-background hover:bg-foreground/90">
              <Plus className="h-4 w-4 mr-2" /> Create Document
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredDocs.map(doc => (
            <Card
              key={doc.id}
              className="p-4 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => router.push(`/docs/${doc.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    {doc.icon ? (
                      <span className="text-lg">{doc.icon}</span>
                    ) : (
                      <FileText className="h-4 w-4 text-foreground" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm truncate">{doc.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="secondary"
                        className="text-[10px]"
                        style={doc.project.color ? { backgroundColor: `${doc.project.color}15`, color: doc.project.color } : {}}
                      >
                        {doc.project.name}
                      </Badge>
                      {doc.verificationStatus === "VERIFIED" && (
                        <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                          Verified
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        Updated {new Date(doc.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <UserAvatar user={{ name: doc.author.name || "?", avatar: doc.author.avatar }} size="sm" className="shrink-0" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
