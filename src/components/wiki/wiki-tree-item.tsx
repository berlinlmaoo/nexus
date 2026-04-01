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
    <div className="relative">
      {depth > 0 && (
        <div 
          className="absolute left-0 top-0 bottom-0 w-[1px] bg-on-surface-variant/5" 
          style={{ left: `${(depth - 1) * 16 + 18}px` }}
        />
      )}
      
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex items-center w-full gap-2 px-3 py-2 rounded-xl transition-all duration-300 group cursor-pointer relative z-10",
          isActive
            ? "bg-surface-container-high text-primary shadow-sm shadow-primary/5"
            : "text-on-surface-variant/60 hover:bg-surface-container-low hover:text-primary"
        )}
        style={{ marginLeft: `${depth * 16}px`, width: `calc(100% - ${depth * 16}px)` }}
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
            className="flex h-5 w-5 items-center justify-center rounded-lg hover:bg-surface-container transition-all text-on-surface-variant/20 hover:text-primary"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-300 ease-in-out",
                expanded && "rotate-90"
              )}
            />
          </button>
        ) : (
          <div className="w-5" />
        )}

        <span className="text-sm shrink-0 flex items-center justify-center h-5 w-5">
          {doc.icon || <FileText className={cn("h-4 w-4", isActive ? "text-primary" : "text-on-surface-variant/30 group-hover:text-primary/40")} />}
        </span>

        <span className={cn(
          "truncate flex-1 text-left text-[13px] tracking-tight transition-all",
          isActive ? "font-bold" : "font-medium"
        )}>
          {doc.title}
        </span>

        {hasChildren && (
          <span className="text-[9px] font-black tabular-nums text-on-surface-variant/20 bg-surface-container px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all">
            {doc.children.length}
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-300">
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
