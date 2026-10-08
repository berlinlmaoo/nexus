import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronRight, ExternalLink, FileText, FolderOpen, Image as ImageIcon, Link2, Loader2, LogOut, MessageSquare,
  Pencil, Search, UserMinus, UserPlus, UserRound, Users as UsersIcon, X,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { MuteMenu, mutedLabel } from "@/components/messages/MuteMenu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, fmtTime, nexusApi, type NexusChatMediaType, type NexusConversation, type NexusConversationInfo } from "@/lib/nexus-api";
import { isMuted } from "@/lib/chat-unread";
import { localeOf, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * The chat info panel, like WhatsApp's group info (SYSTEM-MESSAGES contract, Part 2, owner 8 Oct 2026):
 * opened from the chat header. A column beside the thread on wide screens, a sheet from the right on
 * tablets, the whole screen on a phone; it scrolls on its own.
 *
 *   group    picture, name, "Group · N members", description (editable by any member), Add / Search /
 *            Mute, media links and docs, the members (you first, Admin badge, Left tag; tap one for
 *            Message / View profile / Remove), Exit group.
 *   project  the same without Add, Remove and Exit: "Members follow the project" + Open project.
 *   DM       the person's card, Search / Mute, media, View profile.
 *
 * GET /api/conversations/:id/info, kept current by the socket (realtime.tsx invalidates ["chat-info", id]
 * on a membership change or a system line in the room).
 */

export const chatInfoKey = (conversationId: string) => ["chat-info", conversationId] as const;

const WIDE_QUERY = "(min-width: 1024px)";

/** Wide enough for the panel to sit beside the thread (lg). Read on the first render: no flash. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return wide;
}

type Info = NexusConversationInfo;
type View = "info" | "search" | "media";

const COUNT_CAP = 999;
const countLabel = (n: number) => (n >= COUNT_CAP ? `${COUNT_CAP}+` : String(n));

function fmtDate(value?: string | null): string {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(localeOf(), { day: "numeric", month: "short", year: "numeric" });
}

/** The query split around each case-insensitive occurrence, for a highlight. */
function highlight(text: string, q: string): ReactNode {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return text;
  const out: ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, at)) {
    if (i > at) out.push(<Fragment key={`t${at}`}>{text.slice(at, i)}</Fragment>);
    out.push(<mark key={`m${i}`} className="rounded bg-primary/15 px-0.5 text-foreground">{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  if (at < text.length) out.push(<Fragment key={`t${at}`}>{text.slice(at)}</Fragment>);
  return out;
}

function Row({ icon, label, hint, onClick, href, danger, trailing }: {
  icon: ReactNode; label: string; hint?: string; onClick?: () => void; href?: { to: "/projects/$projectId"; projectId: string } | { to: "/people/$userId"; userId: string };
  danger?: boolean; trailing?: ReactNode;
}) {
  const body = (
    <>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", danger ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-semibold", danger && "text-destructive")}>{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {trailing}
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  if (href?.to === "/projects/$projectId") return <Link to="/projects/$projectId" params={{ projectId: href.projectId }} className={cls}>{body}</Link>;
  if (href?.to === "/people/$userId") return <Link to="/people/$userId" params={{ userId: href.userId }} search={{}} className={cls}>{body}</Link>;
  return <button onClick={onClick} className={cls}>{body}</button>;
}

export function ChatInfoPanel({
  conversation,
  meId,
  onClose,
  onAdd,
  onRename,
  onJump,
  onMessage,
  onLeft,
}: {
  conversation: NexusConversation;
  meId?: string;
  onClose: () => void;
  /** Opens the add-people picker (groups, Manager and above). */
  onAdd: () => void;
  onRename: () => void;
  /** Show this message in the thread. */
  onJump: (messageId: string) => void;
  /** Open (or start) a direct message with this person. */
  onMessage: (userId: string) => void;
  /** After leaving the group: back to the chat list. */
  onLeft: () => void;
}) {
  const { lang, t, tn } = useLang();
  const qc = useQueryClient();
  const id = conversation.id;
  const [view, setView] = useState<View>("info");
  const closeRef = useRef<HTMLButtonElement>(null);
  const info = useQuery({ queryKey: chatInfoKey(id), queryFn: () => nexusApi.conversationInfo(id), retry: false });
  const data = info.data;

  // Another room: back to its overview.
  useEffect(() => { setView("info"); }, [id]);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  // Escape closes the panel, unless a menu or a confirmation on top of it takes the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="alertdialog"], [role="menu"], [role="dialog"][data-state="open"]')) return;
      if (view !== "info") setView("info");
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, onClose]);

  const type = data?.conversation.type ?? conversation.type;
  const title = data?.conversation.name?.trim()
    || (type === "DM" ? data?.members.find((m) => !m.isMe)?.name : null)
    || conversation.name
    || t("Conversation");
  const heading = type === "DM" ? t("Contact info") : type === "PROJECT" ? t("Project room info") : t("Group info");
  // Beside the thread it lives in the page's grid. Over it (tablet, phone) it goes to <body>, so it
  // covers the app's floating buttons like any sheet, and menus and confirmations opened from it
  // still come on top.
  const wide = useWide();

  const panel = (
    <aside
      lang={lang}
      role="dialog"
      aria-label={heading}
      className={cn(
        "fixed inset-0 z-50 flex min-h-0 flex-col bg-background pb-[env(safe-area-inset-bottom)]",
        "md:inset-y-0 md:left-auto md:right-0 md:w-[400px] md:border-l md:border-border md:shadow-pop",
        "lg:static lg:z-auto lg:w-auto lg:pb-0 lg:shadow-none",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3">
        {view !== "info" ? (
          <button onClick={() => setView("info")} title={t("Back")} aria-label={t("Back")} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"><ArrowLeft className="h-4 w-4" /></button>
        ) : (
          <button ref={closeRef} onClick={onClose} title={t("Close")} aria-label={t("Close")} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {view === "search" ? t("Search messages") : view === "media" ? t("Media, links and docs") : heading}
        </h2>
      </div>

      {view === "search" && <SearchView conversationId={id} onJump={onJump} />}
      {view === "media" && <MediaView conversationId={id} counts={data?.counts} onJump={onJump} />}
      {view === "info" && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {info.isLoading && <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {info.isError && !data && (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              <p>{t("Couldn't load the info.")}</p>
              <button onClick={() => info.refetch()} className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent">{t("Try again")}</button>
            </div>
          )}
          {data && (
            <InfoBody
              data={data}
              conversation={conversation}
              title={title}
              meId={meId}
              onAdd={onAdd}
              onRename={onRename}
              onSearch={() => setView("search")}
              onMedia={() => setView("media")}
              onMessage={onMessage}
              onLeft={onLeft}
              onChanged={() => {
                qc.invalidateQueries({ queryKey: chatInfoKey(id) });
                qc.invalidateQueries({ queryKey: ["conversations"] });
              }}
            />
          )}
        </div>
      )}
    </aside>
  );
  return wide || typeof document === "undefined" ? panel : createPortal(panel, document.body);
}

function InfoBody({
  data, conversation, title, meId, onAdd, onRename, onSearch, onMedia, onMessage, onLeft, onChanged,
}: {
  data: Info; conversation: NexusConversation; title: string; meId?: string;
  onAdd: () => void; onRename: () => void; onSearch: () => void; onMedia: () => void;
  onMessage: (userId: string) => void; onLeft: () => void; onChanged: () => void;
}) {
  const { t, tn } = useLang();
  const c = data.conversation;
  const isGroup = c.type === "GROUP";
  const isProject = c.type === "PROJECT";
  const peer = c.type === "DM" ? data.members.find((m) => !m.isMe) ?? null : null;
  const me = data.members.find((m) => m.isMe) ?? null;
  // You first, then everyone else in the server's order (admins, then A–Z).
  const members = useMemo(() => [...data.members.filter((m) => m.isMe), ...data.members.filter((m) => !m.isMe)], [data.members]);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const [exiting, setExiting] = useState(false);
  const mediaTotal = data.counts.photos + data.counts.links + data.counts.docs;
  const anyCapped = data.counts.photos >= COUNT_CAP || data.counts.links >= COUNT_CAP || data.counts.docs >= COUNT_CAP;

  const remove = useMutation({
    mutationFn: (userId: string) => nexusApi.removeConversationMember(c.id, userId),
    onSuccess: () => { setRemoving(null); onChanged(); },
    onError: (e, userId) => {
      const name = data.members.find((m) => m.userId === userId)?.name ?? "";
      const managerOnly = e instanceof ApiError && e.status === 403;
      toast.error(managerOnly ? t("Only managers and above can add or remove members.") : t("Couldn't remove {name}.", { name }));
      setRemoving(null);
      onChanged();
    },
  });
  const exit = useMutation({
    mutationFn: () => nexusApi.removeConversationMember(c.id, meId ?? me?.userId ?? ""),
    onSuccess: () => { setExiting(false); onLeft(); },
    onError: () => { toast.error(t("Couldn't leave the group.")); setExiting(false); },
  });

  const muted = isMuted(conversation);
  const subtitle = isGroup
    ? tn(c.memberCount, "Group · {n} member", "Group · {n} members")
    : isProject
      ? tn(c.memberCount, "Project room · {n} member", "Project room · {n} members")
      : t("Direct message");

  return (
    // Room at the end to scroll the last rows clear of the floating GIDEON button (beside the thread).
    <div className="pb-6 lg:pb-24">
      {/* Picture, name, count */}
      <div className="flex flex-col items-center px-6 pb-4 pt-6 text-center">
        {peer ? (
          <Avatar userId={peer.userId} name={peer.name} avatar={peer.avatar} size={88} />
        ) : (
          <span className="grid h-[88px] w-[88px] place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-border"><UsersIcon className="h-9 w-9" /></span>
        )}
        <div className="mt-3 flex max-w-full items-center gap-1">
          <h3 className="truncate text-lg font-semibold tracking-tight">{title}</h3>
          {isGroup && c.canEdit && (
            <button onClick={onRename} title={t("Rename group")} aria-label={t("Rename group")} className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><Pencil className="h-3.5 w-3.5" /></button>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        {peer?.deactivatedAt && <span className="mt-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{t("Left")}</span>}
      </div>

      {/* Description: any member of a group may write it */}
      {isGroup && <Description info={data} onSaved={onChanged} />}

      {/* Add · Search · Mute */}
      <div className={cn("grid gap-2 px-4 pb-2", isGroup && c.canManageMembers ? "grid-cols-3" : "grid-cols-2")}>
        {isGroup && c.canManageMembers && (
          <button onClick={onAdd} className="flex flex-col items-center gap-1.5 rounded-2xl border border-border px-2 py-3 text-xs font-semibold transition-colors hover:bg-accent">
            <UserPlus className="h-4 w-4" /> <span>{t("Add")}</span>
          </button>
        )}
        <button onClick={onSearch} className="flex flex-col items-center gap-1.5 rounded-2xl border border-border px-2 py-3 text-xs font-semibold transition-colors hover:bg-accent">
          <Search className="h-4 w-4" /> <span>{t("Search")}</span>
        </button>
        <MuteMenu conversation={conversation} labelled />
      </div>
      {muted && <p className="px-6 pb-2 text-center text-xs text-muted-foreground">{mutedLabel(conversation)}</p>}

      {/* Media, links and docs */}
      <div className="mt-2 border-t border-border px-2 pt-2">
        <Row
          icon={<ImageIcon className="h-4 w-4" />}
          label={t("Media, links and docs")}
          onClick={onMedia}
          trailing={<span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">{anyCapped ? `${COUNT_CAP}+` : mediaTotal}<ChevronRight className="h-4 w-4" /></span>}
        />
        {peer && <Row icon={<UserRound className="h-4 w-4" />} label={t("View profile")} href={{ to: "/people/$userId", userId: peer.userId }} />}
      </div>

      {/* Members */}
      {(isGroup || isProject) && (
        <div className="mt-2 border-t border-border px-2 pt-3">
          <div className="px-3 pb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{tn(c.memberCount, "{n} member", "{n} members")}</div>
          {isProject && (
            <>
              <p className="px-3 pb-1 text-xs text-muted-foreground">{t("Members follow the project")} · {t("Add or remove people in the project itself.")}</p>
              {c.projectId && <Row icon={<FolderOpen className="h-4 w-4" />} label={t("Open project")} href={{ to: "/projects/$projectId", projectId: c.projectId }} />}
            </>
          )}
          {isGroup && c.canManageMembers && <Row icon={<UserPlus className="h-4 w-4" />} label={t("Add people")} onClick={onAdd} />}
          <ul>
            {members.map((m) => {
              const line = (
                <span className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left">
                  <Avatar userId={m.userId} name={m.name} avatar={m.avatar} size={36} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.isMe ? t("You") : m.name}</span>
                  {m.deactivatedAt && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{t("Left")}</span>}
                  {m.isAdmin && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{t("Admin")}</span>}
                </span>
              );
              if (m.isMe) return <li key={m.userId}>{line}</li>;
              return (
                <li key={m.userId}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="block w-full rounded-xl text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={m.name}>{line}</button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => onMessage(m.userId)}><MessageSquare className="mr-2 h-4 w-4" /> {t("Message {name}", { name: m.name })}</DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/people/$userId" params={{ userId: m.userId }} search={{}}><UserRound className="mr-2 h-4 w-4" /> {t("View profile")}</Link>
                      </DropdownMenuItem>
                      {isGroup && c.canManageMembers && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setRemoving({ userId: m.userId, name: m.name })} className="text-destructive focus:text-destructive">
                            <UserMinus className="mr-2 h-4 w-4" /> {t("Remove from group")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Exit group */}
      {isGroup && me && (
        <div className="mt-2 border-t border-border px-2 pt-2">
          <Row icon={<LogOut className="h-4 w-4" />} label={t("Exit group")} danger onClick={() => setExiting(true)} />
        </div>
      )}

      {isGroup && (
        <p className="px-6 pt-4 text-center text-[11px] text-muted-foreground">
          {c.createdBy ? t("Created by {name} · {date}", { name: c.createdBy.name, date: fmtDate(c.createdAt) }) : t("Created {date}", { date: fmtDate(c.createdAt) })}
        </p>
      )}

      <AlertDialog open={!!removing} onOpenChange={(o) => { if (!o && !remove.isPending) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove {name} from {group}?", { name: removing?.name ?? "", group: title })}</AlertDialogTitle>
            <AlertDialogDescription>{t("They stop getting this group's messages. Everyone sees a line saying you removed them.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => { e.preventDefault(); if (removing) remove.mutate(removing.userId); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("Remove from group")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={exiting} onOpenChange={(o) => { if (!o && !exit.isPending) setExiting(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Exit “{group}”?", { group: title })}</AlertDialogTitle>
            <AlertDialogDescription>{t("You stop getting its messages. A manager can add you back.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={exit.isPending}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={exit.isPending}
              onClick={(e) => { e.preventDefault(); exit.mutate(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {exit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("Exit group")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const DESCRIPTION_MAX = 500;

/** The group description, edited in place by any member (canEdit). */
function Description({ info, onSaved }: { info: Info; onSaved: () => void }) {
  const { t } = useLang();
  const c = info.conversation;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.description ?? "");
  useEffect(() => { if (!editing) setDraft(c.description ?? ""); }, [c.description, editing]);
  const save = useMutation({
    mutationFn: () => nexusApi.setConversationDescription(c.id, draft.trim() ? draft.trim() : null),
    onSuccess: () => { setEditing(false); onSaved(); },
  });

  if (editing) {
    return (
      <div className="px-4 pb-3">
        <label className="mb-1 block text-xs font-semibold text-muted-foreground" htmlFor="chat-description">{t("Group description")}</label>
        <textarea
          id="chat-description"
          autoFocus
          value={draft}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(false); } }}
          rows={4}
          className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            disabled={save.isPending || draft.trim() === (c.description ?? "")}
            onClick={() => save.mutate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("Save")}
          </button>
          <button onClick={() => { setEditing(false); save.reset(); }} className="rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent">{t("Cancel")}</button>
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{draft.length}/{DESCRIPTION_MAX}</span>
        </div>
        {save.isError && <p className="mt-1 text-xs font-semibold text-destructive">{t("Couldn't save the description.")}</p>}
      </div>
    );
  }
  if (c.description) {
    return (
      <div className="px-6 pb-4">
        {c.canEdit ? (
          <button onClick={() => setEditing(true)} title={t("Edit description")} className="group/desc w-full rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-accent">
            <span className="whitespace-pre-wrap break-words text-sm leading-relaxed">{c.description}</span>
            <Pencil className="ml-1 inline h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover/desc:opacity-100" />
          </button>
        ) : (
          <p className="whitespace-pre-wrap break-words px-2 text-sm leading-relaxed">{c.description}</p>
        )}
      </div>
    );
  }
  if (!c.canEdit) return null;
  return (
    <div className="flex justify-center px-6 pb-4">
      <button onClick={() => setEditing(true)} className="rounded-lg px-2 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary/10">{t("Add group description")}</button>
    </div>
  );
}

/** In-chat search: results newest first; a click shows the message in the thread. */
function SearchView({ conversationId, onJump }: { conversationId: string; onJump: (messageId: string) => void }) {
  const { t } = useLang();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.replace(/\s+/g, " ").trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const enough = q.length >= 2;
  const results = useInfiniteQuery({
    queryKey: ["chat-search", conversationId, q],
    queryFn: ({ pageParam }) => nexusApi.searchConversation(conversationId, q, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enough,
    retry: false,
  });
  const rows = results.data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("Search messages")}
            aria-label={t("Search messages")}
            maxLength={100}
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-9 text-sm outline-none focus:border-primary"
          />
          {text && (
            <button onClick={() => setText("")} title={t("Close")} aria-label={t("Close")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4 lg:pb-24">
        {!enough && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("Type at least 2 letters.")}</p>}
        {enough && results.isLoading && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {enough && results.isError && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("Couldn't search. Try again.")}</p>}
        {enough && results.isSuccess && rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("No messages match.")}</p>}
        <ul>
          {rows.map((r) => (
            <li key={r.messageId}>
              <button onClick={() => onJump(r.messageId)} className="w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">{r.sender.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtDate(r.createdAt)} {fmtTime(r.createdAt)}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{highlight(r.snippet, q)}</span>
              </button>
            </li>
          ))}
        </ul>
        {results.hasNextPage && (
          <div className="flex justify-center pt-2">
            <button onClick={() => results.fetchNextPage()} disabled={results.isFetchingNextPage} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60">
              {results.isFetchingNextPage && <Loader2 className="h-3 w-3 animate-spin" />} {t("Load more")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Photos (grid), Links and Docs, newest first, a page at a time. */
function MediaView({ conversationId, counts, onJump }: { conversationId: string; counts?: Info["counts"]; onJump: (messageId: string) => void }) {
  const { t } = useLang();
  const [tab, setTab] = useState<NexusChatMediaType>("photos");
  const label = (name: string, n?: number) => (typeof n === "number" ? `${name} · ${countLabel(n)}` : name);
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as NexusChatMediaType)} className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-3">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="photos">{label(t("Photos"), counts?.photos)}</TabsTrigger>
          <TabsTrigger value="links">{label(t("Links"), counts?.links)}</TabsTrigger>
          <TabsTrigger value="docs">{label(t("Docs"), counts?.docs)}</TabsTrigger>
        </TabsList>
      </div>
      {(["photos", "links", "docs"] as const).map((type) => (
        <TabsContent key={type} value={type} className="mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4 pt-3 lg:pb-24">
          {tab === type && <MediaList conversationId={conversationId} type={type} onJump={onJump} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function MediaList({ conversationId, type, onJump }: { conversationId: string; type: NexusChatMediaType; onJump: (messageId: string) => void }) {
  const { t } = useLang();
  const q = useInfiniteQuery({
    queryKey: ["chat-media", conversationId, type],
    queryFn: ({ pageParam }) => nexusApi.conversationMedia(conversationId, type, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const more = q.hasNextPage && (
    <div className="flex justify-center pt-3">
      <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60">
        {q.isFetchingNextPage && <Loader2 className="h-3 w-3 animate-spin" />} {t("Load more")}
      </button>
    </div>
  );

  if (q.isLoading) return <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (q.isError) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <p>{t("Couldn't load the info.")}</p>
        <button onClick={() => q.refetch()} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent">{t("Try again")}</button>
      </div>
    );
  }
  if (items.length === 0 && !q.hasNextPage) {
    const empty = type === "photos" ? t("No photos yet.") : type === "links" ? t("No links yet.") : t("No documents yet.");
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  }

  if (type === "photos") {
    return (
      <>
        <div className="grid grid-cols-3 gap-1">
          {items.map((it) => (
            <button key={it.messageId} onClick={() => onJump(it.messageId)} title={`${it.sender.name} · ${fmtDate(it.createdAt)}`} className="group/ph relative aspect-square overflow-hidden rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <img src={it.url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover/ph:scale-[1.03]" />
            </button>
          ))}
        </div>
        {more}
      </>
    );
  }
  return (
    <>
      <ul>
        {items.map((it, i) => (
          <li key={`${it.messageId}:${i}`} className="flex items-center gap-1 rounded-xl transition-colors hover:bg-accent">
            <a href={it.url} target="_blank" rel="noopener noreferrer nofollow" className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                {type === "links" ? <Link2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{it.title || it.url}</span>
                {type === "links" && <span className="block truncate text-xs text-primary">{it.url}</span>}
                <span className="block truncate text-[11px] text-muted-foreground">{it.sender.name} · {fmtDate(it.createdAt)}</span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
            <button onClick={() => onJump(it.messageId)} title={t("Show in chat")} aria-label={t("Show in chat")} className="mr-1 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-background"><MessageSquare className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      {more}
    </>
  );
}
