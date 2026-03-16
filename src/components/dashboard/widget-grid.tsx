import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
  type LayoutItem,
  type ResponsiveLayouts,
} from "react-grid-layout"
import { WidgetWrapper } from "./widget-wrapper"
import { AddWidgetDialog } from "./add-widget-dialog"
import { MyTasksDashWidget } from "./widgets/my-tasks-widget"
import { ProjectSummaryWidget } from "./widgets/project-summary-widget"
import { RecentActivityWidget } from "./widgets/recent-activity-widget"
import { CalendarWidget } from "./widgets/calendar-widget"
import { QuickActionsWidget } from "./widgets/quick-actions-widget"
import { TeamStatusWidget } from "./widgets/team-status-widget"
import { ChartDashWidget } from "./widgets/chart-widget"
import { NotesDashWidget } from "./widgets/notes-widget"
import { GoalsDashWidget } from "./widgets/goals-widget"
import { FavoritesDashWidget } from "./widgets/favorites-widget"
import { ClockDashWidget } from "./widgets/clock-widget"
import { MetricsDashWidget } from "./widgets/metrics-widget"
import { Button } from "@/components/ui/button"
import { Settings2, Plus, RotateCcw } from "lucide-react"

type Layouts = ResponsiveLayouts<string>

export interface WidgetConfig {
  id: string
  type: string
  title: string
  icon: string
}

export interface DashboardLayoutState {
  widgets: WidgetConfig[]
  layouts: Layouts
}

const WIDGET_REGISTRY: Record<
  string,
  {
    title: string
    icon: string
    description: string
    defaultW: number
    defaultH: number
    minW?: number
    minH?: number
  }
> = {
  "my-tasks": {
    title: "My Tasks",
    icon: "CheckSquare",
    description: "Tasks due soon and overdue",
    defaultW: 2,
    defaultH: 3,
    minW: 1,
    minH: 2,
  },
  "project-summary": {
    title: "Project Summary",
    icon: "FolderKanban",
    description: "Project health overview",
    defaultW: 2,
    defaultH: 2,
    minW: 1,
    minH: 2,
  },
  "recent-activity": {
    title: "Recent Activity",
    icon: "Activity",
    description: "Activity feed across projects",
    defaultW: 2,
    defaultH: 3,
    minW: 1,
    minH: 2,
  },
  calendar: {
    title: "Calendar",
    icon: "Calendar",
    description: "Mini calendar with task dots",
    defaultW: 2,
    defaultH: 3,
    minW: 2,
    minH: 3,
  },
  "quick-actions": {
    title: "Quick Actions",
    icon: "Zap",
    description: "Quick action buttons",
    defaultW: 1,
    defaultH: 2,
    minW: 1,
    minH: 1,
  },
  "team-status": {
    title: "Team Status",
    icon: "Users",
    description: "Team members online/offline",
    defaultW: 1,
    defaultH: 2,
    minW: 1,
    minH: 2,
  },
  chart: {
    title: "Charts",
    icon: "BarChart3",
    description: "Configurable task charts",
    defaultW: 2,
    defaultH: 3,
    minW: 2,
    minH: 2,
  },
  notes: {
    title: "Notes",
    icon: "StickyNote",
    description: "Personal sticky notes",
    defaultW: 1,
    defaultH: 2,
    minW: 1,
    minH: 2,
  },
  goals: {
    title: "Goals",
    icon: "Target",
    description: "Goal progress bars",
    defaultW: 2,
    defaultH: 2,
    minW: 1,
    minH: 2,
  },
  favorites: {
    title: "Favorites",
    icon: "Star",
    description: "Pinned/favorited items",
    defaultW: 1,
    defaultH: 2,
    minW: 1,
    minH: 2,
  },
  clock: {
    title: "Clock",
    icon: "Clock",
    description: "Clock + timezone display",
    defaultW: 1,
    defaultH: 2,
    minW: 1,
    minH: 2,
  },
  metrics: {
    title: "Metrics",
    icon: "TrendingUp",
    description: "Key performance metrics",
    defaultW: 2,
    defaultH: 2,
    minW: 1,
    minH: 2,
  },
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "my-tasks-1", type: "my-tasks", title: "My Tasks", icon: "CheckSquare" },
  { id: "calendar-1", type: "calendar", title: "Calendar", icon: "Calendar" },
  { id: "recent-activity-1", type: "recent-activity", title: "Recent Activity", icon: "Activity" },
  { id: "quick-actions-1", type: "quick-actions", title: "Quick Actions", icon: "Zap" },
  { id: "project-summary-1", type: "project-summary", title: "Project Summary", icon: "FolderKanban" },
]

