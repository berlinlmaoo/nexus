import { useRealtimeRoom } from "@/lib/realtime";
import { ProjectMarkFor, ProjectPageIcon } from "@/components/projects/ProjectIcon";
import { activityText } from "@/lib/server-text";
import { DateField } from "@/components/DateField";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { animate as fmAnimate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUp,
  CheckSquare,
  CircleDot,
  Flag,
  Hash,
  Loader,
  Tags,
  Type,
  UserRound,
  Users,
  Maximize2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  Eye,
  FolderPlus,
  Heart,
  Link2,
  ListChecks,
  Loader2,
  MapPin,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Search,
  Star,
  Trash2,
  FolderInput,
  Trophy,
  UserPlus,
  X,
  Sparkles,
} from "lucide-react";
import {
  fmtDate,
  fmtDue,
  fmtTime,
  nexusApi,
  statusLabel,
  type CustomFieldFile,
  type NexusAttachment,
  type NexusComment,
  type NexusCustomField,
  type NexusCustomFieldOptions,
  type NexusTask,
  type NexusUser,
} from "@/lib/nexus-api";
import { NumberFieldInput } from "@/components/projects/number-field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { pushGideonPage } from "@/lib/gideon-ai";
import { useAutofillMarks } from "@/components/gideon/AutofillPanel";
import { Avatar, AvatarFace } from "@/components/Avatar";
import { StatusPicker, StatusPill } from "@/components/tasks/StatusPicker";
import { SelectPicker } from "@/components/SelectPicker";
import { choiceColor, optionColor } from "@/lib/project-views";
import { usesStatusOptions } from "@/lib/status-options";
import { useLang } from "@/lib/lang";
import { displayName } from "@/lib/system-users";
import { toast } from "sonner";
import { FieldEditor } from "@/components/projects/ProjectCustomFieldsManager";
import { CopyToProjectDialog } from "@/components/tasks/CopyToProjectDialog";
import { patchTaskInCaches, settleTaskWrite } from "@/lib/task-cache";
import { friendlyError, pushUndo } from "@/lib/task-undo";
import { LoadError, retryTransient } from "@/components/LoadError";
import { EmptyAction } from "@/components/EmptyState";
import { Link } from "@tanstack/react-router";

// The description's block editor (TipTap + Yjs) is the heaviest part of the popup; it loads beside the popup
// rather than in front of it, so the title, status and fields show first (perf pass, 12 Oct 2026).
const loadBody = () => import("@/components/editor/TaskBodyEditor");
const TaskBodyEditor = lazy(() => loadBody().then((m) => ({ default: m.TaskBodyEditor })));
export const preloadTaskBody = () => void loadBody();

// On every pointer-down we record both the tap point AND the rect of the tapped card (the element with a
// `data-morph-id`). The panel uses that rect to do a MANUAL FLIP morph — it starts the box exactly on the
// card and grows into the panel — WITHOUT a shared framer `layoutId`. That's the whole point: a layoutId
// would tie the panel to the card's live DOM node, so a Section change that moves the card to another
// column yanks/pollutes the panel → stuck backdrop blur. A measured rect is a one-time snapshot, so a card
// that later moves or unmounts can never affect the open panel. (On close we re-measure the card's CURRENT
// rect so the shrink lands wherever the card is now.)
let lastPointer: { x: number; y: number } | null = null;
let lastMorph: { id: string; rect: DOMRect } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      const el = (e.target as Element | null)?.closest?.("[data-morph-id]") as HTMLElement | null;
      lastMorph = el?.dataset.morphId ? { id: el.dataset.morphId, rect: el.getBoundingClientRect() } : null;
    },
    true
  );
}
const OPEN_SPRING = { type: "spring", stiffness: 470, damping: 38, mass: 0.7 } as const;
const CLOSE_SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 0.6 } as const;

const STATUS_OPTIONS = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"];
const PRIORITY_OPTIONS = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"];
const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👀", "🚀", "✅"];

