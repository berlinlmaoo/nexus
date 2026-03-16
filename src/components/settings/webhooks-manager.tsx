"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Loader2,
  Plus,
  Trash2,
  Webhook,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { cn } from "@/lib/utils"

const ALL_EVENTS = [
  "task.created",
  "task.updated",
  "task.completed",
  "comment.created",
  "project.updated",
]

interface WebhookDelivery {
  id: string
  event: string
  statusCode: number | null
  success: boolean
  createdAt: string
}

interface WebhookData {
  id: string
  url: string
  events: string[]
  secret: string
  active: boolean
  createdAt: string
  project: { id: string; name: string } | null
  deliveries: WebhookDelivery[]
}

export function WebhooksManager() {
  const [webhooks, setWebhooks] = useState<WebhookData[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Form state
  const [url, setUrl] = useState("")
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)

  const fetchWebhooks = async () => {
    try {
      const res = await fetch("/api/webhooks")
      if (res.ok) {
        const data = await res.json()
        setWebhooks(data)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWebhooks()
  }, [])

  const handleCreate = async () => {
    setFormError(null)
    if (!url.trim()) {
      setFormError("URL is required")
      return
    }
    if (selectedEvents.length === 0) {
      setFormError("Select at least one event")
      return
    }

    setCreating(true)
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), events: selectedEvents }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create webhook")
      }

      setUrl("")
      setSelectedEvents([])
      setShowForm(false)
      fetchWebhooks()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed")
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (id: string, active: boolean) => {
    try {
      await fetch(`/api/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      })
      setWebhooks((prev) =>
        prev.map((w) => (w.id === id ? { ...w, active } : w))
      )
    } catch {
      // ignore
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/webhooks/${id}`, { method: "DELETE" })
      setWebhooks((prev) => prev.filter((w) => w.id !== id))
    } catch {
      // ignore
    }
  }

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event)
        ? prev.filter((e) => e !== event)
        : [...prev, event]
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhooks
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="h-3 w-3 mr-1" />
            New Webhook
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create form */}
        {showForm && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Payload URL</Label>
              <Input
                id="webhook-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhook"
              />
            </div>

            <div className="space-y-2">
              <Label>Events</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_EVENTS.map((event) => (
                  <button
                    key={event}
                    onClick={() => toggleEvent(event)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors border",
                      selectedEvents.includes(event)
                        ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                        : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
                    )}
                  >
                    {event}
                  </button>
                ))}
              </div>
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : null}
                Create
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowForm(false)
                  setFormError(null)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Webhook list */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading webhooks...
          </div>
        ) : webhooks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No webhooks configured. Create one to receive event notifications.
          </p>
        ) : (
          <div className="space-y-3">
            {webhooks.map((webhook) => (
              <div
                key={webhook.id}
                className="rounded-lg border p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Switch
                      checked={webhook.active}
                      onCheckedChange={(checked) =>
                        handleToggle(webhook.id, checked)
                      }
                    />
                    <span className="text-sm font-mono truncate">
                      {webhook.url}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        setExpanded(
                          expanded === webhook.id ? null : webhook.id
                        )
                      }
                    >
                      {expanded === webhook.id ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                      onClick={() => handleDelete(webhook.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {webhook.events.map((event) => (
                    <span
                      key={event}
                      className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs"
                    >
                      {event}
                    </span>
                  ))}
                </div>

                {/* Expanded: delivery history + secret */}
                {expanded === webhook.id && (
                  <div className="mt-2 space-y-2 pt-2 border-t">
                    <div className="text-xs">
                      <span className="text-muted-foreground">Secret:</span>{" "}
                      <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
                        {webhook.secret}
                      </code>
                    </div>
                    {webhook.project && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Project:</span>{" "}
                        {webhook.project.name}
                      </div>
                    )}
                    {webhook.deliveries.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          Recent Deliveries
                        </p>
                        {webhook.deliveries.map((d) => (
                          <div
                            key={d.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            {d.success ? (
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                            ) : (
                              <XCircle className="h-3 w-3 text-red-500" />
                            )}
                            <span>{d.event}</span>
                            <span className="text-muted-foreground">
                              {d.statusCode || "err"}
                            </span>
                            <span className="text-muted-foreground">
                              {new Date(d.createdAt).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
