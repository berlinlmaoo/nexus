"use client"

import { useState, useCallback, useMemo, lazy, Suspense, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { SkeletonList, SkeletonKanban } from "@/components/ui/skeleton"
import { TaskListView } from "@/components/tasks/task-list-view"
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { AddPageDialog } from "@/components/projects/add-page-dialog"
import { BlockEditor } from "@/components/editor/block-editor"
import type { TaskCardData } from "@/components/tasks/task-card"
import type { Block } from "@/components/editor/types"
import {
  ChevronRight,
  Plus,
  Square,
  CheckSquare,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/stores/app-store"

const KanbanView = lazy(() => import("@/components/tasks/kanban-view").then(m => ({ default: m.KanbanView })))
const CalendarView = lazy(() => import("@/components/tasks/calendar-view").then(m => ({ default: m.CalendarView })))

interface PageData {
  id: string
  name: string
  icon: string
  pageType: string
  content: Record<string, unknown> | null
  parent: { id: string; name: string; icon: string } | null
  children: { id: string; name: string; icon: string; pageType: string }[]
  project: {
    id: string
    name: string
    icon: string
    color: string
    members: { id: string; name: string; avatar: string | null; role: string }[]
    taskLists: { id: string; name: string }[]
  }
}

interface PageViewClientProps {
  page: PageData
  tasks: TaskCardData[]
}

interface TodoItem {
  id: string
  text: string
  done: boolean
}

function PageBreadcrumb({ page }: { page: PageData }) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Link
        href={`/projects/${page.project.id}`}
        className="hover:text-foreground transition-colors"
      >
        {page.project.name}
      </Link>
      {page.parent && (
        <>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link
            href={`/projects/${page.project.id}/pages/${page.parent.id}`}
            className="hover:text-foreground transition-colors"
          >
            {page.parent.icon} {page.parent.name}
          </Link>
        </>
      )}
      <ChevronRight className="h-3.5 w-3.5" />
      <span className="text-foreground font-medium">
        {page.icon} {page.name}
      </span>
    </div>
  )
}

function EditablePageHeader({
  page,
  projectId,
}: {
  page: PageData
  projectId: string
}) {
  const router = useRouter()
  const [name, setName] = useState(page.name)
  const [icon] = useState(page.icon)
  const [editing, setEditing] = useState(false)

  const handleSave = async () => {
    if (name.trim() && (name !== page.name || icon !== page.icon)) {
      await fetch(`/api/projects/${projectId}/pages/${page.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), icon }),
      })
      router.refresh()
    }
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-3xl">{icon}</span>
      {editing ? (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
          autoFocus
          className="text-2xl font-bold bg-transparent border-b-2 border-border outline-none focus:border-ring transition-colors"
        />
      ) : (
        <h1
          className="text-2xl font-bold cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
          onClick={() => setEditing(true)}
        >
          {name}
        </h1>
      )}
    </div>
  )
}

function TodoView({ page }: { page: PageData }) {
  const [items, setItems] = useState<TodoItem[]>(() => {
    const content = page.content as { todos?: TodoItem[] } | null
    return content?.todos || []
  })
  const [newText, setNewText] = useState("")

  const saveItems = useCallback(async (updated: TodoItem[]) => {
    setItems(updated)
    await fetch(`/api/projects/${page.project.id}/pages/${page.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { todos: updated } }),
    })
  }, [page.project.id, page.id])

  const addItem = () => {
    if (!newText.trim()) return
    const newItem = { id: Date.now().toString(), text: newText.trim(), done: false }
    saveItems([...items, newItem])
    setNewText("")
  }

  const toggleItem = (id: string) => {
    saveItems(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)))
  }

  const deleteItem = (id: string) => {
    saveItems(items.filter((i) => i.id !== id))
  }

  const pendingCount = items.filter((i) => !i.done).length
  const doneCount = items.filter((i) => i.done).length

  return (
    <div className="max-w-2xl space-y-4">
      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>{pendingCount} pending</span>
        <span>{doneCount} done</span>
        {items.length > 0 && (
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-xs">
            <div
              className="h-full bg-foreground rounded-full transition-all duration-300"
              style={{ width: `${items.length > 0 ? (doneCount / items.length) * 100 : 0}%` }}
            />
          </div>
        )}
      </div>

      {/* Add item */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addItem() }}
          placeholder="Add a to-do item..."
          className="flex-1 h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-all"
        />
        <Button onClick={addItem} size="sm" disabled={!newText.trim()} className="bg-foreground hover:bg-foreground/90">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Items */}
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.id}
            className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
          >
            <button onClick={() => toggleItem(item.id)} className="shrink-0">
              {item.done ? (
                <CheckSquare className="h-4.5 w-4.5 text-foreground" />
              ) : (
                <Square className="h-4.5 w-4.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
              )}
            </button>
            <span className={cn("flex-1 text-sm", item.done && "line-through text-muted-foreground")}>
              {item.text}
            </span>
            <button
              onClick={() => deleteItem(item.id)}
              className="text-xs text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
            >
              Remove
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-center py-8 text-sm text-muted-foreground">
            No items yet. Add your first to-do above.
          </p>
        )}
      </div>
    </div>
  )
}

