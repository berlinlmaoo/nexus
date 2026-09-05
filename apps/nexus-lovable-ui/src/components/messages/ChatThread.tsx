import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Reply, Send, X } from "lucide-react";
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

/** How much of a quoted message a preview shows before it trails off. */
const QUOTE_LIMIT = 80;

/** The one line that stands in for a quoted message: its text, cut short, or a marker for a bare picture. */
function quoteSnippet(content?: string | null, attachmentType?: string | null) {
  const text = (content ?? "").trim();
  if (!text) return attachmentType ? "📎 Attachment" : "";
  return text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT)}…` : text;
}

/** The token being typed right after an "@", or null when the caret isn't in one. */
const MENTION_TAIL = /(^|\s)@([\p{L}\p{N}._-]*)$/u;

export function ChatThread({ conversationId, meId, members = [] }: { conversationId: string; meId?: string; members?: NexusUser[] }) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ url: string; type: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Tag (name without spaces, lowercased) → user id, remembered as you pick from the list. Sending
  // structured ids keeps two people with the same display name from being confused for each other.
  const [tagged, setTagged] = useState<Record<string, string>>({});
  // The message the composer is currently answering, held whole so the quote bar can show its author.
  const [replyTo, setReplyTo] = useState<NexusMessage | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
  // Switching rooms must not carry a half-written message or an unsent picture across.
  useEffect(() => { setInput(""); setPending(null); setTagged({}); setUploadError(null); setReplyTo(null); }, [conversationId]);
  // The highlight on a jumped-to message is a nudge, not a state worth keeping.
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1200);
    return () => clearTimeout(t);
  }, [flashId]);

  const startReply = (m: NexusMessage) => { setReplyTo(m); inputRef.current?.focus(); };

  // Clicking a quote walks back to the message it came from, but only while that message is one of
  // the ones on screen — older pages aren't fetched on demand, so a miss does nothing rather than jump wrong.
  const jumpTo = (id: string) => {
    const el = bubbleRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
  };

  const mentionQuery = useMemo(() => {
    const m = MENTION_TAIL.exec(input);
    return m ? m[2] : null;
  }, [input]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return members.filter((u) => u.id !== meId && (u.name ?? u.email ?? "").toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, members, meId]);

  const pickMention = (u: NexusUser) => {
    const tag = (u.name ?? u.email ?? "").replace(/\s+/g, "");
    if (!tag) return;
    setInput((cur) => cur.replace(MENTION_TAIL, (_full, lead: string) => `${lead}@${tag} `));
    setTagged((cur) => ({ ...cur, [tag.toLowerCase()]: u.id }));
  };

  const upload = useMutation({
    mutationFn: (file: File) => nexusApi.uploadChatImage(conversationId, file),
    onSuccess: (res) => { setPending({ url: res.url, type: res.type }); setUploadError(null); },
    onError: () => setUploadError("Couldn't upload that picture."),
  });

  const send = useMutation({
    mutationFn: (content: string) => {
      // Only tags still present in the final text count — deleting a mention should un-notify.
      const mentionedUserIds = Object.entries(tagged)
        .filter(([tag]) => content.toLowerCase().includes(`@${tag}`))
        .map(([, id]) => id);
      return nexusApi.sendMessage(conversationId, content, {
        ...(mentionedUserIds.length ? { mentionedUserIds } : {}),
        ...(pending ? { attachmentUrl: pending.url, attachmentType: pending.type } : {}),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      });
    },
    onSuccess: () => {
      setInput(""); setPending(null); setTagged({}); setReplyTo(null);
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const busy = send.isPending || upload.isPending;
  // A picture on its own is a message, so an empty box is only a problem when nothing is attached.
  const canSend = (input.trim().length > 0 || !!pending) && !busy;
  const submit = () => { if (canSend) send.mutate(input.trim()); };

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
          const quoted = m.replyTo;
          return (
            <div key={m.id}>
              {showDay && <div className="my-3 text-center text-[11px] font-semibold text-muted-foreground">{day}</div>}
              <div className={cn("group flex items-end gap-2", mine ? "justify-end" : "justify-start")}>
                {!mine && <MiniAvatar user={m.user} size={26} />}
                <div
                  ref={(el) => { bubbleRefs.current[m.id] = el; }}
                  className={cn("max-w-[78%] rounded-2xl px-3.5 py-2 text-sm transition-shadow", mine ? "bg-primary text-primary-foreground" : "bg-muted", flashId === m.id && "ring-2 ring-primary")}
                >
                  {!mine && <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{m.user?.name}</div>}
                  {quoted && (
                    <button
                      onClick={() => jumpTo(quoted.id)}
                      title="Jump to that message"
                      className={cn(
                        "mb-1 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-[11px] leading-snug transition-colors",
                        mine ? "border-primary-foreground/50 bg-primary-foreground/10 hover:bg-primary-foreground/20" : "border-primary/60 bg-background/60 hover:bg-background",
                      )}
                    >
                      <span className={cn("block font-semibold", mine ? "text-primary-foreground/90" : "text-foreground")}>{quoted.user?.name ?? "Someone"}</span>
                      <span className={cn("block truncate", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{quoteSnippet(quoted.content, quoted.attachmentType)}</span>
                    </button>
                  )}
                  {m.attachmentUrl && (
                    <a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="mb-1 block">
                      <img src={m.attachmentUrl} alt="" loading="lazy" className="max-h-72 w-auto max-w-full rounded-xl object-cover" />
                    </a>
                  )}
                  {m.content && <span className="whitespace-pre-wrap leading-relaxed">{m.content}</span>}
                  <span className={cn("mt-0.5 block text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{fmtTime(m.createdAt)}</span>
                </div>
                <button
                  onClick={() => startReply(m)}
                  title="Reply"
                  className="mb-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-accent focus:opacity-100 group-hover:opacity-100"
                >
                  <Reply className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative border-t border-border p-3">
        {mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-pop">
            {mentionMatches.map((u) => (
              <button key={u.id} onMouseDown={(e) => { e.preventDefault(); pickMention(u); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{initialsOf(u.name)}</span>
                <span className="flex-1 truncate">{u.name ?? u.email}</span>
              </button>
            ))}
          </div>
        )}

        {replyTo && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-primary bg-muted/60 px-3 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-primary">Replying to {replyTo.user?.name ?? "someone"}</div>
              <div className="truncate text-xs text-muted-foreground">{quoteSnippet(replyTo.content, replyTo.attachmentType)}</div>
            </div>
            <button onClick={() => setReplyTo(null)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent" title="Cancel reply"><X className="h-4 w-4" /></button>
          </div>
        )}

        {pending && (
          <div className="mb-2 flex items-center gap-2">
            <img src={pending.url} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-border" />
            <button onClick={() => setPending(null)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent" title="Remove picture"><X className="h-4 w-4" /></button>
          </div>
        )}
        {uploadError && <p className="mb-2 text-xs font-semibold text-destructive">{uploadError}</p>}

        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset first: picking the same file twice in a row fires no change event otherwise.
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Send a picture"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-all hover:bg-accent active:scale-[0.95] disabled:opacity-50"
          >
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                // Enter picks the highlighted name while the mention list is open, and only sends
                // once it's closed - otherwise typing "@ann<Enter>" fires off a half-typed tag.
                if (mentionMatches.length > 0) { e.preventDefault(); pickMention(mentionMatches[0]); return; }
                e.preventDefault(); submit();
              }
            }}
            rows={1}
            placeholder="Type a message…  (@ to tag someone)"
            className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
          />
          <button onClick={submit} disabled={!canSend} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.95] disabled:opacity-50">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
