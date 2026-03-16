"use client"

import { useState } from "react"
import { ChevronRight, FileText, MoreHorizontal, GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"

interface WikiDoc {
  id: string
  title: string
  icon: string | null
  children: WikiDoc[]
  verificationStatus: string | null
  updatedAt: string
}

interface WikiTreeItemProps {
  doc: WikiDoc
  depth: number
  activeDocId: string | null
  onSelect: (docId: string) => void
  onContextMenu: (e: React.MouseEvent, docId: string) => void
}

export function WikiTreeItem({
  doc,
  depth,
  activeDocId,
  onSelect,
  onContextMenu,
}: WikiTreeItemProps) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = doc.children.length > 0
  const isActive = activeDocId === doc.id

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex items-center w-full gap-1 px-2 py-1.5 text-sm rounded-md transition-colors group cursor-pointer",
          isActive
            ? "bg-zinc-200 dark:bg-zinc-700 text-foreground font-medium"
            : "text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(doc.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onSelect(doc.id)
          }
        }}
        onContextMenu={(e) => onContextMenu(e, doc.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
            className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200",
                expanded && "rotate-90"
              )}
            />
          </button>
        ) : (
          <span className="w-4.5" />
        )}

        <span className="text-base leading-none">
          {doc.icon || <FileText className="h-4 w-4 inline" />}
        </span>

        <span className="truncate flex-1 text-left">{doc.title}</span>

        {hasChildren && (
          <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            {doc.children.length}
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <div className="animate-slide-down">
          {doc.children.map((child) => (
            <WikiTreeItem
              key={child.id}
              doc={child}
              depth={depth + 1}
              activeDocId={activeDocId}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}
