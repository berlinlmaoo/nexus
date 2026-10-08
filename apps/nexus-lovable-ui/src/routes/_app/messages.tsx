import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BellOff, Loader2, MessageCircle, Pencil, Plus, Trash2, UserPlus, Users as UsersIcon, X, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ChatThread } from "@/components/messages/ChatThread";
import { ChatInfoPanel, chatInfoKey } from "@/components/messages/ChatInfoPanel";
import { MuteMenu, mutedLabel } from "@/components/messages/MuteMenu";
import { ApiError, nexusApi, type NexusConversation, type NexusUser } from "@/lib/nexus-api";
import { isMuted, usePageVisible } from "@/lib/chat-unread";
import { isSystemMessage, systemSentence } from "@/lib/chat-system";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRealtime } from "@/lib/realtime";
import { useTypingRooms } from "@/lib/chat-typing";
import { t, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

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
  return (c.members ?? []).find((m) => (m.userId || m.user?.id) !== meId)?.user ?? null;
}

/** A chat's picture: the other person's photo for a DM, a people icon for a group or project room. */
function ConvoAvatar({ c, meId, size }: { c: NexusConversation; meId?: string; size: number }) {
  const peer = c.type === "DM" ? dmPeer(c, meId) : null;
  if (peer?.id) return <Avatar userId={peer.id} name={peer.name} avatar={peer.avatar} size={size} className="shrink-0" />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-border" style={{ width: size, height: size }}>
      {c.type === "PROJECT" || c.type === "GROUP" ? <UsersIcon className="h-4 w-4" /> : initialsOf(convoTitle(c, meId))}
    </span>
  );
}

