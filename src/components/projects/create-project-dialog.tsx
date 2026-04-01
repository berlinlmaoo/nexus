"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Folder,
  LayoutGrid,
  Code,
  Briefcase,
  Rocket,
  Star,
  Zap,
  Plus,
  Loader2,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"

const PRESET_COLORS = [
  "#0c1427",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
  "#06B6D4",
  "#84CC16",
  "#F97316",
]

const ICONS = [
  { id: "folder", icon: Folder, label: "Folder" },
  { id: "grid", icon: LayoutGrid, label: "Grid" },
  { id: "code", icon: Code, label: "Code" },
  { id: "briefcase", icon: Briefcase, label: "Briefcase" },
  { id: "rocket", icon: Rocket, label: "Rocket" },
  { id: "star", icon: Star, label: "Star" },
  { id: "zap", icon: Zap, label: "Zap" },
]

interface CreateProjectDialogProps {
  workspaceId: string
  children?: React.ReactNode
}

export function CreateProjectDialog({
  workspaceId,
  children,
}: CreateProjectDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [icon, setIcon] = useState("folder")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          color,
          icon,
          workspaceId,
        }),
      })
      if (res.ok) {
        setOpen(false)
        setName(""); setDescription(""); router.refresh();
      }
    } catch (error) { console.error(error) } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button className="bg-primary text-primary-foreground rounded-2xl h-14 px-8 font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 transition-all hover:-translate-y-1 active:scale-95">
            <Plus className="h-4 w-4 mr-3" />
            Establish Initiative
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px] rounded-[3rem] border-none shadow-2xl p-10 bg-surface-container-highest overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/[0.03] rounded-full blur-[80px] -mr-24 -mt-24" />
        
        <form onSubmit={handleSubmit} className="relative z-10 space-y-10">
          <DialogHeader className="space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20 mb-2">
              <Sparkles className="h-6 w-6" />
            </div>
            <DialogTitle className="text-3xl font-headline font-black text-primary tracking-tight text-left">Initiate New Protocol</DialogTitle>
            <p className="text-sm font-medium text-on-surface-variant/60 text-left leading-relaxed">Define the parameters for a new strategic initiative within the Nexus ecosystem.</p>
          </DialogHeader>

          <div className="space-y-8">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Initiative Designation</label>
              <input
                placeholder="e.g. Operation Alpha"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full h-14 bg-surface-container-low border-none rounded-2xl px-6 text-sm font-bold text-primary focus:ring-4 focus:ring-primary/5 transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Strategic Objective</label>
              <textarea
                placeholder="Briefly describe the mission parameters..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-24 bg-surface-container-low border-none rounded-2xl px-6 py-4 text-sm font-bold text-primary focus:ring-4 focus:ring-primary/5 transition-all resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-4">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Protocol Color</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.slice(0, 5).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={cn(
                        "h-7 w-7 rounded-full transition-all duration-300 ring-offset-2 ring-offset-surface-container-highest",
                        color === c ? "ring-2 ring-primary scale-110 shadow-lg" : "hover:scale-110"
                      )}
                      style={{ backgroundColor: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Protocol Icon</label>
                <div className="flex gap-2">
                  {ICONS.slice(0, 4).map((item) => {
                    const IconComp = item.icon
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "h-10 w-10 flex items-center justify-center rounded-xl transition-all duration-300",
                          icon === item.id
                            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                            : "bg-surface-container-low text-on-surface-variant/40 hover:bg-surface-container"
                        )}
                        onClick={() => setIcon(item.id)}
                      >
                        <IconComp className="h-4 w-4" />
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 h-14 rounded-2xl font-black text-xs uppercase tracking-widest text-on-surface-variant/40 hover:bg-surface-container transition-all"
              onClick={() => setOpen(false)}
            >
              Abort
            </Button>
            <Button 
              type="submit" 
              disabled={loading || !name.trim()}
              className="flex-[2] h-14 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-primary/10 transition-all hover:shadow-2xl active:scale-95"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deploy Initiative"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
