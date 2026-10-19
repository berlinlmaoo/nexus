import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEscape } from "@/hooks/use-escape";
import { Avatar } from "@/components/Avatar";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ProjectTile } from "@/components/projects/ProjectIcon";
import { ArrowLeft, BellOff, Loader2, MessageCircle, Pencil, Plus, Trash2, UserPlus, Users as UsersIcon, X, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ChatThread } from "@/components/messages/ChatThread";
import { ChatInfoPanel, chatInfoKey } from "@/components/messages/ChatInfoPanel";
import { MuteMenu, mutedLabel } from "@/components/messages/MuteMenu";
import { ApiError, nexusApi, type NexusConversation, type NexusUser } from "@/lib/nexus-api";
import { isMuted, usePageVisible } from "@/lib/chat-unread";
import { isSystemMessage, systemSentence } from "@/lib/chat-system";
import { isDocAttachment } from "@/lib/chat-files";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRealtime } from "@/lib/realtime";
import { useTypingRooms } from "@/lib/chat-typing";
import { t, useLang } from "@/lib/lang";
import { PresenceLine, usePresence } from "@/lib/presence";
import { cn } from "@/lib/utils";
import { LoadError } from "@/components/LoadError";

export const Route = createFileRoute("/_app/messages")({
  component: Messages,
  // `?c=<conversationId>` — what a chat notification links to. There is no `/messages/$id` route, and
  // the old `/messages/<id>` links matched nothing, which is why a tapped "New message from…" opened
  // the list and not the chat.
  validateSearch: (s: Record<string, unknown>): { c?: string } => ({ c: typeof s.c === "string" ? s.c : undefined }),
});

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/** The other person of a DM: their photo stands for the chat, as in the iOS app. */
function dmPeer(c: NexusConversation, meId?: string) {
  const member = (c.members ?? []).find((m) => (m.userId || m.user?.id) !== meId)?.user ?? null;
  if (member) return member;
  // The other person is no longer in the room (left the workspace, account deleted): the server names
  // who it was with (`peer`, 19 Oct 2026), so the row is not "Direct message" / "DM".
  return c.peer?.id ? ({ id: c.peer.id, name: c.peer.name ?? undefined, avatar: c.peer.avatar ?? undefined } as NexusUser) : null;
}

/**
 * A chat's picture: the other person's photo for a DM, the project's own icon (its photo, else the page
 * icon every other screen draws) for a project room, a people icon for a group. UI tour run 7: project
 * rooms showed the same people icon as groups.
 */
function ConvoAvatar({ c, meId, size }: { c: NexusConversation; meId?: string; size: number }) {
  const peer = c.type === "DM" ? dmPeer(c, meId) : null;
  if (peer?.id) return <Avatar userId={peer.id} name={peer.name} avatar={peer.avatar} size={size} className="shrink-0" />;
  if (c.type === "PROJECT" && c.projectId) return <ProjectTile projectId={c.projectId} size={size} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-border" style={{ width: size, height: size }}>
      {c.type === "PROJECT" || c.type === "GROUP" ? <UsersIcon className="h-4 w-4" /> : initialsOf(convoTitle(c, meId))}
    </span>
  );
}

function convoTitle(c: NexusConversation, meId?: string): string {
  if (c.name) return c.name;
  if (c.type === "DM") {
    return dmPeer(c, meId)?.name ?? t("Direct message");
  }
  return (c.members ?? []).map((m) => m.user?.name).filter(Boolean).slice(0, 3).join(", ") || t("Conversation");
}

/** The list's second line: the last message (a group's log line in words), a marker for a bare picture, or nothing yet. */
function lastLine(c: NexusConversation, meId?: string): string {
  const m = c.lastMessage;
  if (!m) return t("No messages yet");
  if (isSystemMessage(m)) return systemSentence(m, meId);
  const text = (m.content ?? "").trim();
  if (text) return text;
  // A document sent on its own is not a photo (QA final 19 Oct 2026: a PDF showed as "📷 Photo" in the list).
  if (m.attachmentName && isDocAttachment(m.attachmentType)) return `📎 ${m.attachmentName}`;
  return m.attachmentUrl || m.attachmentType ? `📷 ${t("Photo")}` : "";
}

