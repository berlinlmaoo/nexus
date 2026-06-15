import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, ArrowLeft, Music } from "lucide-react";

// Hidden easter egg reached by clicking "PHAËTHON" on the login splash.
// Homage to github.com/danilamisocenko-hue/heart — terminal boot → decrypt →
// a dense canvas heart drawn from the words "love you", with a snippet of
// Massive Attack — Angel (2:19–2:30) looping in the background.
export const Route = createFileRoute("/phaethon")({ component: Phaethon });

const MESSAGE = "love you";
// Randomized love-themed variants so the words don't look copy-pasted.
const PHRASES = ["love you", "love you", "love you", "LOVE YOU", "Love You", "love u", "i love you", "luv u", "love you ♥", "loveyou"];
const pick = () => PHRASES[Math.floor(Math.random() * PHRASES.length)];
const SONG_ID = "66A_3uwuZ_I"; // Massive Attack — Angel (Remastered 2019). Swap if needed.
const SONG_START = 141; // 2:21
const SONG_END = 155; // 2:35

function Typewriter({ text, delay = 30, onComplete }: { text: string; delay?: number; onComplete?: () => void }) {
  const [shown, setShown] = useState("");
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i < text.length) {
      const t = setTimeout(() => { setShown((p) => p + text[i]); setI((p) => p + 1); }, delay);
      return () => clearTimeout(t);
    }
    onComplete?.();
  }, [i, text, delay, onComplete]);
  return <span className="font-mono">{shown}</span>;
}

/** Full-screen canvas heart densely filled with fading "love you" characters. */
function TextHeart() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let pts: { x: number; y: number; text: string; size: number; target: number; alpha: number; delay: number; phase: number }[] = [];
    let start = 0;
    let raf = 0;

    // Implicit heart: inside where (x²+y²−1)³ − x²y³ ≤ 0  (y axis pointing up).
    const insideHeart = (nx: number, ny: number) => {
      const a = nx * nx + ny * ny - 1;
      return a * a * a - nx * nx * (ny * ny * ny) <= 0;
    };

    const build = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const R = Math.min(w, h) * 0.32;
      const cx = w / 2;
      const cy = h / 2 + R * 0.05;
      pts = [];

      // Wild fill: scatter "love you" at random spots & sizes inside the heart
      // (rejection sampling). Messy/alive but unmistakably heart-shaped.
      const N = Math.min(560, Math.max(320, Math.round(Math.min(w, h) * 0.46)));
      // Spread the pop-ins across (almost) the whole song so they keep appearing
      // slowly until it ends — not all at once up front.
      const fillMs = Math.max(4000, (SONG_END - SONG_START - 1) * 1000);
      let tries = 0;
      while (pts.length < N && tries < N * 60) {
        tries++;
        const nx = Math.random() * 2.7 - 1.35;
        const ny = Math.random() * 2.8 - 1.4;
        if (!insideHeart(nx, ny)) continue;
        pts.push({
          x: cx + nx * R,
          y: cy - ny * R, // y-up → screen
          text: pick(), // randomized love-you variant
          size: 9 + Math.random() * Math.random() * 16, // mostly small, a few big
          target: 0.45 + Math.random() * 0.55, // depth via varied opacity
          alpha: 0,
          delay: Math.random() * fillMs, // sprinkle continuously across the song
          phase: Math.random() * Math.PI * 2, // twinkle offset
        });
      }
    };

    const render = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of pts) {
        if (elapsed > p.delay && p.alpha < p.target) p.alpha = Math.min(p.target, p.alpha + 0.012);
        if (p.alpha <= 0) continue;
        // once revealed, twinkle the opacity for a subtle living feel
        const a = p.alpha >= p.target ? p.target * (0.78 + 0.22 * Math.sin(elapsed * 0.004 + p.phase)) : p.alpha;
        ctx.font = `${p.size.toFixed(1)}px 'Fira Code', ui-monospace, monospace`;
        ctx.fillStyle = `rgba(255,77,109,${a})`;
        ctx.fillText(p.text, p.x, p.y);
      }
      raf = requestAnimationFrame(render);
    };

    build();
    raf = requestAnimationFrame(render);
    const onResize = () => { start = 0; build(); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, []);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-10" style={{ filter: "drop-shadow(0 0 7px rgba(255,77,109,0.5))" }} />;
}

