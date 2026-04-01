"use client"

import { useEffect, useRef, useState } from "react"
import { MessageBubble } from "./message-bubble"
import { Button } from "@/components/ui/button"
import { 
  X, 
  Send, 
  Loader2, 
  Trash2, 
  Sparkles, 
  Zap, 
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

interface GideonPanelProps {
  onClose: () => void
}

export function GideonPanel({ onClose }: GideonPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = { id: Date.now().toString(), role: "user", content: input }
    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMessage] }),
      })

      if (res.ok) {
        const data = await res.json()
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: data.content || data.message }])
      } else {
        toast.error("Protocol Breach", { description: "Gideon connection interrupted." })
      }
    } catch (err) {
      toast.error("System Error", { description: "An unexpected error occurred." })
    } finally {
      setIsLoading(false)
    }
  }

  const clearHistory = () => {
    if (confirm("Terminate current session and purge history?")) {
      setMessages([])
      toast.success("Identity Purged")
    }
  }

  return (
    <div className="flex flex-col h-full bg-surface-container-highest">
      {/* Panel Header */}
      <div className="px-8 py-6 bg-surface-container-highest/50 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:scale-110 active:scale-95 cursor-pointer">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-headline font-black text-sm uppercase tracking-widest text-primary leading-none">Gideon Intelligence</h3>
            <p className="text-[10px] font-bold text-on-surface-variant/40 mt-1.5 uppercase tracking-tighter flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Strategic Copilot Active
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={clearHistory}
            className="p-2 rounded-xl text-on-surface-variant/40 hover:text-primary hover:bg-surface-container transition-all"
            title="Purge Protocol"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-on-surface-variant/40 hover:text-primary hover:bg-surface-container transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Messages Flow */}
      <div className="flex-1 overflow-y-auto px-8 py-4 space-y-8 scrollbar-hide">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-8 py-12">
            <div className="w-24 h-24 rounded-[2.5rem] bg-surface-container flex items-center justify-center text-on-surface-variant/10 animate-pulse relative">
              <Sparkles className="h-12 w-12" />
              <div className="absolute inset-0 rounded-[2.5rem] ring-1 ring-primary/5 animate-ping" />
            </div>
            <div className="space-y-3">
              <h4 className="text-2xl font-headline font-black text-primary tracking-tight">Awaiting Directives</h4>
              <p className="text-sm text-on-surface-variant/40 max-w-[260px] mx-auto leading-relaxed">System identity: Gideon. I am ready to facilitate your workspace strategy.</p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full pt-4">
              {[
                "Analyze tactical risks",
                "Summarize recent intelligence",
                "Orchestrate upcoming sprint"
              ].map(suggestion => (
                <button 
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="group flex items-center justify-between px-5 py-4 rounded-2xl bg-surface-container-low text-[11px] font-black uppercase tracking-widest text-on-surface-variant/60 hover:text-primary hover:bg-surface-container-lowest transition-all text-left shadow-sm hover:shadow-md"
                >
                  {suggestion}
                  <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-all" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {isLoading && (
              <div className="flex items-center gap-3 px-4 py-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" />
              </div>
            )}
            <div ref={messagesEndRef} className="h-4" />
          </>
        )}
      </div>

      {/* Input Console */}
      <div className="p-8 bg-surface-container-highest/80 backdrop-blur-md border-t border-on-surface-variant/5">
        <form
          onSubmit={handleSubmit}
          className="relative group"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Transmit command..."
            className="w-full h-16 bg-surface-container-lowest border-none rounded-[1.25rem] pl-6 pr-16 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 shadow-2xl shadow-primary/5 focus:ring-4 focus:ring-primary/5 transition-all"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="absolute right-3 top-3 h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-20 hover:shadow-xl transition-all duration-300 group-hover:scale-105 active:scale-95"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
        <div className="flex items-center justify-center gap-4 mt-6">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-on-surface-variant/20">Protocol Nexus-AI v4.2</p>
          <div className="h-1 w-1 rounded-full bg-on-surface-variant/10" />
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-on-surface-variant/20">Secure Node</p>
        </div>
      </div>
    </div>
  )
}
