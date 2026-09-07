import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Ticket, Plus, X, Loader2, Send, CheckCircle2, MessageSquare, Camera, Inbox as InboxIcon, AlertTriangle, ArrowRight, Ban, CalendarClock, Check } from "lucide-react";
import { GideonMark } from "@/components/gideon/GideonMark";
import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { ApiError, fmtDate, fmtTime, nexusApi, statusLabel, type AttendanceCorrection, type Complaint } from "@/lib/nexus-api";

export const Route = createFileRoute("/_app/complaints")({ component: ComplaintsPage });

// OPEN TO EVERYONE since 2026-07-29 (was BoD-only behind "Coming Soon"). A grievance channel that
// only the bosses could open was the wrong way round — staff are the people who need to file.
// Visibility is enforced server-side, not here: GET /api/complaints scopes non-BoD viewers to
// `reporterId: me`, so a staff member sees only their own tickets while BoD see all of them.

const CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: "ATTENDANCE", label: "Attendance", emoji: "🕐" },
  { key: "EXP", label: "EXP / Gamification", emoji: "⭐" },
  { key: "DAY_OFF", label: "Leave / Day-Off", emoji: "🌴" },
  { key: "OTHER", label: "Other", emoji: "💬" },
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
  OPEN: { label: "Open", cls: "bg-amber-100 text-amber-700 ring-amber-200" },
  AWAITING_DECISION: { label: "Awaiting decision", cls: "bg-violet-100 text-violet-700 ring-violet-200" },
  IN_REVIEW: { label: "In review", cls: "bg-sky-100 text-sky-700 ring-sky-200" },
  RESOLVED: { label: "Resolved", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
  CLOSED: { label: "Closed", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
};
// A status this build has never heard of gets a neutral chip and its own name Title-Cased, rather
// than an undefined lookup that takes the whole list down with it. The server enum grows; a deployed
// bundle does not.
const statusOf = (key: string) => STATUS[key] ?? { label: statusLabel(key), cls: "bg-slate-100 text-slate-500 ring-slate-200" };
// The BoD inbox = every ticket nobody has claimed. Mirror of COMPLAINT_INBOX_STATUSES in
// src/lib/complaints.ts. Asked for by name rather than leaning on the server widening a bare "OPEN"
// (that widening exists for older clients): a ticket GIDEON answered is still unclaimed work.
const INBOX_STATUS = "OPEN,AWAITING_DECISION";
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const CORRECTION_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Awaiting decision", cls: "bg-amber-100 text-amber-700 ring-amber-200" },
  APPROVED: { label: "Approved", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
  REJECTED: { label: "Rejected", cls: "bg-rose-100 text-rose-700 ring-rose-200" },
};
// Keep in sync with EVIDENCE_MAX_COUNT in src/app/api/complaints/route.ts — the server rejects past this.
const MAX_PHOTOS = 5;
// Mirror of CORRECTABLE_COMPLAINT_CATEGORIES in src/lib/attendance-correction.ts.
const CORRECTABLE_CATEGORIES = ["ATTENDANCE", "EXP"];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

type Tab = "open" | "review" | "all";

function ComplaintsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("open");
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const roleQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const viewerIsBod = ["ONE_ABOVE_ALL", "BOD"].includes(roleQ.data?.role ?? "");

  // BoD filter by status; staff just see their own thread list.
  const status = !viewerIsBod ? "ALL" : tab === "open" ? INBOX_STATUS : tab === "review" ? "IN_REVIEW" : "ALL";
  const listQ = useQuery({ queryKey: ["complaints", viewerIsBod ? status : "MINE"], queryFn: () => nexusApi.complaints(status) });
  // Tickets with a decision waiting float to the top; everything else keeps the server's own
  // lastMessageAt-desc order (Array#sort is stable, so the two orders compose). Tickets GIDEON merely
  // ANSWERED are deliberately not floated — a queue sorted "assistant first" buries the genuinely
  // new, unread tickets under a pile of replies. Those get the chip and the marker instead.
  const complaints = useMemo(
    () => [...(listQ.data?.complaints ?? [])].sort((a, b) => Number(b.pendingCorrection) - Number(a.pendingCorrection)),
    [listQ.data],
  );
  // counts.OPEN is what ?status=OPEN returns, i.e. the whole inbox (OPEN + AWAITING_DECISION) — the
  // server widens it so this badge can never disagree with the list under it.
  const counts = listQ.data?.counts ?? {};

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["complaints"] }); };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Ticket"
        subtitle="A direct line to the BoD for ops/HR issues. Only the BoD can read it."
        icon={<Ticket className="h-6 w-6 text-primary" />}
        actions={<button onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground shadow-sm transition active:scale-[0.97]"><Plus className="h-4 w-4" /> Submit a complaint</button>}
      />

      {viewerIsBod && (
        <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
          {([["open", "Inbox"], ["review", "In review"], ["all", "All"]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className="relative shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold transition">
              {tab === t && <motion.span layoutId="complaint-tab" className="absolute inset-0 rounded-lg bg-primary" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
              <span className={cn("relative flex items-center gap-1.5", tab === t ? "text-primary-foreground" : "text-muted-foreground")}>
                {label}
                {t === "open" && (counts.OPEN ?? 0) > 0 && <span className={cn("rounded-full px-1.5 text-[10px] font-black tabular-nums", tab === t ? "bg-primary-foreground/20" : "bg-amber-100 text-amber-700")}>{counts.OPEN}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        {listQ.isLoading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-card" />)}
        {!listQ.isLoading && complaints.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><InboxIcon className="h-7 w-7" /></div>
            <div className="text-base font-black">{viewerIsBod ? "No complaints here yet" : "No complaints yet"}</div>
            <p className="mt-1 text-sm text-muted-foreground">{viewerIsBod ? "Complaints from staff will show up here." : "Got an ops / HR issue? Send it to the BoD here."}</p>
          </div>
        )}
        {complaints.map((c) => <ComplaintCard key={c.id} c={c} viewerIsBod={viewerIsBod} onOpen={() => setOpenId(c.id)} />)}
      </div>

      <AnimatePresence>
        {composing && <Composer onClose={() => setComposing(false)} onDone={() => { setComposing(false); invalidate(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {openId && <ComplaintThread id={openId} viewerIsBod={viewerIsBod} onClose={() => setOpenId(null)} onChanged={invalidate} />}
      </AnimatePresence>
    </div>
  );
}

function ComplaintCard({ c, viewerIsBod, onOpen }: { c: Complaint; viewerIsBod: boolean; onOpen: () => void }) {
  const st = statusOf(c.status);
  const cat = catOf(c.category);
  const who = viewerIsBod ? (c.reporter?.name ?? "—") : "You";
  return (
    <button onClick={onOpen} className="block w-full rounded-2xl border border-border bg-card p-3.5 text-left shadow-soft transition hover:border-primary/40 hover:shadow-pop active:scale-[0.99]">
      <div className="flex items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", st.cls)}>{st.label}</span>
        <span className="text-xs font-semibold text-muted-foreground">{cat?.emoji} {cat?.label}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{fmtWhen(c.lastMessageAt)}</span>
      </div>
      <div className="mt-1.5 line-clamp-1 text-sm font-bold">{c.subject}</div>
      {/* The two things the row could never say before: GIDEON has been in here, and there is a
          decision sitting unmade. Both come straight off /api/complaints (see the list markers in
          src/lib/complaints.ts) and both are independent of the chip above — a ticket a director has
          already taken on still shows the proposal waiting inside it. */}
      {(c.pendingCorrection || c.gideonReplied) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {c.pendingCorrection && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200">
              <CalendarClock className="h-3 w-3" /> Decision waiting
            </span>
          )}
          {c.gideonReplied && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              <GideonMark className="h-3 w-3" /> GIDEON replied
            </span>
          )}
        </div>
      )}
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MessageSquare className="h-3 w-3" /> {c.messageCount} message{c.messageCount === 1 ? "" : "s"} · {viewerIsBod ? `from ${who}` : "your complaint"}
      </div>
    </button>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Composer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
      tooBig > 0 ? `Skipped ${tooBig} photo${tooBig === 1 ? "" : "s"} over 8MB.`
        : kept.length > room ? `Kept the first ${MAX_PHOTOS} photos.`
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
        <h2 className="text-lg font-black">Submit a complaint</h2>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-4 overflow-y-auto p-5">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.key} onClick={() => setCategory(c.key)} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition", category === c.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Short title</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} placeholder="e.g. My leave balance got deducted wrong this month" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tell us what happened</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} placeholder="Describe the issue in as much detail as you can — what happened, when, and what you're hoping for." className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <p className="text-right text-[11px] text-muted-foreground">{body.trim().length}/4000</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Photo evidence <span className="text-rose-500">*required</span></label>
            {evidence.length > 0 && <span className="text-[11px] font-semibold text-muted-foreground">{evidence.length}/{MAX_PHOTOS}</span>}
          </div>
          {evidence.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {previews.map((url, i) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-xl border border-border">
                  <img src={url} alt={`Evidence ${i + 1}`} className="h-full w-full object-cover" />
                  <button onClick={() => setEvidence((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {evidence.length < MAX_PHOTOS && (
                <button onClick={() => fileRef.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-background text-muted-foreground transition hover:border-primary/40 hover:text-primary">
                  <Plus className="h-5 w-5" />
                  <span className="text-[11px] font-semibold">Add photo</span>
                </button>
              )}
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-background py-6 text-muted-foreground transition hover:border-primary/40 hover:text-primary">
              <Camera className="h-6 w-6" />
              <span className="text-sm font-semibold">Take / pick photos for evidence</span>
              <span className="text-[11px]">Up to {MAX_PHOTOS} photos — you can pick several at once</span>
            </button>
          )}
          {/* NO `capture` on purpose: it forces the phone straight into the camera, and the evidence
              people actually have is a SCREENSHOT already sitting in their gallery. Without it the
              OS shows its normal chooser (Photo Library / Take Photo / Files), so both still work.
              The attendance selfie inputs keep `capture="user"` — there a live shot is the point. */}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          {fileNote && <p className="text-[11px] font-semibold text-amber-600">{fileNote}</p>}
        </div>

        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800">
          🔒 Only the <b>BoD</b> can read this complaint — it won't hit the feed or be seen by other staff. The BoD will reply right here.
        </div>
        {create.isError && <p className="text-sm font-semibold text-rose-600">{(create.error as Error)?.message || "Couldn't send. Check your connection."}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">Cancel</button>
        <button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />} Send complaint
        </button>
      </div>
    </Backdrop>
  );
}

function ComplaintThread({ id, viewerIsBod, onClose, onChanged }: { id: string; viewerIsBod: boolean; onClose: () => void; onChanged: () => void }) {
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
            {st && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", st.cls)}>{st.label}</span>}
            <span className="truncate text-xs font-semibold text-muted-foreground">{cat?.emoji} {cat?.label}</span>
          </div>
          <div className="mt-0.5 line-clamp-1 text-sm font-black">{c?.subject ?? "…"}</div>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
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
              <Camera className="h-3.5 w-3.5" /> Photo evidence{c.attachments.length > 1 && <span className="font-semibold normal-case tracking-normal">· {c.attachments.length} photos</span>}
            </div>
            {/* A single photo keeps the full-width look it always had; several tile into a grid so the
                whole set is visible at once instead of hidden behind a carousel. Tap to see it full size. */}
            {c.attachments.length === 1 ? (
              <button onClick={() => setZoom(c.attachments[0].url)} className="block w-full">
                <img src={c.attachments[0].url} alt="Evidence" className="max-h-80 w-full rounded-xl border border-border object-contain" />
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {c.attachments.map((a, i) => (
                  <button key={a.id} onClick={() => setZoom(a.url)} aria-label={`Open evidence photo ${i + 1} full size`}
                    className="aspect-[4/3] overflow-hidden rounded-xl border border-border transition hover:border-primary/50">
                    <img src={a.url} alt={`Evidence ${i + 1}`} className="h-full w-full object-cover" />
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
          <ProposeCorrectionForm complaintId={id} defaultDate={dateKeyOf(c.createdAt)} onProposed={refreshAfterDecision} />
        )}
        {c && c.status !== "OPEN" && c.resolvedAt && (c.status === "RESOLVED" || c.status === "CLOSED") && (
          <div className="py-1 text-center text-[11px] font-semibold text-muted-foreground">— {c.status === "RESOLVED" ? "Marked resolved" : "Closed"} {c.resolvedBy ? `by ${c.resolvedBy.name}` : ""} —</div>
        )}
      </div>

      {/* BoD status controls */}
      {c?.canManage && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2">
          {c.status !== "IN_REVIEW" && c.status !== "CLOSED" && c.status !== "RESOLVED" && <button onClick={() => setStatus.mutate("IN_REVIEW")} disabled={busy} className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 transition hover:bg-sky-100 disabled:opacity-50">Take it on</button>}
          {c.status !== "RESOLVED" && c.status !== "CLOSED" && <button onClick={() => setStatus.mutate("RESOLVED")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Mark resolved</button>}
          {c.status !== "CLOSED" && <button onClick={() => setStatus.mutate("CLOSED")} disabled={busy} className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground transition hover:bg-accent disabled:opacity-50">Close</button>}
          {c.status === "CLOSED" && <button onClick={() => setStatus.mutate("IN_REVIEW")} disabled={busy} className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground transition hover:bg-accent disabled:opacity-50">Reopen</button>}
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
              placeholder={viewerIsBod ? "Reply to this complaint…" : "Write a reply…"}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button onClick={() => send.mutate()} disabled={busy || reply.trim().length < 10} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-40">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          {reply.trim().length > 0 && reply.trim().length < 10 && (
            <p className="mt-1 pl-1 text-[11px] text-muted-foreground">At least 10 characters ({reply.trim().length}/10)</p>
          )}
        </div>
      ) : (
        c && <div className="border-t border-border px-4 py-3 text-center text-xs font-semibold text-muted-foreground">This complaint has been closed.</div>
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
 * The reporter's own correction request.
 *
 * It writes a PROPOSAL and nothing else — same server function GIDEON uses, same guardrails (own
 * ticket, the reporter's own attendance, one live proposal at a time). The BoD tap on the card above
 * is still the only thing that rewrites a record, so this widens who may ask, never who may decide.
 */
function ProposeCorrectionForm({ complaintId, defaultDate, onProposed }: { complaintId: string; defaultDate: string; onProposed: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const propose = useMutation({
    mutationFn: () =>
      nexusApi.proposeComplaintCorrection(complaintId, {
        date,
        checkInAt: checkIn || undefined,
        checkOutAt: checkOut || undefined,
        reason: reason.trim(),
      }),
    onSuccess: () => { setOpen(false); setCheckIn(""); setCheckOut(""); setReason(""); setError(null); onProposed(); },
    // The server's refusals are written to be read (wrong day, ticket closed, one already pending).
    onError: (e) => setError(e instanceof ApiError ? e.message : "Gagal mengirim usulan."),
  });

  const ready = !!date && (!!checkIn || !!checkOut) && reason.trim().length >= 10;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border py-2.5 text-xs font-bold text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
        <CalendarClock className="h-3.5 w-3.5" /> Ajukan koreksi absen
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Usulan koreksi absen</span>
        <button onClick={() => setOpen(false)} className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
      </div>
      <p className="mb-2.5 text-[11px] leading-snug text-muted-foreground">Isi jam yang seharusnya tercatat. Absen kamu <b>belum berubah</b> — ini cuma usulan yang nunggu approve BoD.</p>

      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[11px] font-semibold text-muted-foreground">
          Tanggal
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground" />
        </label>
        <label className="text-[11px] font-semibold text-muted-foreground">
          Check-in
          <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground" />
        </label>
        <label className="text-[11px] font-semibold text-muted-foreground">
          Check-out
          <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground" />
        </label>
      </div>

      <label className="mt-2 block text-[11px] font-semibold text-muted-foreground">
        Alasan
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Kenapa jamnya salah? Contoh: server NEXUS down jam 08.00, absen gagal kekirim."
          className="mt-0.5 w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground placeholder:text-muted-foreground" />
      </label>

      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] font-semibold leading-snug text-rose-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
        </div>
      )}

      <button onClick={() => { setError(null); propose.mutate(); }} disabled={!ready || propose.isPending}
        className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
        {propose.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Kirim ke BoD
      </button>
    </div>
  );
}

/**
 * One proposed attendance correction on a ticket.
 *
 * The whole job of this card is to make the CHANGE legible: what the record says against what is being
 * proposed, side by side, so nobody has to hold two timestamps in their head to see the difference.
 * A null proposed time means "leave that half alone" (the server merges it with the record on approval),
 * which is why the unchanged side reads "unchanged" rather than a dash — a dash would look like the
 * approval is about to wipe a real check-out.
 */
function AttendanceCorrectionCard({ complaintId, correction, canDecide, onDecided }: { complaintId: string; correction: AttendanceCorrection; canDecide: boolean; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const pending = correction.status === "PENDING";
  const approved = correction.status === "APPROVED";
  const st = CORRECTION_STATUS[correction.status] ?? CORRECTION_STATUS.PENDING;

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
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Attendance correction</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", st.cls)}>{st.label}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Avatar userId={correction.user.id} name={correction.user.name} avatar={correction.user.avatar ?? null} size={26} />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{correction.user.name} · {fmtDate(correction.date)}</div>
          <div className="truncate text-[11px] text-muted-foreground">Proposed by {correction.proposedBy.name} · {fmtWhen(correction.createdAt)}</div>
        </div>
      </div>

      {/* Before / after. Struck-through on the left only where the right actually replaces it. */}
      <div className="mt-2.5 rounded-xl border border-border bg-muted/30 p-2.5">
        <div className="grid grid-cols-[4.5rem_1fr_1rem_1fr] items-center gap-x-2 gap-y-1.5">
          <span />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">On record</span>
          <span />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Proposed</span>
          {rows.map((r) => {
            const changed = !!r.after;
            return (
              <Fragment key={r.label}>
                <span className="text-[11px] font-semibold text-muted-foreground">{r.label}</span>
                <span className={cn("text-sm tabular-nums", changed ? "text-muted-foreground line-through" : "font-semibold")}>{r.before ? fmtTime(r.before) : "—"}</span>
                <ArrowRight className={cn("h-3.5 w-3.5", changed ? "text-primary" : "text-transparent")} />
                <span className={cn("text-sm", changed ? "font-black tabular-nums text-emerald-600" : "italic text-muted-foreground/70")}>{changed ? fmtTime(r.after) : "unchanged"}</span>
              </Fragment>
            );
          })}
        </div>
        {correction.before.status && (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            That day is recorded as <b>{statusLabel(correction.before.status)}</b>. Late / early-leave minutes are recalculated from the new times on approval.
          </p>
        )}
      </div>

      <div className="mt-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Reason</div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{correction.reason}</p>
      </div>

      {!pending && (
        <div className={cn("mt-2.5 rounded-xl border px-3 py-2 text-xs leading-snug", approved ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-muted/40 text-muted-foreground")}>
          <p className="font-bold">
            {approved ? "Approved" : "Rejected"}{correction.decidedBy ? ` by ${correction.decidedBy.name}` : ""}{correction.decidedAt ? ` · ${fmtWhen(correction.decidedAt)}` : ""}
          </p>
          {approved && <p className="mt-0.5">The attendance record for {fmtDate(correction.date)} was rewritten to the proposed times.</p>}
          {correction.decisionNote && <p className="mt-1 whitespace-pre-wrap break-words italic">“{correction.decisionNote}”</p>}
        </div>
      )}

      {pending && !canDecide && (
        <p className="mt-2.5 text-[11px] font-semibold text-muted-foreground">Waiting for the BoD to approve or reject this. Nothing has changed on your attendance yet.</p>
      )}

      {pending && canDecide && (
        <div className="mt-2.5 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Note for the reporter (optional) — it goes into the thread with your decision."
            className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <button onClick={() => decide.mutate("APPROVE")} disabled={decide.isPending}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40">
              {decide.isPending && decide.variables === "APPROVE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
            </button>
            <button onClick={() => decide.mutate("REJECT")} disabled={decide.isPending}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-bold text-muted-foreground transition hover:bg-accent active:scale-[0.98] disabled:opacity-40">
              {decide.isPending && decide.variables === "REJECT" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Reject
            </button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">Approving writes the attendance record for {fmtDate(correction.date)}. “On record” is the snapshot taken when this proposal was written.</p>
        </div>
      )}

      {/* Rendered outside the pending branch: a 409 refetches this card, and if it turns out somebody
          else already decided it, the approver still needs to read why their tap did nothing. */}
      {err && (
        <div className={cn("mt-2 rounded-xl border px-3 py-2 text-xs leading-snug", stale ? "border-amber-300 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-700")}>
          {stale ? (
            <>
              <p className="flex items-center gap-1.5 font-bold"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Out of date — nothing was changed.</p>
              <p className="mt-1 font-semibold">{err.message}</p>
              <p className="mt-1">
                That day&rsquo;s attendance no longer matches what this proposal was written against — someone edited it in the meantime,
                or the proposal was already decided. Approving now would have overwritten that edit, so the server refused.
                Re-check {fmtDate(correction.date)} on the attendance board; if the record has moved on, reject this one and ask for a fresh proposal from the current data.
              </p>
            </>
          ) : (
            <p className="font-semibold">{err.message || "Couldn't save that decision. Check your connection and try again."}</p>
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <img src={url} alt="Evidence, full size" className="max-h-full max-w-full rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} aria-label="Close photo" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/25"><X className="h-5 w-5" /></button>
    </motion.div>,
    document.body,
  );
}
