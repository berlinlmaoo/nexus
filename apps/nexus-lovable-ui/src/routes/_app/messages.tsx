import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, BellOff, Loader2, MessageCircle, Pencil, Plus, UserPlus, Users as UsersIcon, X, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ChatThread } from "@/components/messages/ChatThread";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ApiError, nexusApi, type NexusConversation, type NexusUser } from "@/lib/nexus-api";
import { isMuted, isMutedForever, usePageVisible } from "@/lib/chat-unread";
import { useRealtime } from "@/lib/realtime";
import { localeOf, t, useLang } from "@/lib/lang";
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

/** The list's second line: the last message, a marker for a bare picture, or nothing yet. */
function lastLine(c: NexusConversation): string {
  const m = c.lastMessage;
  if (!m) return t("No messages yet");
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

type MuteChoice = "8h" | "1w" | "always" | "off";

function muteValue(choice: MuteChoice): string | "forever" | null {
  if (choice === "off") return null;
  if (choice === "always") return "forever";
  const hours = choice === "8h" ? 8 : 24 * 7;
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/** "Muted" for Always, "Muted until Fri 17:30" otherwise. */
function mutedLabel(c: NexusConversation): string {
  if (isMutedForever(c)) return t("Muted");
  const until = new Date(c.mutedUntil ?? "");
  if (Number.isNaN(until.getTime())) return t("Muted");
  const when = until.toLocaleString(localeOf(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return t("Muted until {when}", { when });
}

type ConversationList = { conversations: NexusConversation[]; totalUnread?: number };

/**
 * Bell menu in the thread header: silence a room for 8 hours, a week or for good, or undo it.
 * Muted rooms stop pushing (an @mention still gets through) and leave the badge count.
 */
function MuteMenu({ conversation }: { conversation: NexusConversation }) {
  const qc = useQueryClient();
  const muted = isMuted(conversation);
  const mute = useMutation({
    mutationFn: (choice: MuteChoice) => nexusApi.muteConversation(conversation.id, muteValue(choice)),
    onSuccess: (res, choice) => {
      const value = res && "mutedUntil" in res ? res.mutedUntil : muteValue(choice);
      qc.setQueryData<ConversationList>(["conversations"], (cur) =>
        cur ? { ...cur, conversations: cur.conversations.map((c) => (c.id === conversation.id ? { ...c, mutedUntil: value } : c)) } : cur,
      );
      qc.invalidateQueries({ queryKey: ["conversations"] });
      toast.success(choice === "off" ? t("Notifications back on for this chat.") : t("Chat muted. You'll still hear about @mentions."));
    },
    onError: (e) => {
      // A server from before 8 Oct 2026 has no mute route at all.
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) toast(t("Muting isn't available yet. It comes with the next server update."));
      else toast.error(t("Couldn't change the mute. Try again."));
    },
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={muted ? mutedLabel(conversation) : t("Mute notifications")}
          aria-label={muted ? mutedLabel(conversation) : t("Mute notifications")}
          disabled={mute.isPending}
          className={cn("rounded-lg p-2 transition-colors hover:bg-accent disabled:opacity-50", muted ? "text-primary" : "text-muted-foreground")}
        >
          {mute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">{muted ? mutedLabel(conversation) : t("Mute notifications")}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => mute.mutate("8h")}>{t("For 8 hours")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => mute.mutate("1w")}>{t("For 1 week")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => mute.mutate("always")}>{t("Always")}</DropdownMenuItem>
        {muted && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => mute.mutate("off")}>{t("Unmute")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Messages() {
  const { lang, tn } = useLang();
  const [composer, setComposer] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const me = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const meId = me.data?.user?.id;
  const { connected } = useRealtime();
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
  useEffect(() => { if (search.c) setActiveId(search.c); }, [search.c]);
  // Hold on to the room opened by default: the list re-sorts as messages arrive, and "whichever is
  // first" would otherwise swap the open chat under the reader.
  useEffect(() => { if (!activeId && rows[0]) setActiveId(rows[0].id); }, [activeId, rows]);
  const active = rows.find((c) => c.id === activeId) ?? rows[0] ?? null;
  const activeKey = active?.id ?? null;

  const threadMembers = useMemo(
    () => (active?.members ?? []).map((m) => m.user).filter(Boolean) as NexusUser[],
    [active],
  );

  const groups = {
    DM: rows.filter((c) => c.type === "DM"),
    GROUP: rows.filter((c) => c.type === "GROUP"),
    PROJECT: rows.filter((c) => c.type === "PROJECT"),
  };

  return (
    <div lang={lang}>
      <PageHeader title={t("Messages")} subtitle={t("Chat with your crew + per-project rooms.")} actions={
        <button onClick={() => setComposer(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> {t("New chat")}</button>
      } />
      <div className="grid h-[calc(100vh-9rem)] grid-cols-1 md:grid-cols-[300px_1fr]">
        {/* conversation list */}
        <aside className="overflow-y-auto border-r border-border">
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
                  <button key={c.id} onClick={() => setActiveId(c.id)} className={cn("flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent", activeKey === c.id && "bg-accent")}>
                    <ConvoAvatar c={c} meId={meId} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className={cn("truncate text-sm", unread > 0 && !muted ? "font-bold" : "font-semibold")}>{convoTitle(c, meId)}</span>
                        {muted && <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t("Muted")} />}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{lastLine(c)}</div>
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
        <section className="min-w-0">
          {active ? (
            <>
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                <ConvoAvatar c={active} meId={meId} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{convoTitle(active, meId)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {tn(active.members?.length ?? 0, "{n} member", "{n} members")}
                    {active.type === "PROJECT" ? ` · ${t("project room")}` : ""}
                    {isMuted(active) ? ` · ${mutedLabel(active)}` : ""}
                  </div>
                </div>
                <MuteMenu conversation={active} />
                {active.type === "GROUP" && (
                  <button onClick={() => setRenaming(true)} title={t("Rename group")} aria-label={t("Rename group")} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"><Pencil className="h-4 w-4" /></button>
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
              <div className="h-[calc(100%-3.5rem)]"><ChatThread conversationId={active.id} meId={meId} members={threadMembers} /></div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-muted-foreground"><div><MessageCircle className="mx-auto mb-3 h-10 w-10 opacity-40" /><p className="text-sm">{t("Pick a conversation or start a new chat.")}</p></div></div>
          )}
        </section>
      </div>
      {composer && <NewChat onClose={() => setComposer(false)} onCreated={(id) => { setActiveId(id); setComposer(false); }} meId={meId} />}
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["conversations"] }); onClose(); },
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
        await nexusApi.addConversationMembers(target.conversationId, [u.id]);
        await qc.invalidateQueries({ queryKey: ["conversation", target.conversationId] });
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
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => nexusApi.members(), staleTime: 300_000 });
  const members = (Array.isArray(membersQuery.data) ? membersQuery.data : membersQuery.data?.members ?? []).filter((m: NexusUser) => m.id !== meId);
  const isGroup = selected.length > 1;

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
