"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Settings2 } from "lucide-react"

interface CustomField {
  id: string
  name: string
  type: string
  options: any
  values: { id: string; value: string; taskId: string }[]
}

export function CustomFields({ taskId, projectId }: { taskId: string; projectId: string }) {
  const [fields, setFields] = useState<CustomField[]>([])

  useEffect(() => {
    fetch(`/api/custom-fields?projectId=${projectId}`)
      .then(r => r.json())
      .then(data => setFields(data.fields || []))
      .catch(() => {})
  }, [projectId])

  const updateValue = async (fieldId: string, value: string) => {
    await fetch("/api/custom-fields", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: fieldId, taskId, value }),
    })
  }

  if (fields.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">No custom fields defined for this project</p>

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        <Settings2 className="h-3 w-3" /> Custom Fields
      </Label>
      {fields.map(field => {
        const currentValue = field.values.find(v => v.taskId === taskId)?.value || ""
        return (
          <div key={field.id} className="space-y-1">
            <label className="text-xs font-medium">{field.name}</label>
            {field.type === "TEXT" && <Input className="h-8 text-sm" defaultValue={currentValue} onBlur={(e) => updateValue(field.id, e.target.value)} />}
            {field.type === "NUMBER" && <Input type="number" className="h-8 text-sm" defaultValue={currentValue} onBlur={(e) => updateValue(field.id, e.target.value)} />}
            {field.type === "DATE" && <Input type="date" className="h-8 text-sm" defaultValue={currentValue} onChange={(e) => updateValue(field.id, e.target.value)} />}
            {field.type === "CHECKBOX" && <Checkbox checked={currentValue === "true"} onCheckedChange={(v) => updateValue(field.id, String(v))} />}
            {field.type === "DROPDOWN" && (
              <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" defaultValue={currentValue} onChange={(e) => updateValue(field.id, e.target.value)}>
                <option value="">Select...</option>
                {(Array.isArray(field.options) ? field.options : []).map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            )}
            {field.type === "RATING" && (
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} className={`h-6 w-6 rounded text-xs font-medium ${parseInt(currentValue) >= n ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`} onClick={() => updateValue(field.id, String(n))}>{n}</button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
