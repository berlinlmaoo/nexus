"use client"

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
  type DraggableProvidedDragHandleProps,
} from "@hello-pangea/dnd"
import { UserAvatar } from "@/components/ui/user-avatar"
import { PriorityBadge } from "./priority-badge"
import type { TaskCardData } from "./task-card"
import { AnimatedCheckbox, TaskCelebration } from "./task-celebration"
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Calendar,
  GripVertical,
} from "lucide-react"
import { isPast, isToday } from "date-fns"
import { cn } from "@/lib/utils"
import { formatTaskDueDate } from "@/lib/task-date-format"
import { TaskCustomFieldChip } from "./task-custom-field-chip"

interface TaskListSection {
  id: string
  name: string
  tasks: TaskCardData[]
  isTemporary?: boolean
}

interface TaskListViewProps {
  sections: TaskListSection[]
  onTaskClick: (task: TaskCardData) => void
  onToggleStatus: (taskId: string, done: boolean) => void
  onAddTask: (taskListId: string) => void
  onMoveTask?: (taskId: string, newSectionId: string, newIndex: number) => void
  projectId?: string
}

interface CustomFieldColumn {
  fieldId: string
  fieldName: string
  fieldType: NonNullable<TaskCardData["customFieldChips"]>[number]["fieldType"]
}

function sortTasksDoneLast(tasks: TaskCardData[]) {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === "DONE"
    const bDone = b.status === "DONE"
    if (aDone !== bDone) return aDone ? 1 : -1
    return a.position - b.position
  })
}

interface TaskListRowProps {
  task: TaskCardData
  isDragging: boolean
  isTemporary: boolean
  dragHandleProps?: DraggableProvidedDragHandleProps | null
  customFieldColumns: CustomFieldColumn[]
  gridTemplateColumns: string
  onOpenTask: (task: TaskCardData) => void
  onToggleStatus: (taskId: string, done: boolean) => void
  onCelebrate: () => void
}

