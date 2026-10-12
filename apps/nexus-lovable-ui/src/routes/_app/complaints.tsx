import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Ticket, Plus, X, Loader2, Send, CheckCircle2, MessageSquare, Camera, Inbox as InboxIcon, AlertTriangle, ArrowRight, Ban, CalendarClock, Check } from "lucide-react";
import { GideonMark } from "@/components/gideon/GideonMark";
import { PageHeader } from "@/components/PageHeader";
import { PageBody, PageTabs } from "@/components/PageLayout";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { localeOf, useLang } from "@/lib/lang";
import { ApiError, fmtTime, nexusApi, statusLabel, type AttendanceCorrection, type AttendanceCorrectionKind, type Complaint } from "@/lib/nexus-api";

export const Route = createFileRoute("/_app/complaints")({
  component: ComplaintsPage,
  // `?id=<ticket>` opens that ticket's thread — the link every ticket notification now carries.
  validateSearch: (s: Record<string, unknown>): { id?: string } => ({ id: typeof s.id === "string" ? s.id : undefined }),
});

// OPEN TO EVERYONE since 2026-07-29 (was BoD-only behind "Coming Soon"). A grievance channel that
// only the bosses could open was the wrong way round — staff are the people who need to file.
// Visibility is enforced server-side, not here: GET /api/complaints scopes non-BoD viewers to
// `reporterId: me`, so a staff member sees only their own tickets while BoD see all of them.

