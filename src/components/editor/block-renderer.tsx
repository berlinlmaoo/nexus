"use client"

import { useState, useRef, useEffect, useCallback, useLayoutEffect, type KeyboardEvent, type FormEvent } from "react"
import { cn } from "@/lib/utils"
import type { Block, BlockType } from "./types"
import {
  GripVertical,
  Plus,
  ChevronRight,
  Square,
  CheckSquare,
  Trash2,
  PlusCircle,
  MinusCircle,
  ImageIcon,
} from "lucide-react"

interface BlockRendererProps {
  block: Block
  index: number
  totalBlocks: number
  editable: boolean
  numberedIndex?: number
  onUpdate: (id: string, updates: Partial<Block>) => void
  onDelete: (id: string) => void
  onInsertAfter: (id: string, type?: BlockType) => void
  onSplitBlock: (id: string, beforeContent: string, afterContent: string, type?: BlockType) => void
  onMergeWithPrevious: (id: string) => void
  onIndent: (id: string) => void
  onOutdent: (id: string) => void
  onFocus: (id: string) => void
  onSlashMenu: (id: string, position: { top: number; left: number }) => void
  onShowToolbar: (position: { top: number; left: number }) => void
  onHideToolbar: () => void
  focusedBlockId: string | null
  dragHandleProps?: Record<string, unknown>
  simplified?: boolean
}

function getCaretCharacterOffset(root: HTMLElement): number | null {
  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(root)
  range.setEnd(selection.anchorNode ?? root, selection.anchorOffset)
  return range.toString().length
}

