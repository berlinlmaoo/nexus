"use client"

import { useState, useEffect, useCallback, createContext, useContext } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

interface ShortcutEntry {
  keys: string[]
  description: string
}

interface ShortcutGroup {
  label: string
  shortcuts: ShortcutEntry[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: ["Cmd+K", "/", "Ctrl+K"], description: "Search" },
      { keys: ["G", "then", "D"], description: "Go to Dashboard" },
      { keys: ["G", "then", "P"], description: "Go to Projects" },
      { keys: ["G", "then", "T"], description: "Go to My Tasks" },
      { keys: ["G", "then", "I"], description: "Go to Inbox" },
    ],
  },
  {
    label: "Tasks",
    shortcuts: [
      { keys: ["N"], description: "New task" },
      { keys: ["E"], description: "Edit selected task" },
      { keys: ["D"], description: "Set due date" },
      { keys: ["P"], description: "Change priority" },
      { keys: ["M"], description: "Assign to me" },
    ],
  },
  {
    label: "General",
    shortcuts: [
      { keys: ["Escape"], description: "Close panel/dialog" },
      { keys: ["?"], description: "Show shortcuts help" },
      { keys: ["Tab"], description: "Navigate between items" },
    ],
  },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-2 py-1 rounded-md border border-zinc-200 bg-zinc-100 text-xs font-mono font-medium text-zinc-700 shadow-sm">
      {children}
    </kbd>
  )
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {keys.map((key, i) =>
        key === "then" || key === "/" ? (
          <span key={i} className="text-xs text-zinc-400 px-0.5">
            {key}
          </span>
        ) : (
          <Kbd key={i}>{key}</Kbd>
        )
      )}
    </span>
  )
}

const fadeVariants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.15, ease: "easeOut" as const },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    transition: { duration: 0.1, ease: "easeIn" as const },
  },
}

interface ShortcutsHelpContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const ShortcutsHelpContext = createContext<ShortcutsHelpContextValue>({
  open: false,
  setOpen: () => {},
})

export function useShortcutsHelp() {
  return useContext(ShortcutsHelpContext)
}

export function ShortcutsHelpProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Skip if user is typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return
      }

      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    },
    []
  )

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  return (
    <ShortcutsHelpContext.Provider value={{ open, setOpen }}>
      {children}
      <ShortcutsHelp open={open} onOpenChange={setOpen} />
    </ShortcutsHelpContext.Provider>
  )
}

interface ShortcutsHelpProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" asChild>
            <motion.div
              variants={fadeVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">
                  Keyboard Shortcuts
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Use these shortcuts to navigate and manage tasks quickly.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {SHORTCUT_GROUPS.map((group) => (
                  <div key={group.label}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                      {group.label}
                    </h3>
                    <div className="space-y-0">
                      {group.shortcuts.map((shortcut, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-zinc-50 transition-colors"
                        >
                          <span className="text-sm text-zinc-700">
                            {shortcut.description}
                          </span>
                          <ShortcutKeys keys={shortcut.keys} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t">
                <p className="text-xs text-zinc-400 text-center">
                  Press <Kbd>?</Kbd> to toggle this dialog
                </p>
              </div>
            </motion.div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
