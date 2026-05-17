"use client"

import { useState, useRef, useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  X,
  CircleDot,
  Signal,
  UserPlus,
  CalendarDays,
  Trash2,
  FolderInput,
  Circle,
  Loader2,
  Eye,
  CheckCircle2,
  AlertTriangle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type BatchAction =
  | { type: "status"; value: string }
  | { type: "priority"; value: string }
  | { type: "assign"; value: string }
  | { type: "dueDate"; value: string }
  | { type: "delete" }
  | { type: "move"; value: string }

interface BatchActionsBarProps {
  selectedIds: Set<string>
  onClear: () => void
  onAction: (action: BatchAction) => void
  projectMembers?: { id: string; name: string }[]
}

const statusOptions = [
  { value: "TODO", label: "To Do", icon: Circle },
  { value: "IN_PROGRESS", label: "In Progress", icon: Loader2 },
  { value: "IN_REVIEW", label: "In Review", icon: Eye },
  { value: "DONE", label: "Done", icon: CheckCircle2 },
]

const priorityOptions = [
  { value: "URGENT", label: "Urgent", icon: AlertTriangle },
  { value: "HIGH", label: "High", icon: ArrowUp },
  { value: "MEDIUM", label: "Medium", icon: ArrowRight },
  { value: "LOW", label: "Low", icon: ArrowDown },
]

type DropdownType = "status" | "priority" | "assign" | "dueDate" | null

function ActionDropdown({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div ref={ref} className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="min-w-[min(12rem,calc(100vw_-_2rem))] rounded-lg border border-border bg-background p-1 shadow-xl"
      >
        {children}
      </motion.div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  active,
  variant = "default",
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
  active?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
        variant === "destructive"
          ? "text-zinc-400 hover:text-red-400 hover:bg-red-950/30"
          : "text-zinc-300 hover:text-white hover:bg-zinc-800",
        active && variant !== "destructive" && "bg-zinc-800 text-white"
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export function BatchActionsBar({
  selectedIds,
  onClear,
  onAction,
  projectMembers = [],
}: BatchActionsBarProps) {
  const [openDropdown, setOpenDropdown] = useState<DropdownType>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [dateValue, setDateValue] = useState("")

  const count = selectedIds.size

  function toggleDropdown(type: DropdownType) {
    setOpenDropdown((prev) => (prev === type ? null : type))
  }

  function handleAction(action: BatchAction) {
    onAction(action)
    setOpenDropdown(null)
  }

  return (
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="bg-zinc-900 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-2">
              {/* Selection count */}
              <span className="text-sm font-medium text-zinc-300 whitespace-nowrap mr-1">
                {count} task{count !== 1 ? "s" : ""} selected
              </span>

              <div className="w-px h-6 bg-zinc-700" />

              {/* Status */}
              <div className="relative">
                <ActionButton
                  icon={CircleDot}
                  label="Status"
                  onClick={() => toggleDropdown("status")}
                  active={openDropdown === "status"}
                />
                <ActionDropdown
                  open={openDropdown === "status"}
                  onClose={() => setOpenDropdown(null)}
                >
                  {statusOptions.map((opt) => {
                    const OptIcon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        onClick={() =>
                          handleAction({ type: "status", value: opt.value })
                        }
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent rounded-md transition-colors"
                      >
                        <OptIcon className="h-4 w-4 text-muted-foreground" />
                        {opt.label}
                      </button>
                    )
                  })}
                </ActionDropdown>
              </div>

              {/* Priority */}
              <div className="relative">
                <ActionButton
                  icon={Signal}
                  label="Priority"
                  onClick={() => toggleDropdown("priority")}
                  active={openDropdown === "priority"}
                />
                <ActionDropdown
                  open={openDropdown === "priority"}
                  onClose={() => setOpenDropdown(null)}
                >
                  {priorityOptions.map((opt) => {
                    const OptIcon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        onClick={() =>
                          handleAction({ type: "priority", value: opt.value })
                        }
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent rounded-md transition-colors"
                      >
                        <OptIcon className="h-4 w-4 text-muted-foreground" />
                        {opt.label}
                      </button>
                    )
                  })}
                </ActionDropdown>
              </div>

              {/* Assign */}
              <div className="relative">
                <ActionButton
                  icon={UserPlus}
                  label="Assign"
                  onClick={() => toggleDropdown("assign")}
                  active={openDropdown === "assign"}
                />
                <ActionDropdown
                  open={openDropdown === "assign"}
                  onClose={() => setOpenDropdown(null)}
                >
                  {projectMembers.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground/60">
                      No members available
                    </p>
                  ) : (
                    projectMembers.map((member) => (
                      <button
                        key={member.id}
                        onClick={() =>
                          handleAction({ type: "assign", value: member.id })
                        }
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent rounded-md transition-colors"
                      >
                        <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        {member.name}
                      </button>
                    ))
                  )}
                </ActionDropdown>
              </div>

              {/* Due Date */}
              <div className="relative">
                <ActionButton
                  icon={CalendarDays}
                  label="Due Date"
                  onClick={() => toggleDropdown("dueDate")}
                  active={openDropdown === "dueDate"}
                />
                <ActionDropdown
                  open={openDropdown === "dueDate"}
                  onClose={() => setOpenDropdown(null)}
                >
                  <div className="p-2 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground px-1">
                      Set due date
                    </p>
                    <Input
                      type="date"
                      value={dateValue}
                      onChange={(e) => setDateValue(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      className="w-full h-8 text-xs"
                      disabled={!dateValue}
                      onClick={() => {
                        handleAction({ type: "dueDate", value: dateValue })
                        setDateValue("")
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </ActionDropdown>
              </div>

              {/* Move */}
              <div className="relative">
                <ActionButton
                  icon={FolderInput}
                  label="Move"
                  onClick={() => toggleDropdown("move" as DropdownType)}
                  active={openDropdown === ("move" as DropdownType)}
                />
              </div>

              <div className="w-px h-6 bg-zinc-700" />

              {/* Delete */}
              <ActionButton
                icon={Trash2}
                label="Delete"
                onClick={() => {
                  setOpenDropdown(null)
                  setShowDeleteDialog(true)
                }}
                variant="destructive"
              />

              {/* Clear selection */}
              <button
                onClick={onClear}
                className="ml-1 p-1 rounded-md text-muted-foreground hover:text-white hover:bg-zinc-800 transition-colors"
                aria-label="Clear selection"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete {count} task{count !== 1 ? "s" : ""}?</DialogTitle>
            <DialogDescription>
              This cannot be undone. All selected tasks will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              className="h-11 w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onAction({ type: "delete" })
                setShowDeleteDialog(false)
              }}
              className="h-11 w-full sm:w-auto"
            >
              Delete {count} task{count !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
