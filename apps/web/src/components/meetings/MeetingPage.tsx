import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, AudioLines, Calendar, Check, ChevronDown, ChevronRight, CircleDot, Clock, FileText, FolderKanban, Languages, ListChecks, Loader2,
  MoreHorizontal, Plus, RefreshCw, Search, Trash2, User, UserPlus, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SelectPicker } from "@/components/SelectPicker";
import { DateField } from "@/components/DateField";
import { Avatar } from "@/components/Avatar";
import { PeoplePicker } from "@/components/tasks/TaskComposer";
import { LoadError } from "@/components/LoadError";
import { GideonMark } from "@/components/gideon/GideonMark";
import { nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import {
  applyMeeting, clock, deleteMeeting, durationText, etaText, MeetingApiError, meetingKey, patchMeeting, retryMeeting, speakerIndex, speakerLabelsOf, useMeeting,
  type MeetingFull, type Mom, type SpeakerMap, type TaskProposal,
} from "@/lib/meetings";
import { BetaBadge } from "./BetaBadge";

type Draft = { title: string; overview: string; mom: Mom; proposals: TaskProposal[] };
const EMPTY_MOM: Mom = { attendees: [], topics: [], decisions: [], openQuestions: [], actionItems: [] };

function draftOf(m: MeetingFull): Draft {
  return { title: m.title, overview: m.overview ?? "", mom: m.mom ?? EMPTY_MOM, proposals: m.proposals ?? [] };
}

const STATUS_STYLE: Record<string, string> = {
  UPLOADING: "bg-muted text-muted-foreground",
  QUEUED: "bg-muted text-muted-foreground",
  TRANSCRIBING: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  SUMMARIZING: "bg-accent text-sidebar-primary",
  READY: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  APPLYING: "bg-accent text-sidebar-primary",
  APPLIED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  FAILED: "bg-destructive/10 text-destructive",
};
export const STATUS_LABEL: Record<string, string> = {
  UPLOADING: "Uploading",
  QUEUED: "Waiting to transcribe",
  TRANSCRIBING: "Transcribing",
  SUMMARIZING: "Writing minutes",
  READY: "Ready to review",
  APPLYING: "Saving",
  APPLIED: "Saved",
  FAILED: "Failed",
};

export function MeetingStatusChip({ status, waiting, className }: { status: string; waiting?: boolean; className?: string }) {
  const { t } = useLang();
  // Waiting for the transcriber (in line, or the GPU is busy) reads as waiting, not as a transcript in progress.
  const s = waiting && (status === "TRANSCRIBING" || status === "QUEUED") ? "QUEUED" : status;
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[s] ?? STATUS_STYLE.QUEUED, className)}>
    {s === "QUEUED" ? <Clock className="h-3 w-3" /> : ["TRANSCRIBING", "SUMMARIZING", "APPLYING"].includes(s) ? <Loader2 className="h-3 w-3 animate-spin" /> : <CircleDot className="h-3 w-3" />}
    {t(STATUS_LABEL[s] ?? s)}
  </span>;
}

