"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Download, FileText, FileSpreadsheet, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface ExportDialogProps {
  projectId: string
  trigger?: React.ReactNode
}

type Format = "csv" | "pdf"

export function ExportDialog({ projectId, trigger }: ExportDialogProps) {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<Format>("csv")
  const [includeCompleted, setIncludeCompleted] = useState(true)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams({ projectId })
      if (!includeCompleted) params.set("includeCompleted", "false")
      if (dateFrom) params.set("dateFrom", dateFrom)
      if (dateTo) params.set("dateTo", dateTo)

      const res = await fetch(`/api/export/${format}?${params}`)

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Export failed")
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = format === "csv" ? `export-${projectId}.csv` : `report-${projectId}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (err) {
      console.error("Export failed:", err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-2">
          {/* Format selection */}
          <div className="space-y-2">
            <Label>Format</Label>
            <div className="flex gap-3">
              {([
                { value: "csv" as const, label: "CSV", icon: FileSpreadsheet },
                { value: "pdf" as const, label: "PDF Report", icon: FileText },
              ]).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setFormat(value)}
                  className={cn(
                    "flex h-16 flex-1 flex-col items-center justify-center gap-1 rounded-lg border-2 text-sm font-medium transition-all",
                    format === value
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-800"
                      : "border-transparent bg-zinc-100 dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-600"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="include-completed" className="text-sm">
                Include completed tasks
              </Label>
              <Switch
                id="include-completed"
                checked={includeCompleted}
                onCheckedChange={setIncludeCompleted}
              />
            </div>

            {format === "csv" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">From date</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To date</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <Button
            className="w-full bg-foreground hover:bg-foreground/90"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Download {format.toUpperCase()}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
