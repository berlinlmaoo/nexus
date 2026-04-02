"use client"

import { useState, useCallback, useRef } from "react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd"
import { UserAvatar } from "@/components/ui/user-avatar"
import type { TaskCardData } from "./task-card"
import { cn } from "@/lib/utils"
import { Plus, Loader2, Calendar, MoreHorizontal, Pencil, Trash2, GripVertical } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useRouter } from "next/navigation"
import { format, isPast, isToday } from "date-fns"

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-yellow-500",
  LOW: "bg-blue-400",
  NONE: "",
}

interface Section {
  id: string
  name: string
  tasks: TaskCardData[]
}

interface BoardViewProps {
  tasks: TaskCardData[]
  sections?: Section[]
  onTaskClick: (task: TaskCardData) => void
  onStatusChange: (taskId: string, newStatus: TaskCardData["status"]) => void
  onSectionChange?: (taskId: string, newSectionId: string) => void
  projectId?: string
  defaultTaskListId?: string
}

export function BoardView({
  tasks,
  sections,
  onTaskClick,
  onStatusChange,
  onSectionChange,
  projectId,
  defaultTaskListId,
}: BoardViewProps) {
  const router = useRouter()
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [renamingColumn, setRenamingColumn] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [showAddSection, setShowAddSection] = useState(false)
  const [addingSectionName, setAddingSectionName] = useState("")
  const [creatingSec, setCreatingSec] = useState(false)
  const [deletingColumn, setDeletingColumn] = useState<string | null>(null)
  const [confirmDeleteColumn, setConfirmDeleteColumn] = useState<{ id: string; name: string } | null>(null)
  const sectionInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Use sections as columns (Asana-style)
  const columns = sections || []

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result
      if (!destination) return
      if (destination.droppableId === source.droppableId && destination.index === source.index) return

      const newSectionId = destination.droppableId
      if (onSectionChange) {
        onSectionChange(draggableId, newSectionId)
      }
    },
    [onSectionChange]
  )

  const handleQuickAdd = async (sectionId: string) => {
    if (!newTitle.trim() || !projectId) return
    setCreating(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          taskListId: sectionId,
          projectId,
        }),
      })
      if (res.ok) {
        setNewTitle("")
        setAddingTo(null)
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create task:", error)
    } finally {
      setCreating(false)
    }
  }

  const startAdding = (columnId: string) => {
    setAddingTo(columnId)
    setNewTitle("")
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleCreateSection = async () => {
    if (!addingSectionName.trim() || !projectId) return
    setCreatingSec(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addingSectionName.trim() }),
      })
      if (res.ok) {
        setAddingSectionName("")
        setShowAddSection(false)
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create section:", error)
    } finally {
      setCreatingSec(false)
    }
  }

  const handleRenameColumn = async (columnId: string) => {
    if (!renameValue.trim() || !projectId) return
    try {
      await fetch(`/api/projects/${projectId}/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: columnId, name: renameValue.trim() }),
      })
      setRenamingColumn(null)
      router.refresh()
    } catch (error) {
      console.error("Failed to rename section:", error)
    }
  }

  const handleDeleteColumn = async (columnId: string) => {
    if (!projectId) return
    setDeletingColumn(columnId)
    try {
      await fetch(`/api/projects/${projectId}/sections`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: columnId }),
      })
      router.refresh()
    } catch (error) {
      console.error("Failed to delete section:", error)
    } finally {
      setDeletingColumn(null)
    }
  }

  const handleReorderColumn = async (columnId: string, newPosition: number) => {
    if (!projectId) return
    try {
      await fetch(`/api/projects/${projectId}/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: columnId, position: newPosition }),
      })
      router.refresh()
    } catch (error) {
      console.error("Failed to reorder section:", error)
    }
  }

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-3 pb-4 overflow-x-auto min-w-0 w-full h-full px-3 pt-3">
        {columns.map((column) => (
          <div
            key={column.id}
            className="flex-1 min-w-[250px] flex flex-col"
          >
            {/* Column header */}
            <div className="group/col flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Reorder arrows */}
                {projectId && columns.length > 1 && (
                  <div className="flex flex-col opacity-0 group-hover/col:opacity-100 transition-opacity">
                    {columns.indexOf(column) > 0 && (
                      <button
                        className="text-muted-foreground/40 hover:text-muted-foreground p-0"
                        onClick={() => handleReorderColumn(column.id, columns.indexOf(column) - 1)}
                        title="Move left"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {renamingColumn === column.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameColumn(column.id)
                      if (e.key === "Escape") setRenamingColumn(null)
                    }}
                    onBlur={() => {
                      if (renameValue.trim()) handleRenameColumn(column.id)
                      else setRenamingColumn(null)
                    }}
                    className="text-[13px] font-semibold bg-transparent outline-none border-b border-foreground/30 px-0.5 min-w-0"
                    autoFocus
                  />
                ) : (
                  <>
                    <h3 className="text-[13px] font-semibold text-foreground truncate">{column.name}</h3>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {column.tasks.length}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 hidden group-hover/col:inline" title="Board view groups tasks by project sections">by section</span>
                  </>
                )}
              </div>

              {/* Column context menu */}
              {projectId && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="opacity-0 group-hover/col:opacity-100 p-1 rounded hover:bg-muted/60 transition-opacity text-muted-foreground shrink-0">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() => {
                        setRenamingColumn(column.id)
                        setRenameValue(column.name)
                        setTimeout(() => renameInputRef.current?.focus(), 50)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-2" />
                      Rename Section
                    </DropdownMenuItem>
                    {columns.indexOf(column) > 0 && (
                      <DropdownMenuItem
                        onClick={() => handleReorderColumn(column.id, columns.indexOf(column) - 1)}
                      >
                        Move Left
                      </DropdownMenuItem>
                    )}
                    {columns.indexOf(column) < columns.length - 1 && (
                      <DropdownMenuItem
                        onClick={() => handleReorderColumn(column.id, columns.indexOf(column) + 1)}
                      >
                        Move Right
                      </DropdownMenuItem>
                    )}
                    {columns.length > 1 && (
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        disabled={deletingColumn === column.id}
                        onClick={() => setConfirmDeleteColumn({ id: column.id, name: column.name })}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete Section
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Droppable area */}
            <Droppable droppableId={column.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    "flex-1 space-y-2 rounded-lg p-1.5 min-h-[120px] transition-colors duration-150",
                    snapshot.isDraggingOver
                      ? "bg-muted/60"
                      : "bg-transparent"
                  )}
                >
                  {column.tasks
                    .sort((a, b) => a.position - b.position)
                    .map((task, index) => {
                    const isOverdue =
                      task.dueDate &&
                      isPast(new Date(task.dueDate)) &&
                      !isToday(new Date(task.dueDate)) &&
                      task.status !== "DONE"

                    return (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                          >
                            <div
                              className={cn(
                                "rounded-lg border bg-white dark:bg-zinc-900 p-3 cursor-pointer transition-all duration-150",
                                "hover:shadow-md",
                                snapshot.isDragging && "shadow-xl ring-1 ring-border"
                              )}
                              onClick={() => onTaskClick(task)}
                            >
                              {/* Spacer — status badge removed (card is already in correct column) */}

                              {/* Task name */}
                              <p className="text-[13px] font-medium text-foreground leading-snug line-clamp-2">
                                {task.title}
                              </p>

                              {/* Bottom: date + priority pill + avatar */}
                              <div className="flex items-center justify-between mt-3">
                                <div className="flex items-center gap-2">
                                  {task.dueDate && (
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1 text-[11px]",
                                        isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"
                                      )}
                                    >
                                      <Calendar className="h-3 w-3" />
                                      {format(new Date(task.dueDate), "MMM d")}
                                    </span>
                                  )}
                                  {task.priority !== "NONE" && PRIORITY_COLORS[task.priority] && (
                                    <span className="inline-flex items-center gap-1">
                                      <span className={cn("h-2 w-2 rounded-full", PRIORITY_COLORS[task.priority])} />
                                      <span className="text-[10px] text-muted-foreground capitalize">{task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}</span>
                                    </span>
                                  )}
                                </div>

                                {task.assignees.length > 0 && (
                                  <div className="flex -space-x-1">
                                    {task.assignees.slice(0, 2).map((a) => (
                                      <UserAvatar
                                        key={a.id}
                                        user={{ name: a.name, avatar: a.avatar }}
                                        size="xs"
                                        className="h-6 w-6 border border-white dark:border-zinc-900"
                                      />
                                    ))}
                                    {task.assignees.length > 2 && (
                                      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white dark:border-zinc-900 bg-muted text-[8px] font-medium text-muted-foreground">
                                        +{task.assignees.length - 2}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    )
                  })}
                  {provided.placeholder}

                  {/* Empty state */}
                  {column.tasks.length === 0 && !snapshot.isDraggingOver && addingTo !== column.id && (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-xs text-muted-foreground/40">No tasks</p>
                    </div>
                  )}

                  {/* Inline quick-add */}
                  {addingTo === column.id && (
                    <div className="rounded-lg border bg-white dark:bg-zinc-900 p-2.5">
                      <input
                        ref={inputRef}
                        type="text"
                        placeholder="Task name..."
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newTitle.trim()) handleQuickAdd(column.id)
                          if (e.key === "Escape") { setAddingTo(null); setNewTitle("") }
                        }}
                        onBlur={() => { if (!newTitle.trim()) setAddingTo(null) }}
                        disabled={creating}
                        className="w-full text-[13px] bg-transparent outline-none placeholder:text-muted-foreground/50"
                      />
                      {creating && (
                        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Creating...
                        </div>
                      )}
                    </div>
                  )}

                  {/* Add button */}
                  {addingTo !== column.id && projectId && (
                    <button
                      onClick={() => startAdding(column.id)}
                      className="flex items-center gap-1.5 w-full rounded-lg px-2 py-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add task
                    </button>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        ))}
        {/* Add Section column */}
        {projectId && (
          <div className="flex-shrink-0 w-72 flex flex-col">
            {showAddSection ? (
              <div className="rounded-lg border bg-white dark:bg-zinc-900 p-2.5">
                <input
                  ref={sectionInputRef}
                  type="text"
                  placeholder="Section name..."
                  value={addingSectionName}
                  onChange={(e) => setAddingSectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && addingSectionName.trim()) handleCreateSection()
                    if (e.key === "Escape") { setShowAddSection(false); setAddingSectionName("") }
                  }}
                  onBlur={() => { if (!addingSectionName.trim()) setShowAddSection(false) }}
                  disabled={creatingSec}
                  className="w-full text-[13px] font-semibold bg-transparent outline-none placeholder:text-muted-foreground/50"
                  autoFocus
                />
                {creatingSec && (
                  <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Creating...
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => {
                  setShowAddSection(true)
                  setAddingSectionName("")
                  setTimeout(() => sectionInputRef.current?.focus(), 50)
                }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30 transition-colors border border-dashed border-border/50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Section
              </button>
            )}
          </div>
        )}
      </div>
      </DragDropContext>

      <ConfirmDialog
        open={!!confirmDeleteColumn}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteColumn(null)
        }}
        title="Delete section?"
        description={
          confirmDeleteColumn
            ? `Delete "${confirmDeleteColumn.name}"? Tasks in this section will be moved to the first remaining section.`
            : ""
        }
        confirmLabel="Delete section"
        icon={<Trash2 className="h-5 w-5" />}
        isLoading={deletingColumn === confirmDeleteColumn?.id}
        onConfirm={async () => {
          if (!confirmDeleteColumn) return
          await handleDeleteColumn(confirmDeleteColumn.id)
          setConfirmDeleteColumn(null)
        }}
      />
    </>
  )
}
