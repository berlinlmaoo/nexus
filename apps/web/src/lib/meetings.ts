// Meeting notes, Beta (owner, 18 Oct 2026): a recording → transcript → GIDEON overview, minutes and proposed tasks →
// Apply. The server is the authority (src/lib/meeting-notes.ts, /api/meetings/**); these types copy its answers.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtime, useRealtimeRoom } from "@/lib/realtime";
import { getLang } from "@/lib/lang";

export type MeetingStatus = "UPLOADING" | "QUEUED" | "TRANSCRIBING" | "SUMMARIZING" | "READY" | "APPLYING" | "APPLIED" | "FAILED";
export type MeetingLanguage = "auto" | "id" | "en";
export type MomTopic = { title: string; points: string[] };
export type MomActionItem = { text: string; owner: string | null; due: string | null };
export type Mom = { attendees: string[]; topics: MomTopic[]; decisions: string[]; openQuestions: string[]; actionItems: MomActionItem[] };
export type TaskProposal = { key: string; include: boolean; title: string; description: string; assigneeIds: string[]; dueDate: string | null; actionIndex: number | null };
export type TranscriptSegment = { start: number; end: number; text: string; speaker?: string | null };
export type MeetingPerson = { id: string; name: string | null; avatar: string | null };

export type Meeting = {
  id: string;
  title: string;
  status: MeetingStatus;
  progress: number;
  language: MeetingLanguage;
  source: "upload" | "record";
  projectId: string | null;
  project: { id: string; name: string; icon: string | null } | null;
  createdBy: MeetingPerson;
  audio: { name: string | null; mime: string | null; bytes: number; received: number; available: boolean; deletedAt: string | null; deleteAfter: string | null };
  durationSec: number | null;
  recordedAt: string | null;
  detectedLanguage: string | null;
  tier: string | null;
  doc: { id: string; title: string; url: string } | null;
  taskCount: number;
  error: string | null;
  errorCode: string | null;
  appliedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  beta: true;
  /** Waiting for / in the transcriber, or writing the minutes: place in line and a rough time left. Null otherwise. */
  queue: MeetingQueue | null;
  can: { edit: boolean; apply: boolean; delete: boolean; retry: boolean };
};

export type MeetingQueue = { waiting: boolean; position: number | null; etaSec: number };

/** "about 4 min" / "about 1 h 10 min" (rounded up to a minute). */
export function etaText(sec: number, t: (s: string, v?: Record<string, string | number>) => string): string {
  const m = Math.max(1, Math.ceil(sec / 60));
  return m >= 60 ? t("about {h} h {m} min", { h: Math.floor(m / 60), m: m % 60 }) : t("about {m} min", { m });
}

/** The honest one-liner for a meeting that is not ready yet (page, list, upload dialog). */
export function queueLine(q: MeetingQueue | null | undefined, status: MeetingStatus, t: (s: string, v?: Record<string, string | number>) => string): string | null {
  if (!q) return null;
  if (q.waiting) {
    const where = q.position && q.position > 1 ? t("#{n} in line", { n: q.position }) : t("next in line");
    return `${t("Waiting for the transcription server…")} ${where} · ${t("ready in {eta}", { eta: etaText(q.etaSec, t) })}`;
  }
  return status === "SUMMARIZING" ? t("Writing the minutes · ready in {eta}", { eta: etaText(q.etaSec, t) }) : t("Transcribing · ready in {eta}", { eta: etaText(q.etaSec, t) });
}

export type MeetingFull = Meeting & {
  overview: string | null;
  mom: Mom | null;
  proposals: TaskProposal[];
  speakers: Record<string, { name: string; userId: string | null }> | null;
  transcript: TranscriptSegment[];
  transcribeStats: { position?: number | null; state?: string } | null;
  tasks: Array<{ id: string; title: string; status: string; dueDate: string | null; projectId: string; section: string; assignees: MeetingPerson[] }>;
  members: MeetingPerson[];
};

export type MeetingSettings = { enabled: boolean; maxMinutes: number; maxBytes: number; retentionDays: number };

export class MeetingApiError extends Error {
  constructor(message: string, public status: number, public code: string | null, public body: Record<string, unknown> | null) { super(message); }
}