const TaskListRow = memo(function TaskListRow({
  task,
  isDragging,
  isTemporary,
  dragHandleProps,
  customFieldColumns,
  gridTemplateColumns,
  onOpenTask,
  onToggleStatus,
  onCelebrate,
}: TaskListRowProps) {
  const isDone = task.status === "DONE"
  const isOverdue =
    task.dueDate &&
    isPast(new Date(task.dueDate)) &&
    !isToday(new Date(task.dueDate)) &&
    !isDone

  const handleOpen = useCallback(() => {
    onOpenTask(task)
  }, [onOpenTask, task])

  const handleToggleStatus = useCallback((checked: boolean) => {
    onToggleStatus(task.id, checked)
    if (checked) onCelebrate()
  }, [onCelebrate, onToggleStatus, task.id])

  return (
    <div
      className={cn(
        "group grid min-h-14 cursor-pointer items-center gap-0 rounded-xl mb-1 text-[13px] transition-all duration-200 sm:min-h-12",
        isDragging ? "z-50 shadow-2xl bg-surface-container-lowest ring-2 ring-primary/5 scale-[1.02]" : "hover:bg-surface-container-low"
      )}
      style={{ gridTemplateColumns }}
      onClick={handleOpen}
    >
      <div className="flex items-center justify-center h-full">
        <div
          {...dragHandleProps}
          className={cn(
            "text-on-surface-variant/30 hover:text-primary transition-all",
            isTemporary ? "opacity-0" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      </div>

      <div className="flex items-center justify-center h-full">
        <div className="scale-90" onClick={(event) => event.stopPropagation()}>
          <AnimatedCheckbox
            checked={isDone}
            onChange={handleToggleStatus}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 min-w-0 px-3 h-full">
        <div className="min-w-0">
          {task.isCrossProject && task.primaryProjectName && (
            <p className="truncate text-[10px] font-medium text-on-surface-variant/50">
              From {task.primaryProjectName}
            </p>
          )}
          <span
            className={cn(
              "text-[14px] font-medium transition-all duration-300 truncate block",
              isDone ? "text-on-surface-variant/40 line-through" : "text-on-surface"
            )}
          >
            {task.title}
          </span>
        </div>
      </div>

      {customFieldColumns.map((column) => {
        const chip = task.customFieldChips?.find((taskChip) => taskChip.fieldId === column.fieldId)

        return (
          <div key={column.fieldId} className="flex min-w-0 items-center justify-center px-2 py-2">
            {chip ? (
              <TaskCustomFieldChip chip={chip} className="max-w-full text-[9px]" />
            ) : (
              <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/15">---</span>
            )}
          </div>
        )
      })}

      <div className="flex items-center px-3 h-full justify-center">
        {task.assignees.length > 0 ? (
          <div className="flex -space-x-2">
            {task.assignees.slice(0, 3).map((assignee) => (
              <UserAvatar
                key={assignee.id || `${task.id}-${assignee.name}`}
                user={{ name: assignee.name, image: assignee.avatar }}
                size="xs"
                className="h-6 w-6 border-2 border-surface shadow-sm ring-1 ring-on-surface-variant/5"
              />
            ))}
          </div>
        ) : (
          <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/20 group-hover:opacity-100 opacity-0 transition-opacity">None</span>
        )}
      </div>

      <div className="flex items-center px-3 h-full justify-center">
        <PriorityBadge priority={task.priority} className="text-[10px] uppercase font-black tracking-widest border-none shadow-none bg-transparent" />
      </div>

      <div className="flex items-center px-3 h-full pr-6 justify-center">
        {task.dueDate ? (
          <div className={cn(
            "flex items-center gap-1.5 text-[11px] font-bold",
            isOverdue ? "text-red-600" : "text-on-surface-variant/40"
          )}>
            <Calendar className="h-3.5 w-3.5" />
            <span>{formatTaskDueDate(task.dueDate)}</span>
          </div>
        ) : (
          <span className="text-on-surface-variant/10 text-[11px] font-bold">---</span>
        )}
      </div>
    </div>
  )
})

export function TaskListView({
  sections,
  onTaskClick,
  onToggleStatus,
  onAddTask,
  onMoveTask,
  projectId,
}: TaskListViewProps) {
  const router = useRouter()
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [celebration, setCelebration] = useState(false)
  const [showAddSection, setShowAddSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState("")
  const [creatingSection, setCreatingSection] = useState(false)
  const sectionInputRef = useRef<HTMLInputElement>(null)

  const sectionEntries = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        sortedTasks: sortTasksDoneLast(section.tasks),
      })),
    [sections]
  )

  const customFieldColumns = useMemo<CustomFieldColumn[]>(() => {
    const columns = new Map<string, CustomFieldColumn>()

    for (const section of sections) {
      for (const task of section.tasks) {
        for (const chip of task.customFieldChips ?? []) {
          if (!columns.has(chip.fieldId)) {
            columns.set(chip.fieldId, {
              fieldId: chip.fieldId,
              fieldName: chip.fieldName,
              fieldType: chip.fieldType,
            })
          }
        }
      }
    }

    return Array.from(columns.values())
  }, [sections])

  const gridTemplateColumns = useMemo(
    () =>
      [
        "32px",
        "32px",
        "minmax(280px, 1fr)",
        ...customFieldColumns.map(() => "minmax(130px, 170px)"),
        "120px",
        "100px",
        "120px",
      ].join(" "),
    [customFieldColumns]
  )

  const tableMinWidth = useMemo(
    () => 684 + customFieldColumns.length * 140,
    [customFieldColumns.length]
  )

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  const triggerCelebration = useCallback(() => {
    setCelebration(true)
  }, [])

  const handleDragEnd = useCallback((result: DropResult) => {
    const { draggableId, destination, source } = result
    if (!destination) return
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    )
      return

    const destinationSection = sections.find((section) => section.id === destination.droppableId)
    const draggedTask = sections.flatMap((section) => section.tasks).find((task) => task.id === draggableId)

    if (destinationSection?.isTemporary || draggedTask?.isCrossProject) return

    if (onMoveTask) {
      onMoveTask(draggableId, destination.droppableId, destination.index)
    }
  }, [onMoveTask, sections])

  const handleCreateSection = async () => {
    if (!newSectionName.trim() || !projectId) return
    setCreatingSection(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSectionName.trim() }),
      })
      if (res.ok) {
        setNewSectionName("")
        setShowAddSection(false)
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create section:", error)
    } finally {
      setCreatingSection(false)
    }
  }

  return (
    <div className="w-full space-y-8 animate-fade-in px-3 pb-24 sm:px-4 md:px-6 lg:px-8">
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="space-y-10">
          {sectionEntries.map((section) => {
            const isCollapsed = collapsedSections.has(section.id)
            return (
              <div key={section.id} className="space-y-6">
                {/* Section Header */}
                <div className="flex items-center justify-between gap-3 px-1 sm:px-2">
                  <div 
                    className="group flex min-w-0 cursor-pointer items-center gap-3 sm:gap-4"
                    onClick={() => toggleSection(section.id)}
                  >
                    <div className="h-8 w-8 rounded-xl bg-surface-container flex items-center justify-center text-primary transition-all group-hover:bg-primary group-hover:text-primary-foreground shadow-sm">
                      {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                    <h3 className="font-headline font-black text-xs uppercase tracking-[0.25em] text-on-surface">
                      {section.name}
                    </h3>
                    <span className="bg-surface-container-high px-2.5 py-0.5 rounded-full text-[10px] font-black text-on-surface-variant/60 tabular-nums">
                      {section.tasks.length}
                    </span>
                    {section.isTemporary && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-primary">
                        Linked
                      </span>
                    )}
                  </div>
                  {!section.isTemporary && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        onAddTask(section.id)
                      }}
                      className="touch-target flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-on-surface-variant/60 transition-all duration-300 hover:bg-surface-container-low hover:text-primary sm:min-h-0 sm:px-4"
                    >
                      <Plus className="h-4 w-4" />
                      New Task
                    </button>
                  )}
                </div>

                {!isCollapsed && (
                  <>
                    <div className="mobile-horizontal-scroll overflow-x-auto pb-2">
                      <div style={{ minWidth: tableMinWidth }}>
                        {/* Task Table Headers */}
                        <div
                          className="grid gap-0 items-center px-2 mb-2 border-b border-on-surface-variant/5 pb-3"
                          style={{ gridTemplateColumns }}
                        >
                          <div className="col-span-2" />
                          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant/20 pl-3">Designation</span>
                          {customFieldColumns.map((column) => (
                            <span
                              key={column.fieldId}
                              className="truncate px-2 text-center text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant/20"
                              title={column.fieldName}
                            >
                              {column.fieldName}
                            </span>
                          ))}
                          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant/20 text-center">Resources</span>
                          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant/20 text-center">Priority</span>
                          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant/20 text-center">Timeline</span>
                        </div>

                        <Droppable droppableId={section.id}>
                          {(provided) => (
                            <div
                              {...provided.droppableProps}
                              ref={provided.innerRef}
                              className="space-y-1 min-h-[20px]"
                            >
                              {section.tasks.length === 0 ? (
                                <div className="py-12 text-center text-on-surface-variant/20 italic text-sm bg-surface-container-low/10 rounded-[2rem] border-2 border-dashed border-on-surface-variant/5">
                                  No tasks in this sanctuary.
                                </div>
                              ) : (
                                section.sortedTasks.map((task, index) => (
                                    <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={Boolean(section.isTemporary || task.isCrossProject)}>
                                      {(provided, snapshot) => (
                                        <div
                                          ref={provided.innerRef}
                                          {...provided.draggableProps}
                                        >
                                          <TaskListRow
                                            task={task}
                                            isDragging={snapshot.isDragging}
                                            isTemporary={Boolean(section.isTemporary || task.isCrossProject)}
                                            dragHandleProps={provided.dragHandleProps}
                                            customFieldColumns={customFieldColumns}
                                            gridTemplateColumns={gridTemplateColumns}
                                            onOpenTask={onTaskClick}
                                            onToggleStatus={onToggleStatus}
                                            onCelebrate={triggerCelebration}
                                          />
                                        </div>
                                      )}
                                    </Draggable>
                                ))
                              )}
                              {provided.placeholder}
                            </div>
                          )}
                        </Droppable>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </DragDropContext>

      {projectId && (
        <div className="rounded-[2rem] border border-dashed border-on-surface-variant/10 bg-surface-container-low/20 p-5">
          {showAddSection ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                ref={sectionInputRef}
                type="text"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newSectionName.trim()) handleCreateSection()
                  if (e.key === "Escape") {
                    setShowAddSection(false)
                    setNewSectionName("")
                  }
                }}
                placeholder="New section name..."
                disabled={creatingSection}
                className="h-12 flex-1 rounded-2xl bg-surface-container-lowest px-5 text-sm font-bold text-on-surface outline-none placeholder:text-on-surface-variant/30"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowAddSection(false)
                    setNewSectionName("")
                  }}
                  className="h-12 rounded-2xl px-5 text-xs font-black uppercase tracking-widest text-on-surface-variant/50 transition-colors hover:text-on-surface"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSection}
                  disabled={creatingSection || !newSectionName.trim()}
                  className="h-12 rounded-2xl bg-primary px-6 text-xs font-black uppercase tracking-widest text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creatingSection ? "Creating..." : "Add Section"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setShowAddSection(true)
                setTimeout(() => sectionInputRef.current?.focus(), 50)
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-xs font-black uppercase tracking-[0.2em] text-on-surface-variant/50 transition-colors hover:text-primary"
            >
              <Plus className="h-4 w-4" />
              Add Section
            </button>
          )}
        </div>
      )}

      {celebration && (
        <TaskCelebration trigger={Date.now()} />
      )}
    </div>
  )
}
