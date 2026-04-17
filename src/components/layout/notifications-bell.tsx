"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Bell, CheckCheck, ExternalLink } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { useSocket } from "@/hooks/use-socket"
import { toast } from "sonner"

interface Notification {
  id: string
  type: string
  title: string
  message: string
  read: boolean
  createdAt: string
  taskId: string | null
  projectId: string | null
  link?: string | null
}

interface NotificationPrefs {
  desktopEnabled: boolean
  desktopSoundEnabled: boolean
}

interface NotificationsBellProps {
  userId?: string
  userName?: string
}

export function NotificationsBell({ userId, userName }: NotificationsBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    desktopEnabled: false,
    desktopSoundEnabled: true,
  })
  const ref = useRef<HTMLDivElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const knownNotificationIdsRef = useRef<Set<string>>(new Set())
  const hasBootstrappedRef = useRef(false)

  // Socket connection for real-time notifications
  const { on, connected } = useSocket({
    room: userId ? `user:${userId}` : "",
    userId: userId || "",
    userName: userName || "User",
    enabled: !!userId,
  })

  const openNotification = useCallback((notification: Notification) => {
    if (!notification.link) return
    window.location.href = notification.link
  }, [])

  const playNotificationSound = useCallback(async () => {
    if (typeof window === "undefined") return

    try {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) return

      const audioContext = audioContextRef.current ?? new AudioContextCtor()
      audioContextRef.current = audioContext

      if (audioContext.state === "suspended") {
        await audioContext.resume()
      }

      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.type = "sine"
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime)
      gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22)

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.24)
    } catch {
      // Ignore sound playback issues silently.
    }
  }, [])

  const showDesktopNotification = useCallback((notification: Notification) => {
    if (typeof window === "undefined" || !("Notification" in window)) return
    if (!prefs.desktopEnabled || Notification.permission !== "granted") return

    const browserNotification = new Notification(notification.title, {
      body: notification.message,
      icon: "/logos/nexus-icon-black.png",
      tag: notification.id,
    })

    browserNotification.onclick = () => {
      window.focus()
      openNotification(notification)
      browserNotification.close()
    }
  }, [openNotification, prefs.desktopEnabled])

  const showNotificationCard = useCallback((notification: Notification) => {
    toast(notification.title, {
      description: notification.message,
      action: notification.link
        ? {
            label: "Open",
            onClick: () => openNotification(notification),
          }
        : undefined,
    })
  }, [openNotification])

  const notifyIncomingNotification = useCallback((notification: Notification) => {
    if (knownNotificationIdsRef.current.has(notification.id)) {
      return
    }

    knownNotificationIdsRef.current.add(notification.id)
    showNotificationCard(notification)
    showDesktopNotification(notification)

    if (prefs.desktopSoundEnabled) {
      void playNotificationSound()
    }
  }, [playNotificationSound, prefs.desktopSoundEnabled, showDesktopNotification, showNotificationCard])

  const fetchNotifications = useCallback(async (options?: { alertNew?: boolean }) => {
    fetch("/api/notifications", {
      cache: "no-store",
      credentials: "include",
    })
      .then(r => r.json())
      .then(data => {
        const nextNotifications = (data.notifications || []) as Notification[]
        setNotifications(nextNotifications)
        setUnreadCount(data.unreadCount || 0)

        const knownIds = knownNotificationIdsRef.current
        const nextIds = new Set<string>()

        for (const notification of nextNotifications) {
          nextIds.add(notification.id)
        }

        if (!hasBootstrappedRef.current) {
          knownNotificationIdsRef.current = nextIds
          hasBootstrappedRef.current = true
          return
        }

        if (options?.alertNew) {
          const unseenNotifications = nextNotifications
            .filter((notification) => !knownIds.has(notification.id))
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

          unseenNotifications.forEach((notification) => notifyIncomingNotification(notification))
        }

        knownNotificationIdsRef.current = nextIds
      })
      .catch(() => {})
  }, [notifyIncomingNotification])

  const fetchPrefs = useCallback(() => {
    fetch("/api/notifications/preferences", {
      cache: "no-store",
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        setPrefs({
          desktopEnabled: Boolean(data.desktopEnabled),
          desktopSoundEnabled: data.desktopSoundEnabled ?? true,
        })
      })
      .catch(() => {})
  }, [])

  // Initial fetch + polling fallback (extended to 60s since we have sockets)
  useEffect(() => {
    void fetchNotifications()
    fetchPrefs()
    const interval = setInterval(() => {
      void fetchNotifications({ alertNew: true })
    }, 5000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchNotifications({ alertNew: true })
        fetchPrefs()
      }
    }

    window.addEventListener("focus", handleVisibilityChange)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", handleVisibilityChange)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [fetchNotifications, fetchPrefs])

  // Real-time: listen for new notifications via socket
  useEffect(() => {
    if (!connected) return

    const unsub = on("new-notification", (notification: unknown) => {
      const n = notification as Notification
      setNotifications(prev => {
        const existing = prev.filter((item) => item.id !== n.id)
        return [n, ...existing].slice(0, 50)
      })
      setUnreadCount(prev => (n.read ? prev : prev + 1))
      notifyIncomingNotification(n)
    })

    return unsub
  }, [connected, notifyIncomingNotification, on])

  useEffect(() => {
    const unlockAudio = () => {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) return

      const audioContext = audioContextRef.current ?? new AudioContextCtor()
      audioContextRef.current = audioContext

      if (audioContext.state === "suspended") {
        void audioContext.resume()
      }
    }

    window.addEventListener("pointerdown", unlockAudio, { once: true })
    window.addEventListener("keydown", unlockAudio, { once: true })

    return () => {
      window.removeEventListener("pointerdown", unlockAudio)
      window.removeEventListener("keydown", unlockAudio)
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const markAsRead = async (id: string) => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n))
    setUnreadCount(Math.max(0, unreadCount - 1))
  }

  const markAllRead = async () => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    })
    setNotifications(notifications.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-md p-2 text-muted-foreground hover:bg-muted transition-all duration-200 active:scale-95"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-medium text-white animate-scale-in">
            {unreadCount > 9 ? "9+" : unreadCount}
            <span className="absolute inset-0 rounded-full bg-zinc-900 animate-ping opacity-30" style={{ animationDuration: "2s" }} />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border bg-background shadow-lg z-50 animate-scale-in">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h3 className="font-semibold text-sm">Notifications</h3>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-zinc-700 hover:text-zinc-900 flex items-center gap-1 transition-colors duration-200">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                <Bell className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No notifications</p>
              </div>
            ) : (
              notifications.map((n, i) => (
                <div
                  key={n.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/50 transition-colors duration-200 cursor-pointer",
                    !n.read && "bg-zinc-50"
                  )}
                  style={{ animationDelay: `${i * 30}ms` }}
                  onClick={() => { if (!n.read) markAsRead(n.id) }}
                >
                  <div className={cn(
                    "h-2 w-2 rounded-full mt-1.5 shrink-0 transition-all duration-300",
                    n.read ? "bg-transparent scale-0" : "bg-zinc-900 scale-100"
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <span className="text-[10px] text-muted-foreground mt-1 block">{format(new Date(n.createdAt), "MMM d, h:mm a")}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          <a href="/inbox" className="flex items-center justify-center gap-1 border-t py-2.5 text-xs text-zinc-700 hover:text-zinc-900 transition-colors duration-200">
            View all <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  )
}
