"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Bell, Mail, MessageSquare, Hash, Loader2, MonitorSpeaker, Volume2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface NotifPrefs {
  emailEnabled: boolean
  waEnabled: boolean
  slackEnabled: boolean
  desktopEnabled: boolean
  desktopSoundEnabled: boolean
  waPhone: string | null
  slackWebhook: string | null
  taskAssigned: boolean
  taskDueSoon: boolean
  commentMention: boolean
  projectInvite: boolean
  statusUpdate: boolean
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon?: React.ReactNode
  label: string
  description: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          checked ? "bg-foreground" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  )
}

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotifPrefs>({
    emailEnabled: true,
    waEnabled: false,
    slackEnabled: false,
    desktopEnabled: false,
    desktopSoundEnabled: true,
    waPhone: null,
    slackWebhook: null,
    taskAssigned: true,
    taskDueSoon: true,
    commentMention: true,
    projectInvite: true,
    statusUpdate: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((r) => r.json())
      .then((data) => {
        setPrefs(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // silently fail
    } finally {
      setSaving(false)
    }
  }

  const toggle = (key: keyof NotifPrefs) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }))
  }

  const toggleDesktopNotifications = async () => {
    if (!prefs.desktopEnabled && typeof window !== "undefined" && "Notification" in window) {
      const permission = await Notification.requestPermission()

      if (permission !== "granted") {
        toast.error("Desktop notification permission was not granted")
        return
      }
    }

    toggle("desktopEnabled")
  }

  const sendTestNotification = async () => {
    setSendingTest(true)

    try {
      const response = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (!response.ok) {
        throw new Error("Failed to send test notification")
      }

      toast.success("Test notification sent. Check the bell, toast card, and desktop notification.")
    } catch {
      toast.error("Failed to send test notification")
    } finally {
      setSendingTest(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-5 w-5" />
            Notification Channels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            icon={<Mail className="h-4 w-4" />}
            label="Email Notifications"
            description="Receive notifications via email"
            checked={prefs.emailEnabled}
            onChange={() => toggle("emailEnabled")}
          />
          <Separator />
          <ToggleRow
            icon={<MessageSquare className="h-4 w-4" />}
            label="WhatsApp Notifications"
            description="Receive notifications via WhatsApp"
            checked={prefs.waEnabled}
            onChange={() => toggle("waEnabled")}
          />
          {prefs.waEnabled && (
            <div className="pl-8 space-y-1">
              <Label htmlFor="wa-phone" className="text-xs">Phone Number</Label>
              <Input
                id="wa-phone"
                placeholder="+62812345678"
                value={prefs.waPhone || ""}
                onChange={(e) => setPrefs((p) => ({ ...p, waPhone: e.target.value || null }))}
                className="max-w-xs"
              />
            </div>
          )}
          <Separator />
          <ToggleRow
            icon={<Hash className="h-4 w-4" />}
            label="Slack Notifications"
            description="Receive notifications via Slack webhook"
            checked={prefs.slackEnabled}
            onChange={() => toggle("slackEnabled")}
          />
          {prefs.slackEnabled && (
            <div className="pl-8 space-y-1">
              <Label htmlFor="slack-webhook" className="text-xs">Webhook URL</Label>
              <Input
                id="slack-webhook"
                placeholder="https://hooks.slack.com/services/..."
                value={prefs.slackWebhook || ""}
                onChange={(e) => setPrefs((p) => ({ ...p, slackWebhook: e.target.value || null }))}
              />
            </div>
          )}
          <Separator />
          <ToggleRow
            icon={<MonitorSpeaker className="h-4 w-4" />}
            label="Desktop Notifications"
            description="Show browser notification cards for new alerts"
            checked={prefs.desktopEnabled}
            onChange={toggleDesktopNotifications}
          />
          <Separator />
          <ToggleRow
            icon={<Volume2 className="h-4 w-4" />}
            label="Notification Sound"
            description="Play a sound when a new real-time notification arrives"
            checked={prefs.desktopSoundEnabled}
            onChange={() => toggle("desktopSoundEnabled")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Types</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow label="Task Assigned" description="When someone assigns a task to you" checked={prefs.taskAssigned} onChange={() => toggle("taskAssigned")} />
          <Separator />
          <ToggleRow label="Task Due Soon" description="When a task is due within 24 hours" checked={prefs.taskDueSoon} onChange={() => toggle("taskDueSoon")} />
          <Separator />
          <ToggleRow label="Comment Mentions" description="When someone mentions you in a comment" checked={prefs.commentMention} onChange={() => toggle("commentMention")} />
          <Separator />
          <ToggleRow label="Project Invitations" description="When you're invited to a project" checked={prefs.projectInvite} onChange={() => toggle("projectInvite")} />
          <Separator />
          <ToggleRow label="Status Updates" description="When a project status is updated" checked={prefs.statusUpdate} onChange={() => toggle("statusUpdate")} />
        </CardContent>
      </Card>

      <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : saved ? "Saved" : "Save Preferences"}
      </Button>
      <Button
        variant="outline"
        onClick={sendTestNotification}
        disabled={sendingTest}
      >
        {sendingTest ? "Sending test..." : "Send Test Notification"}
      </Button>
    </>
  )
}
