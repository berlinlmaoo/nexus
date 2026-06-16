import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { animate as fmAnimate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlignLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Download,
  Eye,
  FolderPlus,
  Heart,
  Link2,
  ListChecks,
  Loader2,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Star,
  Trash2,
  Trophy,
  User,
  UserPlus,
  X,
} from "lucide-react";
import {
  blockText,
  fmtDate,
  fmtDue,
  fmtTime,
  nexusApi,
  statusLabel,
  textToBlocks,
  type NexusAttachment,
  type NexusComment,
  type NexusCustomField,
  type NexusCustomFieldOptions,
  type NexusUser,
} from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { FieldEditor } from "@/components/projects/ProjectCustomFieldsManager";

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

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function MiniAvatar({ user, size = 28 }: { user?: NexusUser | null; size?: number }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary ring-1 ring-border"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      title={user?.name ?? "Unassigned"}
    >
      {initialsOf(user?.name)}
    </span>
  );
}

function toMembers(data: { members?: NexusUser[] } | NexusUser[] | undefined): NexusUser[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.members ?? [];
}

function isDoneStatus(s?: string | null) {
  return (s ?? "").toUpperCase() === "DONE";
}

/** White card with an uppercase icon label — the old-NEXUS task-detail section. */
function SecCard({ icon: Icon, label, action, children, className }: { icon: typeof Plus; label: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-3xl bg-card p-5 shadow-soft", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Icon className="h-4 w-4" />{label}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

export function TaskDetailPanel({ taskId, onClose, morphId }: { taskId: string; onClose: () => void; morphId?: string }) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const morph = !!morphId && !reduce;
  // --- card → panel MORPH via a manual FLIP (no shared layoutId, see note at top of file) ---
  // The box starts exactly on the source card's measured rect and grows to the panel; on close it shrinks
  // back to wherever the card is NOW. Driven by raw motion values so a moving/unmounting card can never
  // yank or blur it (the rect is just a number snapshot).
  const asideRef = useRef<HTMLElement | null>(null);
  const panelRectRef = useRef<DOMRect | null>(null); // panel's natural (untransformed) rect, measured once
  const sourceRect = useRef<DOMRect | null>(morphId && lastMorph && lastMorph.id === morphId ? lastMorph.rect : null);
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
  const requestClose = () => {
    if (closingRef.current) return;
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
  const [showDepPicker, setShowDepPicker] = useState(false);
  const [showProjPicker, setShowProjPicker] = useState(false);
  const [timeMins, setTimeMins] = useState("");

  // Esc to close + lock body scroll while the modal is up. When a NESTED subtask panel is open,
  // this (parent) panel must ignore Esc — otherwise one keypress closes the whole stack at once.
  const openSubRef = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !openSubRef.current) requestClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);

  const task = useQuery({ queryKey: ["task", taskId], queryFn: () => nexusApi.taskDetail(taskId) });
  const comments = useQuery({ queryKey: ["task-comments", taskId], queryFn: () => nexusApi.taskComments(taskId) });
  const attachments = useQuery({ queryKey: ["task-attachments", taskId], queryFn: () => nexusApi.taskAttachments(taskId) });
  const [previewAtt, setPreviewAtt] = useState<NexusAttachment | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [sizeWarn, setSizeWarn] = useState<string | null>(null);
  // Files >80MB auto-chunk client-side (see uploadAttachmentProgress) so they slip under Cloudflare's
  // ~100MB cap and get reassembled server-side — so the real ceiling is the app/nginx limit, 250MB.
  const MAX_ATTACH_MB = 1024; // 1GB — uploads stream in <100MB chunks, so Cloudflare's per-request cap doesn't apply
  const MAX_ATTACH_BYTES = MAX_ATTACH_MB * 1024 * 1024;
  const MAX_ATTACH_LABEL = "1 GB";
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: () => nexusApi.favorites(), staleTime: 60_000 });
  const isFavorited = (favorites.data ?? []).some((f) => f.targetId === taskId && (f.type ?? "").toLowerCase() === "task");
  const followers = useQuery({ queryKey: ["task-followers", taskId], queryFn: () => nexusApi.taskFollowers(taskId) });
  // BoD-only "Jadiin quest" action: bundle this (and more) task(s) into a specific_tasks quest.
  const wsMembers = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), staleTime: 300_000, retry: false });
  const canMakeQuest = wsMembers.data?.role === "BOD" || wsMembers.data?.role === "ONE_ABOVE_ALL";
  const [questOpen, setQuestOpen] = useState(false);
  const projectId = task.data?.taskList?.project?.id || task.data?.taskList?.projectId;
  const customFields = useQuery({ queryKey: ["task-cf", taskId], queryFn: () => nexusApi.taskCustomFields(projectId!, taskId), enabled: !!projectId });
  // Project's sections (board columns = TaskLists) so the top dropdown follows the actual project.
  const projDetail = useQuery({ queryKey: ["nexus", "project", projectId], queryFn: () => nexusApi.project(projectId!), enabled: !!projectId, staleTime: 60_000 });
  const sections = (projDetail.data?.taskLists ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const deps = useQuery({ queryKey: ["task-deps", taskId], queryFn: () => nexusApi.taskDependencies(taskId) });
  const times = useQuery({ queryKey: ["task-times", taskId], queryFn: () => nexusApi.timeEntries(taskId) });
  // Only fetch the whole-workspace member list as a FALLBACK for tasks with no project. For a project
  // task we assign from the project's own team (projDetail.members) — see assignableMembers below.
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => nexusApi.members(), enabled: showAssignPicker && !projectId, staleTime: 300_000 });
  const candidateTasks = useQuery({ queryKey: ["nexus", "tasks"], queryFn: () => nexusApi.tasks(), enabled: showDepPicker, staleTime: 60_000 });
  const candidateProjects = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, enabled: showProjPicker, staleTime: 300_000 });

  const t = task.data;

  // local mirrors for inline edits
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (t) {
      setTitle(t.title ?? "");
      setDescription(blockText(t.description));
    }
  }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["task", taskId] });
    qc.invalidateQueries({ queryKey: ["task-comments", taskId] });
    qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).some((k) => k.includes("task") || k.includes("dashboard") || k.includes("project")) });
  };

  const update = useMutation({
    mutationFn: (payload: Parameters<typeof nexusApi.updateTask>[1]) => nexusApi.updateTask(taskId, payload),
    onSuccess: invalidateAll,
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
  const uploadMut = useMutation({
    mutationFn: (file: File) => nexusApi.uploadAttachmentProgress(taskId, file, setUploadPct),
    onMutate: () => setUploadPct(0),
    onSettled: () => setUploadPct(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-attachments", taskId] }),
  });
  const delAttachment = useMutation({
    mutationFn: (id: string) => nexusApi.deleteAttachment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-attachments", taskId] }),
  });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-cf", taskId] }),
  });
  const [cfAdding, setCfAdding] = useState(false);
  const createCf = useMutation({
    mutationFn: (payload: { name: string; type: string; options: NexusCustomFieldOptions | null }) => nexusApi.createCustomField(projectId!, payload),
    onSuccess: () => {
      setCfAdding(false);
      qc.invalidateQueries({ queryKey: ["task-cf", taskId] });
      qc.invalidateQueries({ queryKey: ["project-custom-fields", projectId] });
    },
    onError: (e: unknown) => toast.error("Gagal bikin field", { description: e instanceof Error ? e.message : "Butuh akses LEAD." }),
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
  const addDep = useMutation({
    mutationFn: (dependsOnTaskId: string) => nexusApi.addDependency(taskId, dependsOnTaskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-deps", taskId] }),
  });
  const removeDep = useMutation({
    mutationFn: (id: string) => nexusApi.removeDependency(taskId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-deps", taskId] }),
  });
  const logTimeMut = useMutation({
    mutationFn: ({ duration, description }: { duration: number; description?: string }) => nexusApi.logTime({ taskId, duration, description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-times", taskId] }),
  });
  const delTask = useMutation({
    mutationFn: () => nexusApi.deleteTask(taskId),
    onSuccess: () => { invalidateAll(); requestClose(); },
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

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-0 sm:p-4">
      <motion.div
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
        style={{ opacity: backdropO }}
        onClick={requestClose}
      />
      {/* Centered modal that MORPHS out of the clicked card (manual FLIP, no layoutId). The box (mx/my +
          scaleX/scaleY) is mapped from the card's rect with transform-origin top-left; content fades in
          just after the box starts so the stretch isn't visible. */}
      <motion.aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        style={{ x: mx, y: my, scaleX: msx, scaleY: msy, opacity: asideO, transformOrigin: "top left", pointerEvents: closing ? "none" : undefined, ...(morph ? { borderRadius: 24 } : null) }}
        className="relative z-10 flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden border-border bg-muted shadow-pop sm:h-auto sm:max-h-[92dvh] sm:rounded-3xl sm:border"
      >
            {/* inner scroll region — separate from the animated shell so the transform never breaks scrolling on iOS.
                During the morph the content fades in just after the box starts so it doesn't look stretched. */}
            <motion.div
              initial={morph ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ delay: morph ? 0.05 : 0, duration: 0.16 }}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
            >
            {/* header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-muted/70 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
            {t?.taskList?.project && (
              <>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.taskList.project.color ?? "#7b68ee" }} />
                <span className="truncate">{t.taskList.project.name}</span>
                <span className="text-muted-foreground/50">/</span>
                <span className="truncate">{t.taskList?.name}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => followMut.mutate()}
              className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors active:scale-[0.97]", followers.data?.isFollowing ? "text-primary" : "text-muted-foreground hover:bg-accent")}
              title={followers.data?.isFollowing ? "Following" : "Follow"}
            >
              <Eye className="h-4 w-4" /> {followers.data?.followers?.length ?? 0}
            </button>
            <button
              onClick={() => favMut.mutate()}
              className={cn("rounded-lg p-1.5 transition-colors active:scale-[0.95]", isFavorited ? "text-amber-500" : "text-muted-foreground hover:bg-accent")}
              title="Favorite"
            >
              <Star className={cn("h-4 w-4", isFavorited && "fill-amber-500")} />
            </button>
            <button
              onClick={() => likeMut.mutate(!t?.liked)}
              className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors active:scale-[0.97]", t?.liked ? "text-destructive" : "text-muted-foreground hover:bg-accent")}
              title="Like"
            >
              <Heart className={cn("h-4 w-4", t?.liked && "fill-destructive")} /> {t?.likeCount ?? 0}
            </button>
            {canMakeQuest && t && (
              <button onClick={() => setQuestOpen(true)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Jadiin quest">
                <Trophy className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => { if (confirm("Delete this task?")) delTask.mutate(); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" title="Delete task">
              <Trash2 className="h-4 w-4" />
            </button>
            <button onClick={requestClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {task.isLoading && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        )}
        {task.isError && (
          <div className="p-6 text-sm font-semibold text-destructive">Gagal memuat task. Cek sesi / koneksi.</div>
        )}

        {t && (
          <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
            {/* Quest nudge: this task is part of one or more task-bundle quests → motivate finishing it. */}
            {(t.quests ?? []).map((q) => (
              <div key={q.id} className="flex items-center gap-2.5 rounded-2xl border border-primary/30 bg-primary/5 px-3.5 py-2.5">
                <Trophy className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-bold text-primary">
                    {(q.total ?? 1) <= 1 ? <>Selesaiin task ini → <span className="tabular-nums">+{q.xpReward} XP</span> 🎯</> : <>Bagian dari quest “{q.title}” → <span className="tabular-nums">+{q.xpReward} XP</span> 🎯</>}
                  </div>
                  {(q.total ?? 1) > 1 && <div className="text-xs text-muted-foreground">Beresin semua {q.total} task-nya ({q.done ?? 0}/{q.total} kelar) buat dapet XP-nya.</div>}
                </div>
              </div>
            ))}
            {/* toolbar: mark done + status + priority (old-NEXUS pills) */}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => update.mutate({ status: (isDoneStatus(t.status) ? "TODO" : "DONE") as never })} className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition-colors", isDoneStatus(t.status) ? "border-success/30 bg-success/10 text-success" : "border-border bg-card text-foreground hover:bg-accent")}>
                {isDoneStatus(t.status) ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4 text-muted-foreground" />} {isDoneStatus(t.status) ? "Done" : "Mark done"}
              </button>
              {/* Section = the project's board column (TaskList). Falls back to global status if the
                  task isn't in a project (no sections). */}
              {sections.length > 0 ? (
                <div className="relative">
                  <select value={t.taskListId ?? ""} onChange={(e) => update.mutate({ taskListId: e.target.value } as never)} className="max-w-[200px] appearance-none truncate rounded-full border border-border bg-card px-3.5 py-2 pr-8 text-xs font-bold uppercase tracking-wider outline-none transition focus:border-primary">
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              ) : (
                <div className="relative">
                  <select value={t.status ?? "TODO"} onChange={(e) => update.mutate({ status: e.target.value as never })} className="appearance-none rounded-full border border-border bg-card px-3.5 py-2 pr-8 text-xs font-bold uppercase tracking-wider outline-none transition focus:border-primary">
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              )}
              <div className="relative">
                <select value={t.priority ?? "NONE"} onChange={(e) => update.mutate({ priority: e.target.value as never })} className="appearance-none rounded-full border border-border bg-card px-3.5 py-2 pr-8 text-xs font-bold uppercase tracking-wider outline-none transition focus:border-primary">
                  {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{statusLabel(p)}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            {/* parent breadcrumb — this task is a SUBTASK; tap to open the parent */}
            {t.parent && (
              <button
                onClick={() => setOpenSub(t.parent!.id)}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground transition hover:opacity-80"
              >
                <ListChecks className="h-3 w-3 shrink-0" />
                <span className="shrink-0 text-accent-foreground/70">Subtask dari</span>
                <span className="truncate">{t.parent.title}</span>
              </button>
            )}

            {/* title */}
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (title.trim() && title !== t.title) update.mutate({ title: title.trim() }); }}
              rows={2}
              className="w-full resize-none rounded-xl bg-transparent font-display text-3xl font-bold leading-tight tracking-tight text-foreground outline-none focus:bg-card/60 focus:px-3 focus:py-2 sm:text-4xl"
            />

            {/* assigned personnel + due date (2-col) */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SecCard icon={User} label="Assigned personnel">
                <div className="flex flex-wrap items-center gap-2">
                  {(t.assignees ?? []).map((a) => (
                    <span key={a.user?.id} className="group inline-flex items-center gap-1.5 rounded-full bg-muted py-1 pl-1 pr-2 text-xs font-semibold">
                      <MiniAvatar user={a.user} size={22} /> {a.user?.name}
                      <button onClick={() => a.user?.id && assignMut.mutate({ userId: a.user.id, add: false })} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <div className="relative">
                    <button onClick={() => { setAssignSearch(""); setShowAssignPicker((v) => !v); }} className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary active:scale-[0.98]"><Plus className="h-4 w-4" /></button>
                    {showAssignPicker && (
                      <div className="absolute z-20 mt-1 w-60 rounded-xl border border-border bg-popover p-1 shadow-pop">
                        <div className="relative p-1">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input autoFocus value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} placeholder="Cari anggota tim…" className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none transition focus:border-primary" />
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {assignPickerLoading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>}
                          {!assignPickerLoading && assignableMembers.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">{assignSearch.trim() ? "Gak ada anggota yang cocok." : "Semua anggota tim project udah di-assign."}</div>}
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
              </SecCard>
              <SecCard icon={Calendar} label="Due date">
                {/* datetime-local so a TIME can be set (not just a date). Value is formatted in LOCAL time;
                    onChange turns the local value back into a UTC ISO string for the API. */}
                <input type="datetime-local" value={(() => { if (!t.dueDate) return ""; const d = new Date(t.dueDate); if (Number.isNaN(d.getTime())) return ""; const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; })()} onChange={(e) => update.mutate({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-primary" />
              </SecCard>
            </div>

            {/* fields — project fields listed directly (no separate "custom" category) + inline "+ new field" */}
            {projectId && (
              <SecCard
                icon={SlidersHorizontal}
                label="Fields"
                action={
                  <button onClick={() => setCfAdding((v) => !v)} title="Field baru" className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                    <Plus className="h-3.5 w-3.5" /> New field
                  </button>
                }
              >
                {cfAdding && (
                  <div className="mb-3">
                    <FieldEditor saving={createCf.isPending} onSave={(p) => createCf.mutate(p)} onCancel={() => setCfAdding(false)} />
                  </div>
                )}
                {(customFields.data?.fields?.length ?? 0) > 0 ? (
                  <div className="[column-gap:0.75rem] sm:columns-2">
                    {customFields.data!.fields.map((f) => (
                      <div key={f.id} className="mb-3 break-inside-avoid">
                        <CustomFieldInput field={f} onSet={(value) => setCfMut.mutate({ id: f.id, value })} />
                      </div>
                    ))}
                  </div>
                ) : !cfAdding ? (
                  <p className="text-xs text-muted-foreground">Belum ada field. Klik <span className="font-semibold">New field</span> buat nambah.</p>
                ) : null}
              </SecCard>
            )}

            {/* also in projects (multi-project links) */}
            <SecCard
              icon={FolderPlus}
              label="Also in projects"
              action={
                <div className="relative">
                  <button onClick={() => setShowProjPicker((v) => !v)} className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"><Plus className="h-3.5 w-3.5" /></button>
                  {showProjPicker && (
                    <div className="absolute right-0 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-pop">
                      {candidateProjects.isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>}
                      {(candidateProjects.data ?? []).filter((p) => p.id !== projectId && !(t.taskProjects ?? []).some((tp) => tp.project?.id === p.id)).map((p) => (
                        <button key={p.id} onClick={() => linkProjectMut.mutate(p.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color ?? "#7b68ee" }} /><span className="truncate">{p.name}</span></button>
                      ))}
                    </div>
                  )}
                </div>
              }
            >
              <p className="mb-3 -mt-1 text-xs text-muted-foreground">Mention another division by linking this task to another project in the same workspace.</p>
              <div className="flex flex-wrap gap-2">
                {(t.taskProjects ?? []).map((tp) => (
                  <span key={tp.id} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
                    <span className="h-2 w-2 rounded-full" style={{ background: tp.project?.color ?? "#7b68ee" }} /> {tp.project?.name}
                    <button onClick={() => tp.project?.id && unlinkProjectMut.mutate(tp.project.id)} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                  </span>
                ))}
                {(t.taskProjects?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">Only in its home project.</p>}
              </div>
            </SecCard>

            {/* description */}
            <SecCard icon={AlignLeft} label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => { if (description !== blockText(t.description)) update.mutate({ description: description.trim() ? textToBlocks(description) : null }); }}
                rows={4}
                placeholder="Add a description…"
                className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition focus:border-primary"
              />
            </SecCard>

            {/* subtasks — Asana-style: each is a full task (own assignee/due/comments), hidden
                from the board; tap the circle to toggle done, tap the title to open its panel */}
            {(() => {
              const subs = t.subtasks ?? [];
              const doneCount = subs.filter((s) => s.status === "DONE").length;
              return (
                <SecCard icon={ListChecks} label={subs.length > 0 ? `Subtasks · ${doneCount}/${subs.length}` : "Subtasks"}>
                  {subs.length > 0 && (
                    <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-success transition-all" style={{ width: `${subs.length ? Math.round((doneCount / subs.length) * 100) : 0}%` }} />
                    </div>
                  )}
                  {subs.length > 0 && (
                    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                      {subs.map((st) => (
                        <div key={st.id} className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent/40">
                          <button
                            onClick={() => toggleSubtask.mutate({ id: st.id, done: st.status !== "DONE" })}
                            disabled={toggleSubtask.isPending}
                            title={st.status === "DONE" ? "Balikin ke To-do" : "Tandai selesai"}
                            className="shrink-0 transition active:scale-90 disabled:opacity-50"
                          >
                            {st.status === "DONE"
                              ? <CheckCircle2 className="h-[18px] w-[18px] text-success" />
                              : <Circle className="h-[18px] w-[18px] text-muted-foreground/50 hover:text-success" />}
                          </button>
                          <button onClick={() => setOpenSub(st.id)} className={cn("min-w-0 flex-1 truncate text-left hover:text-primary", st.status === "DONE" && "text-muted-foreground line-through")}>
                            {st.title}
                          </button>
                          {st.dueDate && <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{fmtDue(st.dueDate)}</span>}
                          {(st.assignees ?? []).slice(0, 2).map((a, i) =>
                            a.user?.avatar
                              ? <img key={a.user.id ?? i} src={a.user.avatar} alt="" title={a.user.name ?? ""} className="h-5 w-5 shrink-0 rounded-full object-cover" />
                              : <span key={a.user?.id ?? i} title={a.user?.name ?? ""} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[9px] font-bold text-accent-foreground">{(a.user?.name ?? "?").slice(0, 1).toUpperCase()}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* inline add — Enter or the button spawns a real task linked to this one.
                      Needs a project home (taskList) so the backend can validate the parent. */}
                  {!!projectId && !!t.taskList?.id && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={newSubTitle}
                      onChange={(e) => setNewSubTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newSubTitle.trim() && !addSubtask.isPending) addSubtask.mutate(newSubTitle.trim()); }}
                      placeholder="+ Tambah subtask… (Enter)"
                      className="min-w-0 flex-1 rounded-xl border border-dashed border-border bg-transparent px-3 py-2 text-sm outline-none transition focus:border-primary"
                    />
                    <button
                      onClick={() => { if (newSubTitle.trim()) addSubtask.mutate(newSubTitle.trim()); }}
                      disabled={addSubtask.isPending || !newSubTitle.trim()}
                      className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.97] disabled:opacity-40"
                    >
                      {addSubtask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  )}
                  {addSubtask.isError && <p className="mt-1 text-[11px] font-semibold text-destructive">{(addSubtask.error as Error)?.message ?? "Gagal menambah subtask."}</p>}
                </SecCard>
              );
            })()}

            {/* attachments */}
            <SecCard
              icon={Paperclip}
              label="Attachments"
              action={
                <div className="flex items-center gap-2">
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">Maks {MAX_ATTACH_LABEL}</span>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                    {uploadMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Upload
                    <input type="file" className="hidden" disabled={uploadMut.isPending} onChange={(e) => {
                      const f = e.target.files?.[0]; e.target.value = "";
                      if (!f) return;
                      if (f.size > MAX_ATTACH_BYTES) { setSizeWarn(`File ${(f.size / 1024 / 1024).toFixed(1)} MB — melebihi maks ${MAX_ATTACH_LABEL}. Upload ditolak.`); return; }
                      setSizeWarn(null); uploadMut.mutate(f);
                    }} />
                  </label>
                </div>
              }
            >
              <div className="space-y-1.5">
                {uploadPct != null && (
                  <div className="rounded-xl border border-border bg-background px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-semibold text-muted-foreground">Mengupload…</span>
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
                      <button onClick={() => setPreviewAtt(att)} className="shrink-0"><img src={att.url} alt="" className="h-9 w-9 rounded-md object-cover" /></button>
                    ) : (
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <button onClick={() => setPreviewAtt(att)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-primary hover:underline">{att.name || "(tanpa nama)"}</button>
                    {att.size != null && <span className="shrink-0 text-xs text-muted-foreground">{Math.round(att.size / 1024)} KB</span>}
                    <button onClick={() => setPreviewAtt(att)} title="Preview" className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Eye className="h-3.5 w-3.5" /></button>
                    {att.url && <a href={`${att.url}?download=${encodeURIComponent(att.name || "file")}`} download={att.name || ""} title="Download" className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Download className="h-3.5 w-3.5" /></a>}
                    <button onClick={() => delAttachment.mutate(att.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {(attachments.data?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">No attachments.</p>}
                {sizeWarn && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-300/60 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {sizeWarn}
                  </div>
                )}
                {uploadMut.isError && <p className="text-xs font-semibold text-destructive">{(uploadMut.error as Error)?.message || `Upload gagal — maks ${MAX_ATTACH_LABEL}.`}</p>}
              </div>
            </SecCard>

            {previewAtt && createPortal(
              <div className="fixed inset-0 z-[90] grid place-items-center p-4" onClick={() => setPreviewAtt(null)}>
                <div className="absolute inset-0 bg-foreground/60 backdrop-blur-sm" />
                <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{previewAtt.name || "Preview"}</div>
                      <div className="truncate text-xs text-muted-foreground">{previewAtt.mimeType ?? "file"}{previewAtt.size != null ? ` · ${Math.round(previewAtt.size / 1024)} KB` : ""}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {previewAtt.url && <a href={`${previewAtt.url}?download=${encodeURIComponent(previewAtt.name || "file")}`} download={previewAtt.name || ""} title="Download" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><Download className="h-4 w-4" /></a>}
                      <button onClick={() => setPreviewAtt(null)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
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
                        <iframe src={rangeSrc} title="preview" className="h-[75vh] w-full rounded-lg bg-white" />
                      );
                      if (kind === "video") return (
                        <div>
                          {/* playsInline + cache-bust: iOS needs inline + a non-stale (range-able) CF response. */}
                          <video src={rangeSrc} controls playsInline preload="metadata" className="mx-auto max-h-[72vh] rounded-lg" />
                          {maybeUnplayableVideo(previewAtt) && (
                            <p className="mx-auto mt-2 max-w-md text-center text-[11px] text-muted-foreground">
                              Format <span className="font-semibold">.mov</span> (HEVC) sering nggak jalan di Android/webview — kalau cuma muncul layar item, pakai tombol Download buat nonton.
                            </p>
                          )}
                        </div>
                      );
                      if (kind === "audio") return <audio src={rangeSrc} controls preload="metadata" className="mx-auto mt-8 w-full" />;
                      return (
                        <div className="grid place-items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                          <Paperclip className="h-8 w-8" />
                          Preview nggak tersedia buat tipe file ini.
                          <a href={`${previewAtt.url}?download=${encodeURIComponent(previewAtt.name || "file")}`} download={previewAtt.name || ""} className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Download</a>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>,
              document.body,
            )}

            {/* dependencies */}
            <SecCard
              icon={Link2}
              label="Blocked by"
              action={
                <div className="relative">
                  <button onClick={() => setShowDepPicker((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"><Plus className="h-3.5 w-3.5" /> Add</button>
                  {showDepPicker && (
                    <div className="absolute right-0 z-20 mt-1 max-h-64 w-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-pop">
                      {candidateTasks.isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>}
                      {(candidateTasks.data ?? []).filter((ct) => ct.id !== taskId).slice(0, 40).map((ct) => (
                        <button key={ct.id} onClick={() => { addDep.mutate(ct.id); setShowDepPicker(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"><span className="truncate">{ct.title}</span></button>
                      ))}
                    </div>
                  )}
                </div>
              }
            >
              <div className="space-y-1.5">
                {(deps.data?.dependencies ?? []).map((dep) => (
                  <div key={dep.id} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
                    <CheckCircle2 className={cn("h-4 w-4 shrink-0", dep.dependsOnTask?.status === "DONE" ? "text-success" : "text-muted-foreground/40")} />
                    <span className="flex-1 truncate">{dep.dependsOnTask?.title}</span>
                    <button onClick={() => removeDep.mutate(dep.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {(deps.data?.dependencies?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">No blockers.</p>}
                {(deps.data?.dependedOnBy?.length ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">Blocks {deps.data!.dependedOnBy.length} task{deps.data!.dependedOnBy.length === 1 ? "" : "s"}.</p>
                )}
              </div>
            </SecCard>

            {/* time tracking */}
            <SecCard icon={Clock} label={`Time tracked${(() => { const total = (times.data?.entries ?? []).reduce((n, e) => n + (e.duration ?? 0), 0); return total ? ` · ${total}m` : ""; })()}`}>
              <div className="flex items-center gap-2">
                <input value={timeMins} onChange={(e) => setTimeMins(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Minutes" className="w-28 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                <button disabled={!timeMins || logTimeMut.isPending} onClick={() => { logTimeMut.mutate({ duration: Number(timeMins) }); setTimeMins(""); }} className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-accent active:scale-[0.98] disabled:opacity-50">{logTimeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log time"}</button>
              </div>
              {(times.data?.entries ?? []).slice(0, 5).map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground/80">{e.duration ?? 0}m</span>
                  <span className="flex-1 truncate">{e.description || e.user?.name || ""}</span>
                  <span>{fmtDate(e.startTime)}</span>
                </div>
              ))}
            </SecCard>

            {/* comments */}
            <SecCard icon={MessageCircle} label="Comments">
              <CommentComposer members={projectMembers} pending={addComment.isPending} onSubmit={(content, mentionedUserIds) => addComment.mutate({ content, mentionedUserIds })} />
              <div className="space-y-3">
                {(comments.data?.comments ?? []).map((c) => (
                  <CommentItem key={c.id} comment={c} currentUserId={currentUserId} onReact={(emoji, has) => reactMut.mutate({ commentId: c.id, emoji, has })} onDelete={() => delComment.mutate(c.id)} />
                ))}
                {comments.data && (comments.data.comments?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
              </div>
            </SecCard>

            {/* activity */}
            {(t.activityLogs?.length ?? 0) > 0 && (
              <SecCard icon={Activity} label="Activity">
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  {t.activityLogs!.slice(0, 12).map((a) => (
                    <div key={a.id} className="flex gap-2">
                      <span className="font-semibold text-foreground/80">{a.user?.name ?? "Someone"}</span>
                      <span className="flex-1">{statusLabel(a.action)}{a.details ? ` — ${a.details}` : ""}</span>
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
    </div>,
    document.body,
  );
}

// BoD-only: bundle this (and more) task(s) into a `specific_tasks` quest. Complete = all tasks DONE; XP
// goes to whoever did them; visible to those tasks' project members.
function QuestComposer({ initialTask, onClose }: { initialTask: { id: string; title: string }; onClose: () => void }) {
  const qc = useQueryClient();
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
    mutationFn: () => nexusApi.createAdminQuest({ title: title.trim() || "Quest", xpReward: xp, requirementType: "specific_tasks", taskIds: tasks.map((t) => t.id) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gamification", "me"] }); toast.success("Quest dibuat 🎯"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal bikin quest"),
  });
  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2"><Trophy className="h-5 w-5 text-primary" /><h3 className="text-lg font-bold">Jadiin quest</h3></div>
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">Judul quest</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="mb-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" placeholder="Nama quest" />
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">Hadiah XP (maks 50)</label>
        <input type="number" min={0} max={50} value={xp} onChange={(e) => setXp(Math.max(0, Math.min(50, Number(e.target.value) || 0)))} className="mb-3 block w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">Task ({tasks.length})</label>
        <div className="mb-2 space-y-1">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <button onClick={() => setTasks((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== t.id) : prev))} disabled={tasks.length <= 1} className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-xl border border-dashed border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" placeholder="+ Cari task buat ditambah (min 2 huruf)…" />
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
          <button onClick={onClose} className="rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">Batal</button>
          <button onClick={() => create.mutate()} disabled={create.isPending || tasks.length === 0 || !title.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Buat quest
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Quest kelar kalau semua task DONE. XP buat yang ngerjain; kelihatan ke member project task-nya.</p>
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
function fmtCreatedDateTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const m = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${m.day} ${m.month} ${m.year} • ${m.hour}:${m.minute}`;
}

function CustomFieldInput({ field, onSet }: { field: NexusCustomField; onSet: (value: unknown) => void }) {
  const type = (field.type ?? "").toUpperCase();
  const choices = customFieldChoices(field.options);
  const cls = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary";

  const strVal = typeof field.value === "string" ? field.value : "";
  const arrVal = Array.isArray(field.value) ? field.value.map(String) : [];
  const placeInit = field.value && typeof field.value === "object" && !Array.isArray(field.value) ? (field.value as { label?: string; mapUrl?: string }) : { label: "", mapUrl: "" };

  const [local, setLocal] = useState<string>(strVal.includes("T") ? strVal.slice(0, 10) : strVal);
  const [place, setPlace] = useState({ label: placeInit.label ?? "", mapUrl: placeInit.mapUrl ?? "" });

  let body: ReactNode;
  if (type === "SELECT" || type === "STATUS") {
    body = (
      <select value={strVal} onChange={(e) => onSet(e.target.value)} className={cls}>
        <option value="">—</option>
        {choices.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  } else if (type === "MULTI_SELECT") {
    body = (
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => {
          const on = arrVal.includes(c);
          return (
            <button type="button" key={c} onClick={() => onSet(on ? arrVal.filter((x) => x !== c) : [...arrVal, c])} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors", on ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/40")}>
              {c}
            </button>
          );
        })}
        {choices.length === 0 && <span className="text-xs text-muted-foreground">No options.</span>}
      </div>
    );
  } else if (type === "PLACE") {
    body = (
      <div className="space-y-1.5">
        <input value={place.label} onChange={(e) => setPlace((p) => ({ ...p, label: e.target.value }))} onBlur={() => onSet(place)} placeholder="Lokasi / nama tempat" className={cls} />
        <input value={place.mapUrl} onChange={(e) => setPlace((p) => ({ ...p, mapUrl: e.target.value }))} onBlur={() => onSet(place)} placeholder="Link Google Maps" className={cls} />
      </div>
    );
  } else if (type === "CREATED") {
    // Auto-filled "created/requested by": submitter name (from backend createdMeta = task creator) + when.
    const meta = field.createdMeta;
    const ts = (meta?.timestamp || strVal || "").trim();
    const name = meta?.userName?.trim();
    const when = ts ? fmtCreatedDateTime(ts) : "";
    body = (
      <div className="w-full rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
        {name ? <div className="text-sm font-semibold text-foreground">{name}</div> : null}
        <div className={cn("text-muted-foreground", name ? "text-xs" : "text-sm")}>{when || strVal || "—"}</div>
      </div>
    );
  } else {
    body = (
      <input
        type={type === "NUMBER" ? "number" : type === "DATE" ? "date" : "text"}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (local !== (strVal.includes("T") ? strVal.slice(0, 10) : strVal)) onSet(local); }}
        className={cls}
      />
    );
  }

  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-muted-foreground">{field.name}</span>
      {body}
    </label>
  );
}

/** Comment input with @-mention autocomplete (project members). Tracks the EXACT userIds picked and sends
 *  them as `mentionedUserIds` so the backend notifies the right person on WhatsApp regardless of name. */
function CommentComposer({ members, pending, onSubmit }: { members: NexusUser[]; pending: boolean; onSubmit: (content: string, mentionedUserIds: string[]) => void }) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState<string | null>(null); // active "@…" token being typed (null = closed)
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

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

  const submit = () => {
    const content = text.trim();
    if (!content || pending) return;
    // Only keep mentions whose "@Name" is still present in the final text.
    const ids = [...new Set(mentions.filter((mm) => content.includes(`@${mm.name}`)).map((mm) => mm.id))];
    onSubmit(content, ids);
    setText(""); setMentions([]); setQuery(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div className="flex items-start gap-2">
      <div className="relative flex-1">
        <textarea ref={ref} value={text} onChange={onChange} onKeyDown={onKeyDown} rows={2} placeholder="Write a comment… (@ buat mention)" className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary" />
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
      <button disabled={!text.trim() || pending} onClick={submit} className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.95] disabled:opacity-50">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </div>
  );
}

function CommentItem({ comment, currentUserId, onReact, onDelete }: { comment: NexusComment; currentUserId?: string; onReact: (emoji: string, has: boolean) => void; onDelete: () => void }) {
  const [showEmoji, setShowEmoji] = useState(false);
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
  const isMine = comment.user?.id && comment.user.id === currentUserId;

  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <div className="flex items-center gap-2">
        <MiniAvatar user={comment.user} size={24} />
        <span className="text-sm font-semibold">{comment.user?.name}</span>
        <span className="text-[11px] text-muted-foreground">{fmtDate(comment.createdAt)} {fmtTime(comment.createdAt)}</span>
        {isMine && <button onClick={onDelete} className="ml-auto rounded p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{comment.content}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {grouped.map(([emoji, info]) => (
          <button key={emoji} onClick={() => onReact(emoji, info.mine)} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors", info.mine ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent")}>
            {emoji} {info.count}
          </button>
        ))}
        <div className="relative">
          <button onClick={() => setShowEmoji((v) => !v)} className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent"><Plus className="h-3 w-3" /></button>
          {showEmoji && (
            <div className="absolute z-20 mt-1 flex gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-pop">
              {REACTION_EMOJIS.map((e) => (
                <button key={e} onClick={() => { onReact(e, false); setShowEmoji(false); }} className="rounded-lg px-1.5 py-1 text-base transition-colors hover:bg-accent">{e}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {(comment.replies?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
          {comment.replies!.map((r) => (
            <div key={r.id} className="text-sm">
              <div className="flex items-center gap-2">
                <MiniAvatar user={r.user} size={20} />
                <span className="font-semibold">{r.user?.name}</span>
                <span className="text-[11px] text-muted-foreground">{fmtDate(r.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{r.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
