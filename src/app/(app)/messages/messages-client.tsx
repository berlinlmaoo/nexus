"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ImagePlus, Loader2, MessageSquare, Pencil, Plus, Send, UserPlus, Users, X } from "lucide-react"
import { PeoplePicker } from "./people-picker"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useSocket } from "@/hooks/use-socket"

interface MemberUser { id?: string | null; name?: string | null; avatar?: string | null }
interface Member { userId?: string | null; user?: MemberUser | null }
interface ChatMessage {
  id: string
  content: string
  createdAt: string
  userId?: string | null
  user?: MemberUser | null
  attachmentUrl?: string | null
  attachmentType?: string | null
}
interface Conversation {
  id: string
  type?: string | null            // DM | GROUP | PROJECT
  name?: string | null
  projectId?: string | null
  members?: Member[] | null
  lastMessage?: ChatMessage | null
  unreadCount?: number | null
}

const uidOf = (m: Member) => m.userId ?? m.user?.id ?? ""

function titleOf(c: Conversation, meId: string) {
  if (c.type === "DM") {
    const other = (c.members ?? []).find((m) => uidOf(m) !== meId)
    return other?.user?.name || c.name || "Direct message"
  }
  return c.name || (c.type === "PROJECT" ? "Project chat" : "Group")
}

function initialOf(text: string) {
  return (text.trim()[0] || "?").toUpperCase()
}

function timeOf(iso?: string) {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
}

