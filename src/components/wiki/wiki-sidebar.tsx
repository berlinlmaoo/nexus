"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WikiTreeItem } from "./wiki-tree-item"
import {
  Plus,
  Search,
  BookOpen,
  Loader2,
  Trash2,
  Copy,
  Pencil,
  ArrowRight,
  Database,
  ShieldCheck,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface WikiDoc {
  id: string
  title: string
  icon: string | null
  parentId: string | null
  position: number
  verificationStatus: string | null
  updatedAt: string
  children: WikiDoc[]
}

interface WikiSidebarProps {
  projectId: string
  activeDocId: string | null
  onSelect: (docId: string) => void
}

function buildTree(docs: Omit<WikiDoc, "children">[]): WikiDoc[] {
  const map = new Map<string, WikiDoc>()
  const roots: WikiDoc[] = []

  docs.forEach((d) => map.set(d.id, { ...d, children: [] }))
  docs.forEach((d) => {
    const node = map.get(d.id)!
    if (d.parentId && map.has(d.parentId)) {
      map.get(d.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sortChildren = (nodes: WikiDoc[]) => {
    nodes.sort((a, b) => a.position - b.position)
    nodes.forEach((n) => sortChildren(n.children))
  }
  sortChildren(roots)
  return roots
}

export function WikiSidebar({ projectId, activeDocId, onSelect }: WikiSidebarProps) {
  const router = useRouter()
  const [docs, setDocs] = useState<WikiDoc[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    docId: string
  } | null>(null)

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/docs?projectId=${projectId}&tree=true`)
      if (res.ok) {
        const data = await res.json()
        const tree = buildTree(data.docs)
        setDocs(tree)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchDocs()
  }, [fetchDocs])

  const handleCreatePage = async (parentId?: string) => {
    setCreating(true)
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled Node",
          projectId,
          parentId: parentId || null,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        await fetchDocs()
        onSelect(data.doc.id)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, docId: string) => {
    e.preventDefault()
    const menuWidth = 180
    const menuHeight = 160
    const x = Math.min(e.clientX, window.innerWidth - menuWidth)
    const y = Math.min(e.clientY, window.innerHeight - menuHeight)
    setContextMenu({ x: Math.max(0, x), y: Math.max(0, y), docId })
  }

  const handleContextAction = async (action: string) => {
    if (!contextMenu) return
    const docId = contextMenu.docId
    setContextMenu(null)

    switch (action) {
      case "rename": {
        const newTitle = prompt("Designate new node name:")
        if (newTitle) {
          await fetch(`/api/docs/${docId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: newTitle }),
          })
          fetchDocs()
        }
        break
      }
      case "delete": {
        if (confirm("Deauthorize this intelligence node and all sub-nodes?")) {
          await fetch(`/api/docs/${docId}`, { method: "DELETE" })
          fetchDocs()
        }
        break
      }
      case "duplicate": {
        await fetch(`/api/docs/${docId}/duplicate`, { method: "POST" })
        fetchDocs()
        break
      }
      case "add-subpage": {
        handleCreatePage(docId)
        break
      }
    }
  }

  const filterTree = (nodes: WikiDoc[], q: string): WikiDoc[] => {
    if (!q.trim()) return nodes
    const lower = q.toLowerCase()
    return nodes
      .map((node) => {
        const filteredChildren = filterTree(node.children, q)
        if (
          node.title.toLowerCase().includes(lower) ||
          filteredChildren.length > 0
        ) {
          return { ...node, children: filteredChildren }
        }
        return null
      })
      .filter(Boolean) as WikiDoc[]
  }

  const displayDocs = filterTree(docs, search)

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-8">
        <div className="flex flex-col">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/40 mb-1">Central Archive</span>
          <h3 className="text-xl font-headline font-black text-primary tracking-tight">Intelligence</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-xl bg-surface-container hover:bg-primary hover:text-primary-foreground transition-all duration-300"
          onClick={() => handleCreatePage()}
          disabled={creating}
        >
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Search */}
      <div className="px-6 mb-6">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-on-surface-variant/20 group-focus-within:text-primary transition-colors" />
          <Input
            placeholder="Filter Intel Node..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 pl-11 bg-surface-container-low border-none rounded-2xl text-xs font-bold text-primary placeholder:text-on-surface-variant/20 focus:ring-4 focus:ring-primary/5 transition-all"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-4 space-y-0.5 scrollbar-hide">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 opacity-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-[10px] font-black uppercase tracking-widest">Decrypting Archive...</span>
          </div>
        ) : displayDocs.length === 0 ? (
          <div className="text-center py-12 px-6">
            <div className="w-16 h-16 rounded-3xl bg-surface-container mx-auto flex items-center justify-center text-on-surface-variant/10 mb-4">
               <Database className="h-8 w-8" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant/40 leading-relaxed">
              {search ? "No matches found in tactical databank" : "Archive is currently vacant"}
            </p>
            {!search && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-6 text-[10px] font-black uppercase tracking-widest text-primary bg-primary/5 hover:bg-primary hover:text-primary-foreground rounded-xl px-4"
                onClick={() => handleCreatePage()}
              >
                Initialize Node
              </Button>
            )}
          </div>
        ) : (
          displayDocs.map((doc) => (
            <WikiTreeItem
              key={doc.id}
              doc={doc}
              depth={0}
              activeDocId={activeDocId}
              onSelect={onSelect}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-[70] rounded-[24px] border-none bg-surface-container-highest p-2 shadow-2xl shadow-primary/20 animate-scale-in min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {[
              { action: "rename", label: "Rename Node", icon: Pencil },
              { action: "duplicate", label: "Duplicate Data", icon: Copy },
              { action: "add-subpage", label: "Add Sub-Node", icon: Plus },
              { action: "delete", label: "Deauthorize", icon: Trash2 },
            ].map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.action}
                  onClick={() => handleContextAction(item.action)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all hover:bg-surface-container-low group",
                    item.action === "delete" ? "text-red-500 hover:bg-red-500/10" : "text-on-surface-variant/60 hover:text-primary"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