function CustomPageView({ page }: { page: PageData }) {
  const defaultBlock: Block[] = [{ id: "1", type: "text", content: "", children: [], properties: {} }]
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const content = page.content as { blocks?: Block[] } | null
    return content?.blocks || defaultBlock
  })

  const handleChange = useCallback(async (updatedBlocks: Block[]) => {
    setBlocks(updatedBlocks)
    await fetch(`/api/projects/${page.project.id}/pages/${page.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { blocks: updatedBlocks } }),
    })
  }, [page.project.id, page.id])

  return (
    <div className="max-w-3xl">
      <BlockEditor initialBlocks={blocks} onChange={handleChange} editable />
    </div>
  )
}

function SubPagesGrid({ pages, projectId }: { pages: PageData["children"]; projectId: string }) {
  if (pages.length === 0) return null
  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sub-pages</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {pages.map((child) => (
          <Link
            key={child.id}
            href={`/projects/${projectId}/pages/${child.id}`}
            className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 hover:border-border transition-all duration-150"
          >
            <span className="text-xl">{child.icon}</span>
            <span className="text-sm font-medium truncate">{child.name}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function PageViewClient({ page, tasks }: PageViewClientProps) {
  const router = useRouter()
  const [selectedTask, setSelectedTask] = useState<TaskCardData | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const { setTaskPanelOpen } = useAppStore()

  const defaultTaskListId = page.project.taskLists[0]?.id

  // Sync task panel open state to app store so GIDEON button can hide
  useEffect(() => {
    setTaskPanelOpen(!!selectedTask)
    return () => setTaskPanelOpen(false)
  }, [selectedTask, setTaskPanelOpen])

  const handleTaskClick = useCallback((task: TaskCardData) => {
    setSelectedTask(task)
  }, [])

  const handleToggleStatus = useCallback(
    async (taskId: string, done: boolean) => {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: done ? "DONE" : "TODO" }),
      })
      router.refresh()
    },
    [router]
  )

  const handleStatusChange = useCallback(
    async (taskId: string, newStatus: TaskCardData["status"]) => {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      router.refresh()
    },
    [router]
  )

  const handleAddTask = useCallback(() => {
    setCreateDialogOpen(true)
  }, [])

  // Build sections for list view
  const taskSections = useMemo(() => {
    const statusGroups: Record<string, TaskCardData[]> = {}
    tasks.forEach((t) => {
      if (!statusGroups[t.status]) statusGroups[t.status] = []
      statusGroups[t.status].push(t)
    })
    return Object.entries(statusGroups).map(([status, groupTasks]) => ({
      id: status,
      name: status.replace("_", " "),
      tasks: groupTasks,
    }))
  }, [tasks])

  const renderPageContent = () => {
    switch (page.pageType) {
      case "tasks":
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setCreateDialogOpen(true)}
                size="sm"
                className="bg-foreground hover:bg-foreground/90"
              >
                <Plus className="h-4 w-4 mr-1" /> Add Task
              </Button>
            </div>
            <TaskListView
              sections={taskSections}
              onTaskClick={handleTaskClick}
              onToggleStatus={handleToggleStatus}
              onAddTask={handleAddTask}
              projectId={page.project.id}
            />
          </div>
        )

      case "board":
        return (
          <div className="space-y-4">
            <Button
              onClick={() => setCreateDialogOpen(true)}
              size="sm"
              className="bg-foreground hover:bg-foreground/90"
            >
              <Plus className="h-4 w-4 mr-1" /> Add Task
            </Button>
            <Suspense fallback={<SkeletonKanban />}>
              <KanbanView
                tasks={tasks}
                onTaskClick={handleTaskClick}
                onStatusChange={handleStatusChange}
                projectId={page.project.id}
                defaultTaskListId={defaultTaskListId}
              />
            </Suspense>
          </div>
        )

      case "calendar":
        return (
          <Suspense fallback={<SkeletonKanban />}>
            <CalendarView
              tasks={tasks}
              onTaskClick={handleTaskClick}
              projectId={page.project.id}
              defaultTaskListId={defaultTaskListId}
            />
          </Suspense>
        )

      case "documents":
        return <DocumentsView projectId={page.project.id} />

      case "todo":
        return <TodoView page={page} />

      case "database":
        return <DatabasePageView projectId={page.project.id} />

      case "custom":
      default:
        return <CustomPageView page={page} />
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageBreadcrumb page={page} />
      <EditablePageHeader page={page} projectId={page.project.id} />

      {renderPageContent()}

      <SubPagesGrid pages={page.children} projectId={page.project.id} />

      {/* Add sub-page button */}
      <AddPageDialog projectId={page.project.id} parentId={page.id}>
        <Button variant="outline" size="sm" className="border-dashed text-muted-foreground">
          <Plus className="h-4 w-4 mr-1" /> Add sub-page
        </Button>
      </AddPageDialog>

      {/* Task creation dialog (for tasks/board views) */}
      {(page.pageType === "tasks" || page.pageType === "board") && (
        <CreateTaskDialog
          projectId={page.project.id}
          taskLists={page.project.taskLists}
          defaultTaskListId={defaultTaskListId}
          onCreated={() => { setCreateDialogOpen(false); router.refresh() }}
        >
          <span />
        </CreateTaskDialog>
      )}

      {/* Task detail panel */}
      {selectedTask && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setSelectedTask(null)}
          />
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onUpdate={() => router.refresh()}
          />
        </>
      )}
    </div>
  )
}

function DocumentsView({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<{ id: string; title: string; updatedAt: string; icon: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  useState(() => {
    fetch(`/api/docs?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { setDocs(Array.isArray(data) ? data : data.docs || []); setLoading(false) })
      .catch(() => setLoading(false))
  })

  if (loading) return <SkeletonList rows={4} />

  return (
    <div className="space-y-2">
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No documents yet.</p>
      ) : (
        docs.map((doc) => (
          <Link
            key={doc.id}
            href={`/docs/${doc.id}`}
            className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
          >
            <span className="text-lg">{doc.icon || "📄"}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{doc.title}</p>
              <p className="text-xs text-muted-foreground">
                Updated {new Date(doc.updatedAt).toLocaleDateString()}
              </p>
            </div>
          </Link>
        ))
      )}
    </div>
  )
}

function DatabasePageView({ projectId }: { projectId: string }) {
  const InlineDatabase = lazy(() =>
    import("@/components/databases/inline-database").then(m => ({ default: m.InlineDatabase }))
  )

  return (
    <Suspense fallback={<SkeletonList rows={6} />}>
      <InlineDatabase type="tasks" projectId={projectId} viewType="table" />
    </Suspense>
  )
}
