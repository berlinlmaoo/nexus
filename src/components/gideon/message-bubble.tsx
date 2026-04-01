'use client'

import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolResultCard } from './tool-result-card'

interface ToolResult {
  tool: string
  result: unknown
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

interface MessageBubbleProps {
  role?: 'user' | 'assistant'
  content?: string
  message?: Message
  toolResults?: ToolResult[]
  isStreaming?: boolean
}

function formatContent(text: string) {
  if (!text) return []
  const parts: React.ReactNode[] = []
  let key = 0

  const lines = text.split('\n')
  let inCodeBlock = false
  let codeContent = ''

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        parts.push(
          <pre
            key={key++}
            className="my-2 overflow-x-auto rounded bg-black/30 p-2 text-xs text-green-300"
          >
            <code>{codeContent.trim()}</code>
          </pre>
        )
        codeContent = ''
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeContent += line + '\n'
      continue
    }

    // Process inline formatting
    let processed = line
    // Bold
    processed = processed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    processed = processed.replace(/`([^`]+)`/g, '<code class="rounded bg-black/20 px-1 py-0.5 text-xs">$1</code>')

    parts.push(
      <span
        key={key++}
        className="block"
        dangerouslySetInnerHTML={{ __html: processed }}
      />
    )
  }

  return parts
}

export function MessageBubble({ role, content, message, toolResults, isStreaming }: MessageBubbleProps) {
  const finalRole = message?.role || role
  const finalContent = message?.content || content || ""
  const isUser = finalRole === 'user'

  return (
    <div className={cn('flex w-full gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800">
          <Bot className="h-4 w-4 text-white" />
        </div>
      )}

      <div className={cn('flex max-w-[85%] flex-col gap-1', isUser && 'items-end')}>
        {!isUser && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            GIDEON
          </span>
        )}

        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isUser
              ? 'rounded-br-md bg-zinc-800 text-white'
              : 'rounded-bl-md bg-zinc-800/50 text-gray-200'
          )}
        >
          {content && formatContent(content)}
          {isStreaming && !content && (
            <div className="flex items-center gap-1 py-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
            </div>
          )}
        </div>

        {toolResults && toolResults.length > 0 && (
          <div className="mt-1 flex flex-col gap-1.5">
            {toolResults.map((tr, i) => (
              <ToolResultCard key={i} tool={tr.tool} result={tr.result} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
