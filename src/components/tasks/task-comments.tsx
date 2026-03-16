"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { format } from "date-fns"
import { motion, AnimatePresence } from "framer-motion"
import {
  Send,
  Loader2,
  Clock,
  Bold,
  Italic,
  Link2,
  AtSign,
  MessageSquare,
  Reply,
  Pencil,
  Trash2,
  MoreHorizontal,
  X,
  Check,
  SmilePlus,
} from "lucide-react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { cn } from "@/lib/utils"

interface Reaction {
  id: string
  emoji: string
  user: { id: string; name: string }
}

interface Comment {
  id: string
  content: string
  createdAt: string
  isEdited?: boolean
  parentId?: string | null
  user: { id: string; name: string; avatar: string | null }
  replies?: Comment[]
  reactions?: Reaction[]
}

interface TaskCommentsProps {
  taskId: string
  currentUserId?: string
  projectMembers?: { id: string; name: string; avatar: string | null }[]
}

const commentVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" as const },
  },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
}

function renderMarkdown(content: string): string {
  let html = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  // Italic: *text*
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>")
  // Links: [text](url)
  html = html.replace(
    /\[(.+?)\]\((.+?)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-foreground underline underline-offset-2 hover:text-muted-foreground">$1</a>'
  )
  // Line breaks
  html = html.replace(/\n/g, "<br />")

  return html
}

function CommentComposer({
  onSubmit,
  submitting,
  placeholder = "Write a comment...",
  projectMembers = [],
  autoFocus = false,
  compact = false,
  onCancel,
}: {
  onSubmit: (content: string) => void
  submitting: boolean
  placeholder?: string
  projectMembers?: { id: string; name: string; avatar: string | null }[]
  autoFocus?: boolean
  compact?: boolean
  onCancel?: () => void
}) {
  const [content, setContent] = useState("")
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const filteredMembers = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    return projectMembers.filter((m) => m.name.toLowerCase().includes(q))
  }, [mentionQuery, projectMembers])

  const handleSubmit = () => {
    const trimmed = content.trim()
    if (!trimmed || submitting) return
    onSubmit(trimmed)
    setContent("")
  }

  const wrapSelection = (before: string, after: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = content.substring(start, end)
    const replacement = `${before}${selected || "text"}${after}`
    const newContent = content.substring(0, start) + replacement + content.substring(end)
    setContent(newContent)
    requestAnimationFrame(() => {
      textarea.focus()
      if (selected) {
        textarea.setSelectionRange(start, start + replacement.length)
      } else {
        textarea.setSelectionRange(start + before.length, start + before.length + 4)
      }
    })
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setContent(value)
    const cursorPos = e.target.selectionStart
    const textBeforeCursor = value.substring(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@(\w*)$/)
    if (atMatch && projectMembers.length > 0) {
      setMentionQuery(atMatch[1])
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  const insertMention = (member: { name: string }) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursorPos = textarea.selectionStart
    const textBeforeCursor = content.substring(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@(\w*)$/)
    if (atMatch) {
      const startOfMention = cursorPos - atMatch[0].length
      const newContent = content.substring(0, startOfMention) + `@${member.name} ` + content.substring(cursorPos)
      setContent(newContent)
      const newCursorPos = startOfMention + member.name.length + 2
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(newCursorPos, newCursorPos)
      })
    }
    setMentionQuery(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredMembers.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, filteredMembers.length - 1)); return }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredMembers[mentionIndex]); return }
      if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit() }
    if (e.key === "Escape" && onCancel) { onCancel() }
  }

  return (
    <div className={cn("rounded-lg border border-border bg-background overflow-hidden", compact && "border-dashed")}>
      {/* Formatting toolbar */}
      <div className="flex items-center gap-0.5 border-b border-border/50 px-2 py-1">
        <button type="button" onClick={() => wrapSelection("**", "**")} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-muted-foreground transition-colors" title="Bold">
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => wrapSelection("*", "*")} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-muted-foreground transition-colors" title="Italic">
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            const textarea = textareaRef.current
            if (!textarea) return
            const start = textarea.selectionStart
            const end = textarea.selectionEnd
            const selected = content.substring(start, end)
            const replacement = `[${selected || "text"}](url)`
            const newContent = content.substring(0, start) + replacement + content.substring(end)
            setContent(newContent)
            requestAnimationFrame(() => {
              textarea.focus()
              if (selected) {
                const urlStart = start + selected.length + 3
                textarea.setSelectionRange(urlStart, urlStart + 3)
              } else {
                textarea.setSelectionRange(start + 1, start + 5)
              }
            })
          }}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-muted-foreground transition-colors"
          title="Link"
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-accent transition-colors" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={compact ? 2 : 3}
          className="w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0"
          autoFocus={autoFocus}
        />

        <AnimatePresence>
          {mentionQuery !== null && filteredMembers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute left-3 z-50 w-56 rounded-md border border-border bg-background shadow-lg"
              style={{ bottom: "100%", marginBottom: 4 }}
            >
              <div className="p-1">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
                  <AtSign className="h-3 w-3" /> Members
                </div>
                {filteredMembers.map((member, idx) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => insertMention(member)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors",
                      idx === mentionIndex ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    <UserAvatar user={{ name: member.name, avatar: member.avatar }} size="xs" />
                    <span className="truncate">{member.name}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between border-t border-border/50 px-3 py-2">
        <p className="text-[11px] text-muted-foreground/60">
          {projectMembers.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <AtSign className="h-3 w-3" /> Mention with @
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!content.trim() || submitting}
          className={cn(
            "inline-flex items-center justify-center h-8 w-8 rounded-full transition-colors",
            content.trim() && !submitting
              ? "bg-foreground text-background hover:bg-foreground/90"
              : "bg-muted text-muted-foreground/60 cursor-not-allowed"
          )}
          title="Send"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

function CommentItem({
  comment,
  currentUserId,
  taskId,
  projectMembers,
  onRefresh,
  depth = 0,
}: {
  comment: Comment
  currentUserId?: string
  taskId: string
  projectMembers: { id: string; name: string; avatar: string | null }[]
  onRefresh: () => void
  depth?: number
}) {
  const [showReply, setShowReply] = useState(false)
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(comment.content)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)

  const QUICK_EMOJIS = ["👍", "❤️", "😄", "🎉", "🤔", "👀", "🚀", "👏"]

  const isOwn = currentUserId === comment.user.id

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
    }
    if (showMenu || showEmojiPicker) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showMenu, showEmojiPicker])

  const toggleReaction = async (emoji: string) => {
    setShowEmojiPicker(false)
    try {
      await fetch(`/api/tasks/${taskId}/comments/${comment.id}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      })
      onRefresh()
    } catch (e) {
      console.error(e)
    }
  }

  // Group reactions by emoji
  const reactionGroups = useMemo(() => {
    if (!comment.reactions?.length) return []
    const groups: Record<string, { emoji: string; count: number; users: string[]; hasOwn: boolean }> = {}
    for (const r of comment.reactions) {
      if (!groups[r.emoji]) groups[r.emoji] = { emoji: r.emoji, count: 0, users: [], hasOwn: false }
      groups[r.emoji].count++
      groups[r.emoji].users.push(r.user.name)
      if (r.user.id === currentUserId) groups[r.emoji].hasOwn = true
    }
    return Object.values(groups)
  }, [comment.reactions, currentUserId])

  const handleReply = async (content: string) => {
    setReplying(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, parentId: comment.id }),
      })
      if (res.ok) {
        setShowReply(false)
        onRefresh()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setReplying(false)
    }
  }

  const handleEdit = async () => {
    if (!editContent.trim() || savingEdit) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${comment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent.trim() }),
      })
      if (res.ok) {
        setEditing(false)
        onRefresh()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm("Delete this comment?")) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${comment.id}`, {
        method: "DELETE",
      })
      if (res.ok) {
        onRefresh()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <motion.div
      variants={commentVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      layout
      className={cn("flex gap-3", depth > 0 && "ml-8 mt-3")}
    >
      <div className="shrink-0 pt-0.5">
        <UserAvatar
          user={{ name: comment.user.name, avatar: comment.user.avatar }}
          size={depth > 0 ? "xs" : "sm"}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {comment.user.name}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
            <Clock className="h-3 w-3" />
            {format(new Date(comment.createdAt), "MMM d, h:mm a")}
          </span>
          {comment.isEdited && (
            <span className="text-[10px] text-muted-foreground/50 italic">(edited)</span>
          )}

          {/* Actions menu */}
          {isOwn && (
            <div className="relative ml-auto" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="rounded p-1 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 w-32 rounded-md border border-border bg-background shadow-lg py-1">
                  <button
                    onClick={() => { setEditing(true); setEditContent(comment.content); setShowMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button
                    onClick={() => { handleDelete(); setShowMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-600 hover:bg-muted transition-colors"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {editing ? (
          <div className="mt-2 space-y-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleEdit()
                if (e.key === "Escape") setEditing(false)
              }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleEdit}
                disabled={savingEdit || !editContent.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-foreground text-background px-3 py-1 text-xs font-medium hover:bg-foreground/90 disabled:opacity-40"
              >
                {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className="mt-1 text-sm text-muted-foreground leading-relaxed break-words [&_strong]:font-semibold [&_strong]:text-foreground [&_em]:italic"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(comment.content) }}
            />

            {/* Reaction chips */}
            {reactionGroups.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {reactionGroups.map(g => (
                  <button
                    key={g.emoji}
                    onClick={() => toggleReaction(g.emoji)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
                      g.hasOwn
                        ? "border-foreground/30 bg-foreground/5"
                        : "border-border hover:bg-muted"
                    )}
                    title={g.users.join(", ")}
                  >
                    <span>{g.emoji}</span>
                    <span className="text-[10px] text-muted-foreground">{g.count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Reply + React buttons */}
            <div className="flex items-center gap-2 mt-1.5">
              {depth < 2 && (
                <button
                  onClick={() => setShowReply(!showReply)}
                  className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <Reply className="h-3 w-3" /> Reply
                </button>
              )}
              <div className="relative" ref={emojiRef}>
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <SmilePlus className="h-3 w-3" />
                </button>
                {showEmojiPicker && (
                  <div className="absolute left-0 top-full mt-1 z-50 flex gap-0.5 rounded-lg border bg-background p-1.5 shadow-lg">
                    {QUICK_EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => toggleReaction(emoji)}
                        className="rounded p-1 text-sm hover:bg-muted transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Reply composer */}
        {showReply && (
          <div className="mt-3">
            <CommentComposer
              onSubmit={handleReply}
              submitting={replying}
              placeholder={`Reply to ${comment.user.name}...`}
              projectMembers={projectMembers}
              autoFocus
              compact
              onCancel={() => setShowReply(false)}
            />
          </div>
        )}

        {/* Nested replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="space-y-0">
            <AnimatePresence initial={false}>
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  currentUserId={currentUserId}
                  taskId={taskId}
                  projectMembers={projectMembers}
                  onRefresh={onRefresh}
                  depth={depth + 1}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  )
}

export function TaskComments({ taskId, currentUserId: propUserId, projectMembers = [] }: TaskCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(propUserId)

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`)
      if (!res.ok) throw new Error("Failed to fetch comments")
      const data = await res.json()
      setComments(Array.isArray(data) ? data : data.comments || [])
      if (data.currentUserId) setCurrentUserId(data.currentUserId)
      setError(null)
    } catch (err) {
      console.error("Failed to fetch comments:", err)
      setError("Failed to load comments")
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    setLoading(true)
    fetchComments()
  }, [fetchComments])

  useEffect(() => {
    const interval = setInterval(fetchComments, 30_000)
    return () => clearInterval(interval)
  }, [fetchComments])

  const handleSubmit = async (content: string) => {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error("Failed to post comment")
      await fetchComments()
    } catch (err) {
      console.error("Failed to post comment:", err)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          onClick={() => { setLoading(true); fetchComments() }}
          className="mt-2 text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Comment composer */}
      <CommentComposer
        onSubmit={handleSubmit}
        submitting={submitting}
        projectMembers={projectMembers}
      />

      {/* Comments list */}
      {comments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="rounded-full bg-muted p-3 mb-3">
            <MessageSquare className="h-5 w-5 text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium text-foreground">No comments yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Be the first to leave a comment.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {comments.map((comment) => (
              <div key={comment.id} className="group">
                <CommentItem
                  comment={comment}
                  currentUserId={currentUserId}
                  taskId={taskId}
                  projectMembers={projectMembers}
                  onRefresh={fetchComments}
                />
              </div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