/**
 * Adding (and removing) people in a group is for Manager and above (owner, 8 Oct 2026); the server
 * says so per room as canManageMembers. Missing means a server from before the rule: keep the button.
 */
function canAddToGroup(c: NexusConversation): boolean {
  return c.type === "GROUP" && c.canManageMembers !== false;
}

/** The server's 403 when someone below Manager tries to add or remove people in a group. */
function isManagerRequired(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 403) return false;
  const p = e.payload as { code?: unknown } | null;
  return typeof p === "object" && p !== null && p.code === "MANAGER_REQUIRED";
}

type ConversationList = { conversations: NexusConversation[]; totalUnread?: number };

/** The list's tabs (UI round 19 Oct 2026, U-8): Direct · Groups · Projects, the last one kept per browser. */
type ChatTab = "DM" | "GROUP" | "PROJECT";
const TAB_KEY = "nexus-messages-tab";
function readTab(): ChatTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === "GROUP" || v === "PROJECT" || v === "DM" ? v : "DM";
  } catch { return "DM"; }
}

/** The info panel sits beside the thread from this width; below it covers the screen. */
const WIDE = "(min-width: 1024px)";

/** A small dot in the header: green while the socket is up, amber while it reconnects. */
function LiveDot({ connected }: { connected: boolean }) {
  const label = connected ? t("Live") : t("Reconnecting…");
  return (
    <span role="status" title={label} className="inline-flex h-8 items-center gap-1.5 px-1 text-xs text-muted-foreground">
      <span aria-hidden className={cn("h-2 w-2 rounded-full", connected ? "bg-success" : "animate-pulse bg-warning")} />
      {label}
    </span>
  );
}