const DEFAULT_LAYOUTS: Layouts = {
  lg: [
    { i: "my-tasks-1", x: 0, y: 0, w: 2, h: 3, minW: 1, minH: 2 },
    { i: "calendar-1", x: 2, y: 0, w: 2, h: 3, minW: 2, minH: 3 },
    { i: "recent-activity-1", x: 4, y: 0, w: 2, h: 3, minW: 1, minH: 2 },
    { i: "quick-actions-1", x: 0, y: 3, w: 2, h: 2, minW: 1, minH: 1 },
    { i: "project-summary-1", x: 2, y: 3, w: 4, h: 2, minW: 1, minH: 2 },
  ],
  md: [
    { i: "my-tasks-1", x: 0, y: 0, w: 2, h: 3, minW: 1, minH: 2 },
    { i: "calendar-1", x: 2, y: 0, w: 2, h: 3, minW: 2, minH: 3 },
    { i: "recent-activity-1", x: 0, y: 3, w: 2, h: 3, minW: 1, minH: 2 },
    { i: "quick-actions-1", x: 2, y: 3, w: 2, h: 2, minW: 1, minH: 1 },
    { i: "project-summary-1", x: 0, y: 6, w: 4, h: 2, minW: 1, minH: 2 },
  ],
  sm: [
    { i: "my-tasks-1", x: 0, y: 0, w: 2, h: 3, minW: 1, minH: 2 },
    { i: "calendar-1", x: 0, y: 3, w: 2, h: 3, minW: 2, minH: 3 },
    { i: "recent-activity-1", x: 0, y: 6, w: 2, h: 3, minW: 1, minH: 2 },
    { i: "quick-actions-1", x: 0, y: 9, w: 2, h: 2, minW: 1, minH: 1 },
    { i: "project-summary-1", x: 0, y: 11, w: 2, h: 2, minW: 1, minH: 2 },
  ],
}

const STORAGE_KEY = "nexus-dashboard-layout"

function loadLayout(): DashboardLayoutState | null {
  if (typeof window === "undefined") return null
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {
    // ignore
  }
  return null
}

function saveLayout(state: DashboardLayoutState) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderWidget(type: string, data: any) {
  switch (type) {
    case "my-tasks":
      return <MyTasksDashWidget data={data} />
    case "project-summary":
      return <ProjectSummaryWidget data={data} />
    case "recent-activity":
      return <RecentActivityWidget data={data} />
    case "calendar":
      return <CalendarWidget data={data} />
    case "quick-actions":
      return <QuickActionsWidget data={data} />
    case "team-status":
      return <TeamStatusWidget data={data} />
    case "chart":
      return <ChartDashWidget data={data} />
    case "notes":
      return <NotesDashWidget data={data} />
    case "goals":
      return <GoalsDashWidget data={data} />
    case "favorites":
      return <FavoritesDashWidget data={data} />
    case "clock":
      return <ClockDashWidget data={data} />
    case "metrics":
      return <MetricsDashWidget data={data} />
    default:
      return <div className="text-sm text-muted-foreground">Unknown widget</div>
  }
}

interface WidgetGridProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  loading?: boolean
}

