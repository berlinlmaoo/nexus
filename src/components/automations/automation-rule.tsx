"use client"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { ArrowRight } from "lucide-react"

export function AutomationRule({ name, trigger, action, enabled, onToggle }: { name: string; trigger: { type: string; value?: string }; action: { type: string; value?: string }; enabled: boolean; onToggle: (enabled: boolean) => void }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={onToggle} />
        <div>
          <h4 className="font-medium text-sm">{name}</h4>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span className="px-2 py-0.5 rounded bg-muted text-on-surface-variant">{trigger.type}{trigger.value ? `: ${trigger.value}` : ''}</span>
            <ArrowRight className="h-3 w-3" />
            <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700">{action.type}{action.value ? `: ${action.value}` : ''}</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
