import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { fmtTime, nexusApi, type NexusMessage, type NexusUser } from "@/lib/nexus-api";
import { useRealtimeRoom } from "@/lib/realtime";
import { cn } from "@/lib/utils";

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function MiniAvatar({ user, size = 28 }: { user?: NexusUser | null; size?: number }) {
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary ring-1 ring-border" style={{ width: size, height: size, fontSize: size * 0.36 }} title={user?.name ?? ""}>
      {initialsOf(user?.name)}
    </span>
  );
}

function dayLabel(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function ChatThread({ conversationId, meId }: { conversationId: string; meId?: string }) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useRealtimeRoom(`conversation:${conversationId}`);

  const messagesQuery = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => nexusApi.conversationMessages(conversationId),
    retry: false,
  });
  const messages = useMemo(() => messagesQuery.data?.messages ?? [], [messagesQuery.data]);

  // mark read on open + when new messages arrive
  useEffect(() => { nexusApi.markConversationRead(conversationId).then(() => qc.invalidateQueries({ queryKey: ["conversations"] })).catch(() => {}); }, [conversationId, messages.length, qc]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const send = useMutation({
    mutationFn: (content: string) => nexusApi.sendMessage(conversationId, content),
    onSuccess: () => { setInput(""); qc.invalidateQueries({ queryKey: ["messages", conversationId] }); qc.invalidateQueries({ queryKey: ["conversations"] }); },
  });
  const submit = () => { const t = input.trim(); if (t && !send.isPending) send.mutate(t); };

  let lastDay = "";

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto p-4">
        {messagesQuery.isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {!messagesQuery.isLoading && messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No messages yet. Say hi 👋</p>}
        {messages.map((m: NexusMessage) => {
          const mine = m.userId && meId && m.userId === meId;
          const day = dayLabel(m.createdAt);
          const showDay = day && day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && <div className="my-3 text-center text-[11px] font-semibold text-muted-foreground">{day}</div>}
              <div className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start")}>
                {!mine && <MiniAvatar user={m.user} size={26} />}
                <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {!mine && <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{m.user?.name}</div>}
                  <span className="whitespace-pre-wrap leading-relaxed">{m.content}</span>
                  <span className={cn("mt-0.5 block text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{fmtTime(m.createdAt)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={1}
            placeholder="Type a message…"
            className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
          />
          <button onClick={submit} disabled={!input.trim() || send.isPending} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.95] disabled:opacity-50">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