// Labels stay English here and go through t() where they are drawn.
const CATEGORIES: { key: string; label: string }[] = [
  { key: "ATTENDANCE", label: "Attendance" },
  { key: "EXP", label: "XP" },
  { key: "DAY_OFF", label: "Leave / day off" },
  { key: "OTHER", label: "Other" },
];
const catOf = (k: string) => CATEGORIES.find((c) => c.key === k);
// The wording is the APP's, deliberately. iOS renders the same ComplaintStatus as "Open" and
// "In review" (Sources/Views/TicketsView.swift, ticketStatusLabel); this screen used to say "New"
// and "In progress" for those same two values, so one ticket read as two different states
// depending on which client you opened. Both clients now say what the enum says. Nothing here is
// derived: the chip is `status` straight off /api/complaints.
//
// AWAITING_DECISION ("Menunggu keputusan") is the one status a human does not set: GIDEON answering,
// or a correction proposal landing, lifts a ticket out of OPEN into it. It is deliberately NOT
// IN_REVIEW — that one means a director picked the ticket up ("Take it on"), and an automatic hop
// there would quietly empty the inbox into a tab implying somebody was already handling it. So it
// gets its own colour, and the Inbox tab below asks for it alongside OPEN.
const STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30" },
  AWAITING_DECISION: { label: "Awaiting decision", cls: "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30" },
  IN_REVIEW: { label: "In review", cls: "bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30" },
  RESOLVED: { label: "Resolved", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30" },
  CLOSED: { label: "Closed", cls: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:ring-slate-500/30" },
};
// A status this build has never heard of gets a neutral chip and its own name Title-Cased, rather
// than an undefined lookup that takes the whole list down with it. The server enum grows; a deployed
// bundle does not.
const statusOf = (key: string) => STATUS[key] ?? { label: statusLabel(key), cls: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:ring-slate-500/30" };
// The BoD inbox = every ticket nobody has claimed. Mirror of COMPLAINT_INBOX_STATUSES in
// src/lib/complaints.ts. Asked for by name rather than leaning on the server widening a bare "OPEN"
// (that widening exists for older clients): a ticket GIDEON answered is still unclaimed work.
// Inbox = yang belum disentuh siapa pun. Tiket yang sudah dijawab GIDEON (AWAITING_DECISION) pindah ke
// "In review" bersama yang sedang dipegang BoD — permintaan BoD 16 Sep 2026: "kenapa yang udah dibales
// GIDEON masih di inbox terus".
const INBOX_STATUS = "OPEN";
const REVIEW_STATUS = "IN_REVIEW,AWAITING_DECISION";
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString(localeOf(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
// Day of a correction ("YYYY-MM-DD"), in the interface language.
const fmtDay = (d: string) => { const x = new Date(d); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString(localeOf(), { day: "numeric", month: "short" }); };
const CORRECTION_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Awaiting decision", cls: "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30" },
  APPROVED: { label: "Approved", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30" },
  REJECTED: { label: "Rejected", cls: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30" },
};
// Keep in sync with EVIDENCE_MAX_COUNT in src/app/api/complaints/route.ts — the server rejects past this.
const MAX_PHOTOS = 5;
// Mirror of CORRECTABLE_COMPLAINT_CATEGORIES in src/lib/attendance-correction.ts.
const CORRECTABLE_CATEGORIES = ["ATTENDANCE", "EXP"];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

type Tab = "open" | "review" | "all";

// Tab badges straight from the server's counts (GET /api/complaints): INBOX and REVIEW are the
// counts of exactly what those tabs return; every other key is one literal status, so All is their sum.
const countFor = (counts: Record<string, number>, tab: Tab) =>
  tab === "open" ? counts.INBOX ?? counts.OPEN ?? 0
    : tab === "review" ? counts.REVIEW ?? ((counts.IN_REVIEW ?? 0) + (counts.AWAITING_DECISION ?? 0))
      : Object.entries(counts).reduce((n, [k, v]) => (k === "INBOX" || k === "REVIEW" ? n : n + v), 0);

// Desktop row grid: subject · from · category · status · replies · last activity. Header and rows share it.
const ROW_GRID = "lg:grid lg:grid-cols-[minmax(0,1fr)_11rem_8rem_9rem_4.5rem_7.5rem] lg:items-center lg:gap-4";
const ROW_GRID_MINE = "lg:grid lg:grid-cols-[minmax(0,1fr)_8rem_9rem_4.5rem_7.5rem] lg:items-center lg:gap-4";

function ComplaintsPage() {
  const { t } = useLang();
  const qc = useQueryClient();
  // null = not chosen yet: the BoD lands on the first queue that has something in it (below), instead of
  // an empty Inbox while eight tickets wait under "In review" (owner, 12 Oct 2026).
  const [tab, setTab] = useState<Tab | null>(null);
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // A ticket asked for by id: open it, on the tab that is guaranteed to contain it. "All" rather than
  // guessing the status — a ticket GIDEON just answered is in a different queue from one still open.
  const search = Route.useSearch();
  useEffect(() => {
    if (!search.id) return;
    setTab("all");
    setOpenId(search.id);
  }, [search.id]);

  const roleQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const viewerIsBod = ["ONE_ABOVE_ALL", "BOD"].includes(roleQ.data?.role ?? "");
  const shownTab: Tab = tab ?? "open";

  // BoD filter by status; staff just see their own thread list.
  const status = !viewerIsBod ? "ALL" : shownTab === "open" ? INBOX_STATUS : shownTab === "review" ? REVIEW_STATUS : "ALL";
  const listQ = useQuery({ queryKey: ["complaints", viewerIsBod ? status : "MINE"], queryFn: () => nexusApi.complaints(status), enabled: !roleQ.isLoading });
  // Every response carries the counts for ALL tabs; keep the last ones so the badges stay put while the
  // next tab loads.
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => { if (listQ.data?.counts) setCounts(listQ.data.counts); }, [listQ.data]);
  // First answer for the BoD: pick the first non-empty queue (Inbox → In review → All). Layout effect, so
  // the empty Inbox never paints before the switch.
  const autoPicking = viewerIsBod && tab === null;
  useLayoutEffect(() => {
    if (!autoPicking || !listQ.data) return;
    const c = listQ.data.counts ?? {};
    setTab(countFor(c, "open") > 0 ? "open" : countFor(c, "review") > 0 ? "review" : "all");
  }, [autoPicking, listQ.data]);

  // Tickets with a decision waiting float to the top; everything else keeps the server's own
  // lastMessageAt-desc order (Array#sort is stable, so the two orders compose). Tickets GIDEON merely
  // ANSWERED are deliberately not floated — a queue sorted "assistant first" buries the genuinely
  // new, unread tickets under a pile of replies. Those get the chip and the marker instead.
  const complaints = useMemo(
    () => [...(listQ.data?.complaints ?? [])].sort((a, b) => Number(b.pendingCorrection) - Number(a.pendingCorrection)),
    [listQ.data],
  );
  const loading = roleQ.isLoading || listQ.isLoading || autoPicking;

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["complaints"] }); };
  const newTicket = (
    <button onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> {t("New ticket")}</button>
  );
  const emptyCopy = !viewerIsBod
    ? { title: t("No tickets yet"), message: t("A ticket is how you raise something with the BoD: a complaint, a question, or an attendance record that looks wrong. GIDEON checks the data first, the BoD decides, and it stays between you and them.") }
    : shownTab === "all"
      ? { title: t("No tickets yet"), message: t("Tickets from staff land here: complaints, questions, attendance records that look wrong. GIDEON checks the data first; the decision is yours.") }
      : shownTab === "open"
        ? { title: t("Inbox is clear"), message: t("Every new ticket has been picked up. New ones from staff land here first.") }
        : { title: t("Nothing in review"), message: t("Tickets you take on, and the ones GIDEON has answered, wait here for a decision.") };

  return (
    <div>
      <PageHeader
        title={t("Tickets")}
        subtitle={t("A direct line to the BoD for work or HR issues. Only the BoD can read it.")}
        actions={newTicket}
        tabs={viewerIsBod ? (
          <PageTabs label={t("Ticket queues")} value={shownTab} onChange={setTab} tabs={[
            { key: "open", label: t("Inbox"), count: countFor(counts, "open"), attention: true },
            { key: "review", label: t("In review"), count: countFor(counts, "review") },
            { key: "all", label: t("All"), count: countFor(counts, "all") },
          ]} />
        ) : undefined}
      />

      <PageBody>
        {loading && (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="flex items-center gap-3 px-4 py-3.5"><div className="h-4 flex-1 animate-pulse rounded bg-muted" /><div className="h-4 w-24 animate-pulse rounded bg-muted" /></div>)}
          </div>
        )}
        {!loading && listQ.isError && (
          <EmptyState icon={AlertTriangle} tone="muted" title={t("Couldn't load tickets")} message={t("Check your connection and try again.")}
            action={<EmptyAction onClick={() => listQ.refetch()}>{t("Try again")}</EmptyAction>} />
        )}
        {!loading && !listQ.isError && complaints.length === 0 && (
          <EmptyState icon={InboxIcon} tone={viewerIsBod && shownTab !== "all" ? "success" : "muted"} title={emptyCopy.title} message={emptyCopy.message}
            action={viewerIsBod
              ? (shownTab !== "all" && countFor(counts, "all") > 0 ? <EmptyAction onClick={() => setTab("all")}>{t("Show all tickets")}</EmptyAction> : undefined)
              : <EmptyAction onClick={() => setComposing(true)}><Plus className="h-4 w-4" /> {t("New ticket")}</EmptyAction>} />
        )}
        {!loading && complaints.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div aria-hidden className={cn("hidden border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground", viewerIsBod ? ROW_GRID : ROW_GRID_MINE)}>
              <span>{t("Subject")}</span>
              {viewerIsBod && <span>{t("From")}</span>}
              <span>{t("Category")}</span>
              <span>{t("Status")}</span>
              <span className="text-right">{t("Replies")}</span>
              <span className="text-right">{t("Last activity")}</span>
            </div>
            <ul className="divide-y divide-border">
              {complaints.map((c) => <li key={c.id}><TicketRow c={c} viewerIsBod={viewerIsBod} onOpen={() => setOpenId(c.id)} /></li>)}
            </ul>
          </div>
        )}
      </PageBody>

      <AnimatePresence>
        {composing && <Composer onClose={() => setComposing(false)} onDone={() => { setComposing(false); invalidate(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {openId && <ComplaintThread id={openId} viewerIsBod={viewerIsBod} onClose={() => setOpenId(null)} onChanged={invalidate} />}
      </AnimatePresence>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const { t } = useLang();
  const st = statusOf(status);
  return <span className={cn("inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", st.cls)}>{t(st.label)}</span>;
}

/** One ticket as a table row on desktop, a two-line row on a phone. The whole row opens the thread. */
function TicketRow({ c, viewerIsBod, onOpen }: { c: Complaint; viewerIsBod: boolean; onOpen: () => void }) {
  const { t, tn } = useLang();
  const cat = catOf(c.category);
  // The server only sends a reporter the viewer may see (BoD, or the reporter themself); anything else
  // stays anonymous here too.
  const who = c.reporter?.name ?? t("Anonymous");
  // The two things a row has to say beyond its status: GIDEON has been in here, and a decision is
  // sitting unmade. Both come straight off /api/complaints and are independent of the status chip.
  const markers = (c.pendingCorrection || c.gideonReplied) && (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {c.pendingCorrection && (
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-px text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
          <CalendarClock className="h-3 w-3" /> {t("Decision waiting")}
        </span>
      )}
      {c.gideonReplied && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
          <GideonMark className="h-3 w-3" /> {t("GIDEON replied")}
        </span>
      )}
    </span>
  );
  return (
    <button onClick={onOpen} className={cn("block w-full px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none", viewerIsBod ? ROW_GRID : ROW_GRID_MINE)}>
      {/* Subject (+ markers). On a phone the date rides on this line. */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{c.subject}</span>
        {/* Desktop: the same two markers as small labelled icons, so a long subject never pushes them into the next column. */}
        {(c.pendingCorrection || c.gideonReplied) && (
          <span className="hidden shrink-0 items-center gap-1 lg:inline-flex">
            {c.pendingCorrection && <span title={t("Decision waiting")} aria-label={t("Decision waiting")} className="grid h-5 w-5 place-items-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><CalendarClock className="h-3 w-3" /></span>}
            {c.gideonReplied && <span title={t("GIDEON replied")} aria-label={t("GIDEON replied")} className="grid h-5 w-5 place-items-center rounded-full bg-muted text-muted-foreground"><GideonMark className="h-3 w-3" /></span>}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground lg:hidden">{fmtWhen(c.lastMessageAt)}</span>
      </div>
      {viewerIsBod && (
        <div className="hidden min-w-0 items-center gap-2 lg:flex">
          {c.reporter ? <Avatar userId={c.reporter.id} name={c.reporter.name} avatar={c.reporter.avatar ?? null} size={20} /> : null}
          <span className="truncate text-sm text-muted-foreground">{who}</span>
        </div>
      )}
      <span className="hidden truncate text-sm text-muted-foreground lg:block">{cat ? t(cat.label) : "—"}</span>
      <span className="hidden lg:flex"><StatusChip status={c.status} /></span>
      <span className="hidden items-center justify-end gap-1 text-sm tabular-nums text-muted-foreground lg:flex"><MessageSquare className="h-3.5 w-3.5" />{c.messageCount}</span>
      <span className="hidden text-right text-xs tabular-nums text-muted-foreground lg:block">{fmtWhen(c.lastMessageAt)}</span>

      {/* Phone / narrow: status · category · sender · replies on one quiet line, markers under it. */}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground lg:hidden">
        <StatusChip status={c.status} />
        {cat && <span>{t(cat.label)}</span>}
        {viewerIsBod && <span className="truncate">{t("from {name}", { name: who })}</span>}
        <span className="inline-flex items-center gap-1 tabular-nums"><MessageSquare className="h-3 w-3" />{c.messageCount}</span>
        {markers}
      </div>
    </button>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 dark:bg-scrim p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Composer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, tn } = useLang();
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [evidence, setEvidence] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // One preview URL per file, rebuilt whenever the list changes; the cleanup revokes the previous set.
  const previews = useMemo(() => evidence.map((f) => URL.createObjectURL(f)), [evidence]);
  useEffect(() => () => { previews.forEach((u) => URL.revokeObjectURL(u)); }, [previews]);
  const [fileNote, setFileNote] = useState("");
  // Check the limits here rather than letting the server bounce the whole submission: someone who picked
  // ten holiday-resolution screenshots should find that out now, not after typing the whole complaint.
  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list);
    const tooBig = picked.filter((f) => f.size > MAX_PHOTO_BYTES).length;
    const kept = picked.filter((f) => f.size <= MAX_PHOTO_BYTES);
    const room = MAX_PHOTOS - evidence.length;
    setEvidence([...evidence, ...kept.slice(0, room)]);
    setFileNote(
      tooBig > 0 ? tn(tooBig, "Skipped {n} photo over 8 MB.", "Skipped {n} photos over 8 MB.")
        : kept.length > room ? t("Kept the first {n} photos.", { n: MAX_PHOTOS })
          : "",
    );
    // Clearing the input lets someone re-pick the exact same file after removing it.
    if (fileRef.current) fileRef.current.value = "";
  };
  const canSubmit = category && subject.trim().length >= 4 && body.trim().length >= 10 && evidence.length > 0;
  const create = useMutation({ mutationFn: () => nexusApi.createComplaint({ category, subject: subject.trim(), body: body.trim(), evidence }), onSuccess: onDone });

  return (
    <Backdrop onClose={onClose}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-lg font-black">{t("New ticket")}</h2>
        <button onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-4 overflow-y-auto p-5">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Category")}</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.key} onClick={() => setCategory(c.key)} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition", category === c.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                {t(c.label)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Short title")}</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} placeholder={t("e.g. My leave balance got deducted wrong this month")} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("What happened")}</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} placeholder={t("Describe the issue in as much detail as you can: what happened, when, and what you'd like to happen.")} className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <p className="text-right text-[11px] text-muted-foreground">{body.trim().length}/4000</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Photo evidence")} <span className="text-rose-500">{t("*required")}</span></label>
            {evidence.length > 0 && <span className="text-[11px] font-semibold text-muted-foreground">{evidence.length}/{MAX_PHOTOS}</span>}
          </div>
          {evidence.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {previews.map((url, i) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-xl border border-border">
                  <img src={url} alt={t("Evidence {n}", { n: i + 1 })} className="h-full w-full object-cover" />
                  <button onClick={() => setEvidence((prev) => prev.filter((_, j) => j !== i))} aria-label={t("Remove photo {n}", { n: i + 1 })}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {evidence.length < MAX_PHOTOS && (
                <button onClick={() => fileRef.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-background text-muted-foreground transition hover:border-primary/40 hover:text-primary">
                  <Plus className="h-5 w-5" />
                  <span className="text-[11px] font-semibold">{t("Add photo")}</span>
                </button>
              )}
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-background py-6 text-muted-foreground transition hover:border-primary/40 hover:text-primary">
              <Camera className="h-6 w-6" />
              <span className="text-sm font-semibold">{t("Take or pick photos as evidence")}</span>
              <span className="text-[11px]">{t("Up to {n} photos. You can pick several at once.", { n: MAX_PHOTOS })}</span>
            </button>
          )}
          {/* NO `capture` on purpose: it forces the phone straight into the camera, and the evidence
              people actually have is a SCREENSHOT already sitting in their gallery. Without it the
              OS shows its normal chooser (Photo Library / Take Photo / Files), so both still work.
              The attendance selfie inputs keep `capture="user"` — there a live shot is the point. */}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          {fileNote && <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{fileNote}</p>}
        </div>

        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
          {t("Only the BoD can read this ticket. It won't show up in the feed or to other staff. The BoD replies right here.")}
        </div>
        {create.isError && <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">{(create.error as Error)?.message || t("Couldn't send. Check your connection.")}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">{t("Cancel")}</button>
        <button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />} {t("Send ticket")}
        </button>
      </div>
    </Backdrop>
  );
}