async function mjson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { Accept: "application/json", "Content-Type": "application/json", "X-Nexus-Client": "web/1", "Accept-Language": getLang(), ...(init?.headers || {}) } });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new MeetingApiError(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`, res.status, typeof body?.code === "string" ? body.code : null, body);
  return body as T;
}

export const meetingsKey = (projectId?: string | null) => ["meetings", projectId ?? "mine"] as const;
export const meetingKey = (id: string) => ["meeting", id] as const;

export const listMeetings = (projectId?: string | null) => mjson<{ meetings: Meeting[]; settings: MeetingSettings }>(`/api/meetings${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`);
export const getMeeting = (id: string) => mjson<{ meeting: MeetingFull }>(`/api/meetings/${encodeURIComponent(id)}`).then((r) => r.meeting);
export const createMeeting = (body: { fileName: string; mime: string; size: number; title?: string; projectId?: string | null; language?: MeetingLanguage; source?: "upload" | "record"; recordedAt?: string; durationSec?: number | null }) =>
  mjson<{ meeting: Meeting; upload: { chunkBytes: number; maxChunkBytes: number } }>("/api/meetings", { method: "POST", body: JSON.stringify(body) });
export const patchMeeting = (id: string, body: Record<string, unknown>) => mjson<{ meeting: MeetingFull }>(`/api/meetings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
export const applyMeeting = (id: string, body: { projectId: string; title: string; overview: string; mom: Mom; proposals: TaskProposal[]; lang: "en" | "id" }) =>
  mjson<{ meeting: MeetingFull; doc: { id: string; title: string; url: string }; tasks: Array<{ id: string; title: string }> }>(`/api/meetings/${encodeURIComponent(id)}/apply`, { method: "POST", body: JSON.stringify(body) });
export const retryMeeting = (id: string, stage?: "minutes" | "transcript") => mjson<{ meeting: MeetingFull }>(`/api/meetings/${encodeURIComponent(id)}/retry`, { method: "POST", body: JSON.stringify(stage ? { stage } : {}) });
export const deleteMeeting = (id: string) => mjson<{ success: true }>(`/api/meetings/${encodeURIComponent(id)}`, { method: "DELETE" });

/**
 * Send the file in chunks (resumable: on a 409 the server says where it is, and the upload continues from there).
 * Three tries per chunk with a pause; `onProgress` gets 0..1.
 */
export async function uploadMeetingAudio(meetingId: string, file: Blob, chunkBytes: number, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Meeting> {
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const end = Math.min(file.size, offset + chunkBytes);
    try {
      const res = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/audio?offset=${offset}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream", "X-Nexus-Client": "web/1" },
        body: file.slice(offset, end),
        signal,
      });
      const body = (await res.json().catch(() => null)) as { received?: number; error?: string; code?: string } | null;
      if (res.status === 409 && typeof body?.received === "number") { offset = body.received; continue; }
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) throw new MeetingApiError(body?.error || `Upload failed (${res.status})`, res.status, body?.code ?? null, body as Record<string, unknown> | null);
        throw new Error(body?.error || `Upload failed (${res.status})`);
      }
      offset = typeof body?.received === "number" ? body.received : end;
      failures = 0;
      onProgress(offset / file.size);
    } catch (error) {
      if (error instanceof MeetingApiError || (error as Error)?.name === "AbortError") throw error;
      if (++failures >= 4) throw error;
      await new Promise((r) => setTimeout(r, 1500 * failures));
    }
  }
  const done = await mjson<{ meeting: Meeting }>(`/api/meetings/${encodeURIComponent(meetingId)}/audio/complete`, { method: "POST", body: "{}" });
  return done.meeting;
}

type MeetingPing = { meetingId: string; projectId: string | null; status: MeetingStatus; progress: number; version: number; deleted?: boolean };

/** One meeting, live: `meeting-changed` for it refetches (status, progress, someone else's edits). */
export function useMeeting(id: string) {
  const qc = useQueryClient();
  const { socket } = useRealtime();
  const q = useQuery({ queryKey: meetingKey(id), queryFn: () => getMeeting(id), retry: 1, refetchOnWindowFocus: true });
  useRealtimeRoom(q.data?.projectId ? `project:${q.data.projectId}` : null);
  useEffect(() => {
    if (!socket) return;
    const on = (p: MeetingPing) => {
      if (p?.meetingId !== id) return;
      const cur = qc.getQueryData<MeetingFull>(meetingKey(id));
      // Progress only: patch in place (no refetch per percent).
      if (cur && !p.deleted && cur.status === p.status && (p.status === "TRANSCRIBING" || p.status === "SUMMARIZING" || p.status === "UPLOADING") && p.version > cur.version) {
        qc.setQueryData<MeetingFull>(meetingKey(id), { ...cur, progress: p.progress, version: p.version });
        return;
      }
      if (!cur || p.deleted || p.version > cur.version || p.status !== cur.status) void qc.invalidateQueries({ queryKey: meetingKey(id) });
    };
    socket.on("meeting-changed", on);
    return () => { socket.off("meeting-changed", on); };
  }, [socket, qc, id]);
  return q;
}