function setCaretCharacterOffset(root: HTMLElement, targetOffset: number) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let currentOffset = 0
  let currentNode = walker.nextNode()

  while (currentNode) {
    const textLength = currentNode.textContent?.length ?? 0
    if (currentOffset + textLength >= targetOffset) {
      range.setStart(currentNode, Math.max(0, targetOffset - currentOffset))
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }

    currentOffset += textLength
    currentNode = walker.nextNode()
  }

  range.selectNodeContents(root)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function BlockRenderer({
  block,
  index,
  editable,
  numberedIndex,
  onUpdate,
  onDelete,
  onInsertAfter,
  onSplitBlock,
  onMergeWithPrevious,
  onIndent,
  onOutdent,
  onFocus,
  onSlashMenu,
  onShowToolbar,
  onHideToolbar,
  focusedBlockId,
  dragHandleProps,
  simplified,
}: BlockRendererProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const caretOffsetRef = useRef<number | null>(null)
  const [imageUrlInput, setImageUrlInput] = useState("")
  const [showImageInput, setShowImageInput] = useState(false)

  const isFocused = focusedBlockId === block.id

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    const normalizedCurrentHtml = el.innerHTML === "<br>" ? "" : el.innerHTML
    const normalizedNextHtml = block.content || ""

    if (normalizedCurrentHtml !== normalizedNextHtml) {
      const nextCaretOffset = isFocused ? caretOffsetRef.current : null
      el.innerHTML = normalizedNextHtml

      if (isFocused && nextCaretOffset !== null) {
        setCaretCharacterOffset(el, nextCaretOffset)
      }
    }
  }, [block.content, isFocused])

  useEffect(() => {
    if (isFocused && contentRef.current && document.activeElement !== contentRef.current) {
      const el = contentRef.current
      el.focus()
      // Place cursor at end
      const range = document.createRange()
      const sel = window.getSelection()
      if (el.childNodes.length > 0) {
        range.selectNodeContents(el)
        range.collapse(false)
      } else {
        range.setStart(el, 0)
        range.collapse(true)
      }
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [isFocused])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        // Split content at cursor if possible
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && contentRef.current) {
          const range = sel.getRangeAt(0)
          const preRange = document.createRange()
          preRange.setStart(contentRef.current, 0)
          preRange.setEnd(range.startContainer, range.startOffset)
          const afterRange = document.createRange()
          afterRange.setStart(range.endContainer, range.endOffset)
          afterRange.setEnd(contentRef.current, contentRef.current.childNodes.length)
          const beforeDiv = document.createElement("div")
          beforeDiv.appendChild(preRange.cloneContents())
          const afterDiv = document.createElement("div")
          afterDiv.appendChild(afterRange.cloneContents())
          const nextType =
            block.type === "todo"
              ? "todo"
              : block.type === "bulleted_list"
                ? "bulleted_list"
                : block.type === "numbered_list"
                  ? "numbered_list"
                  : "text"

          onSplitBlock(
            block.id,
            beforeDiv.innerHTML === "<br>" ? "" : beforeDiv.innerHTML,
            afterDiv.innerHTML === "<br>" ? "" : afterDiv.innerHTML,
            nextType
          )
        } else {
          onInsertAfter(block.id)
        }
        return
      }
      if (e.key === "Backspace") {
        const el = contentRef.current
        if (el) {
          const caretOffset = getCaretCharacterOffset(el)
          const isAtStart = caretOffset === 0
          const isEmpty = el.textContent === "" || el.innerHTML === "" || el.innerHTML === "<br>"
          if (isEmpty || isAtStart) {
            e.preventDefault()
            onMergeWithPrevious(block.id)
            return
          }
        }
      }
      if (e.key === "Tab") {
        e.preventDefault()
        if (e.shiftKey) {
          onOutdent(block.id)
        } else {
          onIndent(block.id)
        }
        return
      }
    },
    [block.id, block.type, onInsertAfter, onMergeWithPrevious, onIndent, onOutdent, onSplitBlock]
  )

  const handleInput = useCallback(
    (e: FormEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const html = el.innerHTML
      caretOffsetRef.current = getCaretCharacterOffset(el)
      // Detect "/" typed as only content
      if (html === "/" || html === "<br>/") {
        const rect = el.getBoundingClientRect()
        onSlashMenu(block.id, {
          top: rect.bottom + window.scrollY,
          left: rect.left + window.scrollX,
        })
        return
      }
      // Check if last char typed was "/" after other content
      const text = el.textContent || ""
      if (text.endsWith("/")) {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0)
          const rect = range.getBoundingClientRect()
          onSlashMenu(block.id, {
            top: rect.bottom + window.scrollY,
            left: rect.left + window.scrollX,
          })
          return
        }
      }
      onUpdate(block.id, { content: html === "<br>" ? "" : html })
    },
    [block.id, onUpdate, onSlashMenu]
  )

  const handleSelect = useCallback(() => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      onShowToolbar({
        top: rect.top + window.scrollY - 48,
        left: rect.left + window.scrollX + rect.width / 2,
      })
    } else {
      onHideToolbar()
    }
  }, [onShowToolbar, onHideToolbar])

  const editableProps = {
    ref: contentRef,
    contentEditable: editable,
    suppressContentEditableWarning: true,
    onKeyDown: handleKeyDown,
    onInput: handleInput,
    onSelect: handleSelect,
    onFocus: () => onFocus(block.id),
    ...(editable ? {} : { dangerouslySetInnerHTML: { __html: block.content } }),
    "data-placeholder": block.type === "text" ? "Type '/' for commands..." : "",
  }

  const renderContent = () => {
    switch (block.type) {
      case "heading1":
        return (
          <div
            {...editableProps}
            className="text-3xl font-bold outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60"
            data-placeholder="Heading 1"
          />
        )
      case "heading2":
        return (
          <div
            {...editableProps}
            className="text-2xl font-semibold outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60"
            data-placeholder="Heading 2"
          />
        )
      case "heading3":
        return (
          <div
            {...editableProps}
            className="text-xl font-medium outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60"
            data-placeholder="Heading 3"
          />
        )
      case "todo":
        return (
          <div className="flex items-start gap-2">
            <button
              onClick={() =>
                onUpdate(block.id, {
                  properties: { ...block.properties, checked: !block.properties.checked },
                })
              }
              className="mt-0.5 flex-shrink-0"
            >
              {block.properties.checked ? (
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground/60" />
              )}
            </button>
            <div
              {...editableProps}
              className={cn(
                "flex-1 outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60",
                block.properties.checked && "line-through text-muted-foreground/60"
              )}
              data-placeholder="To-do"
            />
          </div>
        )
      case "bulleted_list":
        return (
          <div className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-foreground flex-shrink-0" />
            <div
              {...editableProps}
              className="flex-1 outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60"
              data-placeholder="List item"
            />
          </div>
        )
      case "numbered_list":
        return (
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground font-medium flex-shrink-0 min-w-[1.5em] text-right">
              {(numberedIndex ?? index) + 1}.
            </span>
            <div
              {...editableProps}
              className="flex-1 outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60"
              data-placeholder="List item"
            />
          </div>
        )
      case "quote":
        return (
          <div className="border-l-2 border-border pl-4">
            <div
              {...editableProps}
              className="italic text-muted-foreground outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60"
              data-placeholder="Quote"
            />
          </div>
        )
      case "callout":
        return (
          <div className="flex items-start gap-3 rounded-lg bg-muted/50 border border-border p-3">
            <span className="text-lg flex-shrink-0">{block.properties.icon || "💡"}</span>
            <div
              {...editableProps}
              className="flex-1 outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60"
              data-placeholder="Callout text"
            />
          </div>
        )
      case "code":
        return <CodeBlock block={block} editable={editable} onUpdate={onUpdate} onFocus={() => onFocus(block.id)} />
      case "divider":
        return <hr className="border-border my-1" />
      case "image":
        return (
          <div className="space-y-2">
            {block.properties.url ? (
              <div className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={block.properties.url}
                  alt={block.properties.alt || ""}
                  className="max-w-full rounded-lg border border-border"
                  style={block.properties.width ? { width: block.properties.width } : {}}
                />
                {editable && (
                  <button
                    onClick={() => onUpdate(block.id, { properties: { ...block.properties, url: undefined } })}
                    className="absolute top-2 right-2 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ) : editable ? (
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                {showImageInput ? (
                  <div className="flex items-center gap-2 max-w-md mx-auto">
                    <input
                      type="text"
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && imageUrlInput.trim()) {
                          onUpdate(block.id, { properties: { ...block.properties, url: imageUrlInput.trim() } })
                          setImageUrlInput("")
                          setShowImageInput(false)
                        }
                        if (e.key === "Escape") setShowImageInput(false)
                      }}
                      placeholder="Paste image URL..."
                      className="flex-1 h-8 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      autoFocus
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setShowImageInput(true)}
                    className="flex flex-col items-center gap-2 mx-auto text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-sm">Add image URL</span>
                  </button>
                )}
              </div>
            ) : null}
          </div>
        )
      case "toggle":
        return (
          <div>
            <div className="flex items-start gap-1">
              <button
                onClick={() =>
                  onUpdate(block.id, {
                    properties: { ...block.properties, collapsed: !block.properties.collapsed },
                  })
                }
                className="mt-0.5 flex-shrink-0 p-0.5 rounded hover:bg-accent transition-colors"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    !block.properties.collapsed && "rotate-90"
                  )}
                />
              </button>
              <div
                {...editableProps}
                className="flex-1 font-medium outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60"
                data-placeholder="Toggle heading"
              />
            </div>
            {!block.properties.collapsed && (
              <div className="ml-6 mt-1 pl-2 border-l border-border space-y-1">
                {block.children.length === 0 ? (
                  <p className="text-sm text-muted-foreground/60 italic">Empty toggle — click to add content</p>
                ) : (
                  block.children.map((child, i) => (
                    <BlockRenderer
                      key={child.id}
                      block={child}
                      index={i}
                      totalBlocks={block.children.length}
                      editable={editable}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      onInsertAfter={onInsertAfter}
                      onSplitBlock={onSplitBlock}
                      onMergeWithPrevious={onMergeWithPrevious}
                      onIndent={onIndent}
                      onOutdent={onOutdent}
                      onFocus={onFocus}
                      onSlashMenu={onSlashMenu}
                      onShowToolbar={onShowToolbar}
                      onHideToolbar={onHideToolbar}
                      focusedBlockId={focusedBlockId}
                      simplified={simplified}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      case "table":
        return <TableBlock block={block} editable={editable} onUpdate={onUpdate} />
      case "embed":
        return (
          <div className="space-y-2">
            {block.properties.url ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <iframe
                  src={block.properties.url}
                  className="w-full h-[400px]"
                  title="Embed"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                />
              </div>
            ) : editable ? (
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <input
                  type="text"
                  placeholder="Paste embed URL..."
                  className="w-full max-w-md mx-auto h-8 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const url = (e.target as HTMLInputElement).value.trim()
                      if (url) onUpdate(block.id, { properties: { ...block.properties, url } })
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
        )
      default:
        return (
          <div
            {...editableProps}
            className="outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60"
          />
        )
    }
  }

  if (block.type === "divider") {
    return (
      <div
        className={cn(
          "group relative py-2",
          editable && "hover:bg-accent/50"
        )}
        data-block-id={block.id}
        data-block-focused={isFocused}
      >
        {editable && !simplified && (
          <div className="absolute -left-10 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onInsertAfter(block.id)}
              className="p-0.5 rounded hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5 text-muted-foreground/60" />
            </button>
            <div {...dragHandleProps} className="cursor-grab p-0.5 rounded hover:bg-accent">
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
            </div>
          </div>
        )}
        {renderContent()}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group relative py-0.5",
        editable && "hover:bg-accent/50 rounded",
        block.type === "heading1" && "mt-6 mb-1",
        block.type === "heading2" && "mt-4 mb-0.5",
        block.type === "heading3" && "mt-3",
      )}
      data-block-id={block.id}
      data-block-focused={isFocused ? "true" : "false"}
    >
      {editable && !simplified && (
        <div className="absolute -left-10 top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onInsertAfter(block.id)}
            className="p-0.5 rounded hover:bg-accent"
            title="Add block"
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground/60" />
          </button>
          <div {...dragHandleProps} className="cursor-grab p-0.5 rounded hover:bg-accent" title="Drag to reorder">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
          </div>
        </div>
      )}
      {renderContent()}
    </div>
  )
}

// ── Code Block ──────────────────────────────────────
function CodeBlock({
  block,
  editable,
  onUpdate,
  onFocus,
}: {
  block: Block
  editable: boolean
  onUpdate: (id: string, updates: Partial<Block>) => void
  onFocus: () => void
}) {
  const codeRef = useRef<HTMLElement>(null)
  const [highlighted, setHighlighted] = useState<string>("")
  const languages = ["plaintext", "javascript", "typescript", "python", "rust", "go", "java", "html", "css", "json", "bash", "sql", "c", "cpp"]

  useEffect(() => {
    let mounted = true
    import("highlight.js/lib/common").then((hljs) => {
      if (!mounted) return
      try {
        const lang = block.properties.language || "plaintext"
        const result =
          lang === "plaintext"
            ? { value: block.content.replace(/</g, "&lt;").replace(/>/g, "&gt;") }
            : hljs.default.highlight(block.content, { language: lang })
        setHighlighted(result.value)
      } catch {
        setHighlighted(block.content.replace(/</g, "&lt;").replace(/>/g, "&gt;"))
      }
    })
    return () => { mounted = false }
  }, [block.content, block.properties.language])

  return (
    <div className="rounded-lg border border-border bg-foreground overflow-hidden">
      {editable && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-foreground border-b border-on-surface-variant">
          <select
            value={block.properties.language || "plaintext"}
            onChange={(e) =>
              onUpdate(block.id, {
                properties: { ...block.properties, language: e.target.value },
              })
            }
            className="bg-transparent text-muted-foreground text-xs border-none outline-none cursor-pointer"
          >
            {languages.map((l) => (
              <option key={l} value={l} className="bg-foreground">
                {l}
              </option>
            ))}
          </select>
        </div>
      )}
      {editable ? (
        <textarea
          value={block.content}
          onChange={(e) => onUpdate(block.id, { content: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault()
              const target = e.target as HTMLTextAreaElement
              const start = target.selectionStart
              const end = target.selectionEnd
              const value = target.value
              const newValue = value.substring(0, start) + "  " + value.substring(end)
              onUpdate(block.id, { content: newValue })
              setTimeout(() => {
                target.selectionStart = target.selectionEnd = start + 2
              }, 0)
              return
            }
            if (e.key === "Enter") {
              e.stopPropagation()
            }
          }}
          onFocus={onFocus}
          className="w-full bg-transparent text-background text-sm font-mono p-3 outline-none resize-none min-h-[60px]"
          placeholder="Write code..."
          spellCheck={false}
        />
      ) : (
        <pre className="p-3 overflow-x-auto">
          <code
            ref={codeRef}
            className="text-sm font-mono text-background"
            dangerouslySetInnerHTML={{ __html: highlighted || block.content }}
          />
        </pre>
      )}
    </div>
  )
}

// ── Table Block ──────────────────────────────────────
function TableBlock({
  block,
  editable,
  onUpdate,
}: {
  block: Block
  editable: boolean
  onUpdate: (id: string, updates: Partial<Block>) => void
}) {
  const rows = block.properties.rows || [["", "", ""], ["", "", ""], ["", "", ""]]

  const updateCell = (rowIdx: number, colIdx: number, value: string) => {
    const newRows = rows.map((r, ri) =>
      ri === rowIdx ? r.map((c, ci) => (ci === colIdx ? value : c)) : [...r]
    )
    onUpdate(block.id, { properties: { ...block.properties, rows: newRows } })
  }

  const addRow = () => {
    const cols = rows[0]?.length || 3
    onUpdate(block.id, {
      properties: { ...block.properties, rows: [...rows, Array(cols).fill("")] },
    })
  }

  const removeRow = () => {
    if (rows.length <= 1) return
    onUpdate(block.id, {
      properties: { ...block.properties, rows: rows.slice(0, -1) },
    })
  }

  const addCol = () => {
    onUpdate(block.id, {
      properties: { ...block.properties, rows: rows.map((r) => [...r, ""]) },
    })
  }

  const removeCol = () => {
    if ((rows[0]?.length || 0) <= 1) return
    onUpdate(block.id, {
      properties: { ...block.properties, rows: rows.map((r) => r.slice(0, -1)) },
    })
  }

  return (
    <div className="space-y-1">
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? "bg-muted/50" : ""}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border-b border-r border-border last:border-r-0">
                    {editable ? (
                      <input
                        value={cell}
                        onChange={(e) => updateCell(ri, ci, e.target.value)}
                        className={cn(
                          "w-full px-3 py-1.5 text-sm outline-none bg-transparent",
                          ri === 0 && "font-medium"
                        )}
                        placeholder={ri === 0 ? "Header" : ""}
                      />
                    ) : (
                      <span className={cn("block px-3 py-1.5 text-sm", ri === 0 && "font-medium")}>
                        {cell}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <button onClick={addRow} className="flex items-center gap-0.5 hover:text-muted-foreground"><PlusCircle className="h-3 w-3" /> Row</button>
          <button onClick={removeRow} className="flex items-center gap-0.5 hover:text-muted-foreground"><MinusCircle className="h-3 w-3" /> Row</button>
          <span className="text-border">|</span>
          <button onClick={addCol} className="flex items-center gap-0.5 hover:text-muted-foreground"><PlusCircle className="h-3 w-3" /> Col</button>
          <button onClick={removeCol} className="flex items-center gap-0.5 hover:text-muted-foreground"><MinusCircle className="h-3 w-3" /> Col</button>
        </div>
      )}
    </div>
  )
}
