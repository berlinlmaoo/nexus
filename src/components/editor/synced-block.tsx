"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
  Link2,
  Unlink,
  Loader2,
  RotateCw,
  Copy,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface SyncedBlockData {
  id: string
  content: any
  updatedAt: string
}

interface SyncedBlockProps {
  blockId: string
  initialContent?: any
  editable?: boolean
  onUnlink?: (content: any) => void
  onContentChange?: (content: any) => void
}

// localStorage-based synced block store for MVP
const SYNCED_BLOCKS_KEY = "nexus-synced-blocks"

function getSyncedBlocks(): Record<string, SyncedBlockData> {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(localStorage.getItem(SYNCED_BLOCKS_KEY) || "{}")
  } catch {
    return {}
  }
}

function saveSyncedBlock(id: string, content: any) {
  const blocks = getSyncedBlocks()
  blocks[id] = { id, content, updatedAt: new Date().toISOString() }
  localStorage.setItem(SYNCED_BLOCKS_KEY, JSON.stringify(blocks))
}

function deleteSyncedBlock(id: string) {
  const blocks = getSyncedBlocks()
  delete blocks[id]
  localStorage.setItem(SYNCED_BLOCKS_KEY, JSON.stringify(blocks))
}

export function createSyncedBlock(content: any): string {
  const id = `sb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  saveSyncedBlock(id, content)
  return id
}

export function SyncedBlock({
  blockId,
  initialContent,
  editable = true,
  onUnlink,
  onContentChange,
}: SyncedBlockProps) {
  const [content, setContent] = useState<any>(initialContent || null)
  const [loading, setLoading] = useState(!initialContent)

  useEffect(() => {
    if (!initialContent) {
      const blocks = getSyncedBlocks()
      const block = blocks[blockId]
      if (block) {
        setContent(block.content)
      }
      setLoading(false)
    }
  }, [blockId, initialContent])

  const handleSync = useCallback(() => {
    const blocks = getSyncedBlocks()
    const block = blocks[blockId]
    if (block) {
      setContent(block.content)
    }
  }, [blockId])

  const handleUnlink = () => {
    if (onUnlink) {
      onUnlink(content)
    }
  }

  const handleContentUpdate = (newContent: any) => {
    setContent(newContent)
    saveSyncedBlock(blockId, newContent)
    onContentChange?.(newContent)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const contentText = typeof content === "string"
    ? content
    : content?.content
      ? content.content
          .map((node: any) =>
            node.content?.map((c: any) => c.text || "").join("") || ""
          )
          .join("\n")
      : "Empty synced block"

  return (
    <div
      className={cn(
        "relative rounded-lg border-l-[3px] border-l-amber-400 bg-amber-50/30 dark:bg-amber-950/10 p-4 my-2 group",
        editable && "hover:border-l-amber-500"
      )}
    >
      {/* Synced indicator */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleSync}
          className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
          title="Refresh"
        >
          <RotateCw className="h-3 w-3 text-amber-600" />
        </button>
        {onUnlink && (
          <button
            onClick={handleUnlink}
            className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            title="Unlink (make independent copy)"
          >
            <Unlink className="h-3 w-3 text-amber-600" />
          </button>
        )}
      </div>

      <div className="flex items-start gap-2">
        <Link2 className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-amber-600 font-medium mb-1">
            Synced Block
          </div>
          {editable ? (
            <textarea
              className="w-full min-h-[60px] bg-transparent border-none outline-none text-sm resize-none"
              value={contentText}
              onChange={(e) => handleContentUpdate(e.target.value)}
              placeholder="Type content here..."
            />
          ) : (
            <div className="text-sm whitespace-pre-wrap">{contentText}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// Panel to manage/create synced blocks
export function SyncedBlockManager() {
  const [blocks, setBlocks] = useState<SyncedBlockData[]>([])

  useEffect(() => {
    const allBlocks = getSyncedBlocks()
    setBlocks(Object.values(allBlocks).sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ))
  }, [])

  const handleCreate = () => {
    const id = createSyncedBlock("New synced block content")
    setBlocks(Object.values(getSyncedBlocks()).sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ))
    return id
  }

  const handleDelete = (id: string) => {
    deleteSyncedBlock(id)
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Synced Blocks</h4>
        <Button variant="outline" size="sm" onClick={handleCreate}>
          <Copy className="h-3 w-3 mr-1" /> Create Block
        </Button>
      </div>
      {blocks.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No synced blocks yet. Convert content to a synced block or create one.
        </p>
      ) : (
        blocks.map((block) => (
          <SyncedBlock
            key={block.id}
            blockId={block.id}
            initialContent={block.content}
            onUnlink={() => handleDelete(block.id)}
          />
        ))
      )}
    </div>
  )
}