/** The person's meetings (or a project's): refetched on any `meeting-changed`. */
export function useMeetingList(projectId?: string | null) {
  const qc = useQueryClient();
  const { socket } = useRealtime();
  useRealtimeRoom(projectId ? `project:${projectId}` : null);
  useEffect(() => {
    if (!socket) return;
    const on = () => { void qc.invalidateQueries({ queryKey: ["meetings"] }); };
    socket.on("meeting-changed", on);
    return () => { socket.off("meeting-changed", on); };
  }, [socket, qc]);
  return useQuery({ queryKey: meetingsKey(projectId), queryFn: () => listMeetings(projectId), retry: 1 });
}

// ---------------------------------------------------------------- remote config (web)

export type WebAppConfig = { flags: Record<string, boolean>; values: Record<string, number>; gideonTiers?: GideonTierStatus | null };

/** /api/app/config?platform=web — the flags the web also follows (meetingNotesEnabled). Defaults when unreachable. */
export function useWebAppConfig() {
  return useQuery({
    queryKey: ["app-config", "web"],
    queryFn: () => mjson<WebAppConfig>("/api/app/config?platform=web"),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useMeetingNotesEnabled(): boolean {
  const cfg = useWebAppConfig();
  return cfg.data?.flags?.meetingNotesEnabled !== false;
}

// ---------------------------------------------------------------- GIDEON tier availability

export type TierAvailability = { available: boolean; reason: "transcribing" | "loading" | "down" | null; since: string | null };
export type GideonTierStatus = Record<"astra" | "luna" | "terra" | "experimental", TierAvailability>;
export const TIERS_KEY = ["gideon-tiers"] as const;

/**
 * Which GIDEON tiers can answer now (18 Oct 2026). Live: the socket `gideon-tiers` (sent to everyone when Model 0
 * goes away for a meeting transcript or comes back) replaces the cached answer; a refetch on focus and a minute's
 * poll cover a missed event.
 */
export function useGideonTiers() {
  const qc = useQueryClient();
  const { socket } = useRealtime();
  useEffect(() => {
    if (!socket) return;
    const on = (data: { tiers?: GideonTierStatus | null }) => {
      if (data?.tiers) qc.setQueryData(TIERS_KEY, data.tiers);
      else void qc.invalidateQueries({ queryKey: TIERS_KEY });
    };
    socket.on("gideon-tiers", on);
    // Reconnected: whatever changed while the socket was down.
    const re = () => { void qc.invalidateQueries({ queryKey: TIERS_KEY }); };
    socket.on("connect", re);
    return () => { socket.off("gideon-tiers", on); socket.off("connect", re); };
  }, [socket, qc]);
  return useQuery({
    queryKey: TIERS_KEY,
    queryFn: () => mjson<{ tiers: GideonTierStatus }>("/api/gideon/tiers").then((r) => r.tiers),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export const TIER_REASON: Record<string, string> = {
  transcribing: "The office GPU is transcribing a meeting.",
  loading: "It's starting up again.",
  down: "The local model isn't responding.",
};

// ---------------------------------------------------------------- display helpers

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

export function durationText(sec: number | null | undefined, t: (s: string, v?: Record<string, string | number>) => string): string | null {
  if (!sec || sec < 1) return null;
  const m = Math.round(sec / 60);
  if (m >= 60) return t("{h} h {m} min", { h: Math.floor(m / 60), m: m % 60 });
  return t("{m} min", { m: Math.max(1, m) });
}

export const MEETING_AUDIO_ACCEPT = ".m4a,.mp4,.mov,.mp3,.wav,.webm,.ogg,.oga,.opus,.aac,.flac,.3gp,.amr,audio/*,video/mp4,video/quicktime";
export const MEETING_AUDIO_EXTS = ["m4a", "mp4", "mov", "mp3", "wav", "webm", "ogg", "oga", "opus", "aac", "flac", "3gp", "amr"];

export function isMeetingAudio(file: File): boolean {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (ext && MEETING_AUDIO_EXTS.includes(ext)) return true;
  return /^audio\//.test(file.type) || file.type === "video/mp4" || file.type === "video/quicktime";
}

/** The file's duration in seconds, read by the browser (null when it can't tell — the server checks again). */
export function readDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement("audio");
      const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v); };
      el.preload = "metadata";
      el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
      el.onerror = () => done(null);
      setTimeout(() => done(null), 8000);
      el.src = url;
    } catch {
      resolve(null);
    }
  });
}