function convoTitle(c: NexusConversation, meId?: string): string {
  if (c.name) return c.name;
  if (c.type === "DM") {
    const other = (c.members ?? []).find((m) => (m.userId || m.user?.id) !== meId);
    return other?.user?.name ?? t("Direct message");
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

/** The info panel sits beside the thread from this width; below it covers the screen. */
const WIDE = "(min-width: 1024px)";

/** A small dot in the header: green while the socket is up, amber while it reconnects. */
function LiveDot({ connected }: { connected: boolean }) {
  const label = connected ? t("Live") : t("Reconnecting…");
  return (
    <span role="status" title={label} aria-label={label} className="inline-grid h-8 w-6 place-items-center">
      <span className={cn("h-2 w-2 rounded-full", connected ? "bg-success" : "animate-pulse bg-warning")} />
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
  const [activeId, setActiveId] = useState<string | null>(search.c ?? null);
  // On a phone the list and the open chat take turns on the screen; from md up they sit side by side.
  const [phoneThread, setPhoneThread] = useState<boolean>(!!search.c);
  useEffect(() => { if (search.c) { setActiveId(search.c); setPhoneThread(true); } }, [search.c]);
  // Hold on to the room opened by default: the list re-sorts as messages arrive, and "whichever is
  // first" would otherwise swap the open chat under the reader. Not on a phone: there the list comes
  // first and a room opens only when tapped — a thread mounted out of sight would mark it read.
  const phone = useIsMobile();
  useEffect(() => { if (!activeId && !goneId && rows[0] && !phone) setActiveId(rows[0].id); }, [activeId, goneId, rows, phone]);
  const active = goneId || (phone && !phoneThread) ? null : rows.find((c) => c.id === activeId) ?? (phone ? null : rows[0] ?? null);
  const activeKey = active?.id ?? null;
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
      setGoneId(data.conversationId);
      setInfoOpen(false);
      setAdding(false);
      setRenaming(false);
      setActiveId(null);
    };
    socket.on("conversation-updated", onUpdated);
    return () => { socket.off("conversation-updated", onUpdated); };
  }, [socket]);

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
  }, [qc]);

  const groups = {
    DM: rows.filter((c) => c.type === "DM"),
    GROUP: rows.filter((c) => c.type === "GROUP"),
    PROJECT: rows.filter((c) => c.type === "PROJECT"),
  };

  return (
    // The page itself never scrolls: it fills the screen under the app header (above the phone's tab
    // bar, which the app shell pads for with 7rem), and the list, the thread and the info panel each
    // scroll on their own. Until 8 Oct 2026 the page was taller than the screen, so scrolling the
    // thread past its end scrolled the whole page and pushed the list out of view.
    <div lang={lang} className="flex h-[calc(100dvh-7rem)] flex-col overflow-hidden md:h-[100dvh]">
      <div className={cn("shrink-0", phoneThread && "hidden md:block")}>
        <PageHeader title={t("Messages")} subtitle={t("Chat with your crew + per-project rooms.")} actions={
          <>
            <LiveDot connected={connected} />
            <button onClick={() => setComposer(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> {t("New chat")}</button>
          </>
        } />
      </div>
      <div className={cn("grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]", infoOpen && active && "lg:grid-cols-[300px_minmax(0,1fr)_360px]")}>
        {/* conversation list */}
        <aside className={cn("min-h-0 overflow-y-auto overscroll-contain border-r border-border", phoneThread && "hidden md:block")}>
          {convos.isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {!convos.isLoading && rows.length === 0 && (
            <div className="p-3">
              <EmptyState icon={MessageSquare} title={t("No chats yet")} compact
                message={t("Direct messages and group chats with colleagues live here, and every project has a room of its own.")}
                action={<EmptyAction onClick={() => setComposer(true)}>{t("New chat")}</EmptyAction>} />
            </div>
          )}
          {(["DM", "GROUP", "PROJECT"] as const).map((kind) => groups[kind].length > 0 && (
            <div key={kind} className="py-1">
              <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{kind === "DM" ? t("Direct") : kind === "GROUP" ? t("Groups") : t("Projects")}</div>
              {groups[kind].map((c) => {
                const muted = isMuted(c);
                // The open room is being read as it arrives; its count would only flicker.
                const unread = activeKey === c.id && visible ? 0 : c.unreadCount ?? 0;
                return (
                  <button key={c.id} onClick={() => openRoom(c.id)} className={cn("flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent", activeKey === c.id && "md:bg-accent")}>
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
              })}
            </div>
          ))}
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
                conversationId={active.id}
                meId={meId}
                members={threadMembers}
                kind={active.type}
                jump={jump}
                // The floating GIDEON button sits over the composer's right end (bottom-32 right-4 on a
                // phone, bottom-6 right-6 from md): keep Send clear of it. With the info panel open the
                // thread is covered (phone, tablet) or no longer at the screen's edge (wide).
                composerClassName={infoOpen ? undefined : "pr-[4.75rem] md:pr-[5.25rem]"}
              /></div>
            </>
          ) : goneId ? (
            <div className="relative grid h-full place-items-center px-6 text-center text-muted-foreground">
              <button onClick={() => { setGoneId(null); setPhoneThread(false); }} title={t("Back to chats")} aria-label={t("Back to chats")} className="absolute left-2 top-2.5 rounded-lg p-2 transition-colors hover:bg-accent md:hidden"><ArrowLeft className="h-4 w-4" /></button>
              <div role="status">
                <Trash2 className="mx-auto mb-3 h-9 w-9 opacity-40" />
                <p className="text-sm">{t("This group was deleted")}</p>
              </div>
            </div>
          ) : convos.isLoading ? (
            <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
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
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold tracking-tight">{title}</h2><button onClick={onClose} title={t("Close")} aria-label={t("Close")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button></div>
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
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("Group name")} className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" onKeyDown={(e) => { if (e.key === "Enter" && valid && !rename.isPending) rename.mutate(); }} />
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold tracking-tight">{t("New chat")}</h2><button onClick={onClose} title={t("Close")} aria-label={t("Close")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button></div>
        <p className="mt-1 text-xs text-muted-foreground">{t("Pick 1 person for a DM, or several for a group.")}</p>
        <label className={cn("mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5", selected.length > 1 ? "opacity-60" : "cursor-pointer")}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><UsersIcon className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("Make it a group")}</span>
            <span className="block text-xs text-muted-foreground">{selected.length > 1 ? t("Two or more people always make a group.") : t("Start a group with just one other person, and add more later.")}</span>
          </span>
          <input type="checkbox" role="switch" checked={isGroup} disabled={selected.length > 1} onChange={(e) => setGroupMode(e.target.checked)} className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
        </label>
        {isGroup && <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t("Group name (optional)")} className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />}
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
