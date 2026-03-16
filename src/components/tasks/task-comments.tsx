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
} from "lucide-react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { cn } from "@/lib/utils"

interface Comment {
  id: string
  content: string
  createdAt: string
  user: { id: string; name: string; avatar: string | null }
}

interface TaskCommentsProps {
  taskId: string
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

export function TaskComments({ taskId, projectMembers = [] }: TaskCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState("")

  // Mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionPosition, setMentionPosition] = useState<{ top: number; left: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mentionDropdownRef = useRef<HTMLDivElement>(null)

  const filteredMembers = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    return projectMembers.filter((m) => m.name.toLowerCase().includes(q))
  }, [mentionQuery, projectMembers])

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`)
      if (!res.ok) throw new Error("Failed to fetch comments")
      const data = await res.json()
      setComments(data.comments || [])
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

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      })
      if (!res.ok) throw new Error("Failed to post comment")
      setContent("")
      await fetchComments()
    } catch (err) {
      console.error("Failed to post comment:", err)
    } finally {
      setSubmitting(false)
    }
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

  const handleBold = () => wrapSelection("**", "**")
  const handleItalic = () => wrapSelection("*", "*")
  const handleLink = () => {
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

      // Approximate position for dropdown
      const textarea = textareaRef.current
      if (textarea) {
        const lineHeight = 20
        const lines = textBeforeCursor.split("\n")
        const currentLine = lines.length - 1
        setMentionPosition({
          top: (currentLine + 1) * lineHeight,
          left: 0,
        })
      }
    } else {
      setMentionQuery(null)
      setMentionPosition(null)
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
      const newContent =
        content.substring(0, startOfMention) +
        `@${member.name} ` +
        content.substring(cursorPos)
      setContent(newContent)

      const newCursorPos = startOfMention + member.name.length + 2
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(newCursorPos, newCursorPos)
      })
    }

    setMentionQuery(null)
    setMentionPosition(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMentionIndex((i) => Math.min(i + 1, filteredMembers.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMentionIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        insertMention(filteredMembers[mentionIndex])
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setMentionQuery(null)
        setMentionPosition(null)
        return
      }
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
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
          onClick={() => {
            setLoading(true)
            fetchComments()
          }}
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
      <div className="rounded-lg border border-border bg-background overflow-hidden">
        {/* Formatting toolbar */}
        <div className="flex items-center gap-0.5 border-b border-border/50 px-2 py-1">
          <button
            type="button"
            onClick={handleBold}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-muted-foreground transition-colors"
            title="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleItalic}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-muted-foreground transition-colors"
            title="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleLink}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-muted-foreground transition-colors"
            title="Link"
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Textarea with mention dropdown */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Write a comment..."
            rows={3}
            className="w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0"
          />

          {/* Mention dropdown */}
          <AnimatePresence>
            {mentionQuery !== null && filteredMembers.length > 0 && mentionPosition && (
              <motion.div
                ref={mentionDropdownRef}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute left-3 z-50 w-56 rounded-md border border-border bg-background shadow-lg"
                style={{ bottom: "100%", marginBottom: 4 }}
              >
                <div className="p-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
                    <AtSign className="h-3 w-3" />
                    Members
                  </div>
                  {filteredMembers.map((member, idx) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => insertMention(member)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors",
                        idx === mentionIndex
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-accent"
                      )}
                    >
                      <UserAvatar
                        user={{ name: member.name, avatar: member.avatar }}
                        size="xs"
                      />
                      <span className="truncate">{member.name}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Submit bar */}
        <div className="flex items-center justify-between border-t border-border/50 px-3 py-2">
          <p className="text-[11px] text-muted-foreground/60">
            {projectMembers.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <AtSign className="h-3 w-3" />
                Mention with @
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              content.trim() && !submitting
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted text-muted-foreground/60 cursor-not-allowed"
            )}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send
          </button>
        </div>
      </div>

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
              <motion.div
                key={comment.id}
                variants={commentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                layout
                className="flex gap-3"
              >
                <div className="shrink-0 pt-0.5">
                  <UserAvatar
                    user={{ name: comment.user.name, avatar: comment.user.avatar }}
                    size="sm"
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
                  </div>
                  <div
                    className="mt-1 text-sm text-muted-foreground leading-relaxed break-words [&_strong]:font-semibold [&_strong]:text-foreground [&_em]:italic"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(comment.content),
                    }}
                  />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