function ComplaintThread({ id, viewerIsBod, onClose, onChanged }: { id: string; viewerIsBod: boolean; onClose: () => void; onChanged: () => void }) {
  const { t, tn } = useLang();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);   // evidence photo shown full size
  const scrollRef = useRef<HTMLDivElement>(null);
  const detailQ = useQuery({ queryKey: ["complaint", id], queryFn: () => nexusApi.complaint(id) });
  const c = detailQ.data;

  // The detail payload already carries the proposals, so the card renders with no extra round trip.
  // What it can't tell us is whether THIS viewer may decide one — `canManage` there means "can move the
  // ticket status", a weaker thing than the attendance-write permission the decision route enforces. So
  // ask the correction endpoint for `canDecide`, and only when a proposal actually exists: an ordinary
  // ticket shouldn't pay for a second request to be told about buttons it will never show.
  const corrections = c?.corrections ?? [];
  const correctionQ = useQuery({
    queryKey: ["complaint-corrections", id],
    queryFn: () => nexusApi.complaintCorrections(id),
    enabled: corrections.length > 0,
    staleTime: 60_000,
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["complaint", id] }); onChanged(); };
  // A decision moves more than this ticket: an APPROVE rewrites that day's AttendanceRecord, so every
  // screen reading attendance is stale the moment it lands. Missing these left the approver looking at
  // the old times on the attendance board and re-proposing a correction that had already been applied.
  const refreshAfterDecision = () => {
    refresh();
    qc.invalidateQueries({ queryKey: ["complaint-corrections", id] });
    qc.invalidateQueries({ queryKey: ["attendance-today"] });
    qc.invalidateQueries({ queryKey: ["attendance-history"] });
    qc.invalidateQueries({ queryKey: ["attendance-deductions"] });
  };
  const send = useMutation({ mutationFn: () => nexusApi.replyComplaint(id, reply.trim()), onSuccess: () => { setReply(""); refresh(); } });
  const setStatus = useMutation({ mutationFn: (status: string) => nexusApi.setComplaintStatus(id, status), onSuccess: refresh });
  const busy = send.isPending || setStatus.isPending;

  // Keep the thread pinned to the latest message.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [c?.messages?.length]);

  const cat = c ? catOf(c.category) : null;
  const st = c ? statusOf(c.status) : null;

  return (
    <Backdrop onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {st && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", st.cls)}>{t(st.label)}</span>}
            <span className="truncate text-xs font-semibold text-muted-foreground">{cat ? t(cat.label) : null}</span>
          </div>
          <div className="mt-0.5 line-clamp-1 text-sm font-black">{c?.subject ?? "…"}</div>
        </div>
        <button onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>

      {/* Reporter identity strip (BoD view) */}
      {c && viewerIsBod && c.reporter && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-2 text-xs">
          <Avatar userId={c.reporter.id} name={c.reporter.name} avatar={c.reporter.avatar ?? null} size={24} />
          <span className="font-semibold">{c.reporter.name}</span>
        </div>
      )}

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-muted/10 p-4">
        {detailQ.isLoading && <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-muted" />)}</div>}
        {!!c?.attachments?.length && (
          <div className="rounded-2xl border border-border bg-card p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Camera className="h-3.5 w-3.5" /> {t("Photo evidence")}{c.attachments.length > 1 && <span className="font-semibold normal-case tracking-normal">· {tn(c.attachments.length, "{n} photo", "{n} photos")}</span>}
            </div>
            {/* A single photo keeps the full-width look it always had; several tile into a grid so the
                whole set is visible at once instead of hidden behind a carousel. Tap to see it full size. */}
            {c.attachments.length === 1 ? (
              <button onClick={() => setZoom(c.attachments[0].url)} className="block w-full">
                <img src={c.attachments[0].url} alt={t("Evidence")} className="max-h-80 w-full rounded-xl border border-border object-contain" />
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {c.attachments.map((a, i) => (
                  <button key={a.id} onClick={() => setZoom(a.url)} aria-label={t("Open evidence photo {n} full size", { n: i + 1 })}
                    className="aspect-[4/3] overflow-hidden rounded-xl border border-border transition hover:border-primary/50">
                    <img src={a.url} alt={t("Evidence {n}", { n: i + 1 })} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {c?.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm", m.mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-card ring-1 ring-border")}>
              {!m.mine && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-bold opacity-70">{m.fromGideon ? (<><GideonMark className="h-3 w-3" /> GIDEON</>) : m.fromReviewer ? "BoD" : (m.author?.name ?? "—")}</div>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <div className={cn("mt-0.5 text-right text-[10px]", m.mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{fmtWhen(m.createdAt)}</div>
            </div>
          </div>
        ))}
        {/* Proposals sit AFTER the messages on purpose: the thread auto-scrolls to the bottom, so a
            pending decision is on screen the moment the ticket opens instead of scrolled out of sight. */}
        {corrections.map((cor) => (
          <AttendanceCorrectionCard key={cor.id} complaintId={id} correction={cor} canDecide={correctionQ.data?.canDecide ?? false} onDecided={refreshAfterDecision} />
        ))}
        {/* Nothing pending, correctable ticket, still open → the reporter can say what the record
            SHOULD read, in their own name. Without this the only proposer is GIDEON, and a ticket it
            declines has no path to a BoD tap at all.
            EXP is in the list because an XP deduction is a CONSEQUENCE of a wrong attendance record —
            fixing the record is the only way to fix the XP. Keep this in step with
            CORRECTABLE_COMPLAINT_CATEGORIES in src/lib/attendance-correction.ts; the server refuses
            anything else, so a button shown here that the server rejects is just a dead end. */}
        {c && CORRECTABLE_CATEGORIES.includes(c.category) && c.status !== "CLOSED" && !corrections.some((cor) => cor.status === "PENDING") && (
          <ProposeRemedyForm complaintId={id} defaultDate={dateKeyOf(c.createdAt)} onProposed={refreshAfterDecision} />
        )}
        {c && c.status !== "OPEN" && c.resolvedAt && (c.status === "RESOLVED" || c.status === "CLOSED") && (
          <div className="py-1 text-center text-[11px] font-semibold text-muted-foreground">— {c.resolvedBy
            ? t(c.status === "RESOLVED" ? "Marked resolved by {name}" : "Closed by {name}", { name: c.resolvedBy.name })
            : t(c.status === "RESOLVED" ? "Marked resolved" : "Closed")} —</div>
        )}
      </div>

      {/* BoD status controls */}
      {c?.canManage && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2">
          {c.status !== "IN_REVIEW" && c.status !== "CLOSED" && c.status !== "RESOLVED" && <button onClick={() => setStatus.mutate("IN_REVIEW")} disabled={busy} className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 transition hover:bg-sky-100 disabled:opacity-50 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/15">{t("Take it on")}</button>}
          {c.status !== "RESOLVED" && c.status !== "CLOSED" && <button onClick={() => setStatus.mutate("RESOLVED")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15"><CheckCircle2 className="h-3.5 w-3.5" /> {t("Mark resolved")}</button>}
          {c.status !== "CLOSED" && <button onClick={() => setStatus.mutate("CLOSED")} disabled={busy} className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground transition hover:bg-accent disabled:opacity-50">{t("Close")}</button>}
          {c.status === "CLOSED" && <button onClick={() => setStatus.mutate("IN_REVIEW")} disabled={busy} className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground transition hover:bg-accent disabled:opacity-50">{t("Reopen")}</button>}
        </div>
      )}

      {/* Reply box */}
      {c?.canReply ? (
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (reply.trim().length >= 10) send.mutate(); } }}
              rows={1}
              maxLength={4000}
              placeholder={viewerIsBod ? t("Reply to this ticket…") : t("Write a reply…")}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button onClick={() => send.mutate()} disabled={busy || reply.trim().length < 10} aria-label={t("Send")} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-40">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          {reply.trim().length > 0 && reply.trim().length < 10 && (
            <p className="mt-1 pl-1 text-[11px] text-muted-foreground">{t("At least 10 characters ({n}/10)", { n: reply.trim().length })}</p>
          )}
        </div>
      ) : (
        c && <div className="border-t border-border px-4 py-3 text-center text-xs font-semibold text-muted-foreground">{t("This ticket is closed.")}</div>
      )}
      {zoom && <PhotoZoom url={zoom} onClose={() => setZoom(null)} />}
    </Backdrop>
  );
}


// Jakarta calendar day of an ISO timestamp, as the "YYYY-MM-DD" the correction API expects.
// toISOString() would answer in UTC and hand back yesterday for anything before 07:00 WIB.
function dateKeyOf(iso: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return p;
}

/**
 * The reporter's own request, in either shape.
 *
 * It writes a PROPOSAL and nothing else — same server functions GIDEON uses, same guardrails (own
 * ticket, the reporter's own attendance, one live proposal at a time). The BoD tap on the card above
 * is still the only thing that rewrites a record or moves XP, so this widens who may ask, never who
 * may decide.
 *
 * Both remedies are offered here for the same reason GIDEON has both: someone whose permit is still
 * awaiting approval, or who could not check in because NEXUS was down, does not have a wrong CLOCK to
 * type in. Offering them only the times form is asking them to invent a number to describe a problem
 * that is not about numbers.
 */
function ProposeRemedyForm({ complaintId, defaultDate, onProposed }: { complaintId: string; defaultDate: string; onProposed: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AttendanceCorrectionKind>("TIME_CORRECTION");
  const [date, setDate] = useState(defaultDate);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancelling = kind === "PENALTY_CANCELLATION";

  const propose = useMutation({
    mutationFn: () =>
      nexusApi.proposeComplaintCorrection(complaintId, {
        kind,
        date,
        // Deliberately never sent for a cancellation, even if the fields still hold something from
        // before the toggle: the server ignores them, and sending them would suggest otherwise.
        checkInAt: cancelling ? undefined : checkIn || undefined,
        checkOutAt: cancelling ? undefined : checkOut || undefined,
        reason: reason.trim(),
      }),
    onSuccess: () => { setOpen(false); setCheckIn(""); setCheckOut(""); setReason(""); setError(null); onProposed(); },
    // The server's refusals are written to be read (wrong day, ticket closed, one already pending,
    // nothing left to cancel).
    onError: (e) => setError(e instanceof ApiError ? e.message : t("Couldn't send the request.")),
  });

  const ready = !!date && reason.trim().length >= 10 && (cancelling || !!checkIn || !!checkOut);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border py-2.5 text-xs font-bold text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
        <CalendarClock className="h-3.5 w-3.5" /> {t("Request an attendance fix")}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{cancelling ? t("Request to cancel a deduction") : t("Request to correct attendance")}</span>
        <button onClick={() => setOpen(false)} aria-label={t("Close")} className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
      </div>

      {/* The choice comes first, because it changes what the rest of the form even asks for. */}
      <div className="mb-2.5 grid grid-cols-2 gap-1.5">
        {([
          { k: "TIME_CORRECTION" as const, title: t("The time is wrong"), sub: t("The recorded check-in or check-out time isn't what happened") },
          { k: "PENALTY_CANCELLATION" as const, title: t("The deduction is unfair"), sub: t("The time is right, but that day you had a permit, leave or sick day, or NEXUS was down") },
        ]).map((opt) => (
          <button key={opt.k} onClick={() => { setKind(opt.k); setError(null); }}
            className={cn("rounded-xl border px-2.5 py-2 text-left transition", kind === opt.k ? "border-primary bg-primary/5" : "border-border hover:bg-accent")}>
            <div className="text-[11px] font-bold">{opt.title}</div>
            <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{opt.sub}</div>
          </button>
        ))}
      </div>

      <p className="mb-2.5 text-[11px] leading-snug text-muted-foreground">
        {cancelling
          ? t("Your attendance times won't change. This only asks to cancel that day's XP deduction, and nothing happens until the BoD approves.")
          : t("Enter the times that should have been recorded. Your attendance doesn't change yet: this is a request waiting for BoD approval.")}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[11px] font-semibold text-muted-foreground">
          {t("Date")}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground" />
        </label>
        {!cancelling && (
          <>
            <label className="text-[11px] font-semibold text-muted-foreground">
              Check-in
              <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground" />
            </label>
            <label className="text-[11px] font-semibold text-muted-foreground">
              Check-out
              <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground" />
            </label>
          </>
        )}
      </div>

      <label className="mt-2 block text-[11px] font-semibold text-muted-foreground">
        {t("Reason")}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          placeholder={cancelling
            ? t("Why is the deduction unfair? For example: you requested a permit that day and it's still waiting for approval.")
            : t("Why is the time wrong? For example: NEXUS was down at 08:00 and your check-in didn't go through.")}
          className="mt-0.5 w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground placeholder:text-muted-foreground" />
      </label>

      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] font-semibold leading-snug text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
        </div>
      )}

      <button onClick={() => { setError(null); propose.mutate(); }} disabled={!ready || propose.isPending}
        className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
        {propose.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("Send to the BoD")}
      </button>
    </div>
  );
}

