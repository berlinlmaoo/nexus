"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command"
import { Search, Folder, CheckCircle2, Settings, User, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface SearchResults {
  projects: any[]
  tasks: any[]
}

export function SearchDialog() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResults>({ projects: [], tasks: [] })
  const router = useRouter()

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  useEffect(() => {
    if (!open || query.length < 2) {
      setResults({ projects: [], tasks: [] })
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
        if (res.ok) {
          const data = await res.json()
          setResults(data)
        }
      } catch (err) {
        if (!(err instanceof DOMException)) {
          console.error("Search failed:", err)
        }
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  const runCommand = useCallback((command: () => void) => {
    setOpen(false)
    command()
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <div className="bg-surface-container-highest overflow-hidden border-none shadow-2xl shadow-primary/20 rounded-[2.5rem]">
        <div className="px-8 pt-8 pb-4 flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-surface-container flex items-center justify-center text-on-surface-variant/40">
            <Search className="h-6 w-6" />
          </div>
          <CommandInput
            placeholder="Search designating protocols..."
            onValueChange={setQuery}
            className="h-16 bg-transparent border-none text-2xl font-headline font-black text-primary placeholder:text-on-surface-variant/10 focus:ring-0"
          />
        </div>

        <CommandList className="max-h-[500px] px-4 pb-8 scrollbar-hide">
          <CommandEmpty className="py-12 text-center">
            <div className="w-16 h-16 rounded-3xl bg-surface-container mx-auto flex items-center justify-center text-on-surface-variant/10 mb-4">
              <Search className="h-8 w-8" />
            </div>
            <p className="text-sm font-bold text-on-surface-variant/40 font-headline uppercase tracking-widest">No matching intelligence found.</p>
          </CommandEmpty>

          {results.projects.length > 0 && (
            <CommandGroup heading={<span className="px-4 text-[10px] font-black uppercase tracking-[0.25em] text-on-surface-variant/20">Active Initiatives</span>}>
              {results.projects.map((project) => (
                <CommandItem
                  key={project.id}
                  onSelect={() => runCommand(() => router.push(`/projects/${project.id}`))}
                  className="flex items-center gap-4 p-4 rounded-2xl cursor-pointer aria-selected:bg-surface-container-lowest aria-selected:shadow-sm transition-all group"
                >
                  <div 
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-primary-foreground font-black shadow-lg shadow-primary/5 transition-transform group-hover:scale-110"
                    style={{ backgroundColor: project.color }}
                  >
                    {project.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-primary">{project.name}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">Initiative Node</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-on-surface-variant/20 opacity-0 group-hover:opacity-100 transition-all" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {results.tasks.length > 0 && (
            <>
              <CommandSeparator className="my-4 bg-on-surface-variant/5" />
              <CommandGroup heading={<span className="px-4 text-[10px] font-black uppercase tracking-[0.25em] text-on-surface-variant/20">Tactical Tasks</span>}>
                {results.tasks.map((task) => (
                  <CommandItem
                    key={task.id}
                    onSelect={() => runCommand(() => router.push(`/projects/${task.project.id}?taskId=${task.id}`))}
                    className="flex items-center gap-4 p-4 rounded-2xl cursor-pointer aria-selected:bg-surface-container-lowest aria-selected:shadow-sm transition-all group"
                  >
                    <div className="h-10 w-10 rounded-xl bg-surface-container flex items-center justify-center text-primary/20">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-primary">{task.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: task.project.color }} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">{task.project.name}</span>
                      </div>
                    </div>
                    <div className={cn(
                      "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest",
                      task.status === "DONE" ? "bg-green-100 text-green-700" : "bg-primary/5 text-primary"
                    )}>
                      {task.status}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          <CommandSeparator className="my-4 bg-on-surface-variant/5" />
          
          <CommandGroup heading={<span className="px-4 text-[10px] font-black uppercase tracking-[0.25em] text-on-surface-variant/20">System Controls</span>}>
            <CommandItem 
              onSelect={() => runCommand(() => router.push("/settings"))}
              className="flex items-center gap-4 p-4 rounded-2xl cursor-pointer aria-selected:bg-surface-container-lowest transition-all"
            >
              <div className="h-10 w-10 rounded-xl bg-surface-container flex items-center justify-center text-on-surface-variant/40">
                <Settings className="h-5 w-5" />
              </div>
              <span>General Settings</span>
            </CommandItem>
            <CommandItem 
              onSelect={() => runCommand(() => router.push("/settings"))}
              className="flex items-center gap-4 p-4 rounded-2xl cursor-pointer aria-selected:bg-surface-container-lowest transition-all"
            >
              <div className="h-10 w-10 rounded-xl bg-surface-container flex items-center justify-center text-on-surface-variant/40">
                <User className="h-5 w-5" />
              </div>
              <span>Profile Protocol</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>

        <div className="px-8 py-4 bg-surface-container-high/50 flex items-center justify-between">
          <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-on-surface-variant/30">
            <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded bg-surface-container-lowest shadow-sm">ENT</kbd> Access</span>
            <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded bg-surface-container-lowest shadow-sm">ESC</kbd> Close</span>
          </div>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-on-surface-variant/20">Nexus Index V2.4</p>
        </div>
      </div>
    </CommandDialog>
  )
}