export function MeetingPage({ id }: { id: string }) {
  const { t, lang } = useLang();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useMeeting(id);
  const m = q.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const dirty = useRef(false);
  const version = useRef<number>(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRedo, setConfirmRedo] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Server copy → the draft, unless the person has unsaved edits.
  useEffect(() => {
    if (!m) return;
    if (!dirty.current || !draft) { setDraft(draftOf(m)); version.current = m.version; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m]);

  const editable = Boolean(m?.can.edit && m.status === "READY");
  const titleEditable = Boolean(m?.can.edit);

  const flush = useCallback(async (d: Draft) => {
    if (!m) return;
    setSaveState("saving");
    try {
      const body: Record<string, unknown> = { version: version.current, title: d.title };
      if (m.status === "READY") Object.assign(body, { overview: d.overview, mom: d.mom, proposals: d.proposals });
      const r = await patchMeeting(m.id, body);
      version.current = r.meeting.version;
      dirty.current = false;
      qc.setQueryData(meetingKey(m.id), r.meeting);
      setSaveState("saved");
    } catch (e) {
      if (e instanceof MeetingApiError && e.code === "VERSION_CONFLICT") {
        const fresh = (e.body?.meeting ?? null) as MeetingFull | null;
        dirty.current = false;
        if (fresh) { qc.setQueryData(meetingKey(m.id), fresh); setDraft(draftOf(fresh)); version.current = fresh.version; }
        toast.warning(t("Someone else changed these minutes. Their version is shown now."));
        setSaveState("idle");
      } else {
        setSaveState("error");
      }
    }
  }, [m, qc, t]);

  const update = (fn: (d: Draft) => Draft) => {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      dirty.current = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(next), 900);
      return next;
    });
  };
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  const projects = useQuery({ queryKey: ["nexus", "projects"], queryFn: () => nexusApi.projects(), enabled: Boolean(m?.can.edit && m.status !== "APPLIED"), staleTime: 60_000 });
  const projectOptions = useMemo(() => {
    const list = (projects.data ?? []).filter((p) => !p.viewerAccessLevel || p.viewerAccessLevel === "EDIT" || p.viewerAccessLevel === "FULL").map((p) => ({ value: p.id, label: p.name }));
    if (m?.project && !list.some((o) => o.value === m.project!.id)) list.unshift({ value: m.project.id, label: m.project.name });
    return list;
  }, [projects.data, m?.project]);

  const setProject = async (pid: string) => {
    if (!m) return;
    try {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const r = await patchMeeting(m.id, { version: version.current, projectId: pid || null, ...(draft && m.status === "READY" ? { proposals: draft.proposals.map((p) => ({ ...p, assigneeIds: [] })) } : {}) });
      version.current = r.meeting.version;
      dirty.current = false;
      qc.setQueryData(meetingKey(m.id), r.meeting);
      setDraft(draftOf(r.meeting));
      if (draft?.proposals.some((p) => p.assigneeIds.length)) toast(t("Project changed: pick the people for each task again from its members."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Couldn't save."));
    }
  };

  const apply = async () => {
    if (!m || !draft || applying) return;
    if (!m.projectId) { toast.error(t("Pick a project first.")); return; }
    setApplying(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    try {
      const r = await applyMeeting(m.id, { projectId: m.projectId, title: draft.title, overview: draft.overview, mom: draft.mom, proposals: draft.proposals, lang });
      dirty.current = false;
      qc.setQueryData(meetingKey(m.id), r.meeting);
      void qc.invalidateQueries({ queryKey: ["nexus"] });
      toast.success(r.tasks.length ? t("Minutes saved and {n} tasks created", { n: r.tasks.length }) : t("Minutes saved"), { action: { label: t("Open"), onClick: () => router.history.push(r.doc.url) } });
    } catch (e) {
      if (e instanceof MeetingApiError && e.code === "ALREADY_APPLIED") {
        const fresh = (e.body?.meeting ?? null) as MeetingFull | null;
        if (fresh) qc.setQueryData(meetingKey(m.id), fresh);
        toast(t("These minutes were already saved."));
      } else toast.error(e instanceof Error ? e.message : t("Couldn't save."));
    } finally {
      setApplying(false);
    }
  };

  const retry = async (stage?: "minutes") => {
    if (!m) return;
    try {
      const r = await retryMeeting(m.id, stage);
      dirty.current = false;
      qc.setQueryData(meetingKey(m.id), r.meeting);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Couldn't start it again."));
    }
  };

  const remove = async () => {
    if (!m) return;
    try {
      await deleteMeeting(m.id);
      toast.success(t("Meeting deleted. It can be restored from Control Room › Audit."));
      router.history.push("/meetings");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Couldn't delete."));
    }
  };

  if (q.isLoading) return <div className="mx-auto w-full max-w-[860px] space-y-3 px-4 py-10 md:px-8" aria-busy>{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />)}</div>;
  if (q.isError || !m || !draft) return <div className="mx-auto w-full max-w-[860px] px-4 py-10 md:px-8"><LoadError error={q.error} onRetry={() => void q.refetch()} /></div>;

  const included = draft.proposals.filter((p) => p.include);
  const members = m.members ?? [];
  const langLabel = (l: string | null) => (l === "id" ? t("Indonesian") : l === "en" ? t("English") : l ? l.toUpperCase() : t("Detect automatically"));
  const speakerMap: SpeakerMap = m.speakers ?? {};
  const voices = speakerLabelsOf(m.transcript);
  const canNameSpeakers = Boolean(m.can.edit && m.status !== "APPLIED" && m.status !== "APPLYING");
  const saveSpeakers = async (next: SpeakerMap) => {
    try {
      const r = await patchMeeting(m.id, { version: version.current, speakers: next });
      version.current = r.meeting.version;
      qc.setQueryData(meetingKey(m.id), r.meeting);
      if (m.status === "READY") toast(t("Saved. To use the new names in the minutes, choose Write the minutes again."));
    } catch (e) {
      if (e instanceof MeetingApiError && e.code === "VERSION_CONFLICT") {
        const fresh = (e.body?.meeting ?? null) as MeetingFull | null;
        if (fresh) { qc.setQueryData(meetingKey(m.id), fresh); version.current = fresh.version; }
        toast.warning(t("Someone else changed this meeting. It has been reloaded."));
      } else toast.error(e instanceof Error ? e.message : t("Couldn't save."));
    }
  };
  const seek = (sec: number) => { const a = audioRef.current; if (a) { a.currentTime = sec; void a.play().catch(() => {}); } };

  return (
    <div className="min-h-dvh bg-card pb-28">
      <div className="mx-auto w-full max-w-[860px] px-4 pt-4 md:px-8 md:pt-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/meetings" className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted hover:text-foreground"><GideonMark className="h-3.5 w-3.5" />{t("Meeting notes")}</Link>
          <BetaBadge />
          <div className="flex-1" />
          {saveState !== "idle" && m.can.edit && (
            <span className="text-xs tabular-nums" aria-live="polite">{saveState === "saving" ? t("Saving…") : saveState === "saved" ? t("Saved") : <button type="button" onClick={() => draft && void flush(draft)} className="font-medium text-destructive hover:underline">{t("Couldn't save. Retry")}</button>}</span>
          )}
          {(m.can.delete || m.can.retry) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label={t("More")} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {m.can.retry && m.status === "READY" && <DropdownMenuItem onSelect={() => setConfirmRedo(true)}><RefreshCw className="mr-2 h-4 w-4" />{t("Write the minutes again")}</DropdownMenuItem>}
                {m.can.retry && m.can.delete && m.status === "READY" && <DropdownMenuSeparator />}
                {m.can.delete && <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />{t("Delete meeting")}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <AutoText
          value={draft.title}
          onChange={(v) => update((d) => ({ ...d, title: v.replace(/\s*\n+\s*/g, " ") }))}
          readOnly={!titleEditable}
          placeholder={t("Untitled meeting")}
          ariaLabel={t("Title")}
          keepFont
          className="-mx-1 mt-4 text-[28px] font-bold leading-tight tracking-tight placeholder:text-muted-foreground/50 md:text-[34px]"
        />

        <dl className="mt-4 grid grid-cols-[minmax(7rem,9rem)_1fr] gap-x-3 gap-y-1.5 text-sm">
          <Prop icon={CircleDot} label={t("Status")}><MeetingStatusChip status={m.status} waiting={m.queue?.waiting} /></Prop>
          <Prop icon={FolderKanban} label={t("Project")}>
            {m.can.edit && m.status !== "APPLIED" && m.status !== "APPLYING" ? (
              <SelectPicker size="sm" value={m.projectId ?? ""} onChange={(v) => void setProject(v)} options={projectOptions} placeholder={t("Choose a project")} ariaLabel={t("Project")} className="-ml-1.5 max-w-full" />
            ) : m.project ? <Link to="/projects/$projectId" params={{ projectId: m.project.id }} className="truncate hover:underline">{m.project.name}</Link> : <span className="text-muted-foreground">—</span>}
          </Prop>
          <Prop icon={Calendar} label={t("Date")}><span className="tabular-nums">{new Date(m.recordedAt ?? m.createdAt).toLocaleString(lang === "id" ? "id-ID" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></Prop>
          {m.durationSec ? <Prop icon={Clock} label={t("Duration")}><span>{durationText(m.durationSec, t)}</span></Prop> : null}
          <Prop icon={Languages} label={t("Language")}><span>{langLabel(m.detectedLanguage ?? (m.language === "auto" ? null : m.language))}</span></Prop>
          <Prop icon={User} label={t("Recorded by")}><span className="inline-flex min-w-0 items-center gap-1.5"><Avatar userId={m.createdBy.id} name={m.createdBy.name} avatar={m.createdBy.avatar} size={20} /><span className="truncate">{m.createdBy.name}</span></span></Prop>
          <Prop icon={AudioLines} label={t("Audio")}>
            {m.audio.available ? (
              <audio ref={audioRef} controls preload="none" src={`/api/meetings/${m.id}/audio`} className="h-8 w-full max-w-sm" />
            ) : (
              <span className="text-muted-foreground">{m.audio.deletedAt ? t("Deleted") : t("Not uploaded yet")}</span>
            )}
          </Prop>
          {m.audio.available && m.audio.deleteAfter && <dd className="col-start-2 -mt-1 text-xs text-muted-foreground">{t("The audio is deleted on {date}. The transcript and minutes stay.", { date: new Date(m.audio.deleteAfter).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" }) })}</dd>}
        </dl>

        <div className="my-6 h-px bg-border" />

        {(["UPLOADING", "QUEUED", "TRANSCRIBING", "SUMMARIZING"] as const).includes(m.status as never) && <Pipeline m={m} />}

        {m.status === "FAILED" && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{t("This didn't work")}</div>
                <p className="mt-0.5 text-sm text-muted-foreground">{m.error ? t(m.error) : t("Something went wrong.")}</p>
                {m.can.retry && !(m.errorCode === "unsupported_type" || m.errorCode === "too_long" || m.errorCode === "undecodable" || m.errorCode === "upload_abandoned" || (m.audio.deletedAt && !m.transcript.length)) && (
                  <button type="button" onClick={() => void retry()} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-sidebar-primary px-3 text-sm font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary/90"><RefreshCw className="h-3.5 w-3.5" />{t("Try again")}</button>
                )}
              </div>
            </div>
          </div>
        )}

        {m.status === "APPLIED" && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
            <Check className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold">{m.taskCount ? t("Minutes saved and {n} tasks created", { n: m.taskCount }) : t("Minutes saved")}</div>
              {m.project && <div className="text-muted-foreground">{t("In {project}. Edit the minutes in the page from now on.", { project: m.project.name })}</div>}
            </div>
            {m.doc && <Link to="/docs/$docId" params={{ docId: m.doc.id }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-accent"><FileText className="h-3.5 w-3.5" />{t("Open minutes")}</Link>}
          </div>
        )}

        {(m.status === "READY" || m.status === "APPLYING" || m.status === "APPLIED") && (
          <>
            <Section title={t("Overview")}>
              <AutoText value={draft.overview} onChange={(v) => update((d) => ({ ...d, overview: v }))} readOnly={!editable} placeholder={t("What the meeting was about and what came out of it.")} className="text-[15px] leading-relaxed" />
            </Section>

            <Section title={t("Minutes of meeting")}>
              <SubHead>{t("Attendees")}</SubHead>
              <Attendees value={draft.mom.attendees} members={members} readOnly={!editable} onChange={(v) => update((d) => ({ ...d, mom: { ...d.mom, attendees: v } }))} />
              <p className="mt-1 text-xs text-muted-foreground">{voices.length ? t("Names come from the introductions at the start. If a voice is wrong, fix it under Speakers below the minutes.") : t("The transcript has no speaker names. Add who was there so GIDEON's minutes and your tasks name the right people.")}</p>

              <SubHead>{t("Topics")}</SubHead>
              <div className="space-y-3">
                {draft.mom.topics.map((tp, i) => (
                  <div key={i} className="group rounded-lg border border-transparent px-1 py-1 hover:border-border">
                    <div className="flex items-center gap-2">
                      <input value={tp.title} readOnly={!editable} onChange={(e) => update((d) => ({ ...d, mom: { ...d.mom, topics: d.mom.topics.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) } }))} placeholder={t("Topic")} className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none" />
                      {editable && <button type="button" aria-label={t("Remove topic")} onClick={() => update((d) => ({ ...d, mom: { ...d.mom, topics: d.mom.topics.filter((_, k) => k !== i) } }))} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"><X className="h-3.5 w-3.5" /></button>}
                    </div>
                    <Lines value={tp.points} readOnly={!editable} onChange={(v) => update((d) => ({ ...d, mom: { ...d.mom, topics: d.mom.topics.map((x, k) => (k === i ? { ...x, points: v } : x)) } }))} placeholder={t("One point per line")} />
                  </div>
                ))}
                {editable && <AddRow label={t("Add topic")} onClick={() => update((d) => ({ ...d, mom: { ...d.mom, topics: [...d.mom.topics, { title: "", points: [] }] } }))} />}
                {!editable && !draft.mom.topics.length && <Empty />}
              </div>

              <SubHead>{t("Decisions")}</SubHead>
              <Lines value={draft.mom.decisions} readOnly={!editable} onChange={(v) => update((d) => ({ ...d, mom: { ...d.mom, decisions: v } }))} placeholder={t("One decision per line")} />
              <SubHead>{t("Open questions")}</SubHead>
              <Lines value={draft.mom.openQuestions} readOnly={!editable} onChange={(v) => update((d) => ({ ...d, mom: { ...d.mom, openQuestions: v } }))} placeholder={t("One question per line")} />
              <SubHead>{t("Action items")}</SubHead>
              <div className="space-y-1">
                {draft.mom.actionItems.map((a, i) => (
                  <div key={i} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-muted/40">
                    <ListChecks className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <AutoText value={a.text} readOnly={!editable} onChange={(v) => update((d) => ({ ...d, mom: { ...d.mom, actionItems: d.mom.actionItems.map((x, k) => (k === i ? { ...x, text: v } : x)) } }))} className="text-sm" />
                      {(a.owner || a.due) && <div className="text-xs text-muted-foreground">{[a.owner, a.due].filter(Boolean).join(" · ")}</div>}
                    </div>
                    {editable && <button type="button" aria-label={t("Remove")} onClick={() => update((d) => ({ ...d, mom: { ...d.mom, actionItems: d.mom.actionItems.filter((_, k) => k !== i) }, proposals: d.proposals.map((p) => (p.actionIndex === i ? { ...p, actionIndex: null } : p.actionIndex !== null && p.actionIndex > i ? { ...p, actionIndex: p.actionIndex - 1 } : p)) }))} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"><X className="h-3.5 w-3.5" /></button>}
                  </div>
                ))}
                {editable && <AddRow label={t("Add action item")} onClick={() => update((d) => ({ ...d, mom: { ...d.mom, actionItems: [...d.mom.actionItems, { text: "", owner: null, due: null }] } }))} />}
                {!editable && !draft.mom.actionItems.length && <Empty />}
              </div>
            </Section>

            {m.status === "APPLIED" ? (
              m.tasks.length > 0 && (
                <Section title={t("Tasks created")}>
                  <div className="divide-y divide-border rounded-xl border border-border">
                    {m.tasks.map((tk) => (
                      <Link key={tk.id} to="/tasks/$taskId" params={{ taskId: tk.id }} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/40">
                        <span className="min-w-0 flex-1 truncate font-medium">{tk.title}</span>
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{tk.section}</span>
                        {tk.dueDate && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{new Date(tk.dueDate).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "short" })}</span>}
                        <span className="flex shrink-0 -space-x-1">{tk.assignees.slice(0, 3).map((u) => <Avatar key={u.id} userId={u.id} name={u.name} avatar={u.avatar} size={20} />)}</span>
                      </Link>
                    ))}
                  </div>
                </Section>
              )
            ) : (
              <Section title={t("Tasks to create")} aside={<span className="text-xs text-muted-foreground">{t("{n} of {total} selected", { n: included.length, total: draft.proposals.length })}</span>}>
                <p className="-mt-1 mb-3 text-sm text-muted-foreground">{t("GIDEON suggests these from the action items. Nothing is created until you press Apply.")}</p>
                {!m.projectId && <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{t("Choose a project above: the tasks and the minutes go there, and only its members can be assigned.")}</p>}
                <div className="space-y-2">
                  {draft.proposals.map((p, i) => (
                    <ProposalCard key={p.key} p={p} members={members} readOnly={!editable} actionText={p.actionIndex !== null ? draft.mom.actionItems[p.actionIndex]?.text ?? null : null}
                      onChange={(np) => update((d) => ({ ...d, proposals: d.proposals.map((x, k) => (k === i ? np : x)) }))}
                      onRemove={() => update((d) => ({ ...d, proposals: d.proposals.filter((_, k) => k !== i) }))} />
                  ))}
                  {editable && <AddRow label={t("Add task")} onClick={() => update((d) => ({ ...d, proposals: [...d.proposals, { key: `n${Date.now().toString(36)}`, include: true, title: "", description: "", assigneeIds: [], dueDate: null, actionIndex: null }] }))} />}
                  {!draft.proposals.length && !editable && <Empty />}
                </div>
              </Section>
            )}
          </>
        )}

        {voices.length > 0 && <Speakers voices={voices} map={speakerMap} segments={m.transcript} members={members} readOnly={!canNameSpeakers} onChange={(v) => void saveSpeakers(v)} onSeek={m.audio.available ? seek : undefined} />}
        {m.transcript.length > 0 && <Transcript segments={m.transcript} speakers={speakerMap} onSeek={m.audio.available ? seek : undefined} />}
      </div>

      {m.status === "READY" && m.can.apply && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[calc(env(safe-area-inset-bottom)+var(--tabbar-room,0px))] backdrop-blur md:left-(--sidebar-width,0px)">
          <div className="mx-auto flex w-full max-w-[860px] items-center gap-3 px-4 py-3 md:px-8">
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate font-medium">{included.length ? t("Save the minutes and create {n} tasks", { n: included.length }) : t("Save the minutes")}</div>
              <div className="truncate text-xs text-muted-foreground">{m.project ? t("As a page in {project}", { project: m.project.name }) : t("Choose a project first")}</div>
            </div>
            <button type="button" onClick={() => void apply()} disabled={applying || !m.projectId || included.some((p) => !p.title.trim())}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-sidebar-primary px-4 text-sm font-semibold text-sidebar-primary-foreground transition-colors hover:bg-sidebar-primary/90 disabled:opacity-50">
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t("Apply")}
            </button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this meeting?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("The audio is deleted now. The transcript and minutes can be restored from Control Room › Audit for 90 days. A saved minutes page and its tasks stay in the project.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmRedo} onOpenChange={setConfirmRedo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Write the minutes again?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("GIDEON reads the transcript again and replaces the overview, minutes and proposed tasks, including your edits. It uses GIDEON credits again.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void retry("minutes")}>{t("Write again")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Prop({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex h-8 items-center gap-1.5 text-muted-foreground"><Icon className="h-4 w-4 shrink-0" /><span className="truncate">{label}</span></dt>
      <dd className="flex min-h-8 min-w-0 items-center">{children}</dd>
    </>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-baseline gap-3"><h2 className="text-xl font-semibold tracking-tight">{title}</h2><div className="flex-1" />{aside}</div>
      {children}
    </section>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{children}</h3>;
}

function Empty() {
  const { t } = useLang();
  return <p className="text-sm text-muted-foreground">{t("None")}</p>;
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="h-4 w-4" />{label}</button>;
}

/** A textarea that grows with its text (Notion-style block). */
function AutoText({ value, onChange, readOnly, placeholder, className, ariaLabel, keepFont }: { value: string; onChange: (v: string) => void; readOnly?: boolean; placeholder?: string; className?: string; ariaLabel?: string; keepFont?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }, [value]);
  // keepFont: a field bigger than 16px (the title) keeps its size on phones (styles.css data-keep-font).
  return <textarea ref={ref} rows={1} value={value} readOnly={readOnly} aria-label={ariaLabel} data-keep-font={keepFont ? "" : undefined} placeholder={readOnly ? undefined : placeholder} onChange={(e) => onChange(e.target.value)}
    className={cn("block w-full resize-none overflow-hidden rounded-md bg-transparent px-1 py-0.5 outline-none placeholder:text-muted-foreground/60", !readOnly && "hover:bg-muted/40 focus:bg-muted/40", className)} />;
}

/** A bulleted list edited as lines. */
function Lines({ value, onChange, readOnly, placeholder }: { value: string[]; onChange: (v: string[]) => void; readOnly?: boolean; placeholder?: string }) {
  if (readOnly) {
    return value.filter(Boolean).length ? <ul className="ml-5 list-disc space-y-0.5 text-sm marker:text-muted-foreground">{value.filter(Boolean).map((v, i) => <li key={i}>{v}</li>)}</ul> : <Empty />;
  }
  return (
    <div className="relative">
      <AutoText value={value.join("\n")} onChange={(v) => onChange(v.split("\n"))} placeholder={placeholder} className="pl-5 text-sm leading-6" />
      <div aria-hidden className="pointer-events-none absolute left-1.5 top-0.5 flex flex-col text-sm leading-6 text-muted-foreground">{(value.length ? value : [""]).map((_, i) => <span key={i}>•</span>)}</div>
    </div>
  );
}

function Attendees({ value, onChange, members, readOnly }: { value: string[]; onChange: (v: string[]) => void; members: Array<{ id: string; name: string | null; avatar: string | null }>; readOnly?: boolean }) {
  const { t } = useLang();
  const [adding, setAdding] = useState("");
  const add = (name: string) => { const n = name.trim(); if (n && !value.some((v) => v.toLowerCase() === n.toLowerCase())) onChange([...value.filter(Boolean), n]); setAdding(""); };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.filter(Boolean).map((n) => {
        const member = members.find((mm) => (mm.name ?? "").toLowerCase() === n.toLowerCase());
        return (
          <span key={n} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-0.5 pr-2 text-sm">
            {member ? <Avatar userId={member.id} name={member.name} avatar={member.avatar} size={20} /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-background text-[10px] font-semibold text-muted-foreground">{n.slice(0, 1).toUpperCase()}</span>}
            {n}
            {!readOnly && <button type="button" aria-label={t("Remove {name}", { name: n })} onClick={() => onChange(value.filter((v) => v !== n))} className="-mr-1 grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"><X className="h-3 w-3" /></button>}
          </span>
        );
      })}
      {!readOnly && (
        <>
          <PeoplePicker members={members} value={[]} onChange={(ids) => { const u = members.find((mm) => mm.id === ids[0]); if (u?.name) add(u.name); }}
            trigger={<button type="button" className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground hover:border-sidebar-primary/50 hover:text-foreground"><UserPlus className="h-3.5 w-3.5" />{t("Add from project")}</button>} />
          <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(adding); } }} onBlur={() => adding && add(adding)} placeholder={t("Or type a name")} aria-label={t("Add attendee")} className="h-7 min-w-[9rem] flex-1 rounded-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:bg-muted/40" />
        </>
      )}
      {readOnly && !value.filter(Boolean).length && <Empty />}
    </div>
  );
}

function ProposalCard({ p, members, readOnly, actionText, onChange, onRemove }: { p: TaskProposal; members: Array<{ id: string; name: string | null; avatar: string | null }>; readOnly?: boolean; actionText: string | null; onChange: (p: TaskProposal) => void; onRemove: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const picked = members.filter((mm) => p.assigneeIds.includes(mm.id));
  return (
    <div className={cn("rounded-xl border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors", p.include ? "border-border" : "border-dashed border-border opacity-60")}>
      <div className="flex items-start gap-2.5">
        <button type="button" role="checkbox" aria-checked={p.include} aria-label={p.include ? t("Don't create this task") : t("Create this task")} disabled={readOnly} onClick={() => onChange({ ...p, include: !p.include })}
          className={cn("mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors", p.include ? "border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground" : "border-border bg-background")}>
          {p.include && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <input value={p.title} readOnly={readOnly} onChange={(e) => onChange({ ...p, title: e.target.value })} placeholder={t("Task title")} aria-label={t("Task title")} className="w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-muted-foreground/60" />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {readOnly ? (
              picked.length ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{picked.map((u) => u.name).join(", ")}</span> : null
            ) : (
              <PeoplePicker members={members} value={p.assigneeIds} onChange={(ids) => onChange({ ...p, assigneeIds: ids })}
                trigger={<button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2 text-xs hover:bg-muted">
                  {picked.length ? <><span className="flex -space-x-1">{picked.slice(0, 3).map((u) => <Avatar key={u.id} userId={u.id} name={u.name} avatar={u.avatar} size={18} />)}</span><span className="max-w-[10rem] truncate">{picked.map((u) => u.name).join(", ")}</span></> : <><User className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">{t("PIC")}</span></>}
                </button>} />
            )}
            <DateField value={p.dueDate} onChange={(v) => onChange({ ...p, dueDate: v ? v.slice(0, 10) : null })} disabled={readOnly} placeholder={t("Due date")} ariaLabel={t("Due date")} className="h-7 rounded-full border border-border px-2 text-xs" />
            {(p.description || actionText || !readOnly) && (
              <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{t("Details")}</button>
            )}
          </div>
          {open && (
            <div className="mt-2 space-y-1.5">
              <AutoText value={p.description} readOnly={readOnly} onChange={(v) => onChange({ ...p, description: v })} placeholder={t("Description")} className="text-sm" />
              {actionText && <p className="px-1 text-xs text-muted-foreground">{t("From action item: {text}", { text: actionText })}</p>}
            </div>
          )}
        </div>
        {!readOnly && <button type="button" aria-label={t("Remove")} onClick={onRemove} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
      </div>
    </div>
  );
}

function Pipeline({ m }: { m: MeetingFull }) {
  const { t } = useLang();
  const steps = [
    { key: "UPLOADING", label: t("Upload") },
    { key: "TRANSCRIBING", label: t("Transcript") },
    { key: "SUMMARIZING", label: t("Write minutes") },
    { key: "READY", label: t("Review") },
  ];
  const at = m.status === "QUEUED" ? 1 : steps.findIndex((s) => s.key === m.status);
  const position = m.transcribeStats?.position;
  const q = m.queue;
  const line = m.status === "UPLOADING"
    ? t("The upload hasn't finished. Keep the tab that is uploading open.")
    : q?.waiting
      ? `${t("Waiting for the transcription server…")} ${q.position && q.position > 1 ? t("#{n} in line", { n: q.position }) : t("next in line")}.`
      : m.status === "TRANSCRIBING" && m.transcribeStats?.stage === "speakers"
        ? t("Telling the voices apart…")
      : m.status === "TRANSCRIBING"
        ? t("Transcribing on the office server. GIDEON Model 0 is paused meanwhile.")
        : t("GIDEON is reading the transcript and writing the minutes.");
  void position;
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4" aria-live="polite">
      <ol className="flex items-center gap-2 text-xs font-medium">
        {steps.map((s, i) => (
          <li key={s.key} className="flex min-w-0 items-center gap-2">
            <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px]", i < at ? "bg-sidebar-primary text-sidebar-primary-foreground" : i === at ? "bg-accent text-sidebar-primary ring-1 ring-sidebar-primary/40" : "bg-muted text-muted-foreground")}>{i < at ? <Check className="h-3 w-3" /> : i + 1}</span>
            <span className={cn("truncate", i === at ? "text-foreground" : "text-muted-foreground max-sm:hidden")}>{s.label}</span>
            {i < steps.length - 1 && <span className="h-px w-4 shrink-0 bg-border sm:w-8" />}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">{line}</p>
      {(m.status === "TRANSCRIBING" || m.status === "SUMMARIZING" || m.status === "UPLOADING") && !q?.waiting && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-sidebar-primary transition-[width] duration-500" style={{ width: `${Math.max(3, Math.round((m.progress || 0) * 100))}%` }} /></div>
      )}
      {q && <p className="mt-2 text-sm font-medium tabular-nums">{t("Ready in {eta}", { eta: etaText(q.etaSec, t) })}<span className="font-normal text-muted-foreground"> · {t("a rough estimate")}</span></p>}
      <p className="mt-1 text-xs text-muted-foreground">{t("You can leave this page — we'll notify you when it's ready.")}</p>
    </div>
  );
}

/** One colour per voice (the same in Speakers and the transcript). */
const VOICE_COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-teal-500", "bg-fuchsia-500", "bg-lime-600", "bg-orange-500", "bg-indigo-500"];
const VOICE_TEXT = ["text-violet-700 dark:text-violet-300", "text-sky-700 dark:text-sky-300", "text-emerald-700 dark:text-emerald-300", "text-amber-700 dark:text-amber-300", "text-rose-700 dark:text-rose-300", "text-teal-700 dark:text-teal-300", "text-fuchsia-700 dark:text-fuchsia-300", "text-lime-700 dark:text-lime-300", "text-orange-700 dark:text-orange-300", "text-indigo-700 dark:text-indigo-300"];
const voiceColor = (label: string) => VOICE_COLORS[(Math.max(1, speakerIndex(label)) - 1) % VOICE_COLORS.length];
const voiceText = (label: string) => VOICE_TEXT[(Math.max(1, speakerIndex(label)) - 1) % VOICE_TEXT.length];
/** "Speaker 2" in the person's language. */
function useVoiceLabel() {
  const { t } = useLang();
  return (label: string) => (/^Speaker \d+$/.test(label) ? t("Speaker {n}", { n: speakerIndex(label) }) : label);
}

/**
 * Speakers (owner, 19 Oct 2026): every voice GIDEON told apart, the name it read from the introductions, and a
 * field to correct it. A name typed by hand wins over the introductions (also after a retry); clearing it goes
 * back to "Speaker N".
 */
function Speakers({ voices, map, segments, members, readOnly, onChange, onSeek }: {
  voices: string[]; map: SpeakerMap; segments: MeetingFull["transcript"]; members: Array<{ id: string; name: string | null }>;
  readOnly?: boolean; onChange: (next: SpeakerMap) => void; onSeek?: (sec: number) => void;
}) {
  const { t } = useLang();
  const voiceLabel = useVoiceLabel();
  const stats = useMemo(() => {
    const out: Record<string, { lines: number; sec: number; first: { start: number; text: string } | null }> = {};
    for (const s of segments) {
      if (!s.speaker) continue;
      const o = (out[s.speaker] ??= { lines: 0, sec: 0, first: null });
      o.lines++;
      o.sec += Math.max(0, s.end - s.start);
      if (!o.first) o.first = { start: s.start, text: s.text };
    }
    return out;
  }, [segments]);
  const listId = "meeting-speaker-people";
  const commit = (label: string, raw: string) => {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, 120);
    const cur = map[label];
    if ((cur?.name ?? "") === name) return;
    const next: SpeakerMap = { ...map };
    if (!name) delete next[label];
    else {
      const member = members.find((p) => (p.name ?? "").toLowerCase() === name.toLowerCase());
      next[label] = { name: member?.name ?? name, userId: member?.id ?? null };
    }
    onChange(next);
  };
  return (
    <section className="mb-8">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Users className="h-5 w-5 text-muted-foreground" />{t("Speakers")}<span className="text-sm font-normal text-muted-foreground">{t("{n} voices", { n: voices.length })}</span></h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("GIDEON told the voices apart and read the names from the introductions. Voices are only used to label this recording.")}</p>
      <datalist id={listId}>{members.filter((p) => p.name).map((p) => <option key={p.id} value={p.name as string} />)}</datalist>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
        {voices.map((label) => {
          const e = map[label];
          const st = stats[label];
          return (
            <li key={label} className="flex gap-3 px-3 py-2.5">
              <span className={cn("mt-[0.6rem] h-2.5 w-2.5 shrink-0 rounded-full", voiceColor(label))} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="w-[5.5rem] shrink-0 text-xs font-medium text-muted-foreground">{voiceLabel(label)}</span>
                  <div className="min-w-[9rem] flex-1">
                    {readOnly ? (
                      <span className="px-2 text-sm font-medium">{e?.name ?? <span className="text-muted-foreground">{t("Not named")}</span>}</span>
                    ) : (
                      <input key={`${label}:${e?.name ?? ""}`} defaultValue={e?.name ?? ""} list={listId} maxLength={120} aria-label={t("Name for {voice}", { voice: voiceLabel(label) })}
                        placeholder={t("Who is this?")} onBlur={(ev) => commit(label, ev.currentTarget.value)} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); ev.currentTarget.blur(); } }}
                        className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-border focus:border-sidebar-primary focus:bg-background" />
                    )}
                  </div>
                  {e?.auto && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-sidebar-primary">{t("From introductions")}</span>}
                  {e && !e.auto && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("Set by hand")}</span>}
                </div>
                {st && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("{n} lines", { n: st.lines })} · {st.sec < 60 ? t("{s} s", { s: Math.max(1, Math.round(st.sec)) }) : durationText(st.sec, t)}
                    {st.first && onSeek ? <> · <button type="button" onClick={() => onSeek(st.first!.start)} className="text-sidebar-primary hover:underline">{t("Listen")} {clock(st.first.start)}</button></> : null}
                    {st.first && <span className="block truncate italic">“{st.first.text}”</span>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Transcript({ segments, speakers, onSeek }: { segments: MeetingFull["transcript"]; speakers?: SpeakerMap; onSeek?: (sec: number) => void }) {
  const voiceLabel = useVoiceLabel();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const shown = useMemo(() => {
    const f = find.trim().toLowerCase();
    return f ? segments.filter((s) => s.text.toLowerCase().includes(f)) : segments;
  }, [segments, find]);
  return (
    <section className="mb-8">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="-ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-xl font-semibold tracking-tight hover:bg-muted">
        {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}{t("Transcript")}<span className="ml-1 text-sm font-normal text-muted-foreground">{t("{n} lines", { n: segments.length })}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted-foreground">{t("Automatic transcript — names and words can be misheard.")}</p>
          <div className="relative mb-2 max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("Find in transcript")} className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none focus:border-sidebar-primary" />
          </div>
          <div className="max-h-[60vh] space-y-0.5 overflow-y-auto rounded-xl border border-border p-2">
            {shown.slice(0, 3000).map((s, i) => (
              <div key={i} className="flex gap-3 rounded-md px-1.5 py-1 text-sm hover:bg-muted/40">
                {onSeek ? <button type="button" onClick={() => onSeek(s.start)} className="w-14 shrink-0 text-left font-mono text-xs leading-5 text-sidebar-primary hover:underline">{clock(s.start)}</button> : <span className="w-14 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{clock(s.start)}</span>}
                <span className="min-w-0 flex-1 leading-5">{s.speaker ? <span className={cn("font-semibold", voiceText(s.speaker))}>{speakers?.[s.speaker]?.name ?? voiceLabel(s.speaker)}: </span> : null}{s.text}</span>
              </div>
            ))}
            {!shown.length && <p className="px-2 py-3 text-sm text-muted-foreground">{t("No line matches.")}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
