'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Send, Bot, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GideonButton } from './gideon-button'
import { MessageBubble } from './message-bubble'
import { useAppStore } from '@/stores/app-store'
import { ScrollArea } from '@/components/ui/scroll-area'

interface ToolResult {
  tool: string
  result: unknown
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolResults?: ToolResult[]
}

type ModelChoice = 'sonnet' | 'opus'

export function GideonChat() {
  const { gideonOpen, toggleGideon } = useAppStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [model, setModel] = useState<ModelChoice>('sonnet')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isStreaming])

  useEffect(() => {
    if (gideonOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [gideonOpen])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    }

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolResults: [],
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setInput('')
    setIsStreaming(true)

    try {
      const apiMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch('/api/gideon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model }),
      })

      if (!res.ok) throw new Error('Failed to connect to GIDEON')

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6)

          try {
            const event = JSON.parse(jsonStr)

            if (event.type === 'text') {
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last.role === 'assistant') {
                  last.content += event.content
                }
                return updated
              })
            } else if (event.type === 'tool_result') {
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last.role === 'assistant') {
                  last.toolResults = [
                    ...(last.toolResults || []),
                    { tool: event.tool, result: event.result },
                  ]
                }
                return updated
              })
            } else if (event.type === 'error') {
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last.role === 'assistant') {
                  last.content = event.content || 'An error occurred.'
                }
                return updated
              })
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    } catch (error) {
      console.error('GIDEON error:', error)
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last.role === 'assistant') {
          last.content = 'Sorry, I encountered an error. Please try again.'
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <>
      <GideonButton isOpen={gideonOpen} onClick={toggleGideon} />

      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity duration-300',
          gideonOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={toggleGideon}
      />

      {/* Slide-in panel */}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 flex h-screen w-[420px] max-w-full flex-col bg-zinc-950 shadow-2xl transition-transform duration-300 ease-in-out',
          gideonOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">GIDEON</h3>
              <p className="text-[10px] text-zinc-500">Strategic Operations AI</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Model selector */}
            <div className="flex rounded-lg bg-white/5 p-0.5">
              <button
                onClick={() => setModel('sonnet')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-200',
                  model === 'sonnet'
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-white'
                )}
              >
                <Sparkles className="h-3 w-3" />
                Sonnet
              </button>
              <button
                onClick={() => setModel('opus')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-200',
                  model === 'opus'
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-white'
                )}
              >
                <Sparkles className="h-3 w-3" />
                Opus
              </button>
            </div>

            <button
              onClick={toggleGideon}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white transition-all duration-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4" ref={scrollRef}>
          <div className="space-y-4 py-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5">
                  <Bot className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white">Hey, I&apos;m GIDEON</h3>
                <p className="mt-1 max-w-[280px] text-sm text-zinc-500">
                  Your Strategic Operations AI. I can create tasks, update statuses, assign team members, and more.
                </p>
                <div className="mt-6 grid w-full gap-2">
                  {[
                    'Show me all my tasks',
                    'Create a new urgent task',
                    'List all projects',
                  ].map((suggestion, i) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion)
                        setTimeout(() => inputRef.current?.focus(), 0)
                      }}
                      className="rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-zinc-400 hover:border-zinc-700 hover:bg-white/5 transition-all duration-200 animate-fade-in-up"
                      style={{ animationDelay: `${(i + 1) * 100}ms` }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                toolResults={msg.toolResults}
                isStreaming={isStreaming && msg === messages[messages.length - 1] && msg.role === 'assistant'}
              />
            ))}

            {/* Typing indicator */}
            {isStreaming && messages.length > 0 && messages[messages.length - 1].content === '' && (
              <div className="flex items-center gap-1 px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce-dots" style={{ animationDelay: '0ms' }} />
                <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce-dots" style={{ animationDelay: '160ms' }} />
                <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce-dots" style={{ animationDelay: '320ms' }} />
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t border-white/10 p-3">
          <div className="flex items-end gap-2 rounded-xl bg-white/5 px-3 py-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask GIDEON anything..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-white placeholder-zinc-600 focus:outline-none"
              style={{ maxHeight: '120px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = Math.min(target.scrollHeight, 120) + 'px'
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200 active:scale-90',
                input.trim() && !isStreaming
                  ? 'bg-white text-zinc-900 hover:bg-zinc-200'
                  : 'text-zinc-700'
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-zinc-700">
            GIDEON &middot; {model === 'sonnet' ? 'Claude Sonnet 4.6' : 'Claude Opus 4.6'}
          </p>
        </div>
      </div>
    </>
  )
}
