import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowDown, Clock, ImagePlus, Loader2, Reply, RotateCw, Send, X } from "lucide-react";
import { ApiError, fmtTime, nexusApi, type NexusConversation, type NexusMessage, type NexusMessagePage, type NexusUser } from "@/lib/nexus-api";
import { useRealtime, useRealtimeRoom } from "@/lib/realtime";
import { useTypers, useTypingSender, type Typer } from "@/lib/chat-typing";
import { Avatar, AvatarFace } from "@/components/Avatar";
import { usePageVisible } from "@/lib/chat-unread";
import { localeOf, useLang, t as translate } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { MessageText, safeHref } from "@/components/messages/MessageText";
import { isSystemMessage, systemSentence } from "@/lib/chat-system";

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/** The sender's photo beside their bubble (initials when there is none), as everywhere else in NEXUS. */
function MiniAvatar({ user, size = 28 }: { user?: NexusUser | null; size?: number }) {
  if (user?.id) return <Avatar userId={user.id} name={user.name} avatar={user.avatar} size={size} className="shrink-0" />;
  return <AvatarFace name={user?.name} size={size} className="shrink-0" />;
}

/**
 * Who is typing, at the bottom of the thread like WhatsApp: their photos beside one bubble of three
 * dots (up to three photos, overlapping, then "+N"), and in a group or project room the words under it.
 * The dots hold still under "reduce motion".
 */
function TypingRow({ typers, named }: { typers: Typer[]; named: boolean }) {
  const { t } = useLang();
  const shown = typers.slice(0, 3);
  const more = typers.length - shown.length;
  const label = typers.length === 1
    ? t("{name} is typing…", { name: typers[0].name || t("Someone") })
    : t("{n} people are typing…", { n: typers.length });
  return (
    <div role="status" aria-live="polite" aria-label={label} className="flex items-end gap-2 pt-1">
      <span className="flex shrink-0 -space-x-2" aria-hidden>
        {shown.map((p) => <Avatar key={p.userId} userId={p.userId} name={p.name} avatar={p.avatar} size={26} />)}
        {more > 0 && (
          <span className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground ring-2 ring-background">+{more}</span>
        )}
      </span>
      <span className="flex min-w-0 flex-col items-start">
        <span className="inline-flex items-center gap-1 rounded-2xl bg-muted px-3.5 py-3" aria-hidden>
          {[0, 150, 300].map((delay) => (
            <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 motion-reduce:animate-none" style={{ animationDelay: `${delay}ms` }} />
          ))}
        </span>
        {named && <span className="mt-0.5 max-w-full truncate text-[11px] text-muted-foreground">{label}</span>}
      </span>
    </div>
  );
}

function dayLabel(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return translate("Today");
  if (d.toDateString() === yest.toDateString()) return translate("Yesterday");
  return d.toLocaleDateString(localeOf(), { weekday: "short", month: "short", day: "numeric" });
}

/** How much of a quoted message a preview shows before it trails off. */
const QUOTE_LIMIT = 80;

