import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, Loader2, Volume2, VolumeX, Sparkles, ListChecks, FolderKanban,
  User as UserIcon, ArrowUpRight, X, Zap, Send,
} from "lucide-react";
import { nexusApi, type OracleResult, type OracleNode } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/oracle")({ component: OraclePage });

const SUGGESTIONS = [
  "Task Bagas Putro",
  "Project Jagain Agency",
  "Who's overdue?",
  "Who's busiest?",
  "Tasks due today",
  "What projects are there?",
];

function iconFor(kind: OracleNode["kind"]) {
  return kind === "project" ? FolderKanban : kind === "person" ? UserIcon : ListChecks;
}
function statusTone(s: OracleNode["status"]) {
  switch (s) {
    case "completed": return { dot: "bg-emerald-400", ring: "border-emerald-300/60", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-400/40", bar: "from-emerald-400 to-teal-300", label: "DONE" };
    case "in-progress": return { dot: "bg-sky-400", ring: "border-sky-300/60", badge: "bg-sky-500/15 text-sky-300 border-sky-400/40", bar: "from-sky-400 to-indigo-400", label: "IN PROGRESS" };
    default: return { dot: "bg-slate-300", ring: "border-slate-300/40", badge: "bg-slate-500/15 text-slate-300 border-slate-400/30", bar: "from-slate-400 to-slate-300", label: "PENDING" };
  }
}

function stripMd(s: string) { return s.replace(/[*_`#]/g, ""); }

function OraclePage() {
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false });
  const role = wsm.data?.role;
  const allowed = role === "ONE_ABOVE_ALL";

  const [query, setQuery] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OracleResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ttsOn, setTtsOn] = useState(false);
  const [angle, setAngle] = useState(0);
  const recognitionRef = useRef<any>(null);

  // Auto-rotate the orbit, paused while a node card is open.
  useEffect(() => {
    if (expanded || !result?.nodes.length) return;
    const t = setInterval(() => setAngle((a) => (a + 0.25) % 360), 50);
    return () => clearInterval(t);
  }, [expanded, result?.nodes.length]);

  const speak = useCallback((text: string) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      // Strip markdown + emoji so the voice doesn't read "bintang" / "wajah tersenyum".
      const clean = stripMd(text).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "").replace(/\s+/g, " ").trim();
      if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean);
      const idVoice = synth.getVoices().find((v) => (v.lang || "").toLowerCase().startsWith("id"));
      if (idVoice) u.voice = idVoice;
      u.lang = "id-ID"; u.rate = 1.0;
      synth.speak(u);
    } catch { /* TTS unsupported */ }
  }, []);

  const submit = useCallback(async (q?: string) => {
    const text = (q ?? query).trim();
    if (!text) return;
    setQuery(text); setLoading(true); setExpanded(null);
    try {
      const res = await nexusApi.oracleAsk(text);
      setResult(res);
      if (ttsOn && res.answer) speak(res.answer);
    } catch {
      setResult({ intent: "error", subject: "Error", answer: "Couldn't pull the data. Give it another shot.", nodes: [] });
    } finally { setLoading(false); }
  }, [query, ttsOn, speak]);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setVoiceErr("This browser doesn't do voice — just type it."); return; }
    try {
      const rec = new SR();
      rec.lang = "id-ID"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      rec.onresult = (e: any) => {
        const txt = Array.from(e.results).map((r: any) => r[0].transcript).join("");
        setQuery(txt);
        // Only auto-submit a real utterance (guard against stray/empty finals).
        if (e.results[e.results.length - 1].isFinal) {
          setListening(false);
          if (txt.trim().length >= 2) submit(txt);
          else setVoiceErr("Didn't catch that clearly — try again or type it.");
        }
      };
      rec.onerror = (e: any) => {
        setListening(false);
        setVoiceErr(e.error === "not-allowed" ? "Mic isn't allowed yet. Check your browser permissions." : e.error === "no-speech" ? "Didn't hear anything — try again." : "Voice error, just type it.");
      };
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      setVoiceErr(null); setQuery(""); setListening(true); rec.start();
    } catch { setVoiceErr("Couldn't start voice — just type it."); }
  }, [submit]);

  const stopListening = useCallback(() => { try { recognitionRef.current?.stop(); } catch { /* noop */ } setListening(false); }, []);

  if (wsm.isLoading) {
    return <div className="flex h-screen items-center justify-center bg-[#070b1a] text-white"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!allowed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#070b1a] text-white">
        <Sparkles className="h-10 w-10 text-indigo-400/60" />
        <div className="text-lg font-bold">Oracle is for One Above All only</div>
        <p className="max-w-sm text-center text-sm text-white/50">This dashboard is just for the top role. If this looks wrong, ping an admin.</p>
      </div>
    );
  }

  const nodes = result?.nodes ?? [];
  const radius = 210;

  return (
    <div className="relative h-screen overflow-hidden bg-gradient-to-b from-[#0a0f24] via-[#070b1a] to-[#04060f] text-white">
      {/* ambient grid + glow */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 50% 40%, #6366f1 0%, transparent 60%)" }} />

      {/* header */}
      <div className="relative z-20 flex items-center justify-between px-6 py-5">
        <div>
          <div className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
            <Sparkles className="h-5 w-5 text-indigo-400" /> Oracle
          </div>
          <p className="text-xs text-white/40">Ask anything about NEXUS — by voice or type.</p>
        </div>
        <button
          onClick={() => setTtsOn((v) => !v)}
          title={ttsOn ? "Spoken answers: ON" : "Spoken answers: OFF"}
          className={cn("inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition", ttsOn ? "border-indigo-400/40 bg-indigo-500/10 text-indigo-200" : "border-white/15 text-white/50 hover:bg-white/5")}
        >
          {ttsOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />} Voice
        </button>
      </div>

      {/* orbital stage */}
      <div className="relative z-10 flex h-[calc(100vh-220px)] items-center justify-center">
        <div className="relative flex items-center justify-center" style={{ width: radius * 2 + 120, height: radius * 2 + 120 }}>
          {/* orbit rings */}
          <div className="absolute rounded-full border border-white/10" style={{ width: radius * 2, height: radius * 2 }} />
          <div className="absolute rounded-full border border-white/5" style={{ width: radius * 2 + 60, height: radius * 2 + 60 }} />

          {/* center */}
          <div className="absolute z-10 flex flex-col items-center">
            <div className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 shadow-[0_0_60px_-5px_rgba(99,102,241,0.6)]">
              <div className="absolute h-28 w-28 animate-ping rounded-full border border-white/20 opacity-60" />
              {loading
                ? <Loader2 className="h-7 w-7 animate-spin text-white" />
                : <div className="grid h-12 w-12 place-items-center rounded-full bg-white/15 backdrop-blur"><Sparkles className="h-5 w-5 text-white" /></div>}
            </div>
            <div className="mt-3 max-w-[180px] truncate text-center text-sm font-bold tracking-wide text-white/90">
              {loading ? "Thinking…" : result?.subject ?? "NEXUS"}
            </div>
          </div>

          {/* nodes */}
          {nodes.map((node, i) => {
            const a = ((i / Math.max(1, nodes.length)) * 360 + angle) % 360;
            const rad = (a * Math.PI) / 180;
            const x = radius * Math.cos(rad);
            const y = radius * Math.sin(rad);
            const tone = statusTone(node.status);
            const Icon = iconFor(node.kind);
            const isOpen = expanded === node.id;
            const z = Math.round(100 + 50 * Math.cos(rad));
            const op = Math.max(0.5, Math.min(1, 0.5 + 0.5 * ((1 + Math.sin(rad)) / 2)));
            return (
              <div
                key={node.id}
                className="absolute cursor-pointer transition-all duration-700"
                style={{ transform: `translate(${x}px, ${y}px)`, zIndex: isOpen ? 300 : z, opacity: isOpen ? 1 : op }}
                onClick={(e) => { e.stopPropagation(); setExpanded(isOpen ? null : node.id); }}
              >
                {/* glow */}
                <div className="absolute rounded-full" style={{ background: "radial-gradient(circle, rgba(129,140,248,0.25) 0%, transparent 70%)", width: node.energy * 0.6 + 40, height: node.energy * 0.6 + 40, left: -(node.energy * 0.6) / 2, top: -(node.energy * 0.6) / 2 }} />
                <motion.div layout className={cn("grid h-11 w-11 place-items-center rounded-full border-2 backdrop-blur transition-all", isOpen ? "scale-125 border-white bg-white text-[#0a0f24] shadow-lg" : `${tone.ring} bg-white/5 text-white`)}>
                  <Icon size={17} />
                </motion.div>
                <div className={cn("absolute left-1/2 top-12 w-32 -translate-x-1/2 text-center text-[11px] font-semibold leading-tight transition-all", isOpen ? "text-white" : "text-white/55")}>
                  {node.title.length > 26 ? node.title.slice(0, 26) + "…" : node.title}
                </div>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.7, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.7, y: -6 }}
                      transition={{ type: "spring", stiffness: 320, damping: 26 }}
                      className="absolute left-1/2 top-20 z-50 w-64 -translate-x-1/2 rounded-2xl border border-white/15 bg-[#0b1022]/95 p-4 shadow-2xl backdrop-blur-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide", tone.badge)}>{tone.label}</span>
                        {node.date && <span className="font-mono text-[11px] text-white/40">{node.date}</span>}
                      </div>
                      <div className="text-sm font-bold leading-snug">{node.title}</div>
                      {node.subtitle && <div className="mt-0.5 text-[11px] text-white/50">{node.subtitle}</div>}
                      {node.detail && <p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed text-white/70">{node.detail}</p>}

                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-[10px] text-white/50">
                          <span className="flex items-center gap-1"><Zap size={10} /> Energy</span>
                          <span className="font-mono">{Math.round(node.energy)}%</span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                          <div className={cn("h-full rounded-full bg-gradient-to-r", tone.bar)} style={{ width: `${node.energy}%` }} />
                        </div>
                      </div>

                      {node.href && node.kind === "task" && (
                        <Link to="/tasks/$taskId" params={{ taskId: node.id }} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-indigo-400/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 transition hover:bg-indigo-500/20">
                          Open in NEXUS <ArrowUpRight size={12} />
                        </Link>
                      )}
                      {node.href && node.kind === "project" && (
                        <Link to="/projects/$projectId" params={{ projectId: node.id }} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-indigo-400/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 transition hover:bg-indigo-500/20">
                          Open in NEXUS <ArrowUpRight size={12} />
                        </Link>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      {/* answer + truncation */}
      <AnimatePresence>
        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="absolute left-1/2 top-[88px] z-20 w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-center backdrop-blur"
          >
            <p className="text-sm text-white/85">{stripMd(result.answer)}</p>
            {result.usedLlm ? <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-indigo-300/80"><Sparkles className="h-3 w-3" /> answered by AI</p> : null}
            {result.truncated ? <p className="mt-1 text-[11px] text-white/40">+{result.truncated} more hidden to keep it tidy.</p> : null}
            {result.needsLlm && !result.usedLlm ? <p className="mt-1 text-[11px] text-amber-300/70">Couldn't find a good match — try rewording your question.</p> : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* bottom control bar */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-4 pb-6">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3">
          {/* suggestion chips (idle) */}
          {!result && !loading && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:border-indigo-400/40 hover:bg-indigo-500/10 hover:text-white">
                  {s}
                </button>
              ))}
            </div>
          )}
          {voiceErr && <div className="text-xs text-amber-300/80">{voiceErr}</div>}

          <div className="flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 backdrop-blur">
            <button
              onClick={listening ? stopListening : startListening}
              title={listening ? "Stop" : "Tap & talk"}
              className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl transition", listening ? "bg-rose-500 text-white shadow-[0_0_24px_-2px_rgba(244,63,94,0.7)]" : "bg-gradient-to-br from-indigo-500 to-violet-500 text-white hover:opacity-90")}
            >
              {listening ? <span className="relative flex h-4 w-4"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" /><span className="relative inline-flex h-4 w-4 rounded-full bg-white" /></span> : <Mic className="h-5 w-5" />}
            </button>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder={listening ? "Listening…" : "Ask, or tap the mic & talk…"}
              className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white outline-none placeholder:text-white/35"
            />
            {result && (
              <button onClick={() => { setResult(null); setQuery(""); setExpanded(null); }} title="Reset" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white/40 transition hover:bg-white/5 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => submit()} disabled={!query.trim() || loading} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