/** Faint background splash that traces an "M" — soft/jittered so it doesn't read
 *  as an obvious letter, with a slow highlight that "runs" along the shape. */
function MSplash() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let parts: { bx: number; by: number; jx: number; jy: number; size: number; a: number; pos: number; bit: string }[] = [];
    let start = 0;
    let raf = 0;
    let minDim = 0;
    // wander params — re-randomized each pass so the route differs every loop
    let ph1 = 0, ph2 = 0, ampL = 0, freqA = 14, freqB = 12, lastLoop = -1;
    const newRoute = () => {
      ph1 = Math.random() * Math.PI * 2;
      ph2 = Math.random() * Math.PI * 2;
      ampL = minDim * (0.045 + Math.random() * 0.06);
      freqA = 10 + Math.random() * 12;
      freqB = 8 + Math.random() * 10;
    };
    // The flowing stream is binary that decodes to "Daiva Meara" (8-bit ASCII).
    const BITS = "Daiva Meara".split("").map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join("");

    const build = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // wide "M" spanning almost the full width (flows left → right)
      const mw = w * 0.92;
      const mh = Math.min(w, h) * 0.6;
      const ox = (w - mw) / 2;
      const oy = h / 2 - mh / 2;
      const V = ([[0, 1], [0, 0], [0.5, 0.52], [1, 0], [1, 1]] as const).map(([nx, ny]) => [ox + nx * mw, oy + ny * mh] as const);
      const segs = [[V[0], V[1]], [V[1], V[2]], [V[2], V[3]], [V[3], V[4]]] as const;
      const total = segs.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
      minDim = Math.min(w, h);
      parts = [];
      lastLoop = -1; // force a fresh random route on the first frame
      let acc = 0;
      let gi = 0; // running index → assigns binary digits in path order
      for (const [a, b] of segs) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(6, Math.round(len / 15)); // ~1 digit per 15px
        for (let i = 0; i < steps; i++) {
          const t = i / steps;
          const pos = (acc + len * t) / total;
          parts.push({
            bx: a[0] + (b[0] - a[0]) * t, // M-skeleton point (wander added at render)
            by: a[1] + (b[1] - a[1]) * t,
            jx: (Math.random() - 0.5) * 10,
            jy: (Math.random() - 0.5) * 10,
            size: 11 + Math.random() * 4,
            a: 0.04 + Math.random() * 0.06, // very faint base
            pos,
            bit: BITS[gi % BITS.length], // 0/1 of "Daiva Meara"
          });
          gi++;
        }
        acc += len;
      }
    };

    const render = (ts: number) => {
      if (!start) start = ts;
      const el = ts - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // a glowing head flows left → right along the M route, leaving a fading
      // tail. The route's wander is re-randomized each pass (loop) → different
      // every time it restarts from the left.
      const period = 3300;
      const head = (el / period) % 1;
      const loop = Math.floor(el / period);
      if (loop !== lastLoop) { lastLoop = loop; newRoute(); }
      const trail = 0.28;
      for (const p of parts) {
        const rel = head - p.pos; // how far behind the head (no wrap)
        if (rel < 0 || rel > trail) continue;
        const k = 1 - rel / trail; // 1 at head → 0 at tail
        const a = p.a * 0.3 + k * 0.5; // digits glow bright at the flowing head
        const wx = Math.sin(p.pos * freqA + ph1) * ampL + Math.sin(p.pos * freqA * 0.4 + ph2) * ampL * 0.7;
        const wy = Math.cos(p.pos * freqB + ph2) * ampL + Math.cos(p.pos * freqB * 0.4 + ph1) * ampL * 0.7;
        ctx.font = `${p.size.toFixed(1)}px 'Fira Code', ui-monospace, monospace`;
        ctx.fillStyle = `rgba(255,77,109,${a})`;
        ctx.fillText(p.bit, p.bx + wx + p.jx, p.by + wy + p.jy);
      }
      raf = requestAnimationFrame(render);
    };

    build();
    raf = requestAnimationFrame(render);
    const onResize = () => { start = 0; build(); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, []);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0" style={{ filter: "blur(0.4px)" }} aria-hidden />;
}

