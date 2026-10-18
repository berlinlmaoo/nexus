import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { FileAudio, Loader2, Mic, Pause, Play, Square, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SelectPicker } from "@/components/SelectPicker";
import { nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import {
  clock, createMeeting, isMeetingAudio, MeetingApiError, MEETING_AUDIO_ACCEPT, readDuration, uploadMeetingAudio, useWebAppConfig, type MeetingLanguage,
} from "@/lib/meetings";
import { BetaBadge } from "./BetaBadge";

/**
 * New meeting notes (Beta, owner 18 Oct 2026). Upload a recording or record here (MediaRecorder), pick the project
 * the minutes and tasks go to and the spoken language, then the file goes up in chunks and the meeting page opens
 * while it is transcribed. Opened from GIDEON's "+" menu and the project header.
 */
export function NewMeetingDialog({ open, onOpenChange, projectId: initialProject }: { open: boolean; onOpenChange: (v: boolean) => void; projectId?: string | null }) {
  const { t } = useLang();
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
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const projects = useQuery({ queryKey: ["nexus", "projects"], queryFn: () => nexusApi.projects(), enabled: open, staleTime: 60_000 });

  useEffect(() => {
    if (!open) return;
    setProjectId(initialProject ?? "");
    setFile(null); setDuration(null); setTitle(""); setError(null); setProgress(0); setBusy(false); setMode("upload");
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
      });
      await uploadMeetingAudio(meeting.id, file, upload.chunkBytes, setProgress, ctl.signal);
      onOpenChange(false);
      router.history.push(`/meetings/${meeting.id}`);
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

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{t("Meeting notes")}<BetaBadge /></DialogTitle>
          <DialogDescription>{t("GIDEON turns a recording into an overview, minutes and tasks. Nothing is added to the project until you check it and press Apply.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div role="tablist" aria-label={t("How to add the recording")} className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
            {(["upload", "record"] as const).map((m) => (
              <button key={m} role="tab" type="button" aria-selected={mode === m} disabled={busy} onClick={() => { setMode(m); setFile(null); setDuration(null); setError(null); }}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 font-medium text-muted-foreground transition-colors", mode === m && "bg-card text-foreground shadow-sm")}>
                {m === "upload" ? <Upload className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}{m === "upload" ? t("Upload a file") : t("Record")}
              </button>
            ))}
          </div>

          {mode === "upload" ? (
            file ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-sidebar-primary"><FileAudio className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{file.name}</span>
                  <span className="block text-xs text-muted-foreground">{(file.size / 1048576).toFixed(1)} MB{duration ? ` · ${clock(duration)}` : ""}</span>
                </span>
                {!busy && <button type="button" onClick={() => { setFile(null); setDuration(null); }} aria-label={t("Remove")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>}
              </div>
            ) : (
              <button type="button" onClick={() => input.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files?.[0] ?? null); }}
                className={cn("flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-7 text-center transition-colors hover:border-sidebar-primary/60 hover:bg-accent/40", drag && "border-sidebar-primary bg-accent/60")}>
                <Upload className="h-5 w-5 text-sidebar-primary" />
                <span className="text-sm font-medium">{t("Choose a recording or drop it here")}</span>
                <span className="text-xs text-muted-foreground">{t("m4a, mp3, wav, webm, ogg, aac or mp4 · up to {h} hours, {mb} MB", { h: Math.round((maxMinutes / 60) * 10) / 10, mb: maxMB })}</span>
              </button>
            )
          ) : (
            <Recorder disabled={busy} maxSeconds={maxMinutes * 60} onDone={(f, d) => { setFile(f); setDuration(d); if (!title) setTitle(t("Meeting {date}", { date: new Date().toLocaleDateString() })); }} recorded={file} onDiscard={() => { setFile(null); setDuration(null); }} />
          )}
          <input ref={input} type="file" accept={MEETING_AUDIO_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; void pick(f); }} />

          <label className="block">
            <span className="text-xs font-semibold">{t("Title")}</span>
            <input value={title} maxLength={200} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Weekly sync")} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-sidebar-primary" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className="text-xs font-semibold">{t("Project")}</span>
              <SelectPicker variant="field" className="mt-1 w-full" value={projectId} onChange={setProjectId} disabled={busy} clearable={t("Choose later")} placeholder={projects.isLoading ? t("Loading…") : t("Choose later")} options={projectOptions} ariaLabel={t("Project")} />
            </label>
            <label className="block min-w-0">
              <span className="text-xs font-semibold">{t("Spoken language")}</span>
              <SelectPicker variant="field" className="mt-1 w-full" value={language} onChange={(v) => setLanguage((v || "auto") as MeetingLanguage)} disabled={busy} ariaLabel={t("Spoken language")}
                options={[{ value: "auto", label: t("Detect automatically"), hint: t("Best for Indonesian mixed with English") }, { value: "id", label: t("Indonesian") }, { value: "en", label: t("English") }]} />
            </label>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("The audio is transcribed on our own server in the office and never leaves it. Only you and people with access to the project can open it. The audio is deleted {n} days after the minutes are saved.", { n: cfg.data?.values?.meetingAudioRetentionDays ?? 30 })}</p>
          {busy && (
            <div aria-live="polite">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{t("Uploading…")}</span><span className="tabular-nums">{Math.round(progress * 100)}%</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-sidebar-primary transition-[width] duration-300" style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>
            </div>
          )}
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <button type="button" onClick={() => close(false)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent">{t("Cancel")}</button>
          <button type="button" onClick={() => void start()} disabled={!file || busy} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sidebar-primary px-3 py-2 text-sm font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary/90 disabled:opacity-50">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("Upload and transcribe")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** In-browser recording (MediaRecorder). Opus in WebM where supported, AAC in MP4 on Safari. */
function Recorder({ onDone, onDiscard, recorded, disabled, maxSeconds }: { onDone: (f: File, durationSec: number) => void; onDiscard: () => void; recorded: File | null; disabled?: boolean; maxSeconds: number }) {
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
  const pause = () => { const r = rec.current; if (!r) return; if (r.state === "recording") { r.pause(); accumulated.current += (Date.now() - startedAt.current) / 1000; startedAt.current = 0; setState("paused"); } else if (r.state === "paused") { r.resume(); startedAt.current = Date.now(); setState("recording"); } };
  const stop = () => { try { if (rec.current?.state === "paused") { rec.current.resume(); startedAt.current = Date.now(); } rec.current?.stop(); } catch { /* stopped */ } };

  if (recorded && state === "idle") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-sidebar-primary"><Mic className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{t("Recording ready")}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">{clock(elapsed)} · {(recorded.size / 1048576).toFixed(1)} MB</span>
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
      <div className="mt-3 flex gap-2">
        {state === "idle" ? (
          <button type="button" disabled={disabled} onClick={() => void begin()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-sidebar-primary px-3 text-sm font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary/90 disabled:opacity-50"><Mic className="h-4 w-4" />{t("Start recording")}</button>
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