/**
 * One proposed attendance remedy on a ticket — either kind, decided here and nowhere else.
 *
 * The whole job of this card is to make the CHANGE legible. For a TIME_CORRECTION that means what the
 * record says against what is being proposed, side by side, so nobody has to hold two timestamps in
 * their head to see the difference. A null proposed time means "leave that half alone" (the server
 * merges it with the record on approval), which is why the unchanged side reads "unchanged" rather
 * than a dash — a dash would look like the approval is about to wipe a real check-out.
 *
 * A PENALTY_CANCELLATION has no such diff, and drawing an empty one would be worse than useless: it
 * would say "— → unchanged" twice and leave the approver believing the proposal does nothing. What it
 * actually does is reverse the day's XP, so that is what the card shows, next to the times that are
 * explicitly STAYING.
 */
function AttendanceCorrectionCard({ complaintId, correction, canDecide, onDecided }: { complaintId: string; correction: AttendanceCorrection; canDecide: boolean; onDecided: () => void }) {
  const { t, tn } = useLang();
  const [note, setNote] = useState("");
  const pending = correction.status === "PENDING";
  const approved = correction.status === "APPROVED";
  const st = CORRECTION_STATUS[correction.status] ?? CORRECTION_STATUS.PENDING;
  // Old rows predate the column and come back as TIME_CORRECTION; anything not explicitly the
  // cancellation is treated as the times-diff card it has always been.
  const isCancellation = correction.kind === "PENALTY_CANCELLATION";
  const penaltyXp = correction.beforePenaltyXp ?? 0;
  // Hari tanpa check-in memakan satu jatah day-off DI SAMPING XP, dan approve mengembalikan
  // dua-duanya. Kartu yang cuma menyebut XP membuat approve terlihat lebih kecil dari kenyataannya.
  const dayOffs = correction.beforeAutoDayOffs ?? 0;

  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") =>
      nexusApi.decideComplaintCorrection(complaintId, { decision, correctionId: correction.id, note: note.trim() || undefined }),
    onSuccess: () => { setNote(""); onDecided(); },
    // 409 = the world moved under this proposal (the day was edited, or somebody already decided it).
    // Refetch immediately: the explanation below tells the approver why nothing happened, and the
    // refetch makes the card itself true again instead of still offering a decision that can't be made.
    onError: (e) => { if (e instanceof ApiError && e.status === 409) onDecided(); },
  });
  const err = decide.error as Error | undefined;
  const stale = err instanceof ApiError && err.status === 409;

  const rows = [
    { label: "Check-in", before: correction.before.checkInAt, after: correction.proposedCheckInAt },
    { label: "Check-out", before: correction.before.checkOutAt, after: correction.proposedCheckOutAt },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 shadow-soft">
      <div className="flex items-center gap-1.5">
        <CalendarClock className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{isCancellation ? t("Deduction cancellation") : t("Attendance correction")}</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", st.cls)}>{t(st.label)}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Avatar userId={correction.user.id} name={correction.user.name} avatar={correction.user.avatar ?? null} size={26} />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{correction.user.name} · {fmtDay(correction.date)}</div>
          <div className="truncate text-[11px] text-muted-foreground">{t("Proposed by {name}", { name: correction.proposedBy.name })} · {fmtWhen(correction.createdAt)}</div>
        </div>
      </div>

      {/* No times move here, so the card leads with the number that does: the XP the day cost. The
          recorded clock is shown underneath precisely BECAUSE it is staying — an approver needs to see
          that approving this leaves the attendance history exactly as it stands. */}
      {/* Koreksi jam juga membalikkan potongan hari itu saat di-approve. Disebut di sini, karena
          kartu yang cuma bilang "ubah jam" membuat BoD mengira jatah day off-nya tidak ikut. */}
      {!isCancellation && pending && (penaltyXp < 0 || dayOffs > 0) && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {t("If approved, that day's deduction comes back too:")} {penaltyXp < 0 ? <b>{penaltyXp} XP</b> : null}{penaltyXp < 0 && dayOffs > 0 ? ` ${t("and")} ` : ""}{dayOffs > 0 ? <b>{tn(dayOffs, "{n} day off", "{n} days off")}</b> : null}.
        </div>
      )}
      {isCancellation ? (
        <div className="mt-2.5 rounded-xl border border-border bg-muted/30 p-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("XP deducted that day")}</span>
            <span className="ml-auto text-lg font-black tabular-nums text-rose-600 dark:text-rose-400">{penaltyXp === 0 ? "—" : penaltyXp}</span>
          </div>
          {dayOffs > 0 && (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Days off deducted")}</span>
              <span className="ml-auto text-lg font-black tabular-nums text-rose-600 dark:text-rose-400">-{dayOffs}</span>
            </div>
          )}
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {dayOffs > 0
              ? tn(dayOffs, "The request: cancel that deduction, so the XP and {n} day off both come back.", "The request: cancel that deduction, so the XP and {n} days off both come back.")
              : t("The request: cancel that deduction.")}{" "}
            {correction.before.checkInAt || correction.before.checkOutAt
              ? t("The recorded check-in and check-out times don't change at all: they stay {in} / {out}.", { in: correction.before.checkInAt ? fmtTime(correction.before.checkInAt) : "—", out: correction.before.checkOutAt ? fmtTime(correction.before.checkOutAt) : "—" })
              : t("That day has no attendance record, and it still won't have one.")}
          </p>
          {correction.before.status && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t("That day is recorded as {status}, and that doesn't change either.", { status: statusLabel(correction.before.status) })}</p>
          )}
        </div>
      ) : (
      <>
      {/* Before / after. Struck-through on the left only where the right actually replaces it. */}
      <div className="mt-2.5 rounded-xl border border-border bg-muted/30 p-2.5">
        <div className="grid grid-cols-[4.5rem_1fr_1rem_1fr] items-center gap-x-2 gap-y-1.5">
          <span />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("On record")}</span>
          <span />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Proposed")}</span>
          {rows.map((r) => {
            const changed = !!r.after;
            return (
              <Fragment key={r.label}>
                <span className="text-[11px] font-semibold text-muted-foreground">{r.label}</span>
                <span className={cn("text-sm tabular-nums", changed ? "text-muted-foreground line-through" : "font-semibold")}>{r.before ? fmtTime(r.before) : "—"}</span>
                <ArrowRight className={cn("h-3.5 w-3.5", changed ? "text-primary" : "text-transparent")} />
                <span className={cn("text-sm", changed ? "font-black tabular-nums text-emerald-600 dark:text-emerald-400" : "italic text-muted-foreground/70")}>{changed ? fmtTime(r.after) : t("unchanged")}</span>
              </Fragment>
            );
          })}
        </div>
        {correction.before.status && (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {t("That day is recorded as {status}. Late and early-leave minutes are worked out again from the new times when this is approved.", { status: statusLabel(correction.before.status) })}
          </p>
        )}
      </div>
      </>
      )}

      <div className="mt-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Reason")}</div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{correction.reason}</p>
      </div>

      {!pending && (
        <div className={cn("mt-2.5 rounded-xl border px-3 py-2 text-xs leading-snug", approved ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-border bg-muted/40 text-muted-foreground")}>
          <p className="font-bold">
            {correction.decidedBy
              ? t(approved ? "Approved by {name}" : "Rejected by {name}", { name: correction.decidedBy.name })
              : t(approved ? "Approved" : "Rejected")}{correction.decidedAt ? ` · ${fmtWhen(correction.decidedAt)}` : ""}
          </p>
          {approved && !isCancellation && <p className="mt-0.5">{t("The attendance record for {date} was changed to the proposed times.", { date: fmtDay(correction.date) })}</p>}
          {approved && !isCancellation && ((correction.refundedXp ?? 0) > 0 || (correction.restoredDayOffs ?? 0) > 0) && (
            <p className="mt-0.5">{t("Also returned:")} {(correction.refundedXp ?? 0) > 0 ? `+${correction.refundedXp} XP` : ""}{(correction.refundedXp ?? 0) > 0 && (correction.restoredDayOffs ?? 0) > 0 ? ` ${t("and")} ` : ""}{(correction.restoredDayOffs ?? 0) > 0 ? tn(correction.restoredDayOffs ?? 0, "{n} day off", "{n} days off") : ""}.</p>
          )}
          {approved && isCancellation && (
            <p className="mt-0.5">
              {typeof correction.refundedXp === "number" && correction.refundedXp > 0
                ? t("The XP deduction for {date} was cancelled: +{xp} XP returned.", { date: fmtDay(correction.date), xp: correction.refundedXp })
                : t("The XP deduction for {date} was cancelled (there was no deduction left to return).", { date: fmtDay(correction.date) })}
              {" "}{t("The attendance times were not changed.")}{" "}
              {correction.waiverGranted
                ? t("This day is now permanently free of deductions, because no request covers it and it isn't recorded as a day NEXUS was down.")
                : t("Not marked permanently: something else already holds the deduction back, so if that request is rejected later, the deduction applies again.")}
            </p>
          )}
          {correction.decisionNote && <p className="mt-1 whitespace-pre-wrap break-words italic">“{correction.decisionNote}”</p>}
        </div>
      )}

      {pending && !canDecide && (
        <p className="mt-2.5 text-[11px] font-semibold text-muted-foreground">{t("Waiting for the BoD to approve or reject this. Nothing has changed on your attendance yet.")}</p>
      )}

      {pending && canDecide && (
        <div className="mt-2.5 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder={t("Note for the reporter (optional). It goes into the thread with your decision.")}
            className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <button onClick={() => decide.mutate("APPROVE")} disabled={decide.isPending}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40">
              {decide.isPending && decide.variables === "APPROVE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("Approve")}
            </button>
            <button onClick={() => decide.mutate("REJECT")} disabled={decide.isPending}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-bold text-muted-foreground transition hover:bg-accent active:scale-[0.98] disabled:opacity-40">
              {decide.isPending && decide.variables === "REJECT" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} {t("Reject")}
            </button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {isCancellation
              ? `${dayOffs > 0
                ? tn(dayOffs, "Approving returns the XP and {n} day off deducted on {date}, and writes nothing to the attendance record.", "Approving returns the XP and {n} days off deducted on {date}, and writes nothing to the attendance record.", { date: fmtDay(correction.date) })
                : t("Approving returns the XP deducted on {date}, and writes nothing to the attendance record.", { date: fmtDay(correction.date) })} ${t("If no permit or leave request covers that day, it is also marked free of deductions so the nightly check doesn't deduct it again.")}`
              : t("Approving writes the attendance record for {date}. “On record” is how it looked when this request was made.", { date: fmtDay(correction.date) })}
          </p>
        </div>
      )}

      {/* Rendered outside the pending branch: a 409 refetches this card, and if it turns out somebody
          else already decided it, the approver still needs to read why their tap did nothing. */}
      {err && (
        <div className={cn("mt-2 rounded-xl border px-3 py-2 text-xs leading-snug", stale ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300")}>
          {stale ? (
            <>
              <p className="flex items-center gap-1.5 font-bold"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {t("Out of date. Nothing was changed.")}</p>
              <p className="mt-1 font-semibold">{err.message}</p>
              <p className="mt-1">
                {t("That day's attendance has changed since this request was made: someone edited it, or the request was already decided. Approving now would overwrite that edit, so it was refused. Check {date} on the attendance board; if the record has changed, reject this one and ask for a new request based on the current data.", { date: fmtDay(correction.date) })}
              </p>
            </>
          ) : (
            <p className="font-semibold">{err.message || t("Couldn't save that decision. Check your connection and try again.")}</p>
          )}
        </div>
      )}
    </div>
  );
}


/**
 * Full-size evidence viewer. Portaled to <body> on purpose: the thread modal animates with a transform,
 * which would turn a `position: fixed` child into a box clipped inside that modal instead of the viewport.
 */
function PhotoZoom({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useLang();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <img src={url} alt={t("Evidence, full size")} className="max-h-full max-w-full rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} aria-label={t("Close photo")} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/25"><X className="h-5 w-5" /></button>
    </motion.div>,
    document.body,
  );
}