export function MessagesClient({ meId, meName, meAvatar }: { meId: string; meName: string; meAvatar: string | null }) {
  const [convos, setConvos] = useState<Conversation[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showAddPeople, setShowAddPeople] = useState(false)
  const [busy, setBusy] = useState(false)
  // tag teks -> userId, supaya mention terkirim sebagai id yang tidak ambigu
  const [pendingMentions, setPendingMentions] = useState<Record<string, string>>({})
  const [attachment, setAttachment] = useState<{ url: string; type: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const active = useMemo(() => convos.find((c) => c.id === activeId) ?? null, [convos, activeId])

  const memberIds = useMemo(
    () => new Set((active?.members ?? []).map(uidOf).filter(Boolean)),
    [active]
  )

  /**
   * The mention being typed, if any. A textarea does expose its caret, but reading the tail keeps
   * this identical to the iOS behaviour - one rule to explain, not two.
   */
  const mentionQuery = useMemo(() => {
    const at = draft.lastIndexOf("@")
    if (at === -1) return null
    if (at > 0 && ![" ", "\n"].includes(draft[at - 1])) return null
    const tail = draft.slice(at + 1)
    if (/\s/.test(tail)) return null
    return tail
  }, [draft])

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return []
    const roster = (active?.members ?? []).filter((m) => uidOf(m) !== meId && m.user?.name)
    if (!mentionQuery) return roster
    return roster.filter((m) => (m.user?.name ?? "").toLowerCase().includes(mentionQuery.toLowerCase()))
  }, [mentionQuery, active, meId])

  const applyMention = useCallback((m: Member) => {
    const name = (m.user?.name ?? "").replace(/\s+/g, "")
    const tag = `@${name}`
    const at = draft.lastIndexOf("@")
    setDraft(at === -1 ? `${draft}${tag} ` : `${draft.slice(0, at)}${tag} `)
    setPendingMentions((prev) => ({ ...prev, [tag]: uidOf(m) }))
  }, [draft])

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations")
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      setConvos(Array.isArray(data?.conversations) ? data.conversations : [])
    } catch {
      toast.error("Couldn't load your conversations.")
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => { void loadConversations() }, [loadConversations])

  const loadThread = useCallback(async (conversationId: string) => {
    setLoadingThread(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`)
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      setMessages(Array.isArray(data?.messages) ? data.messages : [])
      // Clearing the badge is best-effort: failing to mark read must not block reading.
      void fetch(`/api/conversations/${conversationId}/read`, { method: "POST" }).then(() => {
        setConvos((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)))
      })
    } catch {
      toast.error("Couldn't load that conversation.")
    } finally {
      setLoadingThread(false)
    }
  }, [])

  useEffect(() => {
    if (!activeId) return
    void loadThread(activeId)
  }, [activeId, loadThread])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Live updates for the open conversation. The server already broadcasts `message-created` into
  // `conversation:{id}` and checks membership before letting anyone join, so nothing extra is
  // needed here beyond joining the room.
  const { on } = useSocket({
    room: activeId ? `conversation:${activeId}` : "",
    userId: meId,
    userName: meName,
    userAvatar: meAvatar,
    enabled: !!activeId,
  })

  useEffect(() => {
    if (!activeId) return
    const cleanup = on("message-created", (payload: unknown) => {
      const incoming = payload as ChatMessage | null
      if (!incoming?.id) return
      // Our own message is already on screen from the POST response; don't double it.
      setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]))
      setConvos((prev) => prev.map((c) => (c.id === activeId ? { ...c, lastMessage: incoming } : c)))
    })
    return cleanup
  }, [on, activeId])

  const upload = useCallback(async (file: File) => {
    if (!activeId) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("conversationId", activeId)
      const res = await fetch("/api/upload/chat", { method: "POST", body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) throw new Error(data?.error || "failed")
      setAttachment({ url: data.url, type: data.type })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't upload that image.")
    } finally {
      setUploading(false)
    }
  }, [activeId])

  const send = useCallback(async () => {
    const content = draft.trim()
    // A picture alone is a valid message.
    if ((!content && !attachment) || !activeId || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          // Only tags still present in the text count; deleting a tag un-mentions the person.
          mentionedUserIds: Object.entries(pendingMentions)
            .filter(([tag]) => content.includes(tag))
            .map(([, id]) => id)
            .filter((id) => memberIds.has(id)),
          attachmentUrl: attachment?.url,
          attachmentType: attachment?.type,
        }),
      })
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      const created = data?.message as ChatMessage | undefined
      if (created?.id) {
        setMessages((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]))
        setConvos((prev) => prev.map((c) => (c.id === activeId ? { ...c, lastMessage: created } : c)))
      }
      setDraft("")
      setPendingMentions({})
      setAttachment(null)
    } catch {
      toast.error("Message didn't send.")
    } finally {
      setSending(false)
    }
  }, [draft, activeId, sending, pendingMentions, memberIds, attachment])

  const createConversation = useCallback(async (userIds: string[], groupName: string) => {
    setBusy(true)
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: userIds.length > 1 ? "GROUP" : "DM", userIds, name: groupName || undefined }),
      })
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      await loadConversations()
      if (data?.conversation?.id) setActiveId(data.conversation.id)
      setShowNew(false)
    } catch {
      toast.error("Couldn't start that chat.")
    } finally {
      setBusy(false)
    }
  }, [loadConversations])

  /**
   * A project room's membership is derived from the project, so "add to chat" really means "add to
   * the project". Said out loud in the picker's note rather than left as a surprise.
   */
  const addPeople = useCallback(async (userIds: string[]) => {
    if (!active?.projectId) return
    setBusy(true)
    try {
      const results = await Promise.allSettled(userIds.map((userId) =>
        fetch(`/api/projects/${active.projectId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, role: "MEMBER" }),
        }).then((r) => { if (!r.ok) throw new Error("failed") })
      ))
      const failed = results.filter((r) => r.status === "rejected").length
      if (failed) toast.error(`${failed} couldn't be added.`)
      else toast.success("Added. They'll appear once they open the app.")
      setShowAddPeople(false)
    } finally {
      setBusy(false)
    }
  }, [active])

  const renameGroup = useCallback(async () => {
    if (!active || active.type !== "GROUP") return
    const next = window.prompt("Group name", active.name ?? "")
    const name = next?.trim()
    if (!name) return
    try {
      const res = await fetch(`/api/conversations/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error("failed")
      setConvos((prev) => prev.map((c) => (c.id === active.id ? { ...c, name } : c)))
    } catch {
      toast.error("Couldn't rename that group.")
    }
  }, [active])

  const groups = useMemo(() => {
    const of = (t: string) => convos.filter((c) => c.type === t)
    return [
      { label: "Direct", items: of("DM") },
      { label: "Groups", items: of("GROUP") },
      { label: "Projects", items: of("PROJECT") },
    ].filter((g) => g.items.length > 0)
  }, [convos])

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-6xl gap-4 animate-fade-in">
      {/* List. On mobile it gives way to the open thread. */}
      <aside className={cn(
        "w-full shrink-0 overflow-y-auto rounded-2xl bg-surface-container-low p-2 md:w-80",
        activeId && "hidden md:block"
      )}>
        <div className="flex items-center justify-between px-3 py-3">
          <h1 className="font-headline text-2xl font-black tracking-tighter text-primary">Messages</h1>
          <button
            onClick={() => setShowNew(true)}
            title="New chat"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {loadingList ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : convos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <MessageSquare className="h-8 w-8 text-on-surface-variant/40" />
            <p className="text-sm font-medium text-on-surface-variant/70">No conversations yet.</p>
            <button onClick={() => setShowNew(true)} className="rounded-full bg-primary px-4 py-2 text-xs font-black text-on-primary">
              Start a chat
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-3 pb-1 text-[11px] font-black uppercase tracking-widest text-on-surface-variant/50">{group.label}</p>
              {group.items.map((c) => {
                const title = titleOf(c, meId)
                const unread = c.unreadCount ?? 0
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      activeId === c.id ? "bg-surface-container-high" : "hover:bg-surface-container"
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-black text-primary">
                      {c.type === "DM" ? initialOf(title) : <Users className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-on-surface">{title}</span>
                      <span className="block truncate text-xs text-on-surface-variant/70">
                        {c.lastMessage?.content || "No messages yet"}
                      </span>
                    </span>
                    {unread > 0 && (
                      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-black text-on-primary">{unread}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </aside>

      {/* Thread */}
      <section className={cn(
        "flex min-w-0 flex-1 flex-col rounded-2xl bg-surface-container-low",
        !activeId && "hidden md:flex"
      )}>
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <MessageSquare className="h-10 w-10 text-on-surface-variant/30" />
            <p className="text-sm font-medium text-on-surface-variant/60">Pick a conversation to start reading.</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-outline-variant/40 px-4 py-3">
              <button onClick={() => setActiveId(null)} className="rounded-lg p-1.5 hover:bg-surface-container md:hidden">
                <ArrowLeft className="h-4 w-4 text-on-surface-variant" />
              </button>
              <h2 className="min-w-0 flex-1 truncate font-headline text-lg font-black tracking-tight text-on-surface">{titleOf(active, meId)}</h2>
              {active.type === "GROUP" && (
                <button onClick={() => void renameGroup()} title="Rename group" className="rounded-lg p-1.5 hover:bg-surface-container">
                  <Pencil className="h-4 w-4 text-on-surface-variant" />
                </button>
              )}
              {active.projectId && (
                <button onClick={() => setShowAddPeople(true)} title="Add people" className="rounded-lg p-1.5 hover:bg-surface-container">
                  <UserPlus className="h-4 w-4 text-on-surface-variant" />
                </button>
              )}
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {loadingThread ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              ) : messages.length === 0 ? (
                <p className="py-16 text-center text-sm text-on-surface-variant/60">No messages yet. Say hi.</p>
              ) : (
                messages.map((m) => {
                  const mine = (m.userId ?? m.user?.id) === meId
                  return (
                    <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[75%] rounded-2xl px-3.5 py-2",
                        mine ? "bg-primary text-on-primary" : "bg-surface-container"
                      )}>
                        {!mine && (
                          <p className="mb-0.5 text-[11px] font-black uppercase tracking-wider text-on-surface-variant/60">
                            {m.user?.name || "Someone"}
                          </p>
                        )}
                        {m.attachmentUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.attachmentUrl}
                            alt=""
                            className="mb-1 max-h-72 w-full rounded-xl object-cover"
                          />
                        )}
                        {m.content && <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>}
                        <p className={cn("mt-1 text-[10px]", mine ? "text-on-primary/70" : "text-on-surface-variant/50")}>
                          {timeOf(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            {mentionMatches.length > 0 && (
              <div className="flex gap-2 overflow-x-auto border-t border-outline-variant/40 px-4 py-2">
                {mentionMatches.map((m) => (
                  <button
                    key={uidOf(m)}
                    onClick={() => applyMention(m)}
                    className="shrink-0 rounded-full bg-surface-container px-3 py-1.5 text-xs font-bold text-on-surface hover:bg-surface-container-high"
                  >
                    {m.user?.name}
                  </button>
                ))}
              </div>
            )}
            {attachment && (
              <div className="flex items-center gap-2 border-t border-outline-variant/40 px-4 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachment.url} alt="" className="h-14 w-14 rounded-lg object-cover" />
                <button onClick={() => setAttachment(null)} className="rounded-lg p-1.5 hover:bg-surface-container">
                  <X className="h-4 w-4 text-on-surface-variant" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 border-t border-outline-variant/40 px-4 py-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) void upload(file)
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                title="Send a photo"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container disabled:opacity-40"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 text-on-surface-variant" />}
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send() }
                }}
                rows={1}
                placeholder="Write a message…"
                className="max-h-32 flex-1 resize-none rounded-2xl bg-surface-container px-4 py-2.5 text-sm outline-none placeholder:text-on-surface-variant/50"
              />
              <button
                onClick={() => void send()}
                disabled={(!draft.trim() && !attachment) || sending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary disabled:opacity-40"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </>
        )}
      </section>

      {showNew && (
        <PeoplePicker
          title="New chat"
          confirmLabel="Start chat"
          excludeIds={new Set([meId])}
          busy={busy}
          onCancel={() => setShowNew(false)}
          onConfirm={(ids, groupName) => void createConversation(ids, groupName)}
        />
      )}

      {showAddPeople && active?.projectId && (
        <PeoplePicker
          title="Add people"
          confirmLabel="Add to project"
          note="Anyone you add joins the project itself, not just this chat."
          excludeIds={new Set([...memberIds, meId])}
          busy={busy}
          onCancel={() => setShowAddPeople(false)}
          onConfirm={(ids) => void addPeople(ids)}
        />
      )}
    </div>
  )
}
