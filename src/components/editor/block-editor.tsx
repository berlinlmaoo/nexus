"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils"
import type { Block, BlockType } from "./types"
import { createBlock } from "./types"
import { BlockRenderer } from "./block-renderer"
import { SlashCommandMenu } from "./slash-command-menu"
import { InlineToolbar } from "./inline-toolbar"
import { LiveCursors } from "@/components/collaboration/live-cursors"
import { PresenceIndicator } from "@/components/collaboration/presence-indicator"
import { usePresence } from "@/hooks/use-presence"

interface BlockEditorProps {
  initialBlocks: Block[]
  onChange: (blocks: Block[]) => void
  editable?: boolean
  simplified?: boolean
  minHeight?: string
  // Collaboration props
  collaborationRoom?: string
  userId?: string
  userName?: string
  userAvatar?: string | null
}

export function BlockEditor({
  initialBlocks,
  onChange,
  editable = true,
  simplified = false,
  minHeight = "400px",
  collaborationRoom,
  userId,
  userName,
  userAvatar,
}: BlockEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(
    initialBlocks.length > 0 ? initialBlocks : [createBlock("text")]
  )
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null)
  const [slashMenu, setSlashMenu] = useState<{
    blockId: string
    position: { top: number; left: number }
  } | null>(null)
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null)
  const blocksRef = useRef(blocks)
  const containerRef = useRef<HTMLDivElement>(null)

  // Collaboration
  const collabEnabled = !!(collaborationRoom && userId && userName)
  const { otherUsers, connected, emit, on } = usePresence({
    room: collaborationRoom || "",
    userId: userId || "",
    userName: userName || "",
    userAvatar,
    enabled: collabEnabled,
  })

  // Listen for remote content changes
  useEffect(() => {
    if (!connected || !collabEnabled) return

    const cleanup = on("content-change", (data: unknown) => {
      const change = data as { blockId: string; content: string; userId: string }
      if (change.userId === userId) return
      setBlocks((prev) => {
        const updated = prev.map((b) =>
          b.id === change.blockId ? { ...b, content: change.content } : b
        )
        blocksRef.current = updated
        return updated
      })
    })

    return () => { cleanup() }
  }, [connected, collabEnabled, userId, on])

  // Keep ref in sync
  useEffect(() => {
    blocksRef.current = blocks
  }, [blocks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const updateBlocks = useCallback(
    (newBlocks: Block[]) => {
      setBlocks(newBlocks)
      onChange(newBlocks)
    },
    [onChange]
  )

  const handleUpdateBlock = useCallback(
    (id: string, updates: Partial<Block>) => {
      const updated = blocksRef.current.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      )
      updateBlocks(updated)

      // Broadcast content changes to collaborators
      if (collabEnabled && connected && updates.content !== undefined) {
        emit("content-change", { blockId: id, content: updates.content })
      }
    },
    [updateBlocks, collabEnabled, connected, emit]
  )

  const handleDeleteBlock = useCallback(
    (id: string) => {
      const current = blocksRef.current
      if (current.length <= 1) return
      const idx = current.findIndex((b) => b.id === id)
      const newBlocks = current.filter((b) => b.id !== id)
      updateBlocks(newBlocks)
      // Focus previous block
      if (idx > 0) {
        setFocusedBlockId(newBlocks[idx - 1].id)
      } else if (newBlocks.length > 0) {
        setFocusedBlockId(newBlocks[0].id)
      }
    },
    [updateBlocks]
  )

  const handleInsertAfter = useCallback(
    (id: string, type: BlockType = "text") => {
      const current = blocksRef.current
      const idx = current.findIndex((b) => b.id === id)
      const newBlock = createBlock(type)
      const newBlocks = [...current.slice(0, idx + 1), newBlock, ...current.slice(idx + 1)]
      updateBlocks(newBlocks)
      setFocusedBlockId(newBlock.id)
    },
    [updateBlocks]
  )

  const handleSplitBlock = useCallback(
    (
      id: string,
      beforeContent: string,
      afterContent: string,
      type: BlockType = "text"
    ) => {
      const current = blocksRef.current
      const idx = current.findIndex((b) => b.id === id)
      if (idx < 0) return

      const nextBlock = createBlock(type, afterContent)
      const newBlocks = [...current]
      newBlocks[idx] = { ...newBlocks[idx], content: beforeContent }
      newBlocks.splice(idx + 1, 0, nextBlock)

      updateBlocks(newBlocks)
      setFocusedBlockId(nextBlock.id)
    },
    [updateBlocks]
  )

  const handleMergeWithPrevious = useCallback(
    (id: string) => {
      const current = blocksRef.current
      const idx = current.findIndex((b) => b.id === id)
      if (idx <= 0) return
      const currentBlock = current[idx]
      const prevBlock = current[idx - 1]
      // If current block is not text-like, just convert to text or delete if empty
      if (currentBlock.type === "divider" || currentBlock.type === "image" || currentBlock.type === "embed" || currentBlock.type === "table") {
        const newBlocks = current.filter((b) => b.id !== id)
        updateBlocks(newBlocks.length > 0 ? newBlocks : [createBlock("text")])
        setFocusedBlockId(prevBlock.id)
        return
      }
      // If current block has content, merge into previous
      if (currentBlock.content) {
        const mergedContent = prevBlock.content + currentBlock.content
        const newBlocks = current
          .map((b) => (b.id === prevBlock.id ? { ...b, content: mergedContent } : b))
          .filter((b) => b.id !== id)
        updateBlocks(newBlocks)
      } else {
        // Empty block — just delete
        if (current.length <= 1) {
          // If it's the only block and it has a non-text type, convert to text
          if (currentBlock.type !== "text") {
            updateBlocks([createBlock("text")])
            return
          }
          return
        }
        const newBlocks = current.filter((b) => b.id !== id)
        updateBlocks(newBlocks)
      }
      setFocusedBlockId(prevBlock.id)
    },
    [updateBlocks]
  )

  const handleIndent = useCallback(
    (id: string) => {
      const current = blocksRef.current
      const idx = current.findIndex((b) => b.id === id)
      if (idx <= 0) return
      const block = current[idx]
      const prevBlock = current[idx - 1]
      const updatedPrev = {
        ...prevBlock,
        children: [...prevBlock.children, block],
      }
      const newBlocks = current
        .map((b) => (b.id === prevBlock.id ? updatedPrev : b))
        .filter((b) => b.id !== id)
      updateBlocks(newBlocks)
    },
    [updateBlocks]
  )

  const handleOutdent = useCallback(
    (_id: string) => {
      const current = blocksRef.current
      let parentIdx = -1
      let childIdx = -1
      for (let i = 0; i < current.length; i++) {
        const ci = current[i].children.findIndex((c) => c.id === _id)
        if (ci >= 0) {
          parentIdx = i
          childIdx = ci
          break
        }
      }
      if (parentIdx < 0 || childIdx < 0) return
      const parent = current[parentIdx]
      const child = parent.children[childIdx]
      const updatedParent = {
        ...parent,
        children: parent.children.filter((c) => c.id !== _id),
      }
      const newBlocks = [
        ...current.slice(0, parentIdx),
        updatedParent,
        child,
        ...current.slice(parentIdx + 1),
      ]
      updateBlocks(newBlocks)
      setFocusedBlockId(child.id)
    },
    [updateBlocks]
  )

  const handleSlashMenu = useCallback(
    (blockId: string, position: { top: number; left: number }) => {
      setSlashMenu({ blockId, position })
    },
    []
  )

  const handleSlashSelect = useCallback(
    (type: BlockType) => {
      if (!slashMenu) return
      const { blockId } = slashMenu
      const current = blocksRef.current
      const block = current.find((b) => b.id === blockId)
      if (!block) {
        setSlashMenu(null)
        return
      }
      // Remove the "/" from content
      const cleanContent = block.content.replace(/\/$/, "").replace(/<br>\/$/, "").replace(/^\//, "")
      if (type === "divider") {
        // Replace current block with divider, add text block after
        const newBlocks = current.map((b) =>
          b.id === blockId ? { ...createBlock("divider"), id: b.id } : b
        )
        const textBlock = createBlock("text")
        const idx = newBlocks.findIndex((b) => b.id === blockId)
        newBlocks.splice(idx + 1, 0, textBlock)
        updateBlocks(newBlocks)
        setFocusedBlockId(textBlock.id)
      } else {
        // Convert current block to new type
        const newBlock = createBlock(type, cleanContent)
        const newBlocks = current.map((b) =>
          b.id === blockId ? { ...newBlock, id: b.id } : b
        )
        updateBlocks(newBlocks)
        setFocusedBlockId(blockId)
      }
      setSlashMenu(null)
    },
    [slashMenu, updateBlocks]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const current = blocksRef.current
      const oldIndex = current.findIndex((b) => b.id === active.id)
      const newIndex = current.findIndex((b) => b.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const newBlocks = [...current]
      const [moved] = newBlocks.splice(oldIndex, 1)
      newBlocks.splice(newIndex, 0, moved)
      updateBlocks(newBlocks)
    },
    [updateBlocks]
  )

  // Track numbered list indices
  const getNumberedIndex = (blockIndex: number): number => {
    let count = 0
    for (let i = 0; i <= blockIndex; i++) {
      if (blocks[i].type === "numbered_list") {
        if (i === blockIndex) return count
        count++
      } else {
        count = 0
      }
    }
    return count
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative",
        simplified ? "pl-2" : "pl-12",
        editable && "cursor-text"
      )}
      style={{ minHeight }}
      onClick={(e) => {
        // Click on empty area below blocks → focus last block
        if (e.target === containerRef.current) {
          const last = blocks[blocks.length - 1]
          if (last) setFocusedBlockId(last.id)
        }
      }}
    >
      {/* Collaboration presence bar */}
      {collabEnabled && otherUsers.length > 0 && (
        <div className="absolute -top-8 right-0 z-40">
          <PresenceIndicator users={otherUsers} />
        </div>
      )}

      {/* Live cursors overlay */}
      {collabEnabled && connected && (
        <LiveCursors
          containerRef={containerRef}
          emit={emit}
          on={on}
          connected={connected}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={blocks.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          {blocks.map((block, index) => (
            <SortableBlock
              key={block.id}
              block={block}
              index={index}
              totalBlocks={blocks.length}
              editable={editable}
              numberedIndex={block.type === "numbered_list" ? getNumberedIndex(index) : undefined}
              onUpdate={handleUpdateBlock}
              onDelete={handleDeleteBlock}
              onInsertAfter={handleInsertAfter}
              onSplitBlock={handleSplitBlock}
              onMergeWithPrevious={handleMergeWithPrevious}
              onIndent={handleIndent}
              onOutdent={handleOutdent}
              onFocus={setFocusedBlockId}
              onSlashMenu={handleSlashMenu}
              onShowToolbar={setToolbar}
              onHideToolbar={() => setToolbar(null)}
              focusedBlockId={focusedBlockId}
              simplified={simplified}
            />
          ))}
        </SortableContext>
      </DndContext>

      {slashMenu && (
        <SlashCommandMenu
          position={slashMenu.position}
          onSelect={handleSlashSelect}
          onClose={() => setSlashMenu(null)}
        />
      )}

      {toolbar && <InlineToolbar position={toolbar} onClose={() => setToolbar(null)} />}
    </div>
  )
}

// ── Sortable wrapper ────────────────────────────────
function SortableBlock(
  props: React.ComponentProps<typeof BlockRenderer>
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.block.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative" as const,
    zIndex: isDragging ? 50 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <BlockRenderer {...props} dragHandleProps={listeners} />
    </div>
  )
}
