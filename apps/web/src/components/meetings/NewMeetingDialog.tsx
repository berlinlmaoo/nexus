import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Check, FileAudio, Loader2, Mic, Pause, Play, Square, Upload, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SelectPicker } from "@/components/SelectPicker";
import { Switch } from "@/components/ui/switch";
import { nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import {
  clock, createMeeting, etaText, isMeetingAudio, MeetingApiError, MEETING_AUDIO_ACCEPT, readDuration, uploadMeetingAudio, useMeeting, useWebAppConfig, type Meeting, type MeetingLanguage,
} from "@/lib/meetings";
import { BetaBadge } from "./BetaBadge";

/**
 * New meeting notes (Beta, owner 18 Oct 2026). Upload a recording or record here (MediaRecorder), pick the project
 * the minutes and tasks go to and the spoken language, then the file goes up in chunks and the meeting page opens
 * while it is transcribed. Opened from GIDEON's "+" menu and the project header.
 */
export function NewMeetingDialog({ open, onOpenChange, projectId: initialProject }: { open: boolean; onOpenChange: (v: boolean) => void; projectId?: string | null }) {
  const { t, lang } = useLang();
  const router = useRouter();
  const cfg = useWebAppConfig();
  const maxMinutes = cfg.data?.values?.meetingMaxMinutes ?? 180;
  const maxMB = cfg.data?.values?.meetingMaxMB ?? 500;
  const [mode, setMode] = useState<"upload" | "record">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>(initialProject ?? "");
  const [language, setLanguage] = useState<MeetingLanguage>("auto");
  /** Speaker labels (owner, 19 Oct 2026): voices told apart, named from a round of introductions at the start. */
  const [speakerLabels, setSpeakerLabels] = useState(true);
  /** Record mode: seconds into the recording where "Done with introductions" was pressed. */
  const [introEnd, setIntroEnd] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  /** Uploaded: the meeting waits for the transcriber; the dialog says so (place in line, rough time) before closing. */
  const [sent, setSent] = useState<Meeting | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const projects = useQuery({ queryKey: ["nexus", "projects"], queryFn: () => nexusApi.projects(), enabled: open, staleTime: 60_000 });

  useEffect(() => {
    if (!open) return;
    setProjectId(initialProject ?? "");
    setFile(null); setDuration(null); setTitle(""); setError(null); setProgress(0); setBusy(false); setMode("upload"); setSent(null); setSpeakerLabels(true); setIntroEnd(null);
  }, [open, initialProject]);

  const projectOptions = useMemo(() => (projects.data ?? [])
    .filter((p) => !p.viewerAccessLevel || p.viewerAccessLevel === "EDIT" || p.viewerAccessLevel === "FULL")
    .map((p) => ({ value: p.id, label: p.name })), [projects.data]);

  const pick = async (f: File | null) => {
    setError(null);
    if (!f) return;
    if (!isMeetingAudio(f)) { setError(t("That file type can't be transcribed. Use m4a, mp3, wav, webm, ogg, aac or mp4.")); return; }
    if (f.size > maxMB * 1024 * 1024) { setError(t("The file is too large. Maximum {n} MB.", { n: maxMB })); return; }
    const d = await readDuration(f);
    if (d && d > maxMinutes * 60 + 30) { setError(t("The recording is too long. Maximum {n} hours.", { n: Math.round((maxMinutes / 60) * 10) / 10 })); return; }
    setFile(f);
    setDuration(d);
    if (!title) setTitle(f.name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").slice(0, 120));
  };

  const start = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const { meeting, upload } = await createMeeting({
        fileName: file.name, mime: file.type, size: file.size, title: title.trim(), projectId: projectId || null, language,
        source: mode === "record" ? "record" : "upload", recordedAt: new Date(file.lastModified || Date.now()).toISOString(), durationSec: duration,
        speakerLabels, introEndSec: speakerLabels && mode === "record" ? introEnd : null,
      });
      const queued = await uploadMeetingAudio(meeting.id, file, upload.chunkBytes, setProgress, ctl.signal);
      setSent(queued);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setError(e instanceof MeetingApiError || e instanceof Error ? e.message : t("Upload failed. Try again."));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const close = (v: boolean) => {
    if (!v && busy) { abort.current?.abort(); toast(t("Upload cancelled.")); }
    onOpenChange(v);
  };

  // R-6 (owner, 19 Oct 2026): from the moment Upload is pressed it is ONE screen with three steps — ① Upload
  // ② Transcribe ③ Minutes & tasks ready — each with its own live line. The footer stays in the same place in every
  // state: "Cancel upload" only while the file is still going up, then "Done" + "Open meeting".
  if (busy || sent) {
    const openMeeting = sent ? () => { onOpenChange(false); router.history.push(`/meetings/${sent.id}`); } : undefined;
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-lg grid-cols-[minmax(0,1fr)]">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2">{t("Meeting notes")}<BetaBadge /></DialogTitle>
            <DialogDescription className="truncate">{(sent?.title || title.trim() || file?.name) ?? ""}</DialogDescription>
          </DialogHeader>
          {sent ? <LiveSteps id={sent.id} initial={sent} bytes={file?.size ?? sent.audio.bytes} /> : <Steps meeting={null} progress={progress} bytes={file?.size ?? 0} />}
          <p className="text-xs leading-relaxed text-muted-foreground">{t("You can leave this page — we'll notify you when it's ready.")}</p>
          <DialogFooter className="flex-row justify-end gap-2">
            {!sent ? (
              <button type="button" onClick={() => close(false)} className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-accent">{t("Cancel upload")}</button>
            ) : (
              <>
                <button type="button" onClick={() => onOpenChange(false)} className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-accent">{t("Done")}</button>
                <button type="button" onClick={openMeeting} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-sidebar-primary px-4 text-sm font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary/90">{t("Open meeting")}</button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // U-6 (owner, 19 Oct 2026): one title, labeled rows, one speakers caption, the two ways in as the big buttons at
  // the bottom, one small limits line.
  const row = "flex min-h-12 items-center gap-3 px-3 py-2";
  const rowLabel = "w-28 shrink-0 text-sm font-medium sm:w-32";
  return (
    <Dialog open={open} onOpenChange={close}>
      {/* One shrinkable column: the pickers no longer push the sheet past a phone's edge. */}
      <DialogContent className="max-w-lg grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{t("Meeting notes")}<BetaBadge /></DialogTitle>
          <DialogDescription className="sr-only">{t("GIDEON turns a recording into an overview, minutes and tasks. Nothing is added to the project until you check it and press Apply.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            <label className={row}>
              <span className={rowLabel}>{t("Meeting title")}</span>
              <input value={title} maxLength={200} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Weekly sync")}
                className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground" />
            </label>
            <div className={row}>
              <span className={rowLabel}>{t("Project")}</span>
              <SelectPicker variant="field" className="min-w-0 flex-1" value={projectId} onChange={setProjectId} disabled={busy} clearable={t("Choose later")} placeholder={projects.isLoading ? t("Loading…") : t("Pick a project (optional)")} options={projectOptions} ariaLabel={t("Project")} />
            </div>
            <div className={row}>
              <span className={rowLabel}>{t("Language")}</span>
              <SelectPicker variant="field" className="min-w-0 flex-1" value={language} onChange={(v) => setLanguage((v || "auto") as MeetingLanguage)} disabled={busy} ariaLabel={t("Spoken language")}
                options={[{ value: "auto", label: t("Automatic (ID + EN)"), hint: t("Best for Indonesian mixed with English") }, { value: "id", label: t("Indonesian") }, { value: "en", label: t("English") }]} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card px-3 py-3">
            <div className="flex items-center gap-3">
              <label htmlFor="meeting-speakers" className="min-w-0 flex-1 cursor-pointer text-sm font-medium">{t("Tell speakers apart")}</label>
              <Switch id="meeting-speakers" checked={speakerLabels} disabled={busy} onCheckedChange={(v) => { setSpeakerLabels(v); if (!v) setIntroEnd(null); }} aria-label={t("Tell speakers apart")} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("Start with quick introductions: “Hi, I'm Berlin…”. Voices only label this recording.")}</p>
          </div>
          <input ref={input} type="file" accept={MEETING_AUDIO_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; void pick(f); }} />

          {file && mode === "upload" ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-sidebar-primary"><FileAudio className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{file.name}</span>
                <span className="block text-xs text-muted-foreground">{(file.size / 1048576).toFixed(1)} MB{duration ? ` · ${clock(duration)}` : ""}</span>
              </span>
              {!busy && <button type="button" onClick={() => { setFile(null); setDuration(null); }} aria-label={t("Remove")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
          ) : mode === "record" ? (
            <Recorder autoStart disabled={busy} maxSeconds={maxMinutes * 60} onDone={(f, d) => { setFile(f); setDuration(d); if (!title) setTitle(t("Meeting {date}", { date: new Date().toLocaleDateString() })); }} recorded={file}
              onDiscard={() => { setFile(null); setDuration(null); setIntroEnd(null); setMode("upload"); }} onCancel={() => setMode("upload")}
              introductions={speakerLabels} introEnd={introEnd} onIntroEnd={setIntroEnd} />
          ) : null}

          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

          {file ? (
            <button type="button" onClick={() => void start()} disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sidebar-primary px-4 text-sm font-semibold text-sidebar-primary-foreground shadow-soft hover:bg-sidebar-primary/90 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{t("Upload and transcribe")}
            </button>
          ) : mode === "upload" ? (
            <div className="space-y-2">
              <button type="button" disabled={busy} onClick={() => { setError(null); setIntroEnd(null); setMode("record"); }}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sidebar-primary px-4 text-sm font-semibold text-sidebar-primary-foreground shadow-soft hover:bg-sidebar-primary/90 disabled:opacity-50">
                <Mic className="h-4 w-4" />{t("Start recording")}
              </button>
              <button type="button" disabled={busy} onClick={() => input.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files?.[0] ?? null); }}
                className={cn("inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50", drag && "border-sidebar-primary bg-accent/60")}>
                <Upload className="h-4 w-4" />{t("Upload an audio file")}
              </button>
            </div>
          ) : null}
          <p className="text-center text-xs leading-relaxed text-muted-foreground">{t("Up to {min} min · {mb} MB · processed on the company's own server. Check the minutes and tasks before Apply.", { min: maxMinutes, mb: maxMB })}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** MB with one decimal: "12.3 MB". */
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** The upload is done: follow the meeting live (socket `meeting-changed`, same as the meeting page). */
function LiveSteps({ id, initial, bytes }: { id: string; initial: Meeting; bytes: number }) {
  const q = useMeeting(id);
  // The queue estimate is computed when the server lists the job; read it again once it is in line.
  const { refetch } = q;
  useEffect(() => { const h = window.setTimeout(() => { void refetch(); }, 2500); return () => window.clearTimeout(h); }, [refetch]);
  return <Steps meeting={q.data ?? initial} progress={1} bytes={bytes} />;
}

type StepState = "todo" | "active" | "done" | "failed";

/** ① Upload ② Transcribe ③ Minutes & tasks ready — one row each, same layout in every state. */
function Steps({ meeting, progress, bytes }: { meeting: Meeting | null; progress: number; bytes: number }) {
  const { t } = useLang();
  const st = meeting?.status ?? "UPLOADING";
  const failed = st === "FAILED";
  const transcribed = st === "SUMMARIZING" || st === "READY" || st === "APPLYING" || st === "APPLIED";
  const ready = st === "READY" || st === "APPLYING" || st === "APPLIED";
  const uploaded = !!meeting && st !== "UPLOADING";
  const q = meeting?.queue ?? null;
  const pct = (p: number) => `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  const eta = q ? t("ready in {eta}", { eta: etaText(q.etaSec, t) }) : null;

  const upload: { state: StepState; detail: string; bar?: number } = uploaded
    ? { state: "done", detail: mb(bytes) }
    : { state: "active", detail: `${mb(bytes * Math.max(0, Math.min(1, progress)))} / ${mb(bytes)} · ${pct(progress)}`, bar: progress };
  const transcribe: { state: StepState; detail: string; bar?: number } = !uploaded
    ? { state: "todo", detail: t("Starts after the upload") }
    : transcribed
      ? { state: "done", detail: t("Transcript ready") }
      : failed && !transcribed
        ? { state: "failed", detail: meeting?.error || t("Transcription failed. Open the meeting to try again.") }
        : st === "TRANSCRIBING" && !q?.waiting
          ? { state: "active", detail: [pct(meeting?.progress ?? 0), eta].filter(Boolean).join(" · "), bar: meeting?.progress ?? 0 }
          : { state: "active", detail: [t("Waiting for the transcription server…"), q?.position && q.position > 1 ? t("#{n} in line", { n: q.position }) : t("next in line"), eta].filter(Boolean).join(" · ") };
  const minutes: { state: StepState; detail: string } = ready
    ? { state: "done", detail: meeting?.taskCount ? t("Minutes saved and {n} tasks created", { n: meeting.taskCount }) : t("Ready to check — open the meeting, then Apply") }
    : st === "SUMMARIZING"
      ? { state: "active", detail: [t("Writing the minutes…"), eta].filter(Boolean).join(" · ") }
      : failed && transcribed
        ? { state: "failed", detail: meeting?.error || t("The minutes could not be written. Open the meeting to try again.") }
        : { state: "todo", detail: t("Overview, minutes and proposed tasks") };

  const rows: Array<{ n: number; label: string; s: { state: StepState; detail: string; bar?: number } }> = [
    { n: 1, label: t("Upload"), s: upload },
    { n: 2, label: t("Transcribe"), s: transcribe },
    { n: 3, label: t("Minutes & tasks ready"), s: minutes },
  ];
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-live="polite">
      {rows.map(({ n, label, s }) => (
        <li key={n} className="flex items-start gap-3 px-3 py-3">
          <span className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums",
            s.state === "done" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
            s.state === "active" && "bg-sidebar-primary text-sidebar-primary-foreground",
            s.state === "failed" && "bg-destructive/15 text-destructive",
            s.state === "todo" && "bg-muted text-muted-foreground",
          )} aria-hidden>
            {s.state === "done" ? <Check className="h-3.5 w-3.5" /> : s.state === "failed" ? <X className="h-3.5 w-3.5" /> : n}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn("text-sm font-semibold", s.state === "todo" && "text-muted-foreground")}>{label}</span>
              {s.state === "active" && <Loader2 className="h-3.5 w-3.5 animate-spin text-sidebar-primary" aria-hidden />}
            </div>
            <div className={cn("mt-0.5 text-xs tabular-nums", s.state === "failed" ? "text-destructive" : "text-muted-foreground")}>{s.detail}</div>
            {s.bar !== undefined && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-sidebar-primary transition-[width] duration-200" style={{ width: `${Math.max(2, Math.min(1, s.bar) * 100)}%` }} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** In-browser recording (MediaRecorder). Opus in WebM where supported, AAC in MP4 on Safari. */
function Recorder({ onDone, onDiscard, onCancel, autoStart, recorded, disabled, maxSeconds, introductions, introEnd, onIntroEnd }: {
  onDone: (f: File, durationSec: number) => void; onDiscard: () => void; recorded: File | null; disabled?: boolean; maxSeconds: number;
  /** Starts recording as soon as it shows (the dialog's big "Start recording"); onCancel = back before anything was recorded. */
  autoStart?: boolean; onCancel?: () => void;
  /** Speaker labels on: the first phase of the recording is the round of introductions, ended by a tap. */
  introductions: boolean; introEnd: number | null; onIntroEnd: (sec: number | null) => void;
}) {
  const { t } = useLang();
  const [state, setState] = useState<"idle" | "recording" | "paused">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const accumulated = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);

  const cleanup = () => {
    if (timer.current) window.clearInterval(timer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((tr) => tr.stop());
    void ctx.current?.close().catch(() => {});
    stream.current = null; ctx.current = null; timer.current = null; raf.current = null;
  };
  useEffect(() => () => { try { rec.current?.state !== "inactive" && rec.current?.stop(); } catch { /* gone */ } cleanup(); }, []);
  // Leaving the page mid-recording loses it: the browser asks first.
  useEffect(() => {
    if (state === "idle") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  const begin = async () => {
    setErr(null);
    onIntroEnd(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setErr(t("This browser can't record audio. Upload a file instead.")); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      stream.current = s;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
      const r = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        const type = r.mimeType || mime || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunks.current, { type });
        const secs = accumulated.current + (startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0);
        cleanup();
        setState("idle");
        if (blob.size > 0) onDone(new File([blob], `recording-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`, { type: type.split(";")[0] }), secs);
      };
      r.start(10_000);
      rec.current = r;
      accumulated.current = 0;
      startedAt.current = Date.now();
      setElapsed(0);
      setState("recording");
      timer.current = window.setInterval(() => {
        const secs = accumulated.current + (startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0);
        setElapsed(secs);
        if (secs >= maxSeconds) { try { rec.current?.stop(); } catch { /* stopped */ } }
      }, 500);
      try {
        const ac = new AudioContext();
        ctx.current = ac;
        const an = ac.createAnalyser();
        an.fftSize = 512;
        ac.createMediaStreamSource(s).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const loop = () => { an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); setLevel(peak / 128); raf.current = requestAnimationFrame(loop); };
        loop();
      } catch { /* the meter is a nicety */ }
    } catch (e) {
      cleanup();
      setErr((e as Error)?.name === "NotAllowedError" ? t("Microphone access was blocked. Allow it in the browser's site settings, then try again.") : t("The microphone couldn't be started."));
    }
  };
  const started = useRef(false);
  useEffect(() => { if (autoStart && !started.current && !recorded) { started.current = true; void begin(); } }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps
  const pause = () => { const r = rec.current; if (!r) return; if (r.state === "recording") { r.pause(); accumulated.current += (Date.now() - startedAt.current) / 1000; startedAt.current = 0; setState("paused"); } else if (r.state === "paused") { r.resume(); startedAt.current = Date.now(); setState("recording"); } };
  const stop = () => { try { if (rec.current?.state === "paused") { rec.current.resume(); startedAt.current = Date.now(); } rec.current?.stop(); } catch { /* stopped */ } };

  if (recorded && state === "idle") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-sidebar-primary"><Mic className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{t("Recording ready")}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">{clock(elapsed)} · {(recorded.size / 1048576).toFixed(1)} MB{introductions && introEnd !== null ? ` · ${t("introductions until {time}", { time: clock(introEnd) })}` : ""}</span>
        </span>
        {!disabled && <button type="button" onClick={() => { onDiscard(); setElapsed(0); }} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">{t("Discard")}</button>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
      <div className="flex items-center gap-3">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full", state === "recording" ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-accent text-sidebar-primary")}>
          <Mic className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-semibold tabular-nums leading-none">{clock(elapsed)}</div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-sidebar-primary transition-[width] duration-100" style={{ width: `${state === "recording" ? Math.min(100, level * 160) : 0}%` }} /></div>
          <div className="mt-1 text-xs text-muted-foreground">{state === "idle" ? t("Keep this tab open while recording.") : state === "paused" ? t("Paused") : t("Recording… keep this tab open.")}</div>
        </div>
      </div>
      {introductions && state !== "idle" && (
        introEnd === null ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-sidebar-primary/30 bg-accent/50 px-3 py-2.5" aria-live="polite">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sidebar-primary px-2 py-0.5 text-xs font-semibold text-sidebar-primary-foreground"><Users className="h-3 w-3" />{t("Introductions")}</span>
            <span className="min-w-0 flex-1 basis-48 text-xs leading-relaxed">{t("Each person says their name in turn, then tap Done.")}</span>
            <button type="button" onClick={() => onIntroEnd(Math.round(elapsed * 100) / 100)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sidebar-primary px-3 text-xs font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary/90"><Check className="h-3.5 w-3.5" />{t("Done with introductions")}</button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="tabular-nums">{t("Introductions done at {time}", { time: clock(introEnd) })}</span>
            <button type="button" onClick={() => onIntroEnd(null)} className="rounded px-1 font-medium text-foreground underline-offset-2 hover:underline">{t("Undo")}</button>
          </div>
        )
      )}
      <div className="mt-3 flex gap-2">
        {state === "idle" ? (
          <button type="button" disabled={disabled} onClick={() => void begin()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-sidebar-primary px-3 text-sm font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary/90 disabled:opacity-50"><Mic className="h-4 w-4" />{t("Start recording")}</button>
        ) : null}
        {state === "idle" ? (
          onCancel && <button type="button" onClick={onCancel} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-accent">{t("Cancel")}</button>
        ) : (
          <>
            <button type="button" onClick={pause} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-accent">{state === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{state === "paused" ? t("Resume") : t("Pause")}</button>
            <button type="button" onClick={stop} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Square className="h-3.5 w-3.5 fill-current" />{t("Stop")}</button>
          </>
        )}
      </div>
      {err && <p role="alert" className="mt-2 text-sm font-medium text-destructive">{err}</p>}
    </div>
  );
}