function Messages() {
  const { lang, tn } = useLang();
  const qc = useQueryClient();
  const [composer, setComposer] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  // The chat info panel (tap the chat header), and a message it asked the thread to show.
  const [infoOpen, setInfoOpen] = useState(false);
  const [jump, setJump] = useState<{ id: string; seq: number } | null>(null);
  const me = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const meId = me.data?.user?.id;
  const { connected, socket } = useRealtime();
  // Who is typing where (server since 9 Oct 2026): "typing…" in the list and in the open chat's header.
  const typingRooms = useTypingRooms();
  // The open group was deleted while it was on screen (by someone else, or in another tab): the thread
  // closes and this note stands in its place until another chat is opened.
  const [goneId, setGoneId] = useState<string | null>(null);
  // Why it is gone (B-13, 19 Oct 2026): deleted (the server answers 404), or the reader is no longer in it (403).
  const [goneWhy, setGoneWhy] = useState<"deleted" | "left">("deleted");
  const visible = usePageVisible();
  // Other rooms move through the socket (`conversation-updated` on servers since 8 Oct 2026).
  // The poll is the fallback: every 30 s while this page is in front (never in a background tab),
  // relaxed to 2 min once the server is known to push list updates and the socket is up.
  const convos = useQuery({
    queryKey: ["conversations"],
    queryFn: () => nexusApi.conversations(),
    retry: false,
    refetchInterval: (q) => (connected && typeof q.state.data?.totalUnread === "number" ? 120_000 : 30_000),
  });
  const rows = convos.data?.conversations ?? [];
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [activeId, setActiveId] = useState<string | null>(search.c ?? null);
  // On a phone the list and the open chat take turns on the screen; from md up they sit side by side.
  const [phoneThread, setPhoneThread] = useState<boolean>(!!search.c);
  useEffect(() => { if (search.c) { setActiveId(search.c); setPhoneThread(true); } }, [search.c]);
  // Hold on to the room opened by default: the list re-sorts as messages arrive, and "whichever is
  // first" would otherwise swap the open chat under the reader. Not on a phone: there the list comes
  // first and a room opens only when tapped — a thread mounted out of sight would mark it read.
  const phone = useIsMobile();
  // (The room opened by default is the first of the tab on screen: see the tab effect below.)
  // A link to a chat that is not in the list (B-13, 19 Oct 2026): a deleted group's ?c= used to open some
  // other chat without a word. The room is asked for once: 404 = deleted, 403 = no longer a member; then the
  // note below stands in its place and ?c= leaves the address. Found after all (the list was just stale) →
  // the list is refetched and the room opens as usual.
  const linkMissing = !!search.c && convos.isSuccess && !rows.some((c) => c.id === search.c);
  const linkProbe = useQuery({
    queryKey: ["conversation-link-probe", search.c],
    queryFn: () => nexusApi.conversationInfo(search.c as string),
    enabled: linkMissing,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    if (!linkMissing || !search.c) return;
    if (linkProbe.isSuccess) { void qc.invalidateQueries({ queryKey: ["conversations"] }); return; }
    if (!linkProbe.isError) return;
    const status = linkProbe.error instanceof ApiError ? linkProbe.error.status : 0;
    if (status !== 404 && status !== 403) return;
    setGoneWhy(status === 404 ? "deleted" : "left");
    setGoneId(search.c);
    setActiveId(null);
    void navigate({ search: {}, replace: true });
  }, [linkMissing, linkProbe.isSuccess, linkProbe.isError, linkProbe.error, search.c, qc, navigate]);
  const active = goneId || (phone && !phoneThread) ? null : rows.find((c) => c.id === activeId) ?? null;
  const activeKey = active?.id ?? null;
  // The other person's presence status shows under a DM's name (19 Oct 2026).
  const dmPeerStatus = usePresence(active?.type === "DM" ? dmPeer(active, meId)?.id : null);
  const activeKeyRef = useRef<string | null>(null);
  activeKeyRef.current = activeKey;

  // A group deleted elsewhere (server since 9 Oct 2026: conversation-updated, reason "deleted"). The
  // list drops it in realtime.tsx; the room on screen closes here.
  useEffect(() => {
    if (!socket) return;
    const onUpdated = (payload?: unknown) => {
      const data = (payload && typeof payload === "object" ? payload : {}) as { conversationId?: unknown; reason?: unknown };
      if (data.reason !== "deleted" || typeof data.conversationId !== "string") return;
      if (data.conversationId !== activeKeyRef.current) return;
      setGoneWhy("deleted");
      setGoneId(data.conversationId);
      void navigate({ search: {}, replace: true });
      setInfoOpen(false);
      setAdding(false);
      setRenaming(false);
      setActiveId(null);
    };
    socket.on("conversation-updated", onUpdated);
    return () => { socket.off("conversation-updated", onUpdated); };
  }, [socket, navigate]);

  const threadMembers = useMemo(
    () => (active?.members ?? []).map((m) => m.user).filter(Boolean) as NexusUser[],
    [active],
  );

  const openRoom = useCallback((id: string) => { setGoneId(null); setActiveId(id); setPhoneThread(true); setJump(null); }, []);

  // From the info panel: show a message in the thread. On a narrow screen the panel covers the
  // thread, so it steps aside.
  const jumpTo = useCallback((messageId: string) => {
    setJump({ id: messageId, seq: Date.now() });
    if (typeof window !== "undefined" && !window.matchMedia(WIDE).matches) setInfoOpen(false);
  }, []);

  // "Message" on a member: their DM, opened or started.
  const messagePerson = useCallback(async (userId: string) => {
    try {
      const res = await nexusApi.createConversation({ type: "DM", userIds: [userId] });
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      setInfoOpen(false);
      openRoom(res.conversation.id);
    } catch {
      toast.error(t("Couldn't start the chat."));
    }
  }, [qc, openRoom]);

  // Left the group, or deleted it: it leaves the list at once, and the screen goes back to the list.
  const leftRoom = useCallback((id: string) => {
    setGoneId(null);
    qc.setQueryData<ConversationList>(["conversations"], (cur) => (cur ? { ...cur, conversations: cur.conversations.filter((c) => c.id !== id) } : cur));
    qc.removeQueries({ queryKey: chatInfoKey(id) });
    qc.invalidateQueries({ queryKey: ["conversations"] });
    setInfoOpen(false);
    setActiveId(null);
    setPhoneThread(false);
    void navigate({ search: {}, replace: true });
  }, [qc, navigate]);

  const groups = {
    DM: rows.filter((c) => c.type === "DM"),
    GROUP: rows.filter((c) => c.type === "GROUP"),
    PROJECT: rows.filter((c) => c.type === "PROJECT"),
  };
  const [tab, setTabState] = useState<ChatTab>(readTab);
  const setTab = useCallback((next: ChatTab) => {
    setTabState(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* private mode: this visit only */ }
  }, []);
  // A chat opened from a link (a notification) shows its own tab, so the open room is in the list beside it.
  const linkedType = search.c ? rows.find((c) => c.id === search.c)?.type : undefined;
  useEffect(() => { if (linkedType) setTabState(linkedType); }, [linkedType]);
  // From md up the open chat sits beside the list, and it is one of the tab's rooms (U-8 fix: Groups showed
  // a project room's thread). Nothing open yet: the tab's first room. Another tab picked: its first room.
  // A room opened from elsewhere (a link, "Message" in a group's info): the tab follows the room.
  const activeType = active?.type ?? null;
  const firstOfTab = groups[tab][0]?.id ?? null;
  useEffect(() => {
    if (phone || goneId || !convos.data || activeId) return;
    if (firstOfTab) setActiveId(firstOfTab);
  }, [phone, goneId, convos.data, activeId, firstOfTab]);
  const shownTab = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    if (!phone && activeType !== tab) setActiveId(firstOfTab);
  }, [tab, phone, activeType, firstOfTab]);
  const openedId = useRef(activeId);
  useEffect(() => {
    if (openedId.current === activeId || !activeType) return;
    openedId.current = activeId;
    if (!phone && activeType !== tab) { shownTab.current = activeType; setTabState(activeType); }
  }, [activeId, activeType, phone, tab]);
  // A tab's count: its unread rooms' messages, muted rooms left out as in the nav badge; the open room is being read.
  const tabUnread = (kind: ChatTab) =>
    groups[kind].reduce((n, c) => n + (isMuted(c) || (activeKey === c.id && visible) ? 0 : c.unreadCount ?? 0), 0);
  const tabLabel = (kind: ChatTab) => (kind === "DM" ? t("Direct") : kind === "GROUP" ? t("Groups") : t("Projects"));
  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const order: ChatTab[] = ["DM", "GROUP", "PROJECT"];
    const i = order.indexOf(tab);
    const next = e.key === "ArrowRight" ? order[(i + 1) % 3] : e.key === "ArrowLeft" ? order[(i + 2) % 3] : e.key === "Home" ? order[0] : e.key === "End" ? order[2] : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`chat-tab-${next}`)?.focus();
  };

  return (
    // The page itself never scrolls: it fills the screen under the app header (above the phone's tab
    // bar, which the app shell leaves room for), and the list, the thread and the info panel each
    // scroll on their own. Until 8 Oct 2026 the page was taller than the screen, so scrolling the
    // thread past its end scrolled the whole page and pushed the list out of view. On a phone it ends just
    // above the floating tab bar (7rem left a dead band, audit 12 Oct 2026); -mb-8 overlaps the shell's
    // tab bar room so the page still doesn't scroll.
    <div lang={lang} className="-mb-8 flex h-[calc(100dvh-5rem-env(safe-area-inset-bottom))] flex-col overflow-hidden md:mb-0 md:h-[100dvh]">
      <div className={cn("shrink-0", phoneThread && "hidden md:block")}>
        <PageHeader title={t("Messages")} subtitle={t("Chat with your team and in project rooms.")} actions={
          <>
            <LiveDot connected={connected} />
            <button onClick={() => setComposer(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> {t("New chat")}</button>
          </>
        } />
      </div>
      <div className={cn("grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]", infoOpen && active && "lg:grid-cols-[300px_minmax(0,1fr)_360px]")}>
        {/* conversation list */}
        <aside className={cn("min-h-0 overflow-y-auto overscroll-contain border-border md:border-r", phoneThread && "hidden md:block")}>
          {/* Rows shaped like the list (avatar + two lines), not a spinner: nothing moves when it fills in. */}
          {convos.isLoading && (
            <div className="space-y-1 px-2 py-2 md:pl-6" aria-busy>
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="min-w-0 flex-1 space-y-1.5"><div className="h-3 w-2/5 animate-pulse rounded bg-muted" /><div className="h-3 w-4/5 animate-pulse rounded bg-muted/70" /></div>
                </div>
              ))}
            </div>
          )}
          {/* A failed list is not "No chats yet" (QA 13 Oct 2026). */}
          {convos.isError && !convos.data && (
            <div className="px-4 py-3 md:pl-8"><LoadError compact error={convos.error} what={t("your chats")} onRetry={() => void convos.refetch()} /></div>
          )}
          {!convos.isLoading && !(convos.isError && !convos.data) && rows.length === 0 && (
            <div className="px-4 py-3 md:pl-8">
              <EmptyState icon={MessageSquare} title={t("No chats yet")} compact
                message={t("Direct messages and group chats with colleagues live here, and every project has a room of its own.")}
                action={<EmptyAction onClick={() => setComposer(true)}>{t("New chat")}</EmptyAction>} />
            </div>
          )}
          {rows.length > 0 && (
            <div className="sticky top-0 z-10 bg-background/95 px-3 pb-2 pt-2 backdrop-blur md:pl-6">
              <div role="tablist" aria-label={t("Chats")} className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
                {(["DM", "GROUP", "PROJECT"] as const).map((kind) => {
                  const n = tabUnread(kind);
                  const on = tab === kind;
                  return (
                    <button
                      key={kind}
                      id={`chat-tab-${kind}`}
                      role="tab"
                      type="button"
                      aria-selected={on}
                      aria-controls="chat-tab-panel"
                      tabIndex={on ? 0 : -1}
                      onClick={() => setTab(kind)}
                      onKeyDown={onTabKey}
                      className={cn(
                        "flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        on ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{tabLabel(kind)}</span>
                      {n > 0 && (
                        <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground" aria-label={tn(n, "{n} unread", "{n} unread")}>
                          {n > 99 ? "99+" : n}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {rows.length > 0 && (
            <div id="chat-tab-panel" role="tabpanel" aria-labelledby={`chat-tab-${tab}`} className="pb-1">
              {groups[tab].length === 0 ? (
                <div className="px-4 py-3 md:pl-8">
                  {tab === "DM" ? (
                    <EmptyState icon={MessageCircle} title={t("No direct messages yet")} compact
                      message={t("A direct message is a chat between you and one colleague.")}
                      action={<EmptyAction onClick={() => setComposer(true)}>{t("New chat")}</EmptyAction>} />
                  ) : tab === "GROUP" ? (
                    <EmptyState icon={UsersIcon} title={t("No groups yet")} compact
                      message={t("Start a group to talk with several colleagues at once.")}
                      action={<EmptyAction onClick={() => setComposer(true)}>{t("New chat")}</EmptyAction>} />
                  ) : (
                    <EmptyState icon={MessageSquare} title={t("No project rooms yet")} compact
                      message={t("Every project you're in has a room here. Join a project to see its room.")} />
                  )}
                </div>
              ) : (
                groups[tab].map((c) => {
                  const muted = isMuted(c);
                  // The open room is being read as it arrives; its count would only flicker.
                  const unread = activeKey === c.id && visible ? 0 : c.unreadCount ?? 0;
                  return (
                    <button key={c.id} onClick={() => openRoom(c.id)} className={cn("flex w-full items-center gap-2.5 px-4 py-2.5 md:pl-8 text-left transition-colors hover:bg-accent", activeKey === c.id && "md:bg-accent")}>
                      <ConvoAvatar c={c} meId={meId} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className={cn("truncate text-sm", unread > 0 && !muted ? "font-bold" : "font-semibold")}>{convoTitle(c, meId)}</span>
                          {muted && <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t("Muted")} />}
                        </div>
                        {typingRooms.get(c.id)?.length ? (
                          <div className="truncate text-xs font-medium text-primary">{t("typing…")}</div>
                        ) : (
                          <div className={cn("truncate text-xs text-muted-foreground", isSystemMessage(c.lastMessage) && "italic")}>{lastLine(c, meId)}</div>
                        )}
                      </div>
                      {/* A muted room still counts its unread, quietly: grey, and left out of the nav badge. */}
                      {unread > 0 && (
                        <span className={cn("grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[10px] font-bold", muted ? "bg-muted text-muted-foreground ring-1 ring-border" : "bg-destructive text-destructive-foreground")}>
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </aside>
        {/* active thread */}
        <section className={cn("min-h-0 min-w-0 flex-col", phoneThread ? "flex" : "hidden md:flex")}>
          {active ? (
            <>
              <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-2.5 md:gap-2.5 md:px-4">
                <button onClick={() => setPhoneThread(false)} title={t("Back to chats")} aria-label={t("Back to chats")} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent md:hidden"><ArrowLeft className="h-4 w-4" /></button>
                {/* The header opens the chat's info: members, media, search (like WhatsApp). */}
                <button
                  onClick={() => setInfoOpen((o) => !o)}
                  aria-expanded={infoOpen}
                  title={t("Open chat info")}
                  className="-my-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <ConvoAvatar c={active} meId={meId} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{convoTitle(active, meId)}</span>
                    {typingRooms.get(active.id)?.length ? (
                      <span className="block truncate text-xs font-medium text-primary">{t("typing…")}</span>
                    ) : active.type === "DM" && dmPeerStatus ? (
                      // Presence status of the other person (19 Oct 2026), live.
                      <PresenceLine userId={dmPeer(active, meId)?.id} className="flex max-w-full" />
                    ) : (
                      <span className="block truncate text-xs text-muted-foreground">
                        {tn(active.members?.length ?? 0, "{n} member", "{n} members")}
                        {active.type === "PROJECT" ? ` · ${t("project room")}` : ""}
                        {isMuted(active) ? ` · ${mutedLabel(active)}` : ""}
                      </span>
                    )}
                  </span>
                </button>
                <MuteMenu conversation={active} />
                {active.type === "GROUP" && (
                  <button onClick={() => setRenaming(true)} title={t("Rename group")} aria-label={t("Rename group")} className="hidden rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent sm:inline-flex"><Pencil className="h-4 w-4" /></button>
                )}
                {/* Both kinds of room can take people, by different routes. A project room's
                    membership is derived from the project, so adding here really means adding to
                    the project; a plain group owns its own list and has had an endpoint of its own
                    since /api/conversations/[id]/members — Manager and above only (owner, 8 Oct
                    2026), which the server reports as canManageMembers. A DM stays closed. */}
                {(canAddToGroup(active) || (active.type === "PROJECT" && active.projectId)) && (
                  <button onClick={() => setAdding(true)} title={t("Add people")} aria-label={t("Add people")} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"><UserPlus className="h-4 w-4" /></button>
                )}
              </div>
              <div className="min-h-0 flex-1"><ChatThread
                readOnly={active.canPost === false}
                conversationId={active.id}
                meId={meId}
                members={threadMembers}
                kind={active.type}
                jump={jump}
              /></div>
            </>
          ) : goneId ? (
            <div className="relative grid h-full place-items-center px-6 text-center text-muted-foreground">
              <button onClick={() => { setGoneId(null); setPhoneThread(false); }} title={t("Back to chats")} aria-label={t("Back to chats")} className="absolute left-2 top-2.5 rounded-lg p-2 transition-colors hover:bg-accent md:hidden"><ArrowLeft className="h-4 w-4" /></button>
              <div role="status">
                <Trash2 className="mx-auto mb-3 h-9 w-9 opacity-40" />
                <p className="text-sm">{goneWhy === "deleted" ? t("This group was deleted") : t("You're no longer in this chat")}</p>
              </div>
            </div>
          ) : convos.isLoading ? (
            <div className="h-full" aria-busy />
          ) : (
            <div className="grid h-full place-items-center text-center text-muted-foreground"><div><MessageCircle className="mx-auto mb-3 h-10 w-10 opacity-40" /><p className="text-sm">{t("Pick a conversation or start a new chat.")}</p></div></div>
          )}
        </section>
        {infoOpen && active && (
          <ChatInfoPanel
            conversation={active}
            meId={meId}
            onClose={() => setInfoOpen(false)}
            onAdd={() => setAdding(true)}
            onRename={() => setRenaming(true)}
            onJump={jumpTo}
            onMessage={(userId) => { void messagePerson(userId); }}
            onLeft={() => leftRoom(active.id)}
            onDeleted={() => leftRoom(active.id)}
          />
        )}
      </div>
      {composer && <NewChat onClose={() => setComposer(false)} onCreated={(id) => { openRoom(id); setComposer(false); }} meId={meId} />}
      {renaming && active && <RenameGroup conversation={active} onClose={() => setRenaming(false)} />}
      {adding && active && (
        active.projectId
          ? <AddPeople target={{ kind: "project", projectId: active.projectId }} onClose={() => setAdding(false)} />
          : <AddPeople target={{ kind: "group", conversationId: active.id }} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

function Shell({ title, hint, onClose, children }: { title: string; hint?: string; onClose: () => void; children: React.ReactNode }) {
  // Esc closes it (QA S-09: Add people / Rename stayed open).
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 grid grid-cols-1 place-items-center bg-foreground/30 dark:bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold tracking-tight">{title}</h2><button onClick={onClose} title={t("Close")} aria-label={t("Close")} className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent pointer-coarse:size-11"><X className="h-4 w-4" /></button></div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </div>
  );
}

function RenameGroup({ conversation, onClose }: { conversation: NexusConversation; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(conversation.name ?? "");
  const rename = useMutation({
    mutationFn: () => nexusApi.renameConversation(conversation.id, name.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["conversations"] }); qc.invalidateQueries({ queryKey: chatInfoKey(conversation.id) }); onClose(); },
  });
  const valid = name.trim().length > 0 && name.trim().length <= 80;
  return (
    <Shell title={t("Rename group")} hint={t("Everyone in the room sees the new name.")} onClose={onClose}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("Group name")} className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring" onKeyDown={(e) => { if (e.key === "Enter" && valid && !rename.isPending) rename.mutate(); }} />
      <div className="mt-4 flex items-center gap-2">
        <button disabled={!valid || rename.isPending} onClick={() => rename.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{rename.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save")}</button>
        {rename.isError && <span className="text-xs font-semibold text-destructive">{t("Couldn't rename it.")}</span>}
      </div>
    </Shell>
  );
}

type AddPeopleTarget =
  | { kind: "project"; projectId: string }
  | { kind: "group"; conversationId: string };

function AddPeople({ target, onClose }: { target: AddPeopleTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const isProject = target.kind === "project";
  const roster = useQuery({ queryKey: ["members"], queryFn: () => nexusApi.members(), staleTime: 300_000 });
  // A project room asks the project who belongs; a group carries its own roster. The two endpoints
  // answer in different shapes, so the query itself flattens them to the only thing this component
  // needs — a set of user ids. Returning the raw responses left queryFn with a union type that
  // TanStack Query could not infer.
  const current = useQuery({
    queryKey: target.kind === "project"
      ? ["project-members", target.projectId]
      : ["conversation", target.conversationId],
    queryFn: async (): Promise<string[]> => {
      if (target.kind === "project") {
        const data = await nexusApi.projectMembers(target.projectId);
        const rows = Array.isArray(data) ? data : data.members ?? [];
        return rows.map((m) => m.userId ?? m.user?.id).filter(Boolean) as string[];
      }
      const data = await nexusApi.conversation(target.conversationId);
      return (data.conversation.members ?? []).map((m) => m.userId ?? m.user?.id).filter(Boolean) as string[];
    },
  });

  const all = (Array.isArray(roster.data) ? roster.data : roster.data?.members ?? []) as NexusUser[];
  const already = new Set(current.data ?? []);
  const candidates = all.filter((u) => !already.has(u.id));

  const add = async (u: NexusUser) => {
    setBusyId(u.id); setFailed(null);
    try {
      if (target.kind === "project") {
        await nexusApi.addProjectMember(target.projectId, u.id);
        await qc.invalidateQueries({ queryKey: ["project-members", target.projectId] });
      } else {
        // No "added" toast: the "You added …" line in the chat is the confirmation (8 Oct 2026).
        await nexusApi.addConversationMembers(target.conversationId, [u.id]);
        await qc.invalidateQueries({ queryKey: ["conversation", target.conversationId] });
        await qc.invalidateQueries({ queryKey: chatInfoKey(target.conversationId) });
      }
      await qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      if (isManagerRequired(e)) {
        setFailed(t("Only managers and above can add or remove members."));
        // The list was older than the rule (or the role changed): refetch so the button goes away.
        qc.invalidateQueries({ queryKey: ["conversations"] });
      } else {
        setFailed(t("Couldn't add that person."));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Shell
      title={t("Add people")}
      hint={isProject
        ? t("They join the project too — a project room's membership follows the project.")
        : t("They join this chat straight away.")}
      onClose={onClose}
    >
      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
        {(roster.isLoading || current.isLoading) && <div className="px-3 py-2 text-xs text-muted-foreground">{t("Loading…")}</div>}
        {!roster.isLoading && !current.isLoading && candidates.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">{isProject ? t("Everyone is already in this project.") : t("Everyone is already in this chat.")}</div>}
        {candidates.map((u) => (
          <button key={u.id} disabled={busyId !== null} onClick={() => add(u)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50">
            <Avatar userId={u.id} name={u.name} avatar={u.avatar} size={28} className="shrink-0" />
            <span className="flex-1 truncate">{u.name ?? u.email}</span>
            {busyId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4 text-muted-foreground" />}
          </button>
        ))}
      </div>
      {failed && <p className="mt-2 text-xs font-semibold text-destructive">{failed}</p>}
    </Shell>
  );
}

function NewChat({ onClose, onCreated, meId }: { onClose: () => void; onCreated: (id: string) => void; meId?: string }) {
  useEscape(onClose);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  // A group on purpose, even with one other person (owner, 9 Oct 2026: a group needed three people,
  // the creator included). Two or more picked people are a group whatever the switch says.
  const [groupMode, setGroupMode] = useState(false);
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => nexusApi.members(), staleTime: 300_000 });
  const members = (Array.isArray(membersQuery.data) ? membersQuery.data : membersQuery.data?.members ?? []).filter((m: NexusUser) => m.id !== meId);
  const isGroup = groupMode || selected.length > 1;

  const create = useMutation({
    mutationFn: () => nexusApi.createConversation({ type: isGroup ? "GROUP" : "DM", userIds: selected, name: isGroup ? (groupName.trim() || undefined) : undefined }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["conversations"] }); onCreated(res.conversation.id); },
  });
  const toggle = (id: string) => setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);

  return (
    <div className="fixed inset-0 z-50 grid grid-cols-1 place-items-center bg-foreground/30 dark:bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("New chat")} className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold tracking-tight">{t("New chat")}</h2><button onClick={onClose} title={t("Close")} aria-label={t("Close")} className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent pointer-coarse:size-11"><X className="h-4 w-4" /></button></div>
        <p className="mt-1 text-xs text-muted-foreground">{t("Pick 1 person for a DM, or several for a group.")}</p>
        <label className={cn("mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5", selected.length > 1 ? "opacity-60" : "cursor-pointer")}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><UsersIcon className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("Make it a group")}</span>
            <span className="block text-xs text-muted-foreground">{selected.length > 1 ? t("Two or more people always make a group.") : t("Start a group with just one other person, and add more later.")}</span>
          </span>
          <input type="checkbox" role="switch" checked={isGroup} disabled={selected.length > 1} onChange={(e) => setGroupMode(e.target.checked)} className="h-4 w-4 shrink-0 accent-switch-on" />
        </label>
        {isGroup && <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t("Group name (optional)")} className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring" />}
        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
          {membersQuery.isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">{t("Loading…")}</div>}
          {members.map((m: NexusUser) => (
            <button key={m.id} onClick={() => toggle(m.id)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors", selected.includes(m.id) ? "bg-primary/10 text-primary" : "hover:bg-accent")}>
              <Avatar userId={m.id} name={m.name} avatar={m.avatar} size={28} className="shrink-0" />
              <span className="flex-1 truncate">{m.name ?? m.email}</span>
              {selected.includes(m.id) && <span className="text-xs font-bold">✓</span>}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button disabled={selected.length === 0 || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {isGroup ? t("Start group") : t("Start chat")}</button>
          {create.isError && <span className="text-xs font-semibold text-destructive">{t("Couldn't start the chat.")}</span>}
        </div>
      </div>
    </div>
  );
}
