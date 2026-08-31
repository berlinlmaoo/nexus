"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Loader2, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface RosterMember {
  id?: string | null
  userId?: string | null
  name?: string | null
  email?: string | null
  avatar?: string | null
}

/**
 * Shared multi-select over the workspace roster.
 *
 * Used both for starting a conversation and for adding people to a project room. `excludeIds` keeps
 * anyone already involved out of the list, so you can't pick a duplicate and then wonder why nothing
 * happened.
 */
export function PeoplePicker({
  title,
  confirmLabel,
  note,
  excludeIds,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  confirmLabel: string
  note?: string
  excludeIds: Set<string>
  busy?: boolean
  onCancel: () => void
  onConfirm: (userIds: string[], groupName: string) => void
}) {
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [groupName, setGroupName] = useState("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/workspaces/members")
        const data = res.ok ? await res.json() : null
        if (!cancelled) setRoster(Array.isArray(data?.members) ? data.members : [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const candidates = useMemo(
    () => roster.filter((m) => m.userId && !excludeIds.has(m.userId)),
    [roster, excludeIds]
  )

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(
      (m) => (m.name ?? "").toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q)
    )
  }, [candidates, search])

  const toggle = (uid: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onCancel}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl bg-surface-container-low p-4 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-headline text-lg font-black tracking-tight text-on-surface">{title}</h2>
          <button onClick={onCancel} className="rounded-lg p-1.5 hover:bg-surface-container">
            <X className="h-4 w-4 text-on-surface-variant" />
          </button>
        </div>

        {note && (
          <p className="mb-3 rounded-xl bg-primary/10 px-3 py-2 text-xs font-medium text-on-surface-variant">{note}</p>
        )}

        {picked.size > 1 && (
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name (optional)"
            className="mb-2 rounded-xl bg-surface-container px-3 py-2 text-sm outline-none"
          />
        )}

        <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-container px-3">
          <Search className="h-4 w-4 shrink-0 text-on-surface-variant/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people"
            className="w-full bg-transparent py-2 text-sm outline-none"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-on-surface-variant/60">Nobody left to add.</p>
          ) : (
            results.map((m) => {
              const uid = m.userId as string
              const on = picked.has(uid)
              const label = m.name || m.email || "—"
              return (
                <button
                  key={uid}
                  onClick={() => toggle(uid)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-container"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-black text-primary">
                    {label.trim()[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-on-surface">{label}</span>
                    {m.email && m.email !== label && (
                      <span className="block truncate text-xs text-on-surface-variant/60">{m.email}</span>
                    )}
                  </span>
                  <span className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    on ? "border-primary bg-primary text-on-primary" : "border-outline-variant"
                  )}>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <button
          onClick={() => onConfirm(Array.from(picked), groupName.trim())}
          disabled={picked.size === 0 || busy}
          className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-black text-on-primary disabled:opacity-40"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
