"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
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
import { format, isPast, isToday } from "date-fns"
import { cn } from "@/lib/utils"

interface TaskListSection {
  id: string
  name: string
  tasks: TaskCardData[]
}

interface TaskListViewProps {
  sections: TaskListSection[]
  onTaskClick: (task: TaskCardData) => void
  onToggleStatus: (taskId: string, done: boolean) => void
  onAddTask: (taskListId: string) => void
  onMoveTask?: (taskId: string, newSectionId: string, newIndex: number) => void
  projectId?: string
}

export function TaskListView({
  sections,
  onTaskClick,
  onToggleStatus,
  onAddTask,
  onMoveTask,
  projectId,
}: TaskListViewProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [celebration, setCelebration] = useState(false)

  const toggleSection = (sectionId: string) => {
    const next = new Set(collapsedSections)
    if (next.has(sectionId)) next.delete(sectionId)
    else next.add(sectionId)
    setCollapsedSections(next)
  }

  const handleDragEnd = (result: DropResult) => {
    const { draggableId, destination, source } = result
    if (!destination) return
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    )
      return

    if (onMoveTask) {
      onMoveTask(draggableId, destination.droppableId, destination.index)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-12 animate-fade-in pb-24">
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="space-y-16">
          {sections.map((section) => {
            const isCollapsed = collapsedSections.has(section.id)
            return (
              <div key={section.id} className="space-y-6">
                {/* Section Header */}
                <div className="flex items-center justify-between px-2">
                  <div 
                    className="flex items-center gap-4 group cursor-pointer"
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
                  </div>
                  <button 
                    onClick={() => onAddTask(section.id)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-on-surface-variant/40 hover:text-primary hover:bg-surface-container-low transition-all duration-300"
                  >
                    <Plus className="h-4 w-4" />
                    New Task
                  </button>
                </div>

                {!isCollapsed && (
                  <>
                    {/* Task Table Headers */}
                    <div className="grid grid-cols-[32px_32px_1fr_120px_100px_120px] gap-0 items-center px-2 mb-2 border-b border-on-surface-variant/5 pb-3">
                      <div className="col-span-2" />
                      <span className="text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant/20 pl-3">Designation</span>
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
                            section.tasks.map((task, index) => {
                              const isDone = task.status === "DONE"
                              const isOverdue =
                                task.dueDate &&
                                isPast(new Date(task.dueDate)) &&
                                !isToday(new Date(task.dueDate)) &&
                                !isDone

                              return (
                                <Draggable key={task.id} draggableId={task.id} index={index}>
                                  {(provided, snapshot) => (
                                    <div
                                      ref={provided.innerRef}
                                      {...provided.draggableProps}
                                      className={cn(
                                        "group grid grid-cols-[32px_32px_1fr_120px_100px_120px] gap-0 items-center h-12 cursor-pointer transition-all duration-200 text-[13px] rounded-xl mb-1",
                                        snapshot.isDragging ? "z-50 shadow-2xl bg-surface-container-lowest ring-2 ring-primary/5 scale-[1.02]" : "hover:bg-surface-container-low"
                                      )}
                                      onClick={() => onTaskClick(task)}
                                    >
                                      <div className="flex items-center justify-center h-full">
                                        <div
                                          {...provided.dragHandleProps}
                                          className="opacity-0 group-hover:opacity-100 text-on-surface-variant/30 hover:text-primary transition-all"
                                        >
                                          <GripVertical className="h-4 w-4" />
                                        </div>
                                      </div>

                                      <div className="flex items-center justify-center h-full">
                                        <div className="scale-90" onClick={(e) => e.stopPropagation()}>
                                          <AnimatedCheckbox
                                            checked={isDone}
                                            onChange={(checked) => {
                                              onToggleStatus(task.id, checked)
                                              if (checked) setCelebration(true)
                                            }}
                                          />
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-3 min-w-0 px-3 h-full">
                                        <span
                                          className={cn(
                                            "text-[14px] font-medium transition-all duration-300 truncate",
                                            isDone ? "text-on-surface-variant/40 line-through" : "text-on-surface"
                                          )}
                                        >
                                          {task.title}
                                        </span>
                                      </div>

                                      <div className="flex items-center px-3 h-full justify-center">
                                        {task.assignees.length > 0 ? (
                                          <div className="flex -space-x-2">
                                            {task.assignees.slice(0, 3).map((a: any) => {
                                              const userData = a.user || a
                                              return (
                                                <UserAvatar 
                                                  key={userData.id || Math.random()} 
                                                  user={{ name: userData.name, image: userData.avatar }} 
                                                  size="xs" 
                                                  className="h-6 w-6 border-2 border-surface shadow-sm ring-1 ring-on-surface-variant/5" 
                                                />
                                              )
                                            })}
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
                                            <span>{format(new Date(task.dueDate), "MMM d")}</span>
                                          </div>
                                        ) : (
                                          <span className="text-on-surface-variant/10 text-[11px] font-bold">---</span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </Draggable>
                              )
                            })
                          )}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </DragDropContext>

      {celebration && (
        <TaskCelebration trigger={Date.now()} />
      )}
    </div>
  )
}