function Phaethon() {
  const [stage, setStage] = useState<"console" | "reveal">("console");
  const [ready, setReady] = useState(false);
  const [fading, setFading] = useState(false);

  // --- background music: Massive Attack — Angel (2:19–2:30), via YT IFrame API ---
  // Plays the snippet once; when it ends, we drop back to the login screen.
  const navigate = useNavigate();
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);
  const wantPlayRef = useRef(false);
  const exitTimerRef = useRef<number | undefined>(undefined);
  const onEndedRef = useRef<() => void>(() => {});
  onEndedRef.current = () => {
    // graceful fade to black, then back to login
    setFading(true);
    window.setTimeout(() => navigate({ to: "/login" }), 1200);
  };

  useEffect(() => {
    const w = window as any;
    // Build the player host imperatively (outside React's tree) so React never
    // reconciles the node that YT replaces with its <iframe>. Kept on-screen at
    // 1px/near-zero opacity — fully hidden iframes can have playback suppressed.
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.001;pointer-events:none;z-index:-1;overflow:hidden;";
    const mount = document.createElement("div");
    host.appendChild(mount);
    document.body.appendChild(host);

    const create = () => {
      if (playerRef.current || !w.YT?.Player) return;
      playerRef.current = new w.YT.Player(mount, {
        width: "1",
        height: "1",
        videoId: SONG_ID,
        playerVars: { start: SONG_START, end: SONG_END, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, fs: 0 },
        events: {
          onReady: () => {
            readyRef.current = true;
            // if the Decrypt click already happened, start now
            if (wantPlayRef.current) { try { playerRef.current.seekTo(SONG_START, true); playerRef.current.playVideo(); } catch { /* noop */ } }
          },
          onStateChange: (e: any) => {
            // real playback started → cancel the "audio never played" safety timer
            if (e.data === w.YT.PlayerState.PLAYING) { window.clearTimeout(exitTimerRef.current); exitTimerRef.current = undefined; }
            if (e.data === w.YT.PlayerState.ENDED) onEndedRef.current();
          },
          onError: () => { /* video unavailable/blocked — safety timer will return to login */ },
        },
      });
    };

    if (w.YT?.Player) {
      create();
    } else {
      if (!document.getElementById("youtube-iframe-api")) {
        const s = document.createElement("script");
        s.id = "youtube-iframe-api";
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
      }
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => { prev?.(); create(); };
    }
    return () => { try { playerRef.current?.destroy?.(); } catch { /* noop */ } playerRef.current = null; host.remove(); };
  }, []);

  const startMusic = () => {
    wantPlayRef.current = true;
    const p = playerRef.current;
    if (p && readyRef.current) { try { p.seekTo(SONG_START, true); p.playVideo(); } catch { /* noop */ } }
  };
  const stopMusic = () => { wantPlayRef.current = false; try { playerRef.current?.pauseVideo?.(); } catch { /* noop */ } };

  const goReveal = useCallback(() => {
    setStage("reveal");
    startMusic();
    // Fallback: if audio never actually starts (autoplay blocked / video error),
    // still bow out to login. Cleared as soon as real playback begins.
    window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => onEndedRef.current(), (SONG_END - SONG_START) * 1000 + 13000);
  }, []);
  const goConsole = useCallback(() => { setStage("console"); setReady(true); stopMusic(); window.clearTimeout(exitTimerRef.current); }, []);
  useEffect(() => () => window.clearTimeout(exitTimerRef.current), []);

  const onBackdropClick = useCallback(() => {
    if (stage === "console" && ready) goReveal();
    else if (stage === "reveal") startMusic(); // tap anywhere = retry audio (beats autoplay block)
  }, [stage, ready, goReveal]);

  return (
    <div
      onClick={onBackdropClick}
      className={`relative min-h-screen w-full overflow-hidden bg-[#050505] text-white transition-opacity duration-[1200ms] ease-in ${fading ? "opacity-0" : "opacity-100"} ${stage === "console" && ready ? "cursor-pointer" : ""}`}
    >
      <style>{`
        @keyframes ee-scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
        @keyframes ee-blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
        .ee-scanline { position: fixed; inset: 0; pointer-events: none; z-index: 30; background: linear-gradient(rgba(255,77,109,0) 0%, rgba(255,77,109,0.06) 50%, rgba(255,77,109,0) 100%); height: 40vh; animation: ee-scan 6s linear infinite; }
        .ee-glow { text-shadow: 0 0 12px rgba(255,77,109,0.7), 0 0 32px rgba(255,77,109,0.3); }
        .ee-cursor { display: inline-block; width: 7px; height: 1em; background: #ff4d6d; animation: ee-blink 1s steps(1) infinite; vertical-align: middle; }
        .ee-vignette { position: fixed; inset: 0; pointer-events: none; z-index: 20; background: radial-gradient(circle at center, transparent 55%, rgba(0,0,0,0.85) 100%); }
      `}</style>

      <div className="ee-scanline" />
      <div className="ee-vignette" />

      <Link
        to="/login"
        onClick={(e) => { e.stopPropagation(); stopMusic(); }}
        className="fixed left-6 top-6 z-40 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-white/25 transition-colors hover:text-white/60"
      >
        <ArrowLeft className="h-3 w-3" /> exit
      </Link>

      <div className="relative z-40 flex min-h-screen w-full items-center justify-center">
        <AnimatePresence mode="wait">
          {stage === "console" ? (
            <motion.div
              key="console"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="w-full max-w-2xl p-8 font-mono text-sm text-white/80 md:text-base"
            >
              <div className="space-y-2">
                <div className="flex gap-2 text-[#ff8fa3]/70">
                  <span>[system]</span>
                  <Typewriter text="Here Phaëthon Lies, and thought greatly he failed, more greatly he dared" delay={28} onComplete={() => setReady(true)} />
                </div>
                <div className="flex min-h-6 gap-2">
                  <span>[status]</span>
                  {ready && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-green-400">ok, you found the easter egg</motion.span>}
                </div>

                {ready && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start gap-6 pt-8">
                    <p className="italic text-white/40">{">"} One encrypted package found for you.</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); goReveal(); }}
                      className="group flex items-center gap-3 border border-[#ff4d6d]/30 bg-[#ff4d6d]/5 px-6 py-3 text-[#ff8fa3] transition-all duration-300 hover:bg-[#ff4d6d]/10"
                    >
                      <Lock size={16} className="transition-transform group-hover:rotate-12" />
                      <span className="font-mono text-xs uppercase tracking-widest">Decrypt Message</span>
                      <span className="ee-cursor" />
                    </button>
                    <p className="animate-pulse text-[10px] text-white/20">(or just click anywhere)</p>
                  </motion.div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative flex h-screen w-full items-center justify-center">
              <button
                onClick={(e) => { e.stopPropagation(); startMusic(); }}
                aria-label="Play music"
                title="Play music"
                className="fixed right-6 top-6 z-40 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-white/25 transition-colors hover:text-white/60"
              >
                <Music className="h-3 w-3" /> sound
              </button>
              <MSplash />
              <TextHeart />
              <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 3, duration: 1.5 }} className="z-20 text-center">
                <h2 className="ee-glow mb-2 font-mono text-xl uppercase tracking-[0.3em] text-[#ff4d6d]">Decrypted</h2>
                <div className="mx-auto mb-8 h-px w-12 bg-[#ff4d6d]/30" />
                <button
                  onClick={(e) => { e.stopPropagation(); goConsole(); }}
                  className="font-mono text-[10px] uppercase tracking-widest text-white/20 transition-colors hover:text-white/60"
                >
                  Re-encrypt
                </button>
              </motion.div>

              <div className="absolute left-8 top-8 z-20 space-y-1 font-mono text-[10px] uppercase tracking-widest text-white/10">
                <div>ln: 420</div>
                <div>id: 0xDEADBEEF</div>
                <div>type: organic_emotion</div>
              </div>
              <div className="absolute bottom-8 right-8 z-20 font-mono text-[10px] uppercase tracking-widest text-white/10">heart_reveal // success</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
