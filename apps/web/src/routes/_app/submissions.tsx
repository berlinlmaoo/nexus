import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ProjectMarkFor, ProjectPageIcon } from "@/components/projects/ProjectIcon";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEdgeFade } from "@/hooks/use-edge-fade";
import { AlertCircle, CalendarDays, Check, ChevronDown, Download, FileText, FolderKanban, Inbox, Loader2, Lock, MessageSquare, Paperclip, Send, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { COLOR_PRESETS, normalizeColor } from "@/lib/project-views";
import { fmtTime, nexusApi, type NexusMySubmission, type NexusSubmissionColumn } from "@/lib/nexus-api";
import { thumbUrl } from "@/lib/thumb";
import { Incremental } from "@/components/projects/views/incremental";
import { rupiah } from "@/lib/custom-field-number";
import { MyLegalRequestDetail, MyLegalRequestsSection } from "@/components/legal/MyLegalRequests";
import { legalRequestsApi } from "@/lib/legal-requests-api";

export const Route = createFileRoute("/_app/submissions")({
  component: MySubmissions,
  // `?id=` opens a form submission, `?legal=` one of my Legal requests (the notifications link here).
  validateSearch: (s: Record<string, unknown>): { id?: string; legal?: string } => ({
    id: typeof s.id === "string" && s.id ? s.id : undefined,
    legal: typeof s.legal === "string" && s.legal ? s.legal : undefined,
  }),
});

/**
 * My Submissions (owner, 12 Oct 2026): what I filed through a form, on a board whose columns are the
 * target project's status options — the same names and colours the finance / multimedia team sees on
 * their board, grouped To-do / In progress / Complete. Read-only: the team moves the cards; it updates
 * live (workspace-changed { kind: "submissions" } to my own room). I can open one to see my answers,
 * the Bukti Pencairan, its status history and the comments, and reply.
 */

type Filter = "all" | "finance" | "multimedia";
const GROUP_LABEL: Record<string, string> = { todo: "To-do", in_progress: "In progress", complete: "Complete" };
const STATUS_LABEL: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" };
const GROUP_COLOR: Record<string, string> = { todo: "gray", in_progress: "blue", complete: "green" };
const GROUP_ORDER = ["todo", "in_progress", "complete"] as const;
/**
 * What an empty lane is for (UI tour run 14, R14-WB-4): a reason, not a bare "Nothing here yet". The intake
 * text belongs only to the lane new requests really land in; another empty To-do lane is moved into by the
 * team (UI tour run 18, R18-WD-2: an empty "To Do" said new requests wait there beside "New 4").
 */
const EMPTY_INTAKE = "New requests wait here until the team picks them up.";
const EMPTY_LANE: Record<string, string> = {
  todo: "Nothing here yet. Requests move here when the team moves them.",
  in_progress: "Requests the team is working on move here.",
  complete: "Finished requests end up here.",
};

function preset(c: { color?: string | null; group?: string } | null | undefined) {
  return COLOR_PRESETS[normalizeColor(c?.color) ?? GROUP_COLOR[c?.group ?? "todo"] ?? "gray"];
}

function money(n?: number | null) {
  return n == null ? null : rupiah(n);
}

function useDate() {
  const { locale } = useLang();
  return (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(locale, { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" }) : "");
}

function Avatars({ people }: { people: NonNullable<NexusMySubmission["handlers"]> }) {
  if (!people.length) return null;
  return (
    <span className="flex -space-x-1.5">
      {people.slice(0, 3).map((p) => (
        p.avatar
          ? <img key={p.id} src={thumbUrl(p.avatar, 40)} loading="lazy" decoding="async" alt="" title={p.name ?? ""} className="h-5 w-5 rounded-full border border-card object-cover" />
          : <span key={p.id} title={p.name ?? ""} className="grid h-5 w-5 place-items-center rounded-full border border-card bg-muted text-[9px] font-bold text-muted-foreground">{(p.name ?? "?").slice(0, 1).toUpperCase()}</span>
      ))}
    </span>
  );
}

function Card({ s, onOpen }: { s: NexusMySubmission; onOpen: () => void }) {
  const { t } = useLang();
  const date = useDate();
  const amount = money(s.amount);
  return (
    <button onClick={onOpen} className="w-full rounded-lg border border-border bg-card p-2.5 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md active:scale-[0.99]">
      <div className="text-sm font-semibold leading-snug">{s.taskTitle || s.formName || t("Submission")}</div>
      {amount && <div className="mt-1 text-sm font-semibold tabular-nums">{amount}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {s.category && <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5"><Tag className="h-3 w-3" />{s.category}</span>}
        {s.date && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{date(s.date)}</span>}
        {(s.commentCount ?? 0) > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{s.commentCount}</span>}
        {(s.proofs?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><Paperclip className="h-3 w-3" />{t("Proof")}</span>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground">{s.projectName}</span>
        <Avatars people={s.handlers ?? []} />
      </div>
      {s.needsAction && <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"><AlertCircle className="h-3 w-3" />{t("Needs your reply")}</div>}
    </button>
  );
}

/** Format a submitted answer value (string / number / array / file-object / place-object) for display. */
function fmtVal(v: unknown, yes: string, no: string): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? fmtVal(x, yes, no) : String(x))).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name; // uploaded file
    if (typeof o.label === "string") return o.label; // place
    return JSON.stringify(v);
  }
  if (typeof v === "boolean") return v ? yes : no;
  return String(v);
}

function ColumnChip({ c }: { c?: NexusSubmissionColumn | null }) {
  const { t } = useLang();
  if (!c) return null;
  const p = preset(c);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: p.bg, color: p.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.dot }} />{c.name}
      <span className="font-normal opacity-70">· {t(GROUP_LABEL[c.group])}</span>
    </span>
  );
}

function SubmissionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useLang();
  const date = useDate();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["submission-detail", id], queryFn: () => nexusApi.submissionDetail(id), retry: 1 });
  const [reply, setReply] = useState("");
  const del = useMutation({
    mutationFn: () => nexusApi.deleteSubmission(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-submissions"] }); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't delete the submission.")),
  });
  const send = useMutation({
    mutationFn: () => nexusApi.replyToSubmission(id, reply.trim()),
    onSuccess: () => { setReply(""); qc.invalidateQueries({ queryKey: ["submission-detail", id] }); qc.invalidateQueries({ queryKey: ["my-submissions"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't send the reply.")),
  });
  // Double-click Send posted the reply twice (bughunt N-BUG-2): one reply in flight at a time.
  const [guardSend, sending] = useSubmitGuard();
  const sendReply = () => { if (reply.trim()) guardSend(() => send.mutateAsync()); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sub = d.data;
  const answers = sub?.answers ?? [];
  const label = "text-xs font-semibold text-muted-foreground";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={sub?.taskTitle || t("Submission")} className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold leading-tight">{sub?.taskTitle || sub?.formName || t("Submission")}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub?.formName}{sub?.projectName ? ` · ${sub.projectName}` : ""}</p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {d.isLoading && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>}
          {d.isError && <p className="text-sm text-destructive">{(d.error as { status?: number } | null)?.status === 404 ? t("This submission no longer exists, or the link is wrong.") : t("Couldn't load the details.")}</p>}
          {sub && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <ColumnChip c={sub.column} />
                {sub.needsAction && <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"><AlertCircle className="h-3.5 w-3.5" />{t("Needs your reply")}</span>}
                <span className="text-xs text-muted-foreground">{t("Submitted {when}", { when: `${date(sub.createdAt)} ${fmtTime(sub.createdAt)}` })}</span>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <div><dt className={label}>{t("Amount")}</dt><dd className="tabular-nums">{money(sub.amount) ?? "—"}</dd></div>
                <div><dt className={label}>{t("Category")}</dt><dd>{sub.category ?? "—"}</dd></div>
                <div><dt className={label}>{t("Date")}</dt><dd>{sub.date ? date(sub.date) : "—"}</dd></div>
                <div><dt className={label}>{t("Handled by")}</dt><dd className="truncate">{(sub.handlers ?? []).map((h) => h.name).filter(Boolean).join(", ") || t("Not assigned yet")}</dd></div>
              </dl>

              <section>
                <h3 className={cn(label, "mb-2")}>{t("Your answers")}</h3>
                {answers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("No answers were recorded.")}</p>
                ) : (
                  <dl className="divide-y divide-border rounded-xl border border-border">
                    {answers.map((a) => (
                      <div key={a.id} className="grid gap-1 px-3 py-2 sm:grid-cols-[40%_1fr]">
                        <dt className="text-xs text-muted-foreground">{a.label}</dt>
                        <dd className="whitespace-pre-wrap break-words text-sm">{/(harga|nominal|amount|biaya|total|jumlah)/i.test(String(a.label)) && /^-?\d+$/.test(String(a.value ?? "").trim()) ? rupiah(Number(a.value)) : fmtVal(a.value, t("Yes"), t("No"))}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>

              {/* Proof from the team: legacy PROOF files plus anything someone else attached (lib/my-submissions.ts). */}
              {(sub.proofs?.length ?? 0) > 0 && (
                <section>
                  <h3 className={cn(label, "mb-2")}>{t("Proof of payment")}</h3>
                  <div className="space-y-2">
                    {sub.proofs!.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-50/50 p-2.5 dark:bg-emerald-500/10 dark:border-emerald-500/30">
                        {p.mimeType?.startsWith("image/") && p.url
                          ? <a aria-label={t("Open photo")} href={p.url} target="_blank" rel="noreferrer" className="shrink-0"><img src={p.url} alt="" className="h-10 w-10 rounded-md object-cover" /></a>
                          : <Paperclip className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name || t("proof")}</span>
                        {p.url && <a href={`${p.url}?download=${encodeURIComponent(p.name || "bukti")}`} download={p.name || ""} title={t("Download")} aria-label={t("Download")} className="rounded-lg p-1 text-emerald-700 transition hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-500/15"><Download className="h-4 w-4" /></a>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {(sub.history?.length ?? 0) > 0 && (
                <section>
                  <h3 className={cn(label, "mb-2")}>{t("Status history")}</h3>
                  <ol className="space-y-1.5 text-sm">
                    {sub.history!.map((h) => (
                      <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs text-muted-foreground">{date(h.at)} {fmtTime(h.at)}</span>
                        <span>{h.to ? t("Moved to {status}", { status: t(STATUS_LABEL[h.to] ?? h.to) }) : t("Status changed")}</span>
                        {h.by && <span className="text-xs text-muted-foreground">· {h.by}</span>}
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <section>
                <h3 className={cn(label, "mb-2")}>{t("Comments")}</h3>
                {(sub.comments?.length ?? 0) === 0 && <p className="mb-2 text-sm text-muted-foreground">{t("No comments yet. Ask the team here if something is unclear.")}</p>}
                <ul className="mb-3 space-y-2">
                  {(sub.comments ?? []).map((c) => (
                    <li key={c.id} className={cn("rounded-xl px-3 py-2 text-sm", c.mine ? "ml-8 bg-primary/10" : "mr-8 bg-muted")}>
                      <div className="mb-0.5 text-xs text-muted-foreground">{c.mine ? t("You") : c.user.name} · {date(c.createdAt)} {fmtTime(c.createdAt)}</div>
                      <div className="whitespace-pre-wrap break-words">{c.content}</div>
                    </li>
                  ))}
                </ul>
                {sub.taskId && (
                  <form onSubmit={(e) => { e.preventDefault(); sendReply(); }} className="flex items-end gap-2">
                    <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder={t("Reply to the team…")} aria-label={t("Reply to the team…")}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && reply.trim()) { e.preventDefault(); sendReply(); } }}
                      className="min-h-[44px] flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                    <button type="submit" disabled={!reply.trim() || send.isPending || sending} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                      {send.isPending || sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{t("Send")}
                    </button>
                  </form>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Only for a submission that loaded: an unknown or inaccessible id has nothing to delete (bughunt N-BUG-6). */}
        {sub && <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[11px] text-muted-foreground">{t("Deleting this submission also deletes its task in the project.")}</p>
          <button
            onClick={() => { if (window.confirm(t("Delete this submission? Its task in the project is deleted too."))) del.mutate(); }}
            disabled={del.isPending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-500/10 dark:text-rose-400"
          >
            {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t("Delete")}
          </button>
        </div>}
      </div>
    </div>
  );
}

function MySubmissions() {
  const { t } = useLang();
  const q = useQuery({ queryKey: ["my-submissions"], queryFn: () => nexusApi.mySubmissions(), retry: 1 });
  const subs = q.data?.submissions ?? [];
  // What I asked Legal for (owner, 14 Oct 2026): their own list, above the form board.
  const legalQ = useQuery({ queryKey: ["legal-requests-mine"], queryFn: () => legalRequestsApi.mine(), retry: 1 });
  const legal = legalQ.data?.requests ?? [];
  const [filter, setFilter] = useState<Filter>("all");
  const [mine, setMine] = useState(false);
  // Per-project filter (owner, 12 Oct 2026). Remembered on this device; a project with no submission left is ignored.
  const [projectFilter, setProjectFilterState] = useState<string | null>(() => { try { return localStorage.getItem("nx-submissions-project"); } catch { return null; } });
  const setProjectFilter = (v: string | null) => { setProjectFilterState(v); try { if (v) localStorage.setItem("nx-submissions-project", v); else localStorage.removeItem("nx-submissions-project"); } catch { /* private mode */ } };
  const projectOptions = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>();
    for (const s of subs) {
      if (!s.projectId) continue;
      const cur = m.get(s.projectId) ?? { id: s.projectId, name: s.projectName || t("Untitled project"), count: 0 };
      cur.count++;
      m.set(s.projectId, cur);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [subs, t]);
  const activeProject = projectFilter && projectOptions.some((p) => p.id === projectFilter) ? projectFilter : null;
  const inProject = (s: NexusMySubmission) => !activeProject || s.projectId === activeProject;

  // Columns: the target projects' status options. Older servers send only names (statusColumns): those
  // become columns after "New", as before.
  const keyOf = (s: NexusMySubmission) => s.column?.key ?? (s.procStatus?.trim() || "new");
  const columns: NexusSubmissionColumn[] = useMemo(() => {
    const base: NexusSubmissionColumn[] = q.data?.columns?.length
      ? q.data.columns
      : [{ key: "new", name: t("New"), group: "todo" as const }, ...(q.data?.statusColumns ?? []).map((n) => ({ key: n, name: n, group: "in_progress" as const }))];
    // A submission whose column the list does not have (a status renamed or removed on its project) gets a
    // column of its own, instead of the board showing only empty lanes while it holds requests (UI tour run 13,
    // W-B7).
    const known = new Set(base.map((c) => c.key));
    const extra: NexusSubmissionColumn[] = [];
    for (const s of q.data?.submissions ?? []) {
      const key = s.column?.key ?? (s.procStatus?.trim() || "new");
      if (known.has(key)) continue;
      known.add(key);
      extra.push(s.column ?? { key, name: s.procStatus?.trim() || t("New"), group: key === "new" ? "todo" : "in_progress" });
    }
    // Each extra column joins its own group (stable within a group), instead of trailing after Done: appended
    // at the end, a second "In progress" lane sat past the Complete column, off the right edge, under a
    // repeated group caption (UI tour run 14, R14-WD-2 / R14-WM-7).
    const order = (g: string) => { const i = GROUP_ORDER.indexOf(g as (typeof GROUP_ORDER)[number]); return i < 0 ? GROUP_ORDER.length : i; };
    // "New" (requests not yet on a board) leads its group: New → To Do → In Progress → Done, the flow's order on
    // every platform (decision 19, UI tour run 20, R20-WM-10: it came after "To Do").
    const isNew = (c: NexusSubmissionColumn) => (c.key === "new" ? 0 : 1);
    return [...base, ...extra].map((c, i) => ({ c, i })).sort((a, b) => order(a.c.group) - order(b.c.group) || isNew(a.c) - isNew(b.c) || a.i - b.i).map((x) => x.c);
  }, [q.data, t]);

  const shown = subs.filter((s) => (filter === "all" || s.kind === filter) && inProject(s) && (!mine || s.needsAction));
  const needCount = subs.filter((s) => (filter === "all" || s.kind === filter) && inProject(s) && s.needsAction).length;
  const kinds = new Set(subs.map((s) => s.kind));
  // The columns of the filtered requests' projects (empty ones too, as on their board), so a finance-only
  // view has no multimedia columns.
  const projects = new Set(subs.filter((s) => (filter === "all" || s.kind === filter) && inProject(s)).map((s) => s.projectId).filter(Boolean));
  const visibleCols = columns.filter((c) => (c.projectIds ? c.projectIds.some((id) => projects.has(id)) : true) || shown.some((s) => keyOf(s) === c.key));
  // Phone: the lane cut at the right edge fades out, so it reads as "swipe for more" (UI tour run 9).
  const boardRef = useRef<HTMLDivElement>(null);
  const boardFade = useEdgeFade(boardRef, [visibleCols.length, shown.length]);
  // Phone: one lane at a time, picked from a row of chips (like Legal Requests, R14-WM-8); it opens on the first
  // lane that holds something (UI tour run 15, R15-WM-1: the New lane was cut at the screen edge and In Progress
  // and Done were out of sight).
  const [phoneColState, setPhoneColState] = useState<string | null>(null);
  const phoneCol = (phoneColState && visibleCols.some((c) => c.key === phoneColState) ? phoneColState : null)
    ?? visibleCols.find((c) => shown.some((s) => keyOf(s) === c.key))?.key ?? visibleCols[0]?.key;
  // The intake lane, where new requests land: the "New" lane of requests not yet on the board, else the first
  // To-do lane holding requests, else the first To-do lane (a form files into its project's first section).
  // Only it says new requests wait there and links to the forms when empty, so an empty board has a next step.
  const todoCols = visibleCols.filter((c) => c.group === "todo");
  const intakeKey = (todoCols.find((c) => c.key === "new") ?? todoCols.find((c) => subs.some((s) => keyOf(s) === c.key)) ?? todoCols[0])?.key;

  // `/submissions?id=<submissionId>` opens straight onto that submission (the `submission_status`
  // notification links here).
  const search = useSearch({ strict: false }) as { id?: string; legal?: string };
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(search.id ?? null);
  useEffect(() => { if (search.id) setOpenId(search.id); }, [search.id]);
  const closeDetail = () => {
    setOpenId(null);
    if (search.id) navigate({ to: "/submissions", search: {}, replace: true }).catch(() => {});
  };
  // `?legal=<requestId>`: one of my Legal requests (the legal_request_status notification links here).
  const [openLegal, setOpenLegal] = useState<string | null>(search.legal ?? null);
  useEffect(() => { if (search.legal) setOpenLegal(search.legal); }, [search.legal]);
  const closeLegal = () => {
    setOpenLegal(null);
    if (search.legal) navigate({ to: "/submissions", search: {}, replace: true }).catch(() => {});
  };

  const chip = (on: boolean) => cn("rounded-full border px-3 py-1 text-xs font-semibold transition", on ? "border-foreground/25 bg-accent text-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground");

  return (
    <div>
      <PageHeader title={t("My Submissions")} subtitle={t("Requests you sent through a form. The team that handles them moves them along; this board follows.")} />
      <div className="p-4 md:p-8">
        {q.isLoading && <div className="flex gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-72 rounded-2xl" />)}</div>}
        {q.isError && <EmptyState icon={AlertCircle} tone="muted" title={t("Couldn't load your submissions.")} action={<EmptyAction onClick={() => q.refetch()}>{t("Try again")}</EmptyAction>} />}

        {!q.isLoading && filter === "all" && <MyLegalRequestsSection requests={legal} onOpen={setOpenLegal} />}

        {/* Only Legal requests so far: the form board says what it is for and where to start (W-B7). */}
        {!q.isLoading && !q.isError && subs.length === 0 && legal.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
            <span>{t("Requests you send through a form appear here, with where each one stands.")}</span>
            <EmptyAction to="/forms">{t("Open forms")}</EmptyAction>
          </div>
        )}

        {!q.isLoading && !q.isError && subs.length === 0 && legal.length === 0 && (
          <EmptyState icon={Inbox} title={t("No submissions yet")}
            message={t("Everything you send through a form (a payment request, a design request, a report) shows up here with where it stands, so you never have to ask.")}
            action={<EmptyAction to="/forms">{t("Open forms")}</EmptyAction>} />
        )}

        {!q.isLoading && !q.isError && subs.length > 0 && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button className={chip(filter === "all")} onClick={() => setFilter("all")}>{t("All")}</button>
              {kinds.has("finance") && <button className={chip(filter === "finance")} onClick={() => setFilter("finance")}>{t("Finance")}</button>}
              {kinds.has("multimedia") && <button className={chip(filter === "multimedia")} onClick={() => setFilter("multimedia")}>{t("Multimedia")}</button>}
              {projectOptions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className={cn(chip(!!activeProject), "inline-flex max-w-[16rem] items-center gap-1")} aria-label={t("Filter by project")}>
                      {activeProject ? <ProjectMarkFor projectId={activeProject} size={14} /> : <ProjectPageIcon size={14} />}
                      <span className="truncate">{activeProject ? projectOptions.find((p) => p.id === activeProject)?.name : t("All projects")}</span>
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
                    <DropdownMenuItem onSelect={() => setProjectFilter(null)}>
                      <Check className={cn("mr-2 h-3.5 w-3.5", activeProject ? "opacity-0" : "opacity-100")} />{t("All projects")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {projectOptions.map((p) => (
                      <DropdownMenuItem key={p.id} onSelect={() => setProjectFilter(p.id)}>
                        <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", activeProject === p.id ? "opacity-100" : "opacity-0")} />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="ml-2 text-xs tabular-nums text-muted-foreground">{p.count}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              <button className={cn(chip(mine), "inline-flex items-center gap-1")} onClick={() => setMine((v) => !v)} aria-pressed={mine}>
                <AlertCircle className="h-3.5 w-3.5" />{t("Needs my action")}{needCount > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{needCount}</span>}
              </button>
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Lock className="h-3 w-3" />{t("Read-only. The team moves the cards.")}</span>
            </div>

            {shown.length === 0 ? (
              <EmptyState icon={FileText} title={mine ? t("Nothing needs your action") : t("No submissions here")}
                message={mine ? t("When the team asks for a revision or replies to you, the request shows up here.") : t("Try another filter.")}
                action={<EmptyAction onClick={() => { setFilter("all"); setMine(false); setProjectFilter(null); }}>{t("Show all")}</EmptyAction>} />
            ) : (
              // Computers: every lane in one row; the trailing spacer keeps the last lane clear of the edge at full
              // scroll and the cut edge fades (UI tour run 13 W-M9, run 14 R14-WD-2). No group captions: one lone
              // "To-do" over two lanes, spelled unlike the "To Do" lane, read as a stray header (UI tour run 15,
              // R15-WB-9). Phone: the chosen lane fills the width.
              <>
              <div role="tablist" aria-label={t("Columns")} className="-mt-1 mb-3 flex flex-wrap gap-1.5 sm:hidden">
                {visibleCols.map((col) => {
                  const on = col.key === phoneCol;
                  return (
                    <button key={col.key} type="button" role="tab" aria-selected={on} aria-controls={`sub-col-${col.key}`}
                      onClick={() => setPhoneColState(col.key)}
                      className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors pointer-coarse:min-h-9",
                        on ? "border-foreground/25 bg-accent text-foreground" : "border-border bg-card text-muted-foreground")}>
                      {col.name}<span className="tabular-nums text-muted-foreground">{shown.filter((s) => keyOf(s) === col.key).length}</span>
                    </button>
                  );
                })}
              </div>
              <div ref={boardRef} className={cn("flex gap-3 pb-4 sm:overflow-x-auto sm:overscroll-x-contain sm:after:block sm:after:w-1 sm:after:shrink-0 sm:after:content-['']", boardFade)}>
                {visibleCols.map((col) => {
                  const items = shown.filter((s) => keyOf(s) === col.key);
                  const p = preset(col);
                  return (
                    // A lane with cards is 18 rem on a computer and an empty lane is narrow (R14-WD-2: four 18 rem lanes
                    // did not fit next to the sidebar); on a phone the chosen lane fills the width.
                    <div key={col.key} id={`sub-col-${col.key}`} role="tabpanel" className={cn("flex w-full shrink-0 flex-col", items.length ? "sm:w-72" : "sm:w-48", col.key !== phoneCol && "max-sm:hidden")}>
                      <div className="flex flex-1 flex-col rounded-xl" style={{ background: p.lane }}>
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: p.bg, color: p.text }}>
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p.dot }} /><span className="truncate">{col.name}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">{items.length}</span>
                        </div>
                        <div className="flex-1 space-y-2 px-2 pb-2">
                          {/* Long columns render in slices as they scroll into view (perf pass, 12 Oct 2026). */}
                          <Incremental items={items} first={25} step={30} keyOf={(s) => s.id} render={(s) => <Card s={s} onOpen={() => setOpenId(s.id)} />} />
                          {/* An empty lane says what lands in it (UI tour run 14, R14-WB-4); the empty intake lane
                              also links to the forms, the way a request gets here. */}
                          {items.length === 0 && (
                            <div className="flex flex-col items-center gap-2 px-2 py-4 text-center text-[11px] leading-snug text-muted-foreground">
                              <span>{t(col.key === intakeKey ? EMPTY_INTAKE : EMPTY_LANE[col.group] ?? EMPTY_LANE.in_progress)}</span>
                              {col.key === intakeKey && (
                                <Link to="/forms" className="font-semibold text-primary hover:underline">{t("Open forms")}</Link>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}
          </>
        )}
      </div>

      {openId && <SubmissionDetail id={openId} onClose={closeDetail} />}
      {openLegal && <MyLegalRequestDetail id={openLegal} onClose={closeLegal} />}
    </div>
  );
}
