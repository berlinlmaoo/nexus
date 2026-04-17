"use client"

import { useCallback, useEffect, useState } from "react"
import { BellRing, MonitorSpeaker } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

const PROMPT_SNOOZE_KEY = "nexus-desktop-notification-prompt-snooze-until"
const PROMPT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000

interface NotificationPrefsResponse {
  desktopEnabled?: boolean
  desktopSoundEnabled?: boolean
  emailEnabled?: boolean
  waEnabled?: boolean
  slackEnabled?: boolean
  waPhone?: string | null
  slackWebhook?: string | null
  taskAssigned?: boolean
  taskDueSoon?: boolean
  commentMention?: boolean
  projectInvite?: boolean
  statusUpdate?: boolean
}

function getSnoozeUntil() {
  if (typeof window === "undefined") return 0
  return Number(window.localStorage.getItem(PROMPT_SNOOZE_KEY) || 0)
}

export function DesktopNotificationPrompt() {
  const [open, setOpen] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [prefs, setPrefs] = useState<NotificationPrefsResponse | null>(null)

  const dismissForNow = useCallback(() => {
    window.localStorage.setItem(PROMPT_SNOOZE_KEY, String(Date.now() + PROMPT_SNOOZE_MS))
    setOpen(false)
  }, [])

  const fetchPrefs = useCallback(async () => {
    const response = await fetch("/api/notifications/preferences", {
      cache: "no-store",
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error("Failed to fetch notification preferences")
    }

    return response.json() as Promise<NotificationPrefsResponse>
  }, [])

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      if (typeof window === "undefined" || !("Notification" in window)) return
      if (Notification.permission === "granted" || Notification.permission === "denied") return
      if (getSnoozeUntil() > Date.now()) return

      try {
        const nextPrefs = await fetchPrefs()
        if (cancelled) return

        setPrefs(nextPrefs)

        if (nextPrefs.desktopEnabled) return

        setOpen(true)
      } catch {
        // Ignore prompt bootstrap failures silently.
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [fetchPrefs])

  const enableNotifications = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return

    setEnabling(true)

    try {
      const permission = await Notification.requestPermission()

      if (permission !== "granted") {
        toast.error("Desktop notification permission was not granted")
        dismissForNow()
        return
      }

      const nextPrefs = {
        emailEnabled: prefs?.emailEnabled ?? true,
        waEnabled: prefs?.waEnabled ?? false,
        slackEnabled: prefs?.slackEnabled ?? false,
        desktopEnabled: true,
        desktopSoundEnabled: prefs?.desktopSoundEnabled ?? true,
        waPhone: prefs?.waPhone ?? null,
        slackWebhook: prefs?.slackWebhook ?? null,
        taskAssigned: prefs?.taskAssigned ?? true,
        taskDueSoon: prefs?.taskDueSoon ?? true,
        commentMention: prefs?.commentMention ?? true,
        projectInvite: prefs?.projectInvite ?? true,
        statusUpdate: prefs?.statusUpdate ?? true,
      }

      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(nextPrefs),
      })

      if (!response.ok) {
        throw new Error("Failed to save desktop notification preference")
      }

      window.localStorage.removeItem(PROMPT_SNOOZE_KEY)
      setPrefs(nextPrefs)
      setOpen(false)
      toast.success("Desktop notifications are now active")
    } catch {
      toast.error("Failed to enable desktop notifications")
    } finally {
      setEnabling(false)
    }
  }, [dismissForNow, prefs])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[420px] overflow-hidden border-none bg-surface-container-lowest p-0 shadow-2xl">
        <div className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-surface-container-highest via-surface-container-lowest to-surface-container-low p-6 sm:p-8">
          <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(17,24,39,0.08),transparent_70%)]" />
          <div className="relative">
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <BellRing className="h-5 w-5" />
            </div>

            <DialogHeader className="space-y-2">
              <DialogTitle className="text-2xl">Turn On Desktop Notifications</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-on-surface-variant/70">
                Get instant alerts from NEXUS with a desktop card and sound, even when you are working in another tab.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 rounded-3xl border border-on-surface-variant/10 bg-background/70 p-4 backdrop-blur">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-surface-container-high p-2 text-primary">
                  <MonitorSpeaker className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-on-surface">Recommended</p>
                  <p className="mt-1 text-xs leading-relaxed text-on-surface-variant/70">
                    Enable this so new assignments, mentions, and updates show up immediately without needing the tab open.
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter className="mt-6 flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={dismissForNow}
                disabled={enabling}
              >
                Not now
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={enableNotifications}
                disabled={enabling}
              >
                {enabling ? "Enabling..." : "Enable Notifications"}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
