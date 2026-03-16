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
          title: "Untitled",
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
    const menuWidth = 160
    const menuHeight = 130
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
        const newTitle = prompt("New name:")
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
        if (confirm("Delete this page and all subpages?")) {
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

  // Filter tree by search
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
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900 border-r w-64">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b">
        <div className="flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Wiki</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => handleCreatePage()}
          disabled={creating}
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search pages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-7 text-xs bg-white dark:bg-zinc-800"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : displayDocs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground">
              {search ? "No pages match" : "No pages yet"}
            </p>
            {!search && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-xs"
                onClick={() => handleCreatePage()}
              >
                <Plus className="h-3 w-3 mr-1" /> New Page
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
            className="fixed inset-0 z-50"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 rounded-lg border bg-background p-1 shadow-lg animate-scale-in min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {[
              { action: "rename", label: "Rename", icon: Pencil },
              { action: "duplicate", label: "Duplicate", icon: Copy },
              { action: "add-subpage", label: "Add subpage", icon: Plus },
              { action: "delete", label: "Delete", icon: Trash2 },
            ].map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.action}
                  onClick={() => handleContextAction(item.action)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-muted",
                    item.action === "delete" && "text-red-600 hover:text-red-700"
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
