'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { X, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MessageBubble } from './message-bubble'

interface ToolResult {
  tool: string
  result: unknown
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolResults?: ToolResult[]
}

interface GideonPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function GideonPanel({ isOpen, onClose }: GideonPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Hello! I\'m GIDEON, your AI assistant for NEXUS project management. I can help you create tasks, update statuses, assign team members, and more. How can I help you today?',
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<'sonnet' | 'opus'>('sonnet')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isOpen])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const userMessage: Message = { role: 'user', content: trimmed }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInput('')
    setIsLoading(true)

    // Add placeholder for assistant response
    setMessages((prev) => [...prev, { role: 'assistant', content: '', toolResults: [] }])

    try {
      const apiMessages = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const response = await fetch('/api/gideon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model: selectedModel }),
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader available')

      const decoder = new TextDecoder()
      let buffer = ''
      let accumulatedContent = ''
      const accumulatedTools: ToolResult[] = []

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
              accumulatedContent += event.content
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: accumulatedContent,
                  toolResults: [...accumulatedTools],
                }
                return updated
              })
            } else if (event.type === 'tool_result') {
              accumulatedTools.push({ tool: event.tool, result: event.result })
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: accumulatedContent,
                  toolResults: [...accumulatedTools],
                }
                return updated
              })
            } else if (event.type === 'error') {
              accumulatedContent += event.content
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: accumulatedContent,
                  toolResults: [...accumulatedTools],
                }
                return updated
              })
            }
          } catch {
            // Ignore malformed JSON
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
        }
        return updated
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex animate-slide-in-right">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto flex h-full w-[420px] flex-col bg-[#09090B] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 overflow-hidden">
              <Image
                src="/logos/gideon-icon-white.png"
                alt="GIDEON"
                width={32}
                height={32}
                className="h-6 w-6 object-contain"
              />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">GIDEON</h2>
              <p className="text-[10px] text-gray-400">AI Project Assistant</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Model Selector */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-[10px] font-medium',
                  selectedModel === 'sonnet' ? 'text-white' : 'text-gray-500'
                )}
              >
                Sonnet
              </span>
              <button
                onClick={() =>
                  setSelectedModel((m) => (m === 'sonnet' ? 'opus' : 'sonnet'))
                }
                className={cn(
                  'relative h-5 w-9 rounded-full transition-colors',
                  selectedModel === 'opus' ? 'bg-zinc-800' : 'bg-gray-600'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                    selectedModel === 'opus' ? 'left-[18px]' : 'left-0.5'
                  )}
                />
              </button>
              <span
                className={cn(
                  'text-[10px] font-medium',
                  selectedModel === 'opus' ? 'text-white' : 'text-gray-500'
                )}
              >
                Opus
              </span>
            </div>

            <button
              onClick={onClose}
              className="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.map((message, i) => (
            <MessageBubble
              key={i}
              role={message.role}
              content={message.content}
              toolResults={message.toolResults}
              isStreaming={isLoading && i === messages.length - 1 && message.role === 'assistant'}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/10 p-3">
          <div className="flex items-end gap-2 rounded-xl bg-white/5 px-3 py-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask GIDEON anything..."
              rows={1}
              className="max-h-24 flex-1 resize-none bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                input.trim() && !isLoading
                  ? 'bg-white text-zinc-900 hover:bg-zinc-200'
                  : 'text-gray-600'
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-600">
            GIDEON uses {selectedModel === 'opus' ? 'Claude Opus' : 'Claude Sonnet'} &middot;
            Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  )
}
