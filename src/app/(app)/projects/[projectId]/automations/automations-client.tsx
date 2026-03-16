"use client"

import { useRouter } from "next/navigation"
import { AutomationBuilder } from "@/components/automations/automation-builder"
import { ArrowLeft } from "lucide-react"

interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: { type: string; value?: string }
  action: { type: string; value?: string }
}

export function AutomationsClient({
  project,
  automations: initialAutomations,
}: {
  project: { id: string; name: string }
  automations: Automation[]
}) {
  const router = useRouter()

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => router.push(`/projects/${project.id}`)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {project.name}
        </button>
      </div>

      <AutomationBuilder
        projectId={project.id}
        automations={initialAutomations}
        onUpdate={() => router.refresh()}
      />
    </div>
  )
}