export function WidgetGrid({ data, loading }: WidgetGridProps) {
  const { width, containerRef, mounted: widthMounted } = useContainerWidth({
    measureBeforeMount: false,
    initialWidth: 1200,
  })
  const [isEditing, setIsEditing] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS)
  const [layouts, setLayouts] = useState<Layouts>(DEFAULT_LAYOUTS)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = loadLayout()
    if (saved) {
      setWidgets(saved.widgets)
      setLayouts(saved.layouts)
    }
    setMounted(true)
  }, [])

  const persistLayout = useCallback(
    (newWidgets: WidgetConfig[], newLayouts: Layouts) => {
      saveLayout({ widgets: newWidgets, layouts: newLayouts })
      // Also save to API (fire and forget)
      fetch("/api/dashboard/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: newWidgets, layouts: newLayouts }),
      }).catch(() => {})
    },
    []
  )

  const handleLayoutChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_currentLayout: any, allLayouts: Layouts) => {
      setLayouts(allLayouts)
      persistLayout(widgets, allLayouts)
    },
    [widgets, persistLayout]
  )

  const handleRemoveWidget = useCallback(
    (widgetId: string) => {
      const newWidgets = widgets.filter((w) => w.id !== widgetId)
      const newLayouts: Layouts = {}
      for (const [bp, layout] of Object.entries(layouts)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newLayouts[bp] = ((layout as any[]) || []).filter((l) => l.i !== widgetId)
      }
      setWidgets(newWidgets)
      setLayouts(newLayouts)
      persistLayout(newWidgets, newLayouts)
    },
    [widgets, layouts, persistLayout]
  )

  const handleAddWidget = useCallback(
    (type: string) => {
      const reg = WIDGET_REGISTRY[type]
      if (!reg) return

      const count = widgets.filter((w) => w.type === type).length
      const id = `${type}-${count + 1}`
      const newWidget: WidgetConfig = {
        id,
        type,
        title: reg.title,
        icon: reg.icon,
      }

      // Find lowest y position to add below existing widgets
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lgLayout = (layouts.lg as any[]) || []
      const maxY = lgLayout.reduce(
        (max: number, l: { y: number; h: number }) => Math.max(max, l.y + l.h),
        0
      )

      const newLayoutItem: LayoutItem = {
        i: id,
        x: 0,
        y: maxY,
        w: reg.defaultW,
        h: reg.defaultH,
        minW: reg.minW,
        minH: reg.minH,
      }

      const newWidgets = [...widgets, newWidget]
      const newLayouts: Layouts = {}
      for (const [bp, layout] of Object.entries(layouts)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newLayouts[bp] = [...((layout as any[]) || []), newLayoutItem] as LayoutItem[]
      }

      setWidgets(newWidgets)
      setLayouts(newLayouts)
      persistLayout(newWidgets, newLayouts)
      setShowAddDialog(false)
    },
    [widgets, layouts, persistLayout]
  )

  const handleReset = useCallback(() => {
    setWidgets(DEFAULT_WIDGETS)
    setLayouts(DEFAULT_LAYOUTS)
    persistLayout(DEFAULT_WIDGETS, DEFAULT_LAYOUTS)
  }, [persistLayout])

  const activeWidgetTypes = useMemo(
    () => new Set(widgets.map((w) => w.type)),
    [widgets]
  )

  if (!mounted) return null

  return (
    <div ref={containerRef as unknown as React.Ref<HTMLDivElement>}>
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2 mb-4">
        {isEditing && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddDialog(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Widget
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
          </>
        )}
        <Button
          variant={isEditing ? "default" : "outline"}
          size="sm"
          onClick={() => setIsEditing(!isEditing)}
        >
          <Settings2 className="h-4 w-4 mr-1" />
          {isEditing ? "Done" : "Customize"}
        </Button>
      </div>

      {/* Grid */}
      {widthMounted && (
        <ResponsiveGridLayout
          className="layout"
          width={width}
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996, sm: 0 }}
          cols={{ lg: 6, md: 4, sm: 2 }}
          rowHeight={100}
          isDraggable={isEditing}
          isResizable={isEditing}
          draggableHandle=".drag-handle"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onLayoutChange={handleLayoutChange as any}
          compactType="vertical"
          margin={[16, 16]}
          useCSSTransforms={true}
        >
          {widgets.map((widget) => (
            <div key={widget.id}>
              <WidgetWrapper
                title={widget.title}
                isEditing={isEditing}
                onRemove={() => handleRemoveWidget(widget.id)}
                loading={loading}
              >
                {renderWidget(widget.type, data)}
              </WidgetWrapper>
            </div>
          ))}
        </ResponsiveGridLayout>
      )}

      {/* Add Widget Dialog */}
      <AddWidgetDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAdd={handleAddWidget}
        registry={WIDGET_REGISTRY}
        activeTypes={activeWidgetTypes}
      />
    </div>
  )
}

export { WIDGET_REGISTRY }