/** The one line that stands in for a quoted message: its text, cut short, or a marker for a bare picture. */
function quoteSnippet(content?: string | null, attachmentType?: string | null) {
  const text = (content ?? "").trim();
  if (!text) return attachmentType ? `📎 ${translate("Attachment")}` : "";
  return text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT)}…` : text;
}

/** The token being typed right after an "@", or null when the caret isn't in one. */
const MENTION_TAIL = /(^|\s)@([\p{L}\p{N}._-]*)$/u;

// ---------------------------------------------------------------------------------------------
// Thread cache: ["messages", conversationId] holds every message fetched so far, merged by id.
//
// A refetch (socket event, reconnect, focus) only ever ADDS to what is there: the server is asked
// for what came after the last message we have (`after=`, servers since 8 Oct 2026) or, on an
// older server, for the latest page, which is stitched on when it overlaps. Older pages loaded by
// scrolling up therefore survive every refetch — the old code replaced the whole list with the
// latest 50 each time, dropping them.
// ---------------------------------------------------------------------------------------------

type ThreadData = {
  /** Oldest first, unique by id. */
  messages: NexusMessage[];
  /** More history above the oldest message. */
  hasMoreOlder: boolean;
  /** `before` for the page above: the server's nextCursor, or the oldest createdAt on old servers. */
  olderCursor: string | null;
  /** The server sends nextCursor, so it also understands `after=`. */
  cursorAware: boolean;
  /**
   * The window was opened around one message (a search result, a far-away quote) and does not reach
   * the newest message yet. New messages are not stitched on below it — they would leave a hole — and
   * the newer ones load as you scroll down, or all at once with "Jump to latest".
   */
  hasMoreNewer?: boolean;
};

const PAGE = 50;
/** Longest an unanswered send holds back the next one (ms). */
const SEND_GAP = 15_000;
const CATCH_UP = 100;
const CATCH_UP_PAGES = 5;

const timeOf = (m: NexusMessage) => {
  const v = m.createdAt ? Date.parse(m.createdAt) : NaN;
  return Number.isFinite(v) ? v : 0;
};
const byTime = (a: NexusMessage, b: NexusMessage) => timeOf(a) - timeOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function mergeMessages(base: NexusMessage[], incoming: NexusMessage[]): NexusMessage[] {
  if (incoming.length === 0) return base;
  const byId = new Map(base.map((m) => [m.id, m]));
  for (const m of incoming) if (m?.id) byId.set(m.id, m);
  return [...byId.values()].sort(byTime);
}

function fromPage(res: NexusMessagePage): ThreadData {
  const messages = mergeMessages([], res.messages ?? []);
  return {
    messages,
    hasMoreOlder: !!res.hasMore,
    olderCursor: res.nextCursor ?? messages[0]?.createdAt ?? null,
    cursorAware: "nextCursor" in res,
    hasMoreNewer: !!res.hasMoreNewer,
  };
}

const threadKey = (conversationId: string) => ["messages", conversationId] as const;

/**
 * Adds messages to a thread already in the cache; a thread that isn't cached is left for its first
 * fetch, and a window opened further up (hasMoreNewer) is left alone until it reaches the bottom.
 */
function addToThread(qc: QueryClient, conversationId: string, incoming: NexusMessage[]) {
  qc.setQueryData<ThreadData>(threadKey(conversationId), (cur) => (cur && !cur.hasMoreNewer ? { ...cur, messages: mergeMessages(cur.messages, incoming) } : cur));
}

async function fetchThread(qc: QueryClient, conversationId: string): Promise<ThreadData> {
  const key = threadKey(conversationId);
  const prev = qc.getQueryData<ThreadData>(key);
  const anchor = prev?.messages[prev.messages.length - 1];
  if (!prev || !anchor) return fromPage(await nexusApi.conversationMessages(conversationId, { limit: PAGE }));
  // A window opened around an older message grows downwards by scrolling (loadNewer), not here.
  if (prev.hasMoreNewer) return prev;

  // Merge into whatever the cache holds NOW, not `prev`: a socket insert or a confirmed send may
  // have landed while the request was out, and must not be overwritten.
  const settle = (fresh: NexusMessage[], cursorAware: boolean): ThreadData => {
    const cur = qc.getQueryData<ThreadData>(key) ?? prev;
    return { ...cur, messages: mergeMessages(cur.messages, fresh), cursorAware };
  };

  if (prev.cursorAware) {
    try {
      let fresh: NexusMessage[] = [];
      let after = anchor.id;
      for (let i = 0; i < CATCH_UP_PAGES; i++) {
        const res = await nexusApi.conversationMessages(conversationId, { after, limit: CATCH_UP });
        const rows = res.messages ?? [];
        // A server that ignored `after` (rolled back) returns the latest page, anchor included.
        if (rows.some((m) => m.id === anchor.id)) return settle(rows, false);
        fresh = fresh.concat(rows);
        if (!res.hasMore || rows.length === 0) return settle(fresh, true);
        after = rows[rows.length - 1].id;
      }
    } catch (e) {
      // The anchor is gone (or `after` was refused): start again from the latest page.
      if (!(e instanceof ApiError) || e.status >= 500) throw e;
    }
    // Hundreds of messages behind: show the latest page instead of stitching a gap.
    return fromPage(await nexusApi.conversationMessages(conversationId, { limit: PAGE }));
  }

  // Older server: the latest page. It continues ours when it reaches back to the anchor; when it
  // doesn't, more arrived than one page holds and there is a hole — begin again from the latest.
  const res = await nexusApi.conversationMessages(conversationId, { limit: CATCH_UP });
  const rows = res.messages ?? [];
  const reaches = !res.hasMore || rows.some((m) => m.id === anchor.id) || (rows[0] ? timeOf(rows[0]) <= timeOf(anchor) : true);
  if (!reaches) return fromPage(res);
  return settle(rows, "nextCursor" in res);
}

/** Outgoing message shown at the bottom until the server confirms it (or it fails and waits for Retry). */
type Outgoing = {
  tempId: string;
  conversationId: string;
  content: string;
  attachmentUrl?: string;
  attachmentType?: string;
  replyTo: NexusMessage | null;
  mentionedUserIds: string[];
  status: "sending" | "failed";
  error?: string;
  /** Message ids already on screen when it was queued, to spot its own echo from the socket. */
  knownIds: Set<string>;
};

function sendErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 429) return translate("Sending too fast. Wait a moment, then retry.");
  if (e instanceof ApiError && e.status === 403) return translate("You're no longer in this chat.");
  return translate("Not sent.");
}

/** A picture link only when it is a path on this server or an http(s) address. */
function attachmentHref(url: string): string | null {
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return safeHref(url);
}

/** How long a jumped-to message stays highlighted. */
const FLASH_MS = 2000;

export function ChatThread({
  conversationId,
  meId,
  members = [],
  kind,
  jump = null,
  composerClassName,
}: {
  conversationId: string;
  meId?: string;
  members?: NexusUser[];
  /** "DM" | "GROUP" | "PROJECT": who is typing is named under the dots everywhere but in a DM. */
  kind?: string;
  /** Scroll to this message (loading the page around it when needed) and highlight it; `seq` repeats a jump. */
  jump?: { id: string; seq: number } | null;
  /** Extra classes for the composer row (the page keeps it clear of the floating GIDEON button). */
  composerClassName?: string;
}) {
  const qc = useQueryClient();
  const { lang, t, tn } = useLang();
  const { socket, connected, join } = useRealtime();
  const visible = usePageVisible();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ url: string; type: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Tag (name without spaces, lowercased) → user id, remembered as you pick from the list. Sending
  // structured ids keeps two people with the same display name from being confused for each other.
  const [tagged, setTagged] = useState<Record<string, string>>({});
  // The message the composer is currently answering, held whole so the quote bar can show its author.
  const [replyTo, setReplyTo] = useState<NexusMessage | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Scroll bookkeeping (see "Scrolling" below).
  const atBottomRef = useRef(true);
  const lastTopRef = useRef(0);
  const forceBottomRef = useRef(false);
  const initialDoneRef = useRef(false);
  const convRef = useRef<string | null>(null);
  const prependRef = useRef<{ conversationId: string; height: number; top: number } | null>(null);
  const prevLastRef = useRef<string | undefined>(undefined);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  // A jump waiting for its message to be drawn (after the page around it has loaded).
  const pendingJumpRef = useRef<string | null>(null);

  useRealtimeRoom(`conversation:${conversationId}`);
  // "… is typing": what this composer says, and who else is (chat-typing.ts).
  const typing = useTypingSender(socket, conversationId);
  const typers = useTypers(conversationId);

  const messagesQuery = useQuery({
    queryKey: threadKey(conversationId),
    queryFn: () => fetchThread(qc, conversationId),
    retry: false,
    // The socket is what keeps an open thread live; while it's down, ask every 10 s instead
    // (a near-empty `after=` request on current servers). Never from a background tab.
    refetchInterval: connected ? false : 10_000,
  });
  const thread = messagesQuery.data;
  const messages = useMemo(() => thread?.messages ?? [], [thread]);
  const lastServerId = messages[messages.length - 1]?.id;

  // The room's own event carries the whole message: put it on screen at once. The generic handler
  // in realtime.tsx refetches as well, which fills in anything this one missed.
  useEffect(() => {
    if (!socket) return;
    const onMessage = (payload: unknown) => {
      const m = payload as NexusMessage | null;
      if (m && typeof m.id === "string" && m.conversationId === conversationId) addToThread(qc, conversationId, [m]);
    };
    // Added back to a room after being taken out: the server dropped this socket from the room then,
    // so ask to join again (the join is checked against the membership as it is now).
    const onConversation = (payload: unknown) => {
      const d = (payload ?? {}) as { conversationId?: unknown; reason?: unknown };
      if (d.conversationId === conversationId && d.reason === "membership") join(`conversation:${conversationId}`);
    };
    socket.on("message-created", onMessage);
    socket.on("conversation-updated", onConversation);
    return () => {
      socket.off("message-created", onMessage);
      socket.off("conversation-updated", onConversation);
    };
  }, [socket, conversationId, qc, join]);

  // Read receipt follows the LAST message, not the count: the count stops at the page size, so a
  // long chat used to stop being marked read after its 50th message. `upToMessageId` keeps a message
  // that lands mid-request unread (older servers ignore it). A tab in the background doesn't read —
  // its count shows in the title and the badge until you look.
  const markedRef = useRef<string | null>(null);
  const detached = !!thread?.hasMoreNewer;
  useEffect(() => {
    // Reading an older stretch (opened from a search) is not reading what came in since.
    if (!lastServerId || !visible || detached) return;
    const mark = `${conversationId}:${lastServerId}`;
    if (markedRef.current === mark) return;
    markedRef.current = mark;
    qc.setQueryData<{ conversations: NexusConversation[]; totalUnread?: number }>(["conversations"], (cur) =>
      cur ? { ...cur, conversations: cur.conversations.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)) } : cur,
    );
    nexusApi
      .markConversationRead(conversationId, lastServerId)
      .then(() => qc.invalidateQueries({ queryKey: ["conversations"] }))
      .catch(() => { if (markedRef.current === mark) markedRef.current = null; });
  }, [conversationId, lastServerId, visible, qc, detached]);

  // Stay at the bottom when the thread's box changes size while you are there: it is shown after
  // being hidden (a phone opening the room), the window is resized, the composer grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = `${el.clientWidth}x${el.clientHeight}`;
    const ro = new ResizeObserver(() => {
      const size = `${el.clientWidth}x${el.clientHeight}`;
      if (size === last) return;
      last = size;
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Switching rooms must not carry a half-written message or an unsent picture across.
  useEffect(() => {
    setInput(""); setPending(null); setTagged({}); setUploadError(null); setReplyTo(null);
    setOlderFailed(false); setNewBelow(0);
  }, [conversationId]);
  // A room left while reading an older stretch opens at its newest messages next time.
  useEffect(() => () => {
    if (qc.getQueryData<ThreadData>(threadKey(conversationId))?.hasMoreNewer) qc.removeQueries({ queryKey: threadKey(conversationId) });
  }, [conversationId, qc]);
  // The highlight on a jumped-to message is a nudge, not a state worth keeping.
  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashId]);

  // --- Outgoing: shown at once, then confirmed or marked failed. Sent one after another so they
  // arrive in the order typed — but a request that hangs (old servers send every push before
  // answering) holds the next one back for SEND_GAP at most, not until it finally returns. ---
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const deliver = useCallback((o: Outgoing) => {
    const run = async () => {
      try {
        const res = await nexusApi.sendMessage(o.conversationId, o.content, {
          ...(o.mentionedUserIds.length ? { mentionedUserIds: o.mentionedUserIds } : {}),
          ...(o.attachmentUrl ? { attachmentUrl: o.attachmentUrl, attachmentType: o.attachmentType } : {}),
          ...(o.replyTo ? { replyToId: o.replyTo.id } : {}),
        });
        if (res?.message?.id) addToThread(qc, o.conversationId, [{ conversationId: o.conversationId, ...res.message }]);
        setOutbox((list) => list.filter((x) => x.tempId !== o.tempId));
        // With the socket up, the room's own message-created event refreshes the thread and the
        // list; without it, catch up here.
        if (!socket?.connected) {
          qc.invalidateQueries({ queryKey: threadKey(o.conversationId) });
          qc.invalidateQueries({ queryKey: ["conversations"] });
        }
      } catch (e) {
        setOutbox((list) => list.map((x) => (x.tempId === o.tempId ? { ...x, status: "failed", error: sendErrorText(e) } : x)));
      }
    };
    chainRef.current = chainRef.current.then(() =>
      Promise.race([run(), new Promise<void>((resolve) => setTimeout(resolve, SEND_GAP))]),
    );
  }, [qc, socket]);

  const retry = (o: Outgoing) => {
    const again: Outgoing = { ...o, status: "sending", error: undefined, knownIds: new Set(messages.map((m) => m.id)) };
    setOutbox((list) => list.map((x) => (x.tempId === o.tempId ? again : x)));
    forceBottomRef.current = true;
    deliver(again);
  };
  const discard = (o: Outgoing) => setOutbox((list) => list.filter((x) => x.tempId !== o.tempId));

  // While its POST is still out, an outgoing message can already be back through the socket. Hide
  // the placeholder as soon as a matching message of mine that wasn't there before shows up, so
  // nothing is drawn twice (old servers answer the POST only after every push went out).
  const shownOutbox = useMemo(() => {
    const claimed = new Set<string>();
    return outbox.filter((o) => {
      if (o.conversationId !== conversationId) return false;
      if (o.status !== "sending") return true;
      const echo = messages.find((m) =>
        !claimed.has(m.id) && !o.knownIds.has(m.id) && !!meId && m.userId === meId && !isSystemMessage(m) &&
        (m.content ?? "") === o.content && (m.attachmentUrl ?? "") === (o.attachmentUrl ?? ""));
      if (!echo) return true;
      claimed.add(echo.id);
      return false;
    });
  }, [outbox, messages, conversationId, meId]);

  // --- Scrolling: start at the bottom, follow new messages only while you're there, keep your
  // place when older ones are added above ---
  const firstId = messages[0]?.id;
  // The typing bubble appearing counts as something new at the bottom (followed only while you're there).
  const bottomKey = `${lastServerId ?? ""}|${shownOutbox.length}|${typers.length}`;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prep = prependRef.current;
    if (prep && prep.conversationId === conversationId) {
      el.scrollTop = el.scrollHeight - prep.height + prep.top;
      prependRef.current = null;
    }
  }, [firstId, conversationId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (convRef.current !== conversationId) {
      convRef.current = conversationId;
      initialDoneRef.current = false;
      atBottomRef.current = true;
      prevLastRef.current = undefined;
    }
    if (!initialDoneRef.current) {
      if (!messagesQuery.isSuccess) return;
      el.scrollTop = el.scrollHeight;
      initialDoneRef.current = true;
      prevLastRef.current = lastServerId;
      return;
    }
    const prevLast = prevLastRef.current;
    prevLastRef.current = lastServerId;
    if (forceBottomRef.current || atBottomRef.current) {
      forceBottomRef.current = false;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else if (lastServerId !== prevLast) {
      // Reading further up: don't yank the view, count what landed below instead.
      const from = prevLast ? messages.findIndex((m) => m.id === prevLast) : -1;
      const landed = (from >= 0 ? messages.slice(from + 1) : messages.slice(-1)).filter((m) => m.userId !== meId && !isSystemMessage(m)).length;
      if (landed > 0) setNewBelow((n) => n + landed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomKey, conversationId, messagesQuery.isSuccess]);

  const loadOlder = useCallback(async () => {
    const key = threadKey(conversationId);
    const cur = qc.getQueryData<ThreadData>(key);
    const el = scrollRef.current;
    if (!cur || !cur.hasMoreOlder || !cur.olderCursor || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderFailed(false);
    try {
      const res = await nexusApi.conversationMessages(conversationId, { before: cur.olderCursor, limit: PAGE });
      const rows = res.messages ?? [];
      const known = new Set(cur.messages.map((m) => m.id));
      // Remember where the reader is, to put them back there once the rows above are drawn.
      if (el && scrollRef.current === el && rows.some((m) => !known.has(m.id))) {
        prependRef.current = { conversationId, height: el.scrollHeight, top: el.scrollTop };
      }
      qc.setQueryData<ThreadData>(key, (c) => {
        if (!c) return c;
        const merged = mergeMessages(c.messages, rows);
        return {
          ...c,
          messages: merged,
          hasMoreOlder: !!res.hasMore && rows.length > 0,
          olderCursor: res.nextCursor ?? (rows.length ? [...rows].sort(byTime)[0].createdAt ?? null : c.olderCursor),
          cursorAware: c.cursorAware || "nextCursor" in res,
        };
      });
    } catch {
      setOlderFailed(true);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, qc]);

  // A window opened around an older message: the next page below it, as you scroll down.
  const loadNewer = useCallback(async () => {
    const key = threadKey(conversationId);
    const cur = qc.getQueryData<ThreadData>(key);
    const last = cur?.messages[cur.messages.length - 1];
    if (!cur?.hasMoreNewer || !last || loadingNewerRef.current) return;
    loadingNewerRef.current = true;
    setLoadingNewer(true);
    try {
      const res = await nexusApi.conversationMessages(conversationId, { after: last.id, limit: PAGE });
      const rows = res.messages ?? [];
      // Nothing to count as "new below": these were already there, just not loaded.
      prevLastRef.current = rows[rows.length - 1]?.id ?? prevLastRef.current;
      qc.setQueryData<ThreadData>(key, (c) => (c ? { ...c, messages: mergeMessages(c.messages, rows), hasMoreNewer: !!res.hasMore && rows.length > 0 } : c));
    } catch {
      // The bottom stays where it is; scrolling down again retries.
    } finally {
      loadingNewerRef.current = false;
      setLoadingNewer(false);
    }
  }, [conversationId, qc]);

  /** Back to the newest messages: from a window opened further up, a fresh latest page. */
  const jumpToLatest = useCallback(() => {
    if (qc.getQueryData<ThreadData>(threadKey(conversationId))?.hasMoreNewer) {
      initialDoneRef.current = false;
      atBottomRef.current = true;
      // Back to no data: the fetch starts again from the latest page, and lands at the bottom.
      void qc.resetQueries({ queryKey: threadKey(conversationId) });
    }
  }, [conversationId, qc]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    const goingUp = el.scrollTop < lastTopRef.current;
    lastTopRef.current = el.scrollTop;
    // Only a scroll UP lets go of the bottom: a smooth scroll on its way down passes through
    // "not at the bottom" positions too, and must not count as the reader leaving.
    if (nearBottom && !detached) { atBottomRef.current = true; setNewBelow(0); }
    else if (goingUp) atBottomRef.current = false;
    if (initialDoneRef.current && goingUp && el.scrollTop < 160 && !olderFailed) void loadOlder();
    if (detached && !goingUp && el.scrollHeight - el.scrollTop - el.clientHeight < 240) void loadNewer();
  };

  const scrollToBottom = () => {
    if (detached) { setNewBelow(0); jumpToLatest(); return; }
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = true;
    setNewBelow(0);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // A picture that finishes loading grows the list; stay pinned to the bottom if that's where you were.
  const onMediaLoad = () => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  };

  const startReply = (m: NexusMessage) => { setReplyTo(m); inputRef.current?.focus(); };

  // Walk to a message and highlight it: a quote, a search result. One that isn't loaded yet brings
  // the page around it (servers since 8 Oct 2026: `around=`), which then grows as you scroll.
  const jumpTo = useCallback(async (id: string) => {
    const el = bubbleRefs.current[id];
    if (el) {
      atBottomRef.current = false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(id);
      return;
    }
    try {
      const res = await nexusApi.conversationMessages(conversationId, { around: id, limit: PAGE });
      const rows = res.messages ?? [];
      if (!rows.some((m) => m.id === id)) return; // an older server ignored `around`: stay put
      const page = fromPage(res);
      atBottomRef.current = false;
      forceBottomRef.current = false;
      prevLastRef.current = page.messages[page.messages.length - 1]?.id;
      pendingJumpRef.current = id;
      setNewBelow(0);
      qc.setQueryData<ThreadData>(threadKey(conversationId), page);
    } catch {
      // Not reachable (deleted, or no longer in this room): nothing to show.
    }
  }, [conversationId, qc]);

  // Once the page around a jumped-to message is drawn, bring it into view.
  useLayoutEffect(() => {
    const id = pendingJumpRef.current;
    if (!id) return;
    const el = bubbleRefs.current[id];
    if (!el) return;
    pendingJumpRef.current = null;
    el.scrollIntoView({ block: "center" });
    setFlashId(id);
  }, [messages]);

  // A jump asked for from outside (the info panel's search).
  useEffect(() => {
    if (jump?.id) void jumpTo(jump.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.seq]);

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
    onError: () => setUploadError(t("Couldn't upload that picture.")),
  });

  const busy = upload.isPending;
  // A picture on its own is a message, so an empty box is only a problem when nothing is attached.
  const canSend = (input.trim().length > 0 || !!pending) && !busy;
  const submit = () => {
    if (!canSend) return;
    const content = input.trim();
    // Only tags still present in the final text count — deleting a mention should un-notify.
    const mentionedUserIds = Object.entries(tagged)
      .filter(([tag]) => content.toLowerCase().includes(`@${tag}`))
      .map(([, id]) => id);
    const o: Outgoing = {
      tempId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      content,
      ...(pending ? { attachmentUrl: pending.url, attachmentType: pending.type } : {}),
      replyTo,
      mentionedUserIds,
      status: "sending",
      knownIds: new Set(messages.map((m) => m.id)),
    };
    setOutbox((list) => [...list, o]);
    setInput(""); setPending(null); setTagged({}); setReplyTo(null);
    typing.stop();
    forceBottomRef.current = true;
    // Writing from an older stretch: back to the bottom, where the message will appear.
    jumpToLatest();
    deliver(o);
  };

  const hasMoreOlder = !!thread?.hasMoreOlder;
  let lastDay = "";

  const renderQuote = (quoted: NexusMessage["replyTo"], mine: boolean) => {
    if (!quoted) return null;
    // A quoted picture shows as a thumbnail (servers since 8 Oct 2026 send its attachmentUrl).
    const thumb = quoted.attachmentUrl && (!quoted.attachmentType || quoted.attachmentType.startsWith("image/")) ? attachmentHref(quoted.attachmentUrl) : null;
    return (
      <button
        onClick={() => { void jumpTo(quoted.id); }}
        title={t("Jump to that message")}
        className={cn(
          "mb-1 flex w-full items-center gap-2 rounded-lg border-l-2 px-2 py-1 text-left text-[11px] leading-snug transition-colors",
          mine ? "border-primary-foreground/50 bg-primary-foreground/10 hover:bg-primary-foreground/20" : "border-primary/60 bg-background/60 hover:bg-background",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className={cn("block font-semibold", mine ? "text-primary-foreground/90" : "text-foreground")}>{quoted.user?.name ?? t("A member")}</span>
          <span className={cn("block truncate", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{!(quoted.content ?? "").trim() && thumb ? `📷 ${t("Photo")}` : quoteSnippet(quoted.content, quoted.attachmentType)}</span>
        </span>
        {thumb && <img src={thumb} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded object-cover" />}
      </button>
    );
  };

  return (
    <div lang={lang} className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full space-y-1.5 overflow-y-auto overscroll-contain p-4">
        {messagesQuery.isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {messagesQuery.isError && !thread && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <p>{t("Couldn't load this chat.")}</p>
            <button onClick={() => messagesQuery.refetch()} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent">{t("Try again")}</button>
          </div>
        )}
        {thread && hasMoreOlder && (
          <div className="flex justify-center pb-2">
            <button
              onClick={() => { setOlderFailed(false); void loadOlder(); }}
              disabled={loadingOlder}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
            >
              {loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
              {loadingOlder ? t("Loading earlier messages…") : olderFailed ? t("Couldn't load earlier messages. Try again") : t("Load earlier messages")}
            </button>
          </div>
        )}
        {thread && !hasMoreOlder && messages.length > 0 && (
          <p className="pb-2 text-center text-[11px] text-muted-foreground">{t("This is the start of the conversation.")}</p>
        )}
        {thread && messages.length === 0 && shownOutbox.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t("No messages yet. Say hi 👋")}</p>}
        {messages.map((m: NexusMessage) => {
          const mine = !!(m.userId && meId && m.userId === meId);
          const day = dayLabel(m.createdAt);
          const showDay = day && day !== lastDay;
          lastDay = day;
          // A group's log line ("Bagas added Mey"): centred, muted, no avatar, no bubble, no actions.
          if (isSystemMessage(m)) {
            const when = m.createdAt ? new Date(m.createdAt) : null;
            const full = when && !Number.isNaN(when.getTime())
              ? when.toLocaleString(localeOf(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
              : "";
            return (
              <div key={m.id}>
                {showDay && <div className="my-3 text-center text-[11px] font-semibold text-muted-foreground">{day}</div>}
                <div className="flex justify-center py-1">
                  <div
                    ref={(el) => { bubbleRefs.current[m.id] = el; }}
                    title={full}
                    className={cn(
                      "group/sys inline-flex max-w-[85%] items-baseline gap-1.5 rounded-full bg-muted/70 px-3 py-1 text-center text-[11px] font-medium leading-snug text-muted-foreground ring-1 ring-border/60 transition-shadow",
                      flashId === m.id && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    )}
                  >
                    <span>{systemSentence(m, meId)}</span>
                    <span className="hidden shrink-0 tabular-nums text-muted-foreground/70 group-hover/sys:inline">{fmtTime(m.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          }
          const href = m.attachmentUrl ? attachmentHref(m.attachmentUrl) : null;
          return (
            <div key={m.id}>
              {showDay && <div className="my-3 text-center text-[11px] font-semibold text-muted-foreground">{day}</div>}
              <div className={cn("group flex items-end gap-2", mine ? "justify-end" : "justify-start")}>
                {!mine && <MiniAvatar user={m.user} size={26} />}
                <div
                  ref={(el) => { bubbleRefs.current[m.id] = el; }}
                  className={cn("max-w-[78%] rounded-2xl px-3.5 py-2 text-sm transition-shadow", mine ? "bg-primary text-primary-foreground" : "bg-muted", flashId === m.id && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
                >
                  {!mine && <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{m.user?.name}</div>}
                  {renderQuote(m.replyTo, mine)}
                  {href && (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="mb-1 block">
                      <img src={href} alt="" loading="lazy" onLoad={onMediaLoad} className="max-h-72 w-auto max-w-full rounded-xl object-cover" />
                    </a>
                  )}
                  {m.content && <MessageText text={m.content} mine={mine} />}
                  <span className={cn("mt-0.5 block text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{fmtTime(m.createdAt)}</span>
                </div>
                <button
                  onClick={() => startReply(m)}
                  title={t("Reply")}
                  aria-label={t("Reply")}
                  className="mb-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-accent focus:opacity-100 group-hover:opacity-100"
                >
                  <Reply className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
        {detached && (
          <div className="flex justify-center pt-2">
            <button
              onClick={() => void loadNewer()}
              disabled={loadingNewer}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
            >
              {loadingNewer && <Loader2 className="h-3 w-3 animate-spin" />}
              {loadingNewer ? t("Loading…") : t("Load newer messages")}
            </button>
          </div>
        )}
        {shownOutbox.map((o) => {
          const failed = o.status === "failed";
          return (
            <div key={o.tempId} className="flex flex-col items-end gap-1">
              <div className={cn("max-w-[78%] rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground", failed ? "opacity-70 ring-2 ring-destructive/60" : "opacity-80")}>
                {renderQuote(o.replyTo ? { id: o.replyTo.id, content: o.replyTo.content, attachmentUrl: o.replyTo.attachmentUrl, attachmentType: o.replyTo.attachmentType, user: o.replyTo.user } : null, true)}
                {o.attachmentUrl && <img src={o.attachmentUrl} alt="" onLoad={onMediaLoad} className="mb-1 max-h-72 w-auto max-w-full rounded-xl object-cover" />}
                {o.content && <MessageText text={o.content} mine />}
                <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-primary-foreground/70">
                  {failed ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {failed ? t("Not sent") : t("Sending…")}
                </span>
              </div>
              {failed && (
                <div role="alert" className="flex max-w-[78%] flex-wrap items-center justify-end gap-1.5 text-[11px]">
                  <span className="font-semibold text-destructive">{o.error ?? t("Not sent.")}</span>
                  <button onClick={() => retry(o)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 font-semibold transition-colors hover:bg-accent">
                    <RotateCw className="h-3 w-3" /> {t("Retry")}
                  </button>
                  <button onClick={() => discard(o)} className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent">
                    <X className="h-3 w-3" /> {t("Discard")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {typers.length > 0 && !detached && <TypingRow typers={typers} named={kind !== "DM"} />}
      </div>
      {(newBelow > 0 || detached) && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-pop transition-transform active:scale-[0.97]"
        >
          <ArrowDown className="h-3.5 w-3.5" /> {newBelow > 0 ? tn(newBelow, "{n} new message", "{n} new messages") : t("Jump to latest")}
        </button>
      )}
      </div>

      <div className={cn("relative border-t border-border p-3", composerClassName)}>
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
              <div className="text-[11px] font-semibold text-primary">{t("Replying to {name}", { name: replyTo.user?.name ?? t("A member") })}</div>
              <div className="truncate text-xs text-muted-foreground">{quoteSnippet(replyTo.content, replyTo.attachmentType)}</div>
            </div>
            <button onClick={() => setReplyTo(null)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent" title={t("Cancel reply")} aria-label={t("Cancel reply")}><X className="h-4 w-4" /></button>
          </div>
        )}

        {pending && (
          <div className="mb-2 flex items-center gap-2">
            <img src={pending.url} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-border" />
            <button onClick={() => setPending(null)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent" title={t("Remove picture")} aria-label={t("Remove picture")}><X className="h-4 w-4" /></button>
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
            title={t("Send a picture")}
            aria-label={t("Send a picture")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-all hover:bg-accent active:scale-[0.95] disabled:opacity-50"
          >
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </button>
          {/* The hint is drawn over the box, cut with an ellipsis, rather than as a placeholder: a
              placeholder wraps to a second, hidden line on a narrow screen. */}
          <div className="relative min-w-0 flex-1">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); typing.onInput(e.target.value); }}
            onBlur={typing.stop}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                // Enter picks the highlighted name while the mention list is open, and only sends
                // once it's closed - otherwise typing "@ann<Enter>" fires off a half-typed tag.
                if (mentionMatches.length > 0) { e.preventDefault(); pickMention(mentionMatches[0]); return; }
                e.preventDefault(); submit();
              }
            }}
            rows={1}
            aria-label={t("Type a message…  (@ to tag someone)")}
            className="block max-h-32 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
          />
          {!input && (
            <span aria-hidden className="pointer-events-none absolute left-[13px] right-[13px] top-[9px] truncate text-sm leading-5 text-muted-foreground">
              {t("Type a message…  (@ to tag someone)")}
            </span>
          )}
          </div>
          <button onClick={submit} disabled={!canSend} title={t("Send")} aria-label={t("Send")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.95] disabled:opacity-50">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