// Decide how to preview a file. Some uploaders (Android Chrome, some iOS share-sheets, .mov drag-drop)
// report an empty file.type, so the attachment lands as application/octet-stream — keying the preview
// purely off mimeType then shows a non-playable "download" card for a perfectly good video. Fall back to
// the filename extension so those still mount a <video>/<img>/etc.
function fileExt(name?: string | null): string {
  const m = (name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}
function mediaKind(att: { mimeType?: string | null; name?: string | null }): "image" | "video" | "audio" | "pdf" | "other" {
  const m = (att.mimeType ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  const e = fileExt(att.name); // mimeType missing / octet-stream → sniff the extension
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(e)) return "image";
  if (e === "pdf") return "pdf";
  if (["mp4", "mov", "webm", "m4v", "ogv"].includes(e)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(e)) return "audio";
  return "other";
}
// .mov is usually HEVC/H.265 — plays on iOS Safari but not Android/most webviews. Flag it so we can warn.
function maybeUnplayableVideo(att: { mimeType?: string | null; name?: string | null }): boolean {
  return (att.mimeType ?? "").toLowerCase() === "video/quicktime" || fileExt(att.name) === "mov";
}

/**
 * A task person (assignee or creator) who was offboarded. Their tasks stay theirs (owner, 8 Oct 2026).
 * No date, unlike components/LeftTag: the task payload carries User.deactivatedAt (when the account was
 * closed), not the last working day.
 */
function PersonLeftTag() {
  const lang = useLang();
  return (
    <span title={lang.t("Left the company. Their tasks stay assigned to them.")} className="rounded-full border border-border px-1.5 text-[10px] font-semibold leading-4 text-muted-foreground">
      {lang.t("Left")}
    </span>
  );
}

/** "Created by Rina · 3 Oct" under the people/due cards, with the Left tag when the creator was offboarded. */
function CreatedByLine({ creator, createdAt }: { creator: NexusUser; createdAt: string | null }) {
  const lang = useLang();
  const when = createdAt ? new Date(createdAt) : null;
  const date = when && !Number.isNaN(when.getTime())
    ? when.toLocaleDateString(lang.locale, { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" })
    : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1.5 text-sm text-muted-foreground">
      <MiniAvatar user={creator} size={20} />
      <span className="text-foreground">{displayName(creator)}</span>
      {creator.deactivatedAt && <PersonLeftTag />}
      {date && <span>· {date}</span>}
    </div>
  );
}

/** A task person's photo (looked up in the workspace directory when the payload carries none), initials as fallback. */
function MiniAvatar({ user, size = 28 }: { user?: NexusUser | null; size?: number }) {
  if (user?.id) return <Avatar userId={user.id} name={user.name} avatar={user.avatar} size={size} className="shrink-0 ring-1 ring-border" />;
  return <AvatarFace name={user?.name} size={size} className="shrink-0 ring-1 ring-border" />;
}

function toMembers(data: { members?: NexusUser[] } | NexusUser[] | undefined): NexusUser[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.members ?? [];
}

function isDoneStatus(s?: string | null) {
  return (s ?? "").toUpperCase() === "DONE";
}

/** One property of the task page (Notion's row, 16 Oct 2026): the icon and name in a ~160px muted column on the
 *  left, the value on the right, which reads as text until hovered or clicked. */
function PropRow({ icon: Icon, label, aside, hint, children }: { icon: typeof Plus; label: string; aside?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div role="listitem" className="group/prop flex min-h-9 items-start gap-1 rounded-lg">
      <div className="flex h-9 w-[136px] shrink-0 items-center gap-2 px-1.5 text-sm text-muted-foreground sm:w-40 pointer-coarse:h-11" title={hint ?? label}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        {aside}
      </div>
      <div className="flex min-h-9 min-w-0 flex-1 items-center py-0.5 text-sm pointer-coarse:min-h-11">{children}</div>
    </div>
  );
}

/** The glyph of a project field on its property row (the table's header glyphs). */
function fieldIcon(type?: string | null): typeof Plus {
  switch ((type ?? "").toUpperCase()) {
    case "NUMBER": return Hash;
    case "SELECT": case "STATUS": return CircleDot;
    case "MULTI_SELECT": return Tags;
    case "DATE": return Calendar;
    case "URL": return Link2;
    case "FILE": return Paperclip;
    case "PLACE": return MapPin;
    case "PERSON": return Users;
    case "CHECKBOX": return CheckSquare;
    default: return Type;
  }
}

/** A section under the page body (subtasks, attachments, activity). */
function SecCard({ icon: Icon, label, action, children, className }: { icon: typeof Plus; label: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    // Flat sections divided by a hairline (Notion's page), not a stack of floating shadow cards; the
    // heading reads in sentence case (audit, 12 Oct 2026).
    <section className={cn("border-t border-border/70 pt-4", className)}>
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-[15px] font-bold text-foreground"><Icon className="h-4 w-4 text-muted-foreground" />{label}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function TaskDetailPanel({ taskId, onClose, morphId, asPage }: {
  taskId: string; onClose: () => void; morphId?: string;
  /** Opened at /tasks/$id: the dialog IS the page, so it has no "Open as page" link. */
  asPage?: boolean;
}) {
  // A task opens CENTRED, NEXUS's own popup (owner, 16 Oct 2026: the right-hand side peek of the first Notion pass
  // was taken back out); inside, it reads as a Notion page: title, property rows, comments, then the body.
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const morph = !!morphId && !reduce;
  // --- card → panel MORPH via a manual FLIP (no shared layoutId, see note at top of file) ---
  // The box starts exactly on the source card's measured rect and grows to the panel; on close it shrinks
  // back to wherever the card is NOW. Driven by raw motion values so a moving/unmounting card can never
  // yank or blur it (the rect is just a number snapshot).
  const asideRef = useRef<HTMLElement | null>(null);
  const panelRectRef = useRef<DOMRect | null>(null); // panel's natural (untransformed) rect, measured once
  const sourceRect = useRef<DOMRect | null>(morph && lastMorph && lastMorph.id === morphId ? lastMorph.rect : null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const msx = useMotionValue(1);
  const msy = useMotionValue(1);
  const asideO = useMotionValue(reduce ? 1 : 0);
  const backdropO = useMotionValue(0);
  const closingRef = useRef(false);
  const openedWithRect = useRef(false); // did we morph FROM a card rect? (governs symmetric close)
  const [closing, setClosing] = useState(false); // freeze interaction once the close animation starts

  // OPEN: snap the box onto the card's rect (before paint), then spring it to the panel.
  useLayoutEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    panelRectRef.current = el.getBoundingClientRect(); // transforms are still identity here → natural rect
    fmAnimate(backdropO, 1, { duration: 0.2 });
    if (reduce) { asideO.set(1); return; }
    const src = sourceRect.current;
    const p = panelRectRef.current;
    if (!src || !src.width || !p.width || !p.height) {
      // No source card (keyboard open / opened from a non-morph element) → gentle centred scale-fade.
      msx.set(0.96); msy.set(0.96); asideO.set(0);
      fmAnimate(msx, 1, OPEN_SPRING); fmAnimate(msy, 1, OPEN_SPRING); fmAnimate(asideO, 1, { duration: 0.18 });
      return;
    }
    openedWithRect.current = true;
    mx.set(src.left - p.left); my.set(src.top - p.top);
    msx.set(src.width / p.width); msy.set(src.height / p.height);
    asideO.set(1);
    fmAnimate(mx, 0, OPEN_SPRING); fmAnimate(my, 0, OPEN_SPRING);
    fmAnimate(msx, 1, OPEN_SPRING); fmAnimate(msy, 1, OPEN_SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CLOSE: shrink back to the card's CURRENT on-screen rect — but ONLY if we morphed from one and it's
  // still visible. If the card moved off-screen, was filtered out, or we opened without a rect, fall back
  // to a neutral centred fade (symmetric with that open, and never flies toward an empty region).
  // Fields save on blur. A popup that closes while one is focused (Esc, the X, the backdrop, browser Back)
  // would unmount it without a blur and drop the edit (bug hunt C-BUG-1, 12 Oct 2026): blur it first.
  const flushEdits = () => {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body && asideRef.current?.contains(el)) el.blur();
  };
  // Closed from outside (Back removed ?task=…): the same flush while the fields are still in the page.
  useLayoutEffect(() => () => flushEdits(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const requestClose = () => {
    if (closingRef.current) return;
    flushEdits();
    closingRef.current = true;
    setClosing(true);
    const el = asideRef.current;
    const p = panelRectRef.current;
    fmAnimate(backdropO, 0, { duration: 0.2 });
    const node = openedWithRect.current && morphId ? (document.querySelector(`[data-morph-id="${morphId}"]`) as HTMLElement | null) : null;
    const live = node?.getBoundingClientRect();
    const onScreen = !!live && live.width > 0 && live.bottom > 0 && live.right > 0 && live.top < window.innerHeight && live.left < window.innerWidth;
    if (!reduce && el && p && p.width && live && onScreen) {
      fmAnimate(mx, live.left - p.left, CLOSE_SPRING); fmAnimate(my, live.top - p.top, CLOSE_SPRING);
      fmAnimate(msx, live.width / p.width, CLOSE_SPRING); fmAnimate(msy, live.height / p.height, CLOSE_SPRING);
      fmAnimate(asideO, 0, { duration: 0.22, delay: 0.05 }).then(() => onClose());
    } else {
      if (!reduce) { fmAnimate(msx, 0.96, CLOSE_SPRING); fmAnimate(msy, 0.96, CLOSE_SPRING); }
      fmAnimate(asideO, 0, { duration: reduce ? 0.15 : 0.16 }).then(() => onClose());
    }
  };
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [showProjPicker, setShowProjPicker] = useState(false);

  // Esc to close + lock body scroll while the modal is up. When a NESTED subtask panel is open,
  // this (parent) panel must ignore Esc — otherwise one keypress closes the whole stack at once.
  const openSubRef = useRef<string | null>(null);
  useEffect(() => {
    // defaultPrevented: Esc already closed a menu or the delete alert (Radix) — leave the panel open.
    // ProseMirror marks every Escape typed in the description as handled, so that alone kept the popup open while
    // typing in the body (QA 16 Oct 2026); there it closes unless the slash / mention / block menu is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || openSubRef.current) return;
      const inBody = !!(e.target as HTMLElement | null)?.closest?.(".ProseMirror");
      const bodyMenu = !!document.querySelector('.nx-menu[role="listbox"], .nx-menu[role="menu"]');
      if (!e.defaultPrevented || (inBody && !bodyMenu)) requestClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);

  useEffect(() => { void loadBody(); }, []);
  // A 404/403 is the answer, not a blip: no retries (it took ~7 s and 10 failing requests to show an error
  // for a deleted task, QA 13 Oct 2026).
  const task = useQuery({ queryKey: ["task", taskId], queryFn: () => nexusApi.taskDetail(taskId), retry: retryTransient });
  const comments = useQuery({ queryKey: ["task-comments", taskId], queryFn: () => nexusApi.taskComments(taskId), retry: retryTransient });
  const attachments = useQuery({ queryKey: ["task-attachments", taskId], queryFn: () => nexusApi.taskAttachments(taskId), retry: retryTransient });
  const [previewAtt, setPreviewAtt] = useState<NexusAttachment | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [sizeWarn, setSizeWarn] = useState<string | null>(null);
  // Files >20MB auto-chunk client-side into 10MB pieces (see uploadAttachmentProgress) so each request stays
  // far below Cloudflare's 100MB cap and gets reassembled server-side — the real ceiling is the app/nginx limit.
  const MAX_ATTACH_MB = 1024; // 1GB — uploads stream in 10MB chunks, so Cloudflare's per-request cap doesn't apply
  const MAX_ATTACH_BYTES = MAX_ATTACH_MB * 1024 * 1024;
  const MAX_ATTACH_LABEL = "1 GB";
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: () => nexusApi.favorites(), staleTime: 60_000 });
  const isFavorited = (favorites.data ?? []).some((f) => f.targetId === taskId && (f.type ?? "").toLowerCase() === "task");
  const followers = useQuery({ queryKey: ["task-followers", taskId], queryFn: () => nexusApi.taskFollowers(taskId), retry: retryTransient });
  // BoD-only "Jadiin quest" action: bundle this (and more) task(s) into a specific_tasks quest.
  const wsMembers = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), staleTime: 300_000, retry: false });
  const canMakeQuest = wsMembers.data?.role === "BOD" || wsMembers.data?.role === "ONE_ABOVE_ALL";
  // Control Room → Audit (where a delete is undone) is Manager and up; Staff are told who can do it (QA S-19).
  const canOpenAudit = ["MANAGER", "BOD", "ONE_ABOVE_ALL"].includes(wsMembers.data?.role ?? "");
  const [questOpen, setQuestOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const projectId = task.data?.taskList?.project?.id || task.data?.taskList?.projectId;
  // Live changes by others (status, fields, comments) while the popup is open — also when opened from My Tasks.
  useRealtimeRoom(projectId ? `project:${projectId}` : null);
  const ai = useAutofillMarks(projectId);
  // While the task is open, GIDEON's context chip is this task (Notion AI's page chip).
  useEffect(() => (task.data ? pushGideonPage({ kind: "task", id: taskId, title: task.data.title, projectId: projectId ?? null, projectName: task.data.taskList?.project?.name ?? null }) : undefined), [taskId, task.data?.title, projectId, task.data?.taskList?.project?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const customFields = useQuery({ queryKey: ["task-cf", taskId], queryFn: () => nexusApi.taskCustomFields(projectId!, taskId), enabled: !!projectId });
  // Project's sections (board columns = TaskLists) so the top dropdown follows the actual project.
  const [copyOpen, setCopyOpen] = useState(false);
  const projDetail = useQuery({ queryKey: ["nexus", "project", projectId], queryFn: () => nexusApi.project(projectId!), enabled: !!projectId, staleTime: 60_000 });
  // Deleting a task needs Can edit or Full access (Notion levels, owner 13 Oct 2026).
  const lvl = projDetail.data?.viewerAccessLevel;
  const canDeleteTask = lvl ? lvl === "FULL" || lvl === "EDIT" : projDetail.data?.viewerCanManage !== false;
  // Can view / Can comment: the task opens read-only (QA round 2, N-02) — every control in the editing part sits
  // in a disabled <fieldset>; comments stay open for Can comment.
  const canEditTask = !lvl || lvl === "FULL" || lvl === "EDIT";
  const canCommentTask = lvl !== "VIEW";
  const sections = (projDetail.data?.taskLists ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const { t: tr } = useLang();
  // Only fetch the whole-workspace member list as a FALLBACK for tasks with no project. For a project
  // task we assign from the project's own team (projDetail.members) — see assignableMembers below.
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => nexusApi.members(), enabled: showAssignPicker && !projectId, staleTime: 300_000 });
  const candidateProjects = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, enabled: showProjPicker, staleTime: 300_000 });

  const t = task.data;

  // local mirrors for inline edits
  const [title, setTitle] = useState("");
  // The title follows the task (a rename by someone else shows at once) until you start typing in it; only
  // a title you typed is ever written back, so a focus + blur can't put an old title over a new one
  // (bug hunt C-BUG-3, 12 Oct 2026).
  const titleDirty = useRef(false);
  // The title grows with its text (one line for a short name, no blank second line).
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title, task.data?.id]);
  useEffect(() => {
    if (t && !titleDirty.current) setTitle(t.title ?? "");
  }, [t?.id, t?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  const commitTitle = () => {
    if (!t || !titleDirty.current) return;
    titleDirty.current = false;
    const next = title.replace(/\s*\n+\s*/g, " ").trim();
    if (!next) { setTitle(t.title ?? ""); return; }
    if (next !== t.title) update.mutate({ title: next });
  };

  // After a write: this task, its activity, and the project on screen refetch; other task lists are only
  // marked stale (they refetch when opened) — perf pass, 12 Oct 2026.
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["task-comments", taskId] });
    settleTaskWrite(qc, projectId, taskId);
  };

  const update = useMutation({
    mutationFn: (payload: Parameters<typeof nexusApi.updateTask>[1]) => nexusApi.updateTask(taskId, payload),
    // Optimistic: status, priority, title, dates and tags show at once, here and on the board behind.
    onMutate: (payload) => {
      const { title, status, priority, dueDate, tags } = payload as Partial<NexusTask>;
      const patch = Object.fromEntries(Object.entries({ title, status, priority, dueDate, tags, startDate: (payload as { startDate?: string | null }).startDate }).filter(([, v]) => v !== undefined));
      return { rollback: Object.keys(patch).length ? patchTaskInCaches(qc, taskId, patch) : null };
    },
    onSuccess: invalidateAll,
    // Surfaces the "wajib lampiran sebelum Done" gate (and any other reject) instead of failing silently.
    onError: (e: unknown, _v, c) => { c?.rollback?.(); invalidateAll(); toast.error(friendlyError(e) ?? tr("Couldn't update the task.")); },
  });
  // --- subtasks (Asana-style: full tasks linked via parentId; hidden from board, live here) ---
  const [openSub, setOpenSub] = useState<string | null>(null);
  useEffect(() => { openSubRef.current = openSub; }, [openSub]);
  const [newSubTitle, setNewSubTitle] = useState("");
  const addSubtask = useMutation({
    mutationFn: (subTitle: string) =>
      nexusApi.createTask({
        title: subTitle,
        projectId: projectId ?? "",
        taskListId: t?.taskList?.id ?? "",
        status: "TODO",
        parentId: taskId,
      }),
    onSuccess: () => { setNewSubTitle(""); invalidateAll(); },
  });
  const toggleSubtask = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => nexusApi.updateTask(id, { status: done ? "DONE" : "TODO" }),
    onSuccess: invalidateAll,
  });
  const addComment = useMutation({
    mutationFn: ({ content, mentionedUserIds }: { content: string; mentionedUserIds?: string[] }) => nexusApi.addComment(taskId, content, { mentionedUserIds }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["task-comments", taskId] }); qc.invalidateQueries({ queryKey: ["task", taskId] }); },
    // The composer keeps the text (C-BUG-7); this says why it didn't go.
    onError: (e: unknown) => toast.error(tr("Couldn't send the comment. Your text is still there — try again."), { description: friendlyError(e) }),
  });
  const editComment = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) => nexusApi.updateComment(taskId, commentId, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-comments", taskId] }),
    onError: (e: unknown) => toast.error(tr("Couldn't edit the comment."), { description: friendlyError(e) }),
  });
  const replyComment = useMutation({
    mutationFn: ({ parentId, content, mentionedUserIds }: { parentId: string; content: string; mentionedUserIds?: string[] }) => nexusApi.addComment(taskId, content, { parentId, mentionedUserIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-comments", taskId] }),
    onError: (e: unknown) => toast.error(tr("Couldn't send the reply."), { description: friendlyError(e) }),
  });
  const delComment = useMutation({
    mutationFn: (commentId: string) => nexusApi.deleteComment(taskId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-comments", taskId] }),
  });
  const reactMut = useMutation({
    mutationFn: ({ commentId, emoji, has }: { commentId: string; emoji: string; has: boolean }) =>
      has ? nexusApi.removeCommentReaction(taskId, commentId, emoji) : nexusApi.addCommentReaction(taskId, commentId, emoji),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-comments", taskId] }),
  });
  const assignMut = useMutation({
    mutationFn: ({ userId, add }: { userId: string; add: boolean }) =>
      add ? nexusApi.addAssignee(taskId, userId) : nexusApi.removeAssignee(taskId, userId),
    onSuccess: () => { setShowAssignPicker(false); invalidateAll(); },
  });
  const likeMut = useMutation({
    mutationFn: (like: boolean) => nexusApi.toggleTaskLike(taskId, like),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  // Several files per pick (C-BUG-31), uploaded one after the other; each failure says so.
  const uploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      let failed = 0;
      let why: string | undefined;
      for (const file of files) {
        setUploadPct(0);
        try { await nexusApi.uploadAttachmentProgress(taskId, file, setUploadPct); }
        catch (e) { failed++; why ??= friendlyError(e); }
        qc.invalidateQueries({ queryKey: ["task-attachments", taskId] });
      }
      if (failed) throw new Error(why ?? "");
      return files.length;
    },
    onMutate: () => setUploadPct(0),
    onSettled: () => setUploadPct(null),
    onError: (e: unknown) => toast.error(tr("Couldn't upload the file."), { description: friendlyError(e) }),
  });

  const delAttachment = useMutation({
    mutationFn: (id: string) => nexusApi.deleteAttachment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-attachments", taskId] }),
    onError: (e: unknown) => toast.error(tr("Couldn't delete the attachment."), { description: friendlyError(e) }),
  });
  // A file goes only after a confirm (C-BUG-32): payout proofs are finance's evidence.
  const [confirmAtt, setConfirmAtt] = useState<NexusAttachment | null>(null);
  const favMut = useMutation({
    mutationFn: () => nexusApi.toggleFavorite("task", taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });
  const followMut = useMutation({
    mutationFn: () => nexusApi.toggleFollow(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-followers", taskId] }),
  });
  const setCfMut = useMutation({
    mutationFn: ({ id, value }: { id: string; value: unknown }) => nexusApi.setCustomFieldValue(id, taskId, value),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["task-cf", taskId] }); if (projectId) qc.invalidateQueries({ queryKey: ["gideon-autofill", projectId] }); },
  });
  const [cfAdding, setCfAdding] = useState(false);
  const createCf = useMutation({
    mutationFn: (payload: { name: string; type: string; options: NexusCustomFieldOptions | null }) => nexusApi.createCustomField(projectId!, payload),
    onSuccess: () => {
      setCfAdding(false);
      qc.invalidateQueries({ queryKey: ["task-cf", taskId] });
      qc.invalidateQueries({ queryKey: ["project-custom-fields", projectId] });
    },
    onError: (e: unknown) => toast.error(tr("Couldn't create field"), { description: e instanceof Error ? e.message : tr("You need LEAD access.") }),
  });
  const linkProjectMut = useMutation({
    mutationFn: async (projectId: string) => {
      const proj = await nexusApi.project(projectId);
      const listId = proj.taskLists?.[0]?.id;
      if (!listId) throw new Error("Project has no list");
      return nexusApi.linkTaskProject(taskId, projectId, listId);
    },
    onSuccess: () => { setShowProjPicker(false); qc.invalidateQueries({ queryKey: ["task", taskId] }); },
  });
  const unlinkProjectMut = useMutation({
    mutationFn: (projectId: string) => nexusApi.unlinkTaskProject(taskId, projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const delTask = useMutation({
    mutationFn: () => nexusApi.deleteTask(taskId),
    onSuccess: (res) => {
      invalidateAll();
      requestClose();
      // Undo (toast + Ctrl/⌘+Z on the project) puts it back while the server allows (C-BUG-16).
      const auditId = res?.auditLogId;
      if (auditId) pushUndo(tr("Task deleted"), async () => { await nexusApi.undoDeleteTasks([auditId]); settleTaskWrite(qc, projectId, taskId); });
    },
    onError: (e: unknown) => toast.error(tr("Couldn't delete the task."), { description: friendlyError(e) }),
  });

  const currentUserId = comments.data?.currentUserId;
  const assignedIds = useMemo(() => new Set((t?.assignees ?? []).map((a) => a.user?.id).filter(Boolean) as string[]), [t]);
  // Assignable = the PROJECT's team (the members linked to this project), not the whole workspace.
  // Falls back to all members only when the task has no project. Then filter out already-assigned + search.
  const projectMembers = useMemo(() => ((projDetail.data?.members ?? []).map((m) => m.user).filter(Boolean) as NexusUser[]), [projDetail.data]);
  const assignableMembers = useMemo(() => {
    const pool = projectId ? projectMembers : toMembers(membersQuery.data);
    const q = assignSearch.trim().toLowerCase();
    return pool.filter((m) => m.id && !assignedIds.has(m.id) && (!q || (m.name ?? "").toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q)));
  }, [projectId, projectMembers, membersQuery.data, assignedIds, assignSearch]);
  const assignPickerLoading = projectId ? projDetail.isLoading : membersQuery.isLoading;

  if (typeof document === "undefined") return null;

  const sortedComments = [...(comments.data?.comments ?? [])].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
  const me = projectMembers.find((m) => m.id === currentUserId) ?? (currentUserId ? ({ id: currentUserId } as NexusUser) : null);
  const done = isDoneStatus(t?.status);

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-0 sm:p-4">
      <motion.div
        className="absolute inset-0 bg-foreground/30 dark:bg-scrim backdrop-blur-sm"
        style={{ opacity: backdropO }}
        onClick={requestClose}
      />
      {/* Centered modal that MORPHS out of the clicked card (manual FLIP, no layoutId). The box (mx/my +
          scaleX/scaleY) is mapped from the card's rect with transform-origin top-left; content fades in
          just after the box starts so the stretch isn't visible. */}
      {/* A fixed height on desktop (perf pass, 12 Oct 2026): the box no longer grows and re-centres while the task,
          its fields and comments load in, so nothing jumps (it was the page's biggest layout shift) and the
          morph's measured rect stays true. */}
      <motion.aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label={task.data?.title || tr("Task")}
        style={{ x: mx, y: my, scaleX: msx, scaleY: msy, opacity: asideO, transformOrigin: "top left", pointerEvents: closing ? "none" : undefined, ...(morph ? { borderRadius: 24 } : null) }}
        className="relative z-10 flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden border-border bg-card shadow-pop sm:h-[min(92dvh,900px)] sm:max-h-[92dvh] sm:rounded-3xl sm:border"
      >
            {/* inner scroll region — separate from the animated shell so the transform never breaks scrolling on iOS.
                During the morph the content fades in just after the box starts so it doesn't look stretched. */}
            <motion.div
              initial={morph ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ delay: morph ? 0.05 : 0, duration: 0.16 }}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
            >
        {/* Top bar, quiet like a Notion page's: open as page + the breadcrumb on the left; on the right the actions
            people use (watch, favourite, like, the BoD quest), the rest (copy, delete) behind ···, then Close.
            Phone: 44px targets, the breadcrumb on its own line under the actions. */}
        <div className="sticky top-0 z-10 flex flex-col-reverse gap-0.5 bg-card/90 px-4 pb-2 pt-1.5 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {!asPage && (
              <Link to="/tasks/$taskId" params={{ taskId }} className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" title={tr("Open as page")} aria-label={tr("Open as page")}><Maximize2 className="h-4 w-4" /></Link>
            )}
            {t?.taskList?.project && (
              <>
                <ProjectMarkFor projectId={t.taskList.project.id} icon={(t.taskList.project as { icon?: string | null }).icon} size={16} />
                <span className="truncate">{t.taskList.project.name}</span>
                <span className="text-muted-foreground/50">/</span>
                <span className="truncate">{t.taskList?.name}</span>
              </>
            )}
          </div>
          <div className="-mr-2 flex items-center justify-end gap-0.5 sm:mr-0">
            {/* Task actions only once there IS a task: a deleted or foreign task kept Watch/Star/Like/Move/Delete
                live over its error (QA 13 Oct 2026). Close stays. */}
            {t && (<>
            <button
              onClick={() => followMut.mutate()}
              className={cn("inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors active:scale-[0.97] sm:h-8 sm:min-w-8", followers.data?.isFollowing ? "text-primary" : "text-muted-foreground hover:bg-accent")}
              title={followers.data?.isFollowing ? tr("Following") : tr("Follow")}
              aria-label={followers.data?.isFollowing ? tr("Following") : tr("Follow")}
              aria-pressed={!!followers.data?.isFollowing}
            >
              <Eye className="h-4 w-4" /> <span className="tabular-nums">{followers.data?.followers?.length ?? 0}</span>
            </button>
            <button
              onClick={() => favMut.mutate()}
              className={cn("grid h-11 w-11 place-items-center rounded-lg transition-colors active:scale-[0.95] sm:h-8 sm:w-8", isFavorited ? "text-amber-500" : "text-muted-foreground hover:bg-accent")}
              title={tr("Favorite")}
              aria-label={tr("Favorite")}
              aria-pressed={isFavorited}
            >
              <Star className={cn("h-4 w-4", isFavorited && "fill-amber-500")} />
            </button>
            <button
              onClick={() => likeMut.mutate(!t?.liked)}
              // POST on this route TOGGLES, so a double-click sent two POSTs and the second one took
              // the like straight back off. One request at a time.
              disabled={likeMut.isPending}
              className={cn("inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors active:scale-[0.97] disabled:opacity-60 sm:h-8 sm:min-w-8", t?.liked ? "text-destructive" : "text-muted-foreground hover:bg-accent")}
              title={tr("Like")}
              aria-label={tr("Like")}
              aria-pressed={!!t?.liked}
            >
              <Heart className={cn("h-4 w-4", t?.liked && "fill-destructive")} /> <span className="tabular-nums">{t?.likeCount ?? 0}</span>
            </button>
            {canMakeQuest && (
              <button onClick={() => setQuestOpen(true)} className="hidden h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary sm:grid" title={tr("Make a quest")} aria-label={tr("Make a quest")}>
                <Trophy className="h-4 w-4" />
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent data-[state=open]:bg-accent sm:h-8 sm:w-8" title={tr("More actions")} aria-label={tr("More actions")}>
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[60] w-60">
                {canMakeQuest && (
                  <DropdownMenuItem onSelect={() => setQuestOpen(true)} className="min-h-9 sm:hidden"><Trophy className="h-4 w-4" />{tr("Make a quest")}</DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setCopyOpen(true)} className="min-h-9"><FolderInput className="h-4 w-4" />{tr("Copy to another project")}</DropdownMenuItem>
                {!asPage && (
                  <DropdownMenuItem asChild className="min-h-9"><Link to="/tasks/$taskId" params={{ taskId }}><Maximize2 className="h-4 w-4" />{tr("Open as page")}</Link></DropdownMenuItem>
                )}
                {canDeleteTask && <DropdownMenuSeparator />}
                {canDeleteTask && <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="min-h-9 text-destructive focus:text-destructive"><Trash2 className="h-4 w-4" />{tr("Delete task")}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            </>)}
            <button onClick={requestClose} className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent sm:h-8 sm:w-8" title={tr("Close")} aria-label={tr("Close")}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>{tr("Delete this task?")}</AlertDialogTitle>
              <AlertDialogDescription>{canOpenAudit ? tr("The task is deleted and can be restored from Control Room → Audit for 90 days.") : tr("The task is deleted. A manager or the board can restore it for 90 days if you need it back.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => delTask.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{tr("Delete task")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!confirmAtt} onOpenChange={(o) => { if (!o) setConfirmAtt(null); }}>
          <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmAtt?.kind === "PROOF" ? tr("Delete this payout proof?") : tr("Delete this attachment?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {tr("“{name}” is removed from the task.", { name: confirmAtt?.name || tr("(unnamed)") })}{" "}
                {confirmAtt?.kind === "PROOF" ? tr("Finance uses it as evidence of the payment.") + " " : ""}
                {canOpenAudit ? tr("Control Room → Audit can restore it for 90 days.") : tr("A manager or the board can restore it for 90 days.")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { if (confirmAtt) delAttachment.mutate(confirmAtt.id); setConfirmAtt(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{tr("Delete")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {task.isLoading && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        )}
        {task.isError && !t && (
          <LoadError error={task.error} what={tr("this task")} onRetry={() => void task.refetch()}
            notFoundTitle={tr("This task doesn't exist any more")} notFoundMessage={tr("It was deleted, or the link is wrong. A board member or manager can restore a deleted task from Control Room → Audit for 90 days.")}
            forbiddenTitle={tr("You can't open this task")} forbiddenMessage={tr("It's in a project you're not a member of. Ask its Project Owner to add you.")}
            action={<EmptyAction onClick={requestClose}>{tr("Close")}</EmptyAction>} />
        )}

        {t && (
          // The task as a page (16 Oct 2026, Notion's anatomy in NEXUS's look): title, one row per property, the
          // comments, then the body; subtasks, attachments and activity follow as sections.
          <div className="flex flex-1 flex-col gap-6 px-5 pb-10 pt-3 sm:px-12 sm:pt-6">
            {/* Quest nudge: this task is part of one or more task-bundle quests → motivate finishing it. */}
            {(t.quests ?? []).map((q) => (
              <div key={q.id} className="flex items-center gap-2.5 rounded-2xl border border-primary/30 bg-primary/5 px-3.5 py-2.5">
                <Trophy className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-bold text-primary">
                    {(q.total ?? 1) <= 1 ? <>{tr("Finish this task →")} <span className="tabular-nums">+{q.xpReward} XP</span></> : <>{tr("Part of the quest “{title}” →", { title: q.title })} <span className="tabular-nums">+{q.xpReward} XP</span></>}
                  </div>
                  {(q.total ?? 1) > 1 && <div className="text-xs text-muted-foreground">{tr("Finish all {total} tasks ({done}/{total} done) to get the XP.", { total: q.total ?? 0, done: q.done ?? 0 })}</div>}
                </div>
              </div>
            ))}
            {!canEditTask && (
              <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{lvl === "COMMENT" ? tr("You can comment on this task, but not change it.") : tr("View only: you can read this task, but not change it.")}</p>
            )}
            <fieldset disabled={!canEditTask} className="contents [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-60 [&_input:disabled]:opacity-60">
            <div className="flex flex-col gap-2">
              {/* parent breadcrumb — this task is a SUBTASK; tap to open the parent */}
              {t.parent && (
                <button
                  onClick={() => setOpenSub(t.parent!.id)}
                  className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground transition hover:opacity-80"
                >
                  <ListChecks className="h-3 w-3 shrink-0" />
                  <span className="shrink-0 text-accent-foreground/70">{tr("Subtask of")}</span>
                  <span className="truncate">{t.parent.title}</span>
                </button>
              )}
              {/* title: the page heading */}
              <textarea
                ref={titleRef}
                value={title}
                aria-label={tr("Task title")}
                data-keep-font
                onChange={(e) => { titleDirty.current = true; setTitle(e.target.value.replace(/\n/g, " ")); }}
                onBlur={commitTitle}
                // A title is one line (C-BUG-25): Enter saves it, it never adds a line break.
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); } }}
                rows={1}
                placeholder={tr("Untitled")}
                className="w-full resize-none overflow-hidden rounded-lg bg-transparent font-display text-[1.75rem] font-bold leading-tight tracking-tight text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:bg-muted/40 sm:text-[2rem]"
              />
            </div>

            {/* Properties: one row each, the name on the left, the value on the right reading as text until hovered. */}
            <div role="list" aria-label={tr("Properties")} className="-mx-1.5 flex flex-col">
              <PropRow icon={Loader} label={tr("Status")}>
                <div className="flex min-w-0 items-center gap-1">
                  {/* Done is a tick on the Status row (it was the big "Mark done" button). */}
                  <button type="button" onClick={() => update.mutate({ status: (done ? "TODO" : "DONE") as never })} aria-pressed={done} aria-label={done ? tr("Move back to To-do") : tr("Mark done")} title={done ? tr("Move back to To-do") : tr("Mark done")} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors pointer-coarse:h-11 pointer-coarse:w-11", done ? "text-success" : "text-muted-foreground/60 hover:bg-success/10 hover:text-success")}>
                    {done ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <Circle className="h-[18px] w-[18px]" />}
                  </button>
                  {/* Section = the project's board column (TaskList). Falls back to global status if the
                      task isn't in a project (no sections). */}
                  {sections.length > 0 && projectId && usesStatusOptions(sections) ? (
                    // Status = the project's status options, grouped To-do / In progress / Complete (owner,
                    // 12 Oct 2026, Notion's picker). Picking one moves the task there; the server sets its status.
                    <StatusPicker
                      projectId={projectId}
                      sections={sections}
                      value={t.taskListId}
                      onPick={(id) => update.mutate({ taskListId: id } as never)}
                      trigger={
                        <button type="button" className="group/sp inline-flex min-h-8 min-w-0 items-center gap-1 rounded-lg px-1.5 transition-colors hover:bg-muted data-[state=open]:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" aria-label={tr("Status")}>
                          <StatusPill option={sections.find((x) => x.id === t.taskListId) ?? null} size="md" />
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/sp:opacity-100 pointer-coarse:opacity-100" />
                        </button>
                      }
                    />
                  ) : sections.length > 0 ? (
                    <SelectPicker
                      ariaLabel={tr("Section")}
                      value={t.taskListId ?? ""}
                      onChange={(v) => update.mutate({ taskListId: v } as never)}
                      options={sections.map((s) => ({ value: s.id, label: s.name }))}
                      className="max-w-full"
                    />
                  ) : (
                    <SelectPicker
                      ariaLabel={tr("Status")}
                      value={t.status ?? "TODO"}
                      onChange={(v) => update.mutate({ status: v as never })}
                      options={STATUS_OPTIONS.map((s) => ({ value: s, label: statusLabel(s), color: optionColor("status", s, []) }))}
                      className="max-w-full"
                    />
                  )}
                </div>
              </PropRow>
              <PropRow icon={Flag} label={tr("Priority")}>
                <SelectPicker
                  ariaLabel={tr("Priority")}
                  value={t.priority ?? "NONE"}
                  onChange={(v) => update.mutate({ priority: v as never })}
                  options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: statusLabel(p), color: optionColor("priority", p, []) }))}
                  className="max-w-full"
                />
              </PropRow>
              <PropRow icon={Users} label={tr("Assignees")}>
                <div className="flex min-h-8 flex-wrap items-center gap-1.5 px-1">
                  {(t.assignees ?? []).map((a) => (
                    <span key={a.user?.id} className="group inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-1.5 text-sm">
                      <MiniAvatar user={a.user} size={22} /> {a.user?.name}
                      {a.user?.deactivatedAt && <PersonLeftTag />}
                      <button aria-label={tr("Remove {name}", { name: a.user?.name ?? tr("assignee") })} onClick={() => a.user?.id && assignMut.mutate({ userId: a.user.id, add: false })} className="grid place-items-center rounded-full p-0.5 text-muted-foreground hover:text-destructive pointer-coarse:-m-3.5 pointer-coarse:size-11"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <div className="relative">
                    <button aria-label={tr("Add assignee")} onClick={() => { setAssignSearch(""); setShowAssignPicker((v) => !v); }} className={cn("inline-flex h-7 items-center gap-1 rounded-full text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11", (t.assignees?.length ?? 0) === 0 ? "px-1" : "w-7 justify-center pointer-coarse:w-11")}>
                      {(t.assignees?.length ?? 0) === 0 ? <span className="text-muted-foreground/70">{tr("Not set")}</span> : <Plus className="h-4 w-4" />}
                    </button>
                    {showAssignPicker && (
                      <div className="absolute z-20 mt-1 w-64 rounded-xl border border-border bg-popover p-1 shadow-pop">
                        <div className="relative p-1">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input autoFocus value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} placeholder={tr("Search team members…")} className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none transition focus:border-primary" />
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {assignPickerLoading && <div className="px-3 py-2 text-xs text-muted-foreground">{tr("Loading…")}</div>}
                          {!assignPickerLoading && assignableMembers.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">{assignSearch.trim() ? tr("No matching members.") : tr("Everyone on the project team is already assigned.")}</div>}
                          {assignableMembers.map((m) => (
                            <button key={m.id} onClick={() => assignMut.mutate({ userId: m.id, add: true })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent">
                              <MiniAvatar user={m} size={22} /> <span className="truncate">{m.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </PropRow>
              <PropRow icon={Calendar} label={tr("Due date")}>
                {/* Date + optional time; DateField returns a UTC ISO string for the API. */}
                <DateField withTime value={t.dueDate ?? null} onChange={(v) => update.mutate({ dueDate: v })} ariaLabel={tr("Due date")} placeholder={tr("Not set")} className="rounded-lg" />
              </PropRow>
              {/* who created it — every task, not only projects with a CREATED field (owner, 8 Oct 2026) */}
              {t.creator?.name && (
                <PropRow icon={UserRound} label={tr("Created by")}>
                  <CreatedByLine creator={t.creator} createdAt={t.createdAt ?? null} />
                </PropRow>
              )}
              {/* the project's fields, each a row */}
              {projectId && (customFields.data?.fields ?? []).map((f) => (
                <PropRow key={f.id} icon={fieldIcon(f.type)} label={f.name}
                  aside={ai.aiFields.has(f.id) ? <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-primary/80" title={ai.isMarked(f.id, taskId) ? "GIDEON" : tr("AI Autofill")}><Sparkles className="h-3 w-3" />{ai.isMarked(f.id, taskId) ? "AI" : null}</span> : null}>
                  <CustomFieldInput field={f} projectId={projectId} creatorLeft={!!t.creator?.deactivatedAt} onSet={(value) => setCfMut.mutate({ id: f.id, value })} bare />
                </PropRow>
              ))}
              {/* also in projects (multi-project links) */}
              <PropRow icon={FolderPlus} label={tr("Also in projects")} hint={tr("Mention another division by linking this task to another project in the same workspace.")}>
                <div className="flex min-h-8 flex-wrap items-center gap-1.5 px-1">
                  {(t.taskProjects ?? []).map((tp) => (
                    <span key={tp.id} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-sm">
                      <ProjectMarkFor projectId={tp.project?.id} icon={tp.project ? (tp.project as { icon?: string | null }).icon : null} size={14} /> {tp.project?.name}
                      <button aria-label={tr("Unlink {name}", { name: tp.project?.name ?? tr("project") })} onClick={() => tp.project?.id && unlinkProjectMut.mutate(tp.project.id)} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <div className="relative">
                    <button aria-label={tr("Link to another project")} title={tr("Mention another division by linking this task to another project in the same workspace.")} onClick={() => setShowProjPicker((v) => !v)} className={cn("inline-flex h-7 items-center rounded-full text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11", (t.taskProjects?.length ?? 0) === 0 ? "px-1" : "w-7 justify-center pointer-coarse:w-11")}>
                      {(t.taskProjects?.length ?? 0) === 0 ? <span className="text-muted-foreground/70">{tr("Only in its home project.")}</span> : <Plus className="h-4 w-4" />}
                    </button>
                    {showProjPicker && (
                      <div className="absolute left-0 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-pop">
                        {candidateProjects.isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">{tr("Loading…")}</div>}
                        {(candidateProjects.data ?? []).filter((p) => p.id !== projectId && !(t.taskProjects ?? []).some((tp) => tp.project?.id === p.id)).map((p) => (
                          <button key={p.id} onClick={() => linkProjectMut.mutate(p.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"><ProjectMarkFor projectId={p.id} icon={(p as { icon?: string | null }).icon} size={16} /><span className="truncate">{p.name}</span></button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </PropRow>
              {/* "+ Add a property": a new project field, made right here */}
              {projectId && !cfAdding && canEditTask && (
                <button type="button" onClick={() => setCfAdding(true)} className="mt-0.5 flex h-9 items-center gap-2 rounded-lg px-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 pointer-coarse:h-11">
                  <Plus className="h-4 w-4" /> {tr("Add a property")}
                </button>
              )}
              {cfAdding && (
                <div className="mt-2 rounded-xl border border-border p-3 shadow-soft">
                  <FieldEditor saving={createCf.isPending} onSave={(p) => createCf.mutate(p)} onCancel={() => setCfAdding(false)} />
                </div>
              )}
            </div>
            </fieldset>

            {/* comments: open for Can comment too, so outside the editing fieldset */}
            <section aria-label={tr("Comments")} className="border-b border-border/70 pb-5">
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{tr("Comments")}</h3>
              <div className="space-y-4">
                {sortedComments.map((c) => (
                  <CommentItem key={c.id} comment={c} currentUserId={currentUserId} me={me} members={projectMembers} canReply={canCommentTask}
                    onReact={(commentId, emoji, has) => reactMut.mutate({ commentId, emoji, has })}
                    onDelete={(commentId) => delComment.mutate(commentId)}
                    onEdit={(commentId, content) => editComment.mutateAsync({ commentId, content }).then(() => true, () => false)}
                    replyPending={replyComment.isPending}
                    onReply={(content, mentionedUserIds) => replyComment.mutateAsync({ parentId: c.id, content, mentionedUserIds }).then(() => true, () => false)} />
                ))}
                {canCommentTask && <CommentComposer me={me} members={projectMembers} pending={addComment.isPending} draftKey={`nx-comment-draft:${taskId}`} onSubmit={(content, mentionedUserIds) => addComment.mutateAsync({ content, mentionedUserIds }).then(() => true, () => false)} />}
                {!canCommentTask && sortedComments.length === 0 && comments.data && <p className="text-sm text-muted-foreground">{tr("No comments yet.")}</p>}
              </div>
            </section>

            <fieldset disabled={!canEditTask} className="contents [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-60 [&_input:disabled]:opacity-60">
            {/* the page body: the description is the page itself (a block document: slash menu, @mentions, live) */}
            {/* An empty body is one placeholder line (Notion), not a tall blank band. */}
            <div aria-label={tr("Description")} className="-mt-1">
              <Suspense fallback={<div className="h-7 animate-pulse rounded-md bg-muted/40" aria-busy />}>
                <TaskBodyEditor taskId={t.id} projectId={projectId ?? null} onOpenTask={setOpenSub} />
              </Suspense>
            </div>

            {/* subtasks — Asana-style: each is a full task (own assignee/due/comments), hidden
                from the board; tap the circle to toggle done, tap the title to open its panel */}
            {(() => {
              const subs = t.subtasks ?? [];
              const doneCount = subs.filter((s) => s.status === "DONE").length;
              return (
                <SecCard icon={ListChecks} label={subs.length > 0 ? `${tr("Subtasks")} · ${doneCount}/${subs.length}` : tr("Subtasks")}>
                  {subs.length > 0 && (
                    <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-success transition-all" style={{ width: `${subs.length ? Math.round((doneCount / subs.length) * 100) : 0}%` }} />
                    </div>
                  )}
                  {subs.length > 0 && (
                    <div className="-mx-1.5">
                      {subs.map((st) => (
                        <div key={st.id} className="flex min-h-9 items-center gap-2 rounded-lg px-1.5 text-sm transition-colors hover:bg-muted/60">
                          <button
                            onClick={() => toggleSubtask.mutate({ id: st.id, done: st.status !== "DONE" })}
                            disabled={toggleSubtask.isPending}
                            title={st.status === "DONE" ? tr("Move back to To-do") : tr("Mark done")}
                            aria-label={st.status === "DONE" ? tr("Move back to To-do") : tr("Mark done")}
                            className="shrink-0 transition active:scale-90 disabled:opacity-50"
                          >
                            {st.status === "DONE"
                              ? <CheckCircle2 className="h-[18px] w-[18px] text-success" />
                              : <Circle className="h-[18px] w-[18px] text-muted-foreground/50 hover:text-success" />}
                          </button>
                          <button onClick={() => setOpenSub(st.id)} className={cn("min-w-0 flex-1 truncate py-1.5 text-left hover:text-primary", st.status === "DONE" && "text-muted-foreground line-through")}>
                            {st.title}
                          </button>
                          {st.dueDate && <span className="shrink-0 text-xs text-muted-foreground">{fmtDue(st.dueDate)}</span>}
                          {(st.assignees ?? []).slice(0, 2).map((a, i) =>
                            <MiniAvatar key={a.user?.id ?? i} user={a.user} size={20} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* inline add — Enter spawns a real task linked to this one.
                      Needs a project home (taskList) so the backend can validate the parent. */}
                  {!!projectId && !!t.taskList?.id && canEditTask && (
                  <div className="-mx-1.5 flex min-h-9 items-center gap-2 rounded-lg px-1.5 text-sm transition-colors focus-within:bg-muted/60 hover:bg-muted/60">
                    {addSubtask.isPending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <input
                      value={newSubTitle}
                      aria-label={tr("Add subtask")}
                      onChange={(e) => setNewSubTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newSubTitle.trim() && !addSubtask.isPending) addSubtask.mutate(newSubTitle.trim()); }}
                      placeholder={tr("Add subtask… (Enter)")}
                      className="min-w-0 flex-1 bg-transparent py-1.5 outline-none placeholder:text-muted-foreground"
                    />
                    {newSubTitle.trim() && (
                      <button aria-label={tr("Add subtask")}
                        onClick={() => { if (newSubTitle.trim()) addSubtask.mutate(newSubTitle.trim()); }}
                        disabled={addSubtask.isPending}
                        className="inline-flex h-7 shrink-0 items-center rounded-full bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.97] disabled:opacity-40"
                      >
                        {tr("Add")}
                      </button>
                    )}
                  </div>
                  )}
                  {addSubtask.isError && <p className="mt-1 text-[11px] font-semibold text-destructive">{(addSubtask.error as Error)?.message ?? tr("Couldn't add subtask.")}</p>}
                </SecCard>
              );
            })()}

            {/* attachments */}
            <SecCard
              icon={Paperclip}
              label={tr("Attachments")}
              action={
                // Can view / Can comment: no Upload (it read as live in the disabled fieldset, QA 16 Oct 2026).
                !canEditTask ? undefined : <div className="flex items-center gap-2">
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">{tr("Max {size}", { size: MAX_ATTACH_LABEL })}</span>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                    {uploadMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {tr("Upload")}
                    <input type="file" multiple className="hidden" disabled={uploadMut.isPending} onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []); e.target.value = "";
                      if (!picked.length) return;
                      const tooBig = picked.filter((f) => f.size > MAX_ATTACH_BYTES);
                      const ok = picked.filter((f) => f.size <= MAX_ATTACH_BYTES);
                      setSizeWarn(tooBig.length ? tr("The file is {mb} MB, over the {max} limit. Upload rejected.", { mb: (tooBig[0].size / 1024 / 1024).toFixed(1), max: MAX_ATTACH_LABEL }) : null);
                      if (ok.length) uploadMut.mutate(ok);
                    }} />
                  </label>
                </div>
              }
            >
              <div className="space-y-1.5">
                {uploadPct != null && (
                  <div className="rounded-xl border border-border bg-background px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-semibold text-muted-foreground">{tr("Uploading…")}</span>
                      <span className="font-bold tabular-nums text-primary">{uploadPct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all duration-150" style={{ width: `${uploadPct}%` }} />
                    </div>
                  </div>
                )}
                {(attachments.data ?? []).map((att) => (
                  <div key={att.id} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                    {mediaKind(att) === "image" && att.url ? (
                      <button aria-label={tr("Preview")} onClick={() => setPreviewAtt(att)} className="shrink-0"><img src={att.url} alt="" className="h-9 w-9 rounded-md object-cover" /></button>
                    ) : (
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <button onClick={() => setPreviewAtt(att)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-primary hover:underline">{att.name || tr("(unnamed)")}</button>
                    {/* Payout proofs are ordinary attachments since 12 Oct 2026; files released apps still upload
                        as kind PROOF keep a small tag so finance can tell them apart. */}
                    {att.kind === "PROOF" && <span className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">{tr("Payout proof")}</span>}
                    {att.size != null && <span className="shrink-0 text-xs text-muted-foreground">{Math.round(att.size / 1024)} KB</span>}
                    <button onClick={() => setPreviewAtt(att)} aria-label={tr("Preview")} title={tr("Preview")} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Eye className="h-3.5 w-3.5" /></button>
                    {att.url && <a href={`${att.url}?download=${encodeURIComponent(att.name || "file")}`} download={att.name || ""} aria-label={tr("Download")} title={tr("Download")} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Download className="h-3.5 w-3.5" /></a>}
                    {canEditTask && <button aria-label={tr("Delete attachment")} onClick={() => setConfirmAtt(att)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                ))}
                {(attachments.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">{tr("No attachments.")}</p>}
                {sizeWarn && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-300/60 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {sizeWarn}
                  </div>
                )}
                {uploadMut.isError && <p className="text-xs font-semibold text-destructive">{(uploadMut.error as Error)?.message || tr("Upload failed. Max {size}.", { size: MAX_ATTACH_LABEL })}</p>}
              </div>
            </SecCard>

            {previewAtt && createPortal(
              <div className="fixed inset-0 z-[90] grid place-items-center p-4" onClick={() => setPreviewAtt(null)}>
                <div className="absolute inset-0 bg-foreground/60 dark:bg-scrim backdrop-blur-sm" />
                <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{previewAtt.name || tr("Preview")}</div>
                      <div className="truncate text-xs text-muted-foreground">{previewAtt.mimeType ?? tr("file")}{previewAtt.size != null ? ` · ${Math.round(previewAtt.size / 1024)} KB` : ""}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {previewAtt.url && <a href={`${previewAtt.url}?download=${encodeURIComponent(previewAtt.name || "file")}`} download={previewAtt.name || ""} aria-label={tr("Download")} title={tr("Download")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><Download className="h-4 w-4" /></a>}
                      <button onClick={() => setPreviewAtt(null)} aria-label={tr("Close")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto bg-muted/30 p-2">
                    {(() => {
                      if (!previewAtt.url) return null;
                      const kind = mediaKind(previewAtt);
                      // Cache-bust for range-able no-store media (video/audio/pdf); images stay immutably cached.
                      const rangeSrc = `${previewAtt.url}${previewAtt.url.includes("?") ? "&" : "?"}inline=3`;
                      if (kind === "image") return <img src={previewAtt.url} alt={previewAtt.name ?? ""} className="mx-auto max-h-[75vh] rounded-lg object-contain" />;
                      if (kind === "pdf") return (
                        // Safari PDFKit needs range-able responses; the cache-bust + server no-store keeps CF
                        // from serving a stale full-200 for a Range request (which renders blank white).
                        <iframe src={rangeSrc} title={tr("Preview")} className="h-[75vh] w-full rounded-lg bg-white" />
                      );
                      if (kind === "video") return (
                        <div>
                          {/* playsInline + cache-bust: iOS needs inline + a non-stale (range-able) CF response. */}
                          <video src={rangeSrc} controls playsInline preload="metadata" className="mx-auto max-h-[72vh] rounded-lg" />
                          {maybeUnplayableVideo(previewAtt) && (
                            <p className="mx-auto mt-2 max-w-md text-center text-[11px] text-muted-foreground">
                              {tr("The .mov (HEVC) format often won't play on Android or in a webview. If the screen stays black, download it to watch.")}
                            </p>
                          )}
                        </div>
                      );
                      if (kind === "audio") return <audio src={rangeSrc} controls preload="metadata" className="mx-auto mt-8 w-full" />;
                      return (
                        <div className="grid place-items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                          <Paperclip className="h-8 w-8" />
                          {tr("Preview isn't available for this file type.")}
                          <a href={`${previewAtt.url}?download=${encodeURIComponent(previewAtt.name || "file")}`} download={previewAtt.name || ""} className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">{tr("Download")}</a>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>,
              document.body,
            )}

            </fieldset>

            {/* activity */}
            {(t.activityLogs?.length ?? 0) > 0 && (
              <SecCard icon={Activity} label={tr("Activity")}>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  {t.activityLogs!.slice(0, 12).map((a) => (
                    <div key={a.id} className="flex gap-2">
                      <span className="font-semibold text-foreground/80">{displayName(a.user, tr("Someone"))}</span>
                      <span className="flex-1">{activityText(a.details, statusLabel(a.action))}</span>
                      <span className="shrink-0 text-muted-foreground/70">{fmtDate(a.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </SecCard>
            )}
          </div>
        )}
            </motion.div>
          </motion.aside>
          {/* Nested panel: a subtask (or the parent, via the breadcrumb) opens stacked on top of
              this one — recursive, so sub-subtasks work; no morphId (plain fade, no card source). */}
          {openSub && <TaskDetailPanel taskId={openSub} onClose={() => setOpenSub(null)} />}
          {questOpen && t && <QuestComposer initialTask={{ id: t.id, title: t.title }} onClose={() => setQuestOpen(false)} />}
          {copyOpen && t && <CopyToProjectDialog taskIds={[t.id]} sourceProjectId={projectId} onClose={() => setCopyOpen(false)} />}
    </div>,
    document.body,
  );
}

// BoD-only: bundle this (and more) task(s) into a `specific_tasks` quest. Complete = all tasks DONE; XP
// goes to whoever did them; visible to those tasks' project members.
function QuestComposer({ initialTask, onClose }: { initialTask: { id: string; title: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const { t: tr } = useLang();
  const [title, setTitle] = useState(initialTask.title);
  const [xp, setXp] = useState(50);
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([initialTask]);
  const [search, setSearch] = useState("");
  const taskSearch = useQuery({
    queryKey: ["quest-task-search", search],
    queryFn: () => nexusApi.tasks(`search=${encodeURIComponent(search.trim())}`),
    enabled: search.trim().length >= 2,
    staleTime: 10_000,
  });
  const results = (taskSearch.data ?? []).filter((r) => !tasks.some((t) => t.id === r.id)).slice(0, 8);
  const create = useMutation({
    mutationFn: () => nexusApi.createAdminQuest({ title: title.trim() || tr("Quest"), xpReward: xp, requirementType: "specific_tasks", taskIds: tasks.map((t) => t.id) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gamification", "me"] }); toast.success(tr("Quest created")); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : tr("Couldn't create the quest")),
  });
  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 dark:bg-scrim p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2"><Trophy className="h-5 w-5 text-primary" /><h3 className="text-lg font-bold">{tr("Make a quest")}</h3></div>
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{tr("Quest title")}</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="mb-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" placeholder={tr("Quest name")} />
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{tr("XP reward (max 50)")}</label>
        <input type="number" min={0} max={50} value={xp} onChange={(e) => setXp(Math.max(0, Math.min(50, Number(e.target.value) || 0)))} className="mb-3 block w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{tr("Tasks")} ({tasks.length})</label>
        <div className="mb-2 space-y-1">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <button aria-label={tr("Remove {name}", { name: t.title })} onClick={() => setTasks((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== t.id) : prev))} disabled={tasks.length <= 1} className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-xl border border-dashed border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" placeholder={tr("+ Search tasks to add (min 2 letters)…")} />
        {results.length > 0 && (
          <div className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border bg-popover p-1">
            {results.map((r) => (
              <button key={r.id} onClick={() => { setTasks((prev) => [...prev, { id: r.id, title: r.title }]); setSearch(""); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> <span className="truncate">{r.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">{tr("Cancel")}</button>
          <button onClick={() => create.mutate()} disabled={create.isPending || tasks.length === 0 || !title.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {tr("Create quest")}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{tr("The quest completes once every task is done. XP goes to whoever did them; visible to the tasks' project members.")}</p>
      </div>
    </div>,
    document.body,
  );
}

function customFieldChoices(options: NexusCustomField["options"]): string[] {
  if (Array.isArray(options)) return options.map(String);
  if (options && typeof options === "object") {
    const o = options as { options?: unknown[]; choices?: unknown[] };
    if (Array.isArray(o.options)) return o.options.map(String);
    if (Array.isArray(o.choices)) return o.choices.map(String);
  }
  return [];
}

// "DD Mon YYYY • HH:mm" in Asia/Jakarta (matches the OLD NEXUS CREATED-field format).
function fmtCreatedDateTime(ts: string, locale: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const p = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const m = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${m.day} ${m.month} ${m.year} • ${m.hour}:${m.minute}`;
}

/** An empty table cell is blank, in every column alike (UI tour run 15, R15-WB-4: one rule for all columns; run 20
 *  decision 21, R20-WD-7: blank as Notion, the dashes were noise down whole columns). */
const EMPTY_CELL = "";

export function CustomFieldInput({ field, projectId, onSet, hideLabel, creatorLeft, bare }: { field: NexusCustomField; projectId?: string; onSet: (value: unknown) => void; hideLabel?: boolean; /** The task's creator was offboarded: the CREATED field marks them "Left". */ creatorLeft?: boolean;
  /** A property row of the task page: no label (the row has it), the value reads as text until hovered or
   *  clicked, "Empty" when there is none; unlike a table cell it keeps the full editors (a place's map link). */
  bare?: boolean }) {
  const { t: tr, locale } = useLang();
  const type = (field.type ?? "").toUpperCase();
  const choices = customFieldChoices(field.options);
  // In a table cell (hideLabel) or a property row (bare) the editor reads as plain text until hovered, like a Notion property.
  const ghost = hideLabel || bare;
  const empty = hideLabel ? EMPTY_CELL : bare ? tr("Not set") : undefined;
  const cls = ghost
    ? cn("w-full min-w-0 appearance-none truncate border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none transition-colors hover:bg-muted focus:border-primary focus:bg-background focus:placeholder:text-transparent", bare ? "min-h-8 rounded-lg placeholder:text-muted-foreground/70" : "rounded-md placeholder:text-muted-foreground/60")
    : "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary";

  const strVal = typeof field.value === "string" ? field.value : "";
  const arrVal = Array.isArray(field.value) ? field.value.map(String) : [];
  const placeInit = field.value && typeof field.value === "object" && !Array.isArray(field.value) ? (field.value as { label?: string; mapUrl?: string }) : { label: "", mapUrl: "" };

  const shownVal = type === "DATE" && strVal.includes("T") ? strVal.slice(0, 10) : strVal;
  const [local, setLocalState] = useState<string>(shownVal);
  const [place, setPlaceState] = useState({ label: placeInit.label ?? "", mapUrl: placeInit.mapUrl ?? "" });
  // The field follows the server (someone else's change shows at once) until you type in it; only what you
  // typed is written back, so a focus + blur never puts an old value over a newer one (C-BUG-18).
  const dirty = useRef(false);
  const setLocal = (v: string) => { dirty.current = true; setLocalState(v); };
  const setPlace = (f: (p: { label: string; mapUrl: string }) => { label: string; mapUrl: string }) => { dirty.current = true; setPlaceState(f); };
  const placeKey = JSON.stringify(field.value ?? null);
  useEffect(() => {
    if (dirty.current) return;
    setLocalState(shownVal);
    if (type === "PLACE") setPlaceState({ label: placeInit.label ?? "", mapUrl: placeInit.mapUrl ?? "" });
  }, [shownVal, placeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** On blur: write what was typed (once), else nothing. */
  const commit = (value: unknown, changed: boolean) => { if (!dirty.current) return; dirty.current = false; if (changed) onSet(value); };

  let body: ReactNode;
  if (type === "SELECT" || type === "STATUS") {
    body = (
      <SelectPicker
        value={strVal}
        onChange={(v) => onSet(v)}
        clearable
        placeholder={empty ?? tr("Not set")}
        ariaLabel={field.name}
        // A value no longer in the option list still shows (and stays pickable), as the <select> kept it.
        options={(strVal && !choices.includes(strVal) ? [...choices, strVal] : choices).map((c) => ({ value: c, label: c, color: choiceColor(field, c, choices) }))}
        variant={ghost ? "ghost" : "field"}
        className={hideLabel ? "w-full" : bare ? "max-w-full rounded-lg" : "min-h-[34px] w-full"}
      />
    );
  } else if (type === "MULTI_SELECT") {
    body = (
      <div className={cn("flex flex-wrap gap-1.5", bare && "px-1.5 py-1")}>
        {choices.map((c) => {
          const on = arrVal.includes(c);
          return (
            <button type="button" key={c} onClick={() => onSet(on ? arrVal.filter((x) => x !== c) : [...arrVal, c])} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors", on ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/40")}>
              {c}
            </button>
          );
        })}
        {choices.length === 0 && <span className="text-xs text-muted-foreground">{tr("No options.")}</span>}
      </div>
    );
  } else if (type === "PLACE" && hideLabel) {
    // A table cell keeps one line (UI tour run 14, WD-11: two stacked fields made the row taller): the
    // place's name, with its map link as an icon. The link itself is edited in the task.
    body = (
      <div className="flex min-w-0 items-center gap-1">
        <input value={place.label} onChange={(e) => { const v = e.target.value; setPlace((p) => ({ ...p, label: v })); }} onBlur={() => commit(place, true)} aria-label={field.name} placeholder={EMPTY_CELL} className={cls} />
        {place.mapUrl.trim() && <a href={place.mapUrl} target="_blank" rel="noopener noreferrer" aria-label={tr("Open map")} title={tr("Open map")} className="shrink-0 text-muted-foreground hover:text-primary"><MapPin className="h-3.5 w-3.5" /></a>}
      </div>
    );
  } else if (type === "PLACE") {
    body = (
      <div className={cn(bare ? "w-full space-y-0.5" : "space-y-1.5")}>
        <input value={place.label} onChange={(e) => { const v = e.target.value; setPlace((p) => ({ ...p, label: v })); }} onBlur={() => commit(place, true)} aria-label={field.name} placeholder={tr("Location / place name")} className={cls} />
        <input value={place.mapUrl} onChange={(e) => { const v = e.target.value; setPlace((p) => ({ ...p, mapUrl: v })); }} onBlur={() => commit(place, true)} aria-label={tr("Google Maps link")} placeholder={tr("Google Maps link")} className={cls} />
      </div>
    );
  } else if (type === "CREATED") {
    // Auto-filled "created/requested by": submitter name (from backend createdMeta = task creator) + when.
    const meta = field.createdMeta;
    const ts = (meta?.timestamp || strVal || "").trim();
    const name = meta?.userName?.trim();
    const when = ts ? fmtCreatedDateTime(ts, locale) : "";
    body = bare ? (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1.5 py-1 text-sm">
        {name ? <span className="text-foreground">{name}</span> : null}
        {name && creatorLeft && <PersonLeftTag />}
        <span className="text-muted-foreground">{name ? "· " : ""}{when || strVal || tr("Not set")}</span>
      </div>
    ) : (
      <div className="w-full rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
        {name ? <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">{name}{creatorLeft && <PersonLeftTag />}</div> : null}
        <div className={cn("text-muted-foreground", name ? "text-xs" : "text-sm")}>{when || strVal || "—"}</div>
      </div>
    );
  } else if (type === "URL" && ghost) {
    // One line in a table cell: the address, then an icon that opens it (WD-11).
    body = (
      <div className="flex min-w-0 items-center gap-1">
        <input type="url" value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => commit(local, local !== strVal)} aria-label={field.name} placeholder={bare ? "https://…" : EMPTY_CELL} className={cls} />
        {strVal.trim() && <a href={strVal} target="_blank" rel="noopener noreferrer" aria-label={tr("Open link")} title={tr("Open link")} className="shrink-0 text-muted-foreground hover:text-primary"><Link2 className="h-3.5 w-3.5" /></a>}
      </div>
    );
  } else if (type === "URL") {
    body = (
      <div className="space-y-1">
        <input type="url" value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => commit(local, local !== strVal)} placeholder="https://…" className={cls} />
        {strVal.trim() && (
          <a href={strVal} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            <Link2 className="h-3 w-3" /> {tr("Open link")}
          </a>
        )}
      </div>
    );
  } else if (type === "FILE") {
    body = <div className={cn(bare && "px-1.5 py-1")}><FileFieldEditor projectId={projectId} value={Array.isArray(field.value) ? (field.value as CustomFieldFile[]) : []} onSet={onSet} compact={hideLabel} /></div>;
  } else if (type === "NUMBER") {
    // The field's own format (Rupiah, Percent, a currency… and Bar / Ring), Indonesian grouping; a click edits.
    // Rupiah keeps its "Rp" box that groups while typing. In a table cell numbers sit right-aligned (Notion).
    body = <NumberFieldInput raw={strVal} fieldOptions={field.options} onSet={(v) => onSet(v)} ariaLabel={field.name} inline={ghost} align={hideLabel ? "end" : "start"} placeholder={empty ?? tr("Not set")} />;
  } else if (type === "DATE") {
    // Notion-style date: the day as text, a calendar on click; no "mm/dd/yyyy" in empty fields.
    body = <DateField value={local || null} onChange={(v) => { setLocalState(v ?? ""); onSet(v ?? ""); }} ariaLabel={field.name} className={hideLabel ? undefined : bare ? "rounded-lg" : "h-[34px] rounded-lg border border-border bg-background px-2.5 hover:bg-background hover:border-primary/40"} placeholder={empty ?? tr("Not set")} />;
  } else {
    body = (
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => commit(local, local !== shownVal)}
        aria-label={ghost ? field.name : undefined}
        placeholder={empty}
        className={cls}
      />
    );
  }

  if (hideLabel) return <div className="block">{body}</div>;
  if (bare) return <div className="flex w-full min-w-0 items-center">{body}</div>;
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-muted-foreground">{field.name}</span>
      {body}
    </label>
  );
}

function FileFieldEditor({ projectId, value, onSet, compact }: { projectId?: string; value: CustomFieldFile[]; onSet: (value: unknown) => void; /** A table cell: one line (WD-11). */ compact?: boolean }) {
  const { t: tr } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const files = value.filter((f) => f && f.url);
  const isImg = (f: CustomFieldFile) => /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|$)/i.test(f.url) || (f.type ?? "").startsWith("image/");

  const onPick = async (list: FileList | null) => {
    if (!list || list.length === 0 || !projectId) return;
    setBusy(true);
    try {
      const next = [...files];
      for (const file of Array.from(list)) {
        const up = await nexusApi.uploadCustomFieldFile(projectId, file);
        next.push({ url: up.url, name: up.name, size: up.size, type: up.type });
      }
      onSet(next);
    } catch {
      toast.error(tr("Upload failed"), { description: tr("Check the file size (max 250MB) and your project access.") });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const remove = (url: string) => onSet(files.filter((f) => f.url !== url));

  if (compact) {
    // A table cell: small thumbnails / names on one line and a "+", so the row keeps its height.
    return (
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {files.slice(0, 3).map((f) => (
          <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" title={f.name} aria-label={f.name} className="shrink-0">
            {isImg(f)
              ? <img src={f.url} alt={f.name} className="h-7 w-7 rounded border border-border object-cover" />
              : <span className="flex max-w-[7rem] items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium"><Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" /><span className="truncate">{f.name}</span></span>}
          </a>
        ))}
        {files.length > 3 && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">+{files.length - 3}</span>}
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />
        <button type="button" disabled={busy || !projectId} onClick={() => fileRef.current?.click()} aria-label={tr("Add files")} title={tr("Add files")} className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <div key={f.url} className="group relative">
              {isImg(f) ? (
                <a href={f.url} target="_blank" rel="noopener noreferrer" aria-label={f.name} title={f.name}>
                  <img src={f.url} alt={f.name} className="h-14 w-14 rounded-lg border border-border object-cover" />
                </a>
              ) : (
                <a href={f.url} target="_blank" rel="noopener noreferrer" title={f.name} className="flex max-w-[10rem] items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                </a>
              )}
              <button type="button" onClick={() => remove(f.url)} className="tap-area absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center pointer-coarse:size-6 rounded-full bg-foreground/80 text-background opacity-0 pointer-coarse:opacity-100! transition-opacity group-hover:opacity-100" aria-label={tr("Remove")}>
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />
      <button type="button" disabled={busy || !projectId} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {busy ? tr("Uploading…") : tr("Add files")}
      </button>
    </div>
  );
}

/** Comment input with @-mention autocomplete (project members). Tracks the EXACT userIds picked and sends
 *  them as `mentionedUserIds` so the backend notifies the right person regardless of name. */
function CommentComposer({ me, members, pending, onSubmit, draftKey, autoFocus, placeholder, onCancel, avatarSize = 24 }: { me: NexusUser | null; members: NexusUser[]; pending: boolean; onSubmit: (content: string, mentionedUserIds: string[]) => Promise<boolean>;
  /** sessionStorage key: an unsent comment survives closing the popup (Notion keeps the draft). */
  draftKey?: string; autoFocus?: boolean; placeholder?: string;
  /** Esc in an empty box (a reply box) closes it. */
  onCancel?: () => void; avatarSize?: number }) {
  const { t: tr } = useLang();
  const [text, setTextState] = useState(() => {
    if (!draftKey) return "";
    try { return sessionStorage.getItem(draftKey) ?? ""; } catch { return ""; }
  });
  const setText = (v: string | ((cur: string) => string)) => setTextState((cur) => {
    const next = typeof v === "function" ? v(cur) : v;
    if (draftKey) { try { if (next) sessionStorage.setItem(draftKey, next); else sessionStorage.removeItem(draftKey); } catch { /* private mode */ } }
    return next;
  });
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState<string | null>(null); // active "@…" token being typed (null = closed)
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grows with what is typed, from one line ("Add a comment…").
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return members.filter((m) => (m.name ?? m.email ?? "").toLowerCase().includes(q)).slice(0, 6);
  }, [query, members]);
  useEffect(() => setActive(0), [query]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    const caret = e.target.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/(?:^|\s)@(\S*)$/); // "@" at start or after a space, then the token up to caret
    setQuery(m ? m[1] : null);
  };

  const pick = (u: NexusUser) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const m = text.slice(0, caret).match(/(?:^|\s)@(\S*)$/);
    if (!m) return;
    const at = caret - m[1].length - 1; // index of the "@"
    const name = u.name ?? u.email ?? "user";
    const insert = `@${name} `;
    setText(text.slice(0, at) + insert + text.slice(caret));
    setMentions((prev) => (prev.some((x) => x.id === u.id) ? prev : [...prev, { id: u.id, name }]));
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); const pos = at + insert.length; el.setSelectionRange(pos, pos); });
  };

  const sending = useRef(false);
  const submit = () => {
    const content = text.trim();
    if (!content || pending || sending.current) return;
    sending.current = true;
    // Only keep mentions whose "@Name" is still present in the final text.
    const ids = [...new Set(mentions.filter((mm) => content.includes(`@${mm.name}`)).map((mm) => mm.id))];
    // Cleared only once the server has it: a send that fails (offline, a blip) keeps the text to retry (C-BUG-7).
    void onSubmit(content, ids).then((ok) => {
      sending.current = false;
      if (ok) { setText((cur) => (cur.trim() === content ? "" : cur)); setMentions([]); setQuery(null); }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
    }
    if (e.key === "Escape" && onCancel && !text.trim()) { e.preventDefault(); onCancel(); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    // Notion's comment line in NEXUS's shape: your avatar, a borderless "Add a comment…", the send arrow once
    // there is text. Enter sends, Shift+Enter breaks the line, @ mentions a project member.
    <div className="group flex items-start gap-2.5 rounded-xl border border-transparent px-1 py-1 transition-colors focus-within:border-border focus-within:bg-background focus-within:shadow-soft">
      <span className="mt-0.5"><MiniAvatar user={me} size={avatarSize} /></span>
      <div className="relative min-w-0 flex-1">
        <textarea ref={ref} value={text} onChange={onChange} onKeyDown={onKeyDown} rows={1} autoFocus={autoFocus} aria-label={placeholder ?? tr("Add a comment…")} placeholder={placeholder ?? tr("Add a comment…")} className="block w-full resize-none overflow-y-auto bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70" />
        {query !== null && matches.length > 0 && (
          <div className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-pop">
            {matches.map((u, i) => (
              <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(u); }} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors", i === active ? "bg-accent" : "hover:bg-accent")}>
                <MiniAvatar user={u} size={22} /> <span className="truncate">{u.name ?? u.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button aria-label={tr("Send comment")} disabled={!text.trim() || pending} onClick={submit} className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.95] disabled:bg-muted disabled:text-muted-foreground pointer-coarse:h-11 pointer-coarse:w-11", !text.trim() && !pending && "opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100")}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** One comment's own line: avatar, name, time, "edited", and for your own comment Edit and Delete (Notion). */
function CommentLine({ comment, isMine, size, onEdit, onDelete, actions }: { comment: NexusComment; isMine: boolean; size: number; onEdit: (content: string) => Promise<boolean>; onDelete: () => void; actions?: ReactNode }) {
  const { t: tr } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft, editing]);
  const save = () => {
    const next = draft.trim();
    if (!next || saving) return;
    if (next === comment.content.trim()) { setEditing(false); return; }
    setSaving(true);
    void onEdit(next).then((ok) => { setSaving(false); if (ok) setEditing(false); });
  };
  const edited = comment.isEdited;
  const tool = "grid h-7 w-7 place-items-center rounded-lg text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/line:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100";
  const indent = size + 10;
  return (
    <div className="group/line">
      <div className="flex items-center gap-2.5">
        <MiniAvatar user={comment.user} size={size} />
        <span className="min-w-0 truncate text-sm font-semibold">{displayName(comment.user)}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(comment.createdAt)} {fmtTime(comment.createdAt)}{edited ? ` · ${tr("edited")}` : ""}</span>
        <div className="ml-auto flex shrink-0 items-center">
          {actions}
          {isMine && !editing && (
            <>
              <button type="button" onClick={() => { setDraft(comment.content); setEditing(true); }} aria-label={tr("Edit comment")} title={tr("Edit comment")} className={cn(tool, "hover:bg-accent hover:text-foreground")}><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={onDelete} aria-label={tr("Delete comment")} title={tr("Delete comment")} className={cn(tool, "hover:bg-destructive/10 hover:text-destructive")}><Trash2 className="h-3.5 w-3.5" /></button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <div className="mt-1 rounded-xl border border-border bg-background px-2 py-1 shadow-soft" style={{ marginLeft: indent }}>
          <textarea ref={ref} autoFocus value={draft} rows={1} aria-label={tr("Edit comment")} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
              else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
            }}
            className="block w-full resize-none overflow-y-auto bg-transparent py-1 text-sm leading-relaxed outline-none" />
          <div className="flex justify-end gap-1.5 pb-0.5">
            <button type="button" onClick={() => setEditing(false)} className="h-7 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent pointer-coarse:h-11">{tr("Cancel")}</button>
            <button type="button" onClick={save} disabled={!draft.trim() || saving} className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50 pointer-coarse:h-11">{saving && <Loader2 className="h-3 w-3 animate-spin" />}{tr("Save")}</button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed" style={{ marginLeft: indent }}>{comment.content}</p>
      )}
    </div>
  );
}

function CommentItem({ comment, currentUserId, me, members, canReply, onReact, onDelete, onEdit, onReply, replyPending }: {
  comment: NexusComment; currentUserId?: string; me: NexusUser | null; members: NexusUser[]; canReply: boolean;
  onReact: (commentId: string, emoji: string, has: boolean) => void; onDelete: (commentId: string) => void;
  onEdit: (commentId: string, content: string) => Promise<boolean>;
  onReply: (content: string, mentionedUserIds: string[]) => Promise<boolean>; replyPending: boolean;
}) {
  const { t: tr } = useLang();
  const [showEmoji, setShowEmoji] = useState(false);
  const [replying, setReplying] = useState(false);
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const r of comment.reactions ?? []) {
      const cur = map.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (r.user?.id && r.user.id === currentUserId) cur.mine = true;
      map.set(r.emoji, cur);
    }
    return Array.from(map.entries());
  }, [comment.reactions, currentUserId]);
  const mine = (c: NexusComment) => !!c.user?.id && c.user.id === currentUserId;

  return (
    // A thread as on a Notion page: avatar, name and time on one line, the text under it, replies indented below.
    <div className="group/comment -mx-1 rounded-xl px-1 py-1 transition-colors hover:bg-muted/40">
      <CommentLine comment={comment} isMine={mine(comment)} size={24} onEdit={(content) => onEdit(comment.id, content)} onDelete={() => onDelete(comment.id)}
        actions={canReply ? <button type="button" onClick={() => setReplying(true)} aria-label={tr("Reply")} title={tr("Reply")} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/comment:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"><Reply className="h-3.5 w-3.5" /></button> : null} />
      <div className="ml-[34px] mt-1.5 flex flex-wrap items-center gap-1.5">
        {grouped.map(([emoji, info]) => (
          <button key={emoji} onClick={() => onReact(comment.id, emoji, info.mine)} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors", info.mine ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent")}>
            {emoji} {info.count}
          </button>
        ))}
        <div className="relative">
          <button onClick={() => setShowEmoji((v) => !v)} aria-label={tr("Add reaction")} className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-[opacity,background-color] hover:bg-accent focus-visible:opacity-100 pointer-coarse:opacity-100", grouped.length === 0 && !showEmoji && "opacity-0 group-hover/comment:opacity-100")}><Plus className="h-3 w-3" /></button>
          {showEmoji && (
            <div className="absolute z-20 mt-1 flex gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-pop">
              {REACTION_EMOJIS.map((e) => (
                <button key={e} onClick={() => { onReact(comment.id, e, false); setShowEmoji(false); }} className="rounded-lg px-1.5 py-1 text-base transition-colors hover:bg-accent">{e}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {((comment.replies?.length ?? 0) > 0 || replying) && (
        <div className="ml-[34px] mt-2 space-y-2 border-l-2 border-border pl-3">
          {(comment.replies ?? []).map((r) => (
            <CommentLine key={r.id} comment={r} isMine={mine(r)} size={20} onEdit={(content) => onEdit(r.id, content)} onDelete={() => onDelete(r.id)} />
          ))}
          {replying && (
            <CommentComposer me={me} members={members} pending={replyPending} autoFocus avatarSize={20} placeholder={tr("Write a reply…")} onCancel={() => setReplying(false)}
              onSubmit={(content, ids) => onReply(content, ids).then((ok) => { if (ok) setReplying(false); return ok; })} />
          )}
        </div>
      )}
    </div>
  );
}
