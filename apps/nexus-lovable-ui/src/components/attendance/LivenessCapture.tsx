import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Camera, Check, Eye, EyeOff, Loader2, ScanFace, Sun, X } from "lucide-react";

/**
 * The attendance selfie, taken here with a liveness check in front of it.
 *
 * A still photo proves a camera was pointed at something; this proves a person was in front of it:
 * look straight, turn right, turn left, blink. Face landmarks come from MediaPipe, running in the
 * browser — no frame leaves the device except the one selfie captured at the end. It does not know
 * WHOSE face this is; that would be enrolment, a different decision.
 *
 * "Right" and "left" are instructions, not requirements: the first turn is accepted either way and
 * the second must be the opposite — what liveness needs, two poses a photo cannot produce — so a
 * mirrored preview can never make the words fight the check. The bar under the window fills as the
 * head turns, whichever way it goes.
 *
 * The bright window follows the detected face. The end is the Face ID moment: the ring closes green
 * and the check draws itself. In the dark the rest of the screen turns white, so the phone is its own
 * ring light; it also switches on by hand.
 */
const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type Step = 0 | 1 | 2 | 3 | 4; // straight, right, left, blink, hold still
type Presence = "none" | "small" | "off" | "ok";
const CHIPS = ["Straight", "Right", "Left", "Blink"];
const TITLES = ["Look straight at the camera", "Turn your head to the right", "Now turn to the left", "Blink once", "Hold still"];
const SUBS = ["Keep your face inside the window.", "Slowly, like the arrow, until the bar fills up.", "Same again, the other way.", "Look straight, close your eyes, then open them.", "Look straight, eyes open."];
const STALLED = ["Keep your face inside the window, in good light.", "Turn a bit further, until the bar fills up.", "Turn a bit further, until the bar fills up.", "Close your eyes for a moment, then open them. Glasses can make this harder.", "Keep your face inside the window, in good light."];

const FRONTAL = 0.07; // nose offset over face width
const TURNED = 0.18;
const BLINK_CLOSED = 0.4; // MediaPipe eyeBlink blendshape score
const BLINK_OPEN = 0.2;

type Landmark = { x: number; y: number };
type Result = { faceLandmarks?: Landmark[][]; faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }> };
type Box = { x: number; y: number; w: number; h: number }; // normalized, video coords (unmirrored)

export function LivenessCapture({ onCapture, onCancel, onUnavailable }: {
  onCapture: (file: File) => void;
  onCancel: () => void;
  /** No camera, or the face model could not be fetched: the caller falls back to a plain selfie. */
  onUnavailable: (reason: "camera" | "model") => void;
}) {
  const reduce = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [done, setDone] = useState(false);
  const [presence, setPresence] = useState<Presence>("none");
  const [box, setBox] = useState<Box | null>(null);
  const [progress, setProgress] = useState(0);
  const [closed, setClosed] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [dark, setDark] = useState(false);
  const [manualLight, setManualLight] = useState(false);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight, vw: 0, vh: 0 });
  const lightOn = dark || manualLight;

  useEffect(() => {
    const onResize = () => setView((v) => ({ ...v, w: window.innerWidth, h: window.innerHeight }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: { detectForVideo: (v: HTMLVideoElement, t: number) => Result; close?: () => void } | null = null;
    // Loop-confined state; React state is only what the screen draws.
    const st = { step: 0 as Step, hold: 0, side: 0, blinkSeen: false, lost: 0, stepStart: 0, cooldown: 0, finished: false, lastProgress: 0, stalled: false, frames: 0, dark: false, skipNext: false };
    const lumaCanvas = document.createElement("canvas"); lumaCanvas.width = 24; lumaCanvas.height = 24;

    const setStepAnim = (s: Step) => { st.step = s; st.hold = 0; st.blinkSeen = false; st.stepStart = performance.now(); st.cooldown = performance.now() + 500; st.stalled = false; setStalled(false); setNotice(null); setProgress(0); setStep(s); try { navigator.vibrate?.(20); } catch { /* not everywhere */ } };
    const reset = (why: string) => { st.side = 0; setStepAnim(0); setNotice(why); setTimeout(() => setNotice((n) => (n === why ? null : n)), 2500); };

    const measureLight = (v: HTMLVideoElement) => {
      const ctx = lumaCanvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, 24, 24);
      const d = ctx.getImageData(0, 0, 24, 24).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      const mean = sum / (d.length / 4);
      const was = st.dark;
      // Merely dim already counts as dark once no face has been found for a couple of seconds:
      // if the detector cannot see a face, more light is the one thing that helps.
      const struggling = st.lost > 60;
      if (mean < 55 || (struggling && mean < 100)) st.dark = true;
      else if (mean > (struggling ? 120 : 75)) st.dark = false;
      if (st.dark !== was) setDark(st.dark);
    };

    const capture = (v: HTMLVideoElement) => {
      st.finished = true;
      const max = 1280;
      const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      setDone(true);
      setTimeout(() => { setFlash(true); setTimeout(() => setFlash(false), 140); }, 180);
      c.toBlob((blob) => {
        if (!blob) { st.finished = false; setDone(false); return; }
        const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
        setTimeout(() => { if (alive) onCapture(file); }, 1000);
      }, "image/jpeg", 0.8);
    };

    const evaluate = (res: Result, v: HTMLVideoElement) => {
      const now = performance.now();
      const lm = res.faceLandmarks?.[0];
      if (!lm) {
        st.lost += 1; st.hold = 0;
        // Gone for ~1.5 s after the first move: whoever comes back starts over.
        if (st.lost > 40 && st.step > 0) reset("Face lost. Let's start again.");
        setPresence("none"); setBox(null); setProgress(0); setClosed(false);
        return;
      }
      st.lost = 0;
      const nose = lm[1], left = lm[234], right = lm[454], top = lm[10], chin = lm[152];
      const faceW = Math.abs(right.x - left.x), faceH = Math.abs(chin.y - top.y);
      const widthPx = faceW * v.videoWidth;
      const cx = (left.x + right.x) / 2, cy = (top.y + chin.y) / 2;
      let presence: Presence = "ok";
      if (widthPx < 0.26 * Math.min(v.videoWidth, v.videoHeight)) presence = "small";
      else if (Math.abs(cx - 0.5) > 0.19 || Math.abs(cy - 0.5) > 0.22) presence = "off";
      const yaw = (nose.x - cx) / faceW;
      const cats = res.faceBlendshapes?.[0]?.categories ?? [];
      const blink = (name: string) => cats.find((c) => c.categoryName === name)?.score ?? 0;
      const blinkScore = (blink("eyeBlinkLeft") + blink("eyeBlinkRight")) / 2;
      const eyesClosed = blinkScore > BLINK_CLOSED;
      // How far the head has turned toward what this step wants: any side for the first turn, the
      // opposite side for the second.
      let prog = 0;
      if (st.step === 1) prog = Math.min(1, Math.abs(yaw) / TURNED);
      else if (st.step === 2) prog = (yaw > 0 ? 1 : -1) === -st.side ? Math.min(1, Math.abs(yaw) / TURNED) : 0;
      setPresence(presence);
      setBox({ x: Math.min(left.x, right.x), y: top.y, w: faceW, h: faceH });
      if (Math.abs(prog - st.lastProgress) > 0.02) { st.lastProgress = prog; setProgress(prog); }
      setClosed(eyesClosed);
      if (presence !== "ok" || now < st.cooldown) { st.hold = 0; return; }
      if (!st.stalled && now - st.stepStart > 15000) { st.stalled = true; setStalled(true); }
      const held = (n: number) => { st.hold += 1; return st.hold >= n; };
      switch (st.step) {
        case 0:
          if (Math.abs(yaw) >= FRONTAL) { st.hold = 0; return; }
          if (held(8)) setStepAnim(1);
          return;
        case 1:
          if (Math.abs(yaw) < TURNED) { st.hold = 0; return; }
          st.side = yaw > 0 ? 1 : -1;
          if (held(3)) setStepAnim(2);
          return;
        case 2:
          if (Math.abs(yaw) < TURNED || (yaw > 0 ? 1 : -1) !== -st.side) { st.hold = 0; return; }
          if (held(3)) setStepAnim(3);
          return;
        case 3:
          if (Math.abs(yaw) > FRONTAL + 0.06) return;
          if (!st.blinkSeen) { if (blinkScore > BLINK_CLOSED) st.blinkSeen = true; }
          else if (blinkScore < BLINK_OPEN) setStepAnim(4);
          return;
        case 4:
          if (Math.abs(yaw) >= FRONTAL || eyesClosed) { st.hold = 0; return; }
          if (held(4)) capture(v);
      }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch { if (alive) onUnavailable("camera"); return; }
      const v = videoRef.current;
      if (!v || !alive) { stream.getTracks().forEach((t) => t.stop()); return; }
      v.srcObject = stream;
      try { await v.play(); } catch { /* autoplay policies; the muted+playsInline video still starts on most */ }
      try {
        const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`);
        const files = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
        const make = (delegate: "GPU" | "CPU") => vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true,
        });
        try { landmarker = await make("GPU"); } catch { landmarker = await make("CPU"); }
      } catch { if (alive) onUnavailable("model"); return; }
      if (!alive) { landmarker?.close?.(); return; }
      setReady(true);
      setView((s) => ({ ...s, vw: v.videoWidth, vh: v.videoHeight }));
      st.stepStart = performance.now();
      let lastT = -1;
      const loop = () => {
        if (!alive || st.finished) return;
        raf = requestAnimationFrame(loop);
        if (v.readyState < 2) return;
        const t = performance.now();
        if (t <= lastT) return;
        lastT = t;
        st.frames += 1;
        if (st.frames % 15 === 0) measureLight(v);
        // Slow devices: when a pass took over 40 ms, let the next frame go by — never during the
        // blink step, where a blink is only a few frames long.
        if (st.skipNext && st.step !== 3) { st.skipNext = false; return; }
        const started = performance.now();
        try { evaluate(landmarker!.detectForVideo(v, t), v); } catch { /* one bad frame */ }
        st.skipNext = performance.now() - started > 40;
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const segState = (i: number): "todo" | "current" | "done" => (done || step > i ? "done" : step === i ? "current" : "todo");
  const segColor = { todo: lightOn ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.28)", current: "hsl(var(--primary))", done: "#22c55e" };
  const ink = lightOn ? "text-black" : "text-white";
  const inkSoft = lightOn ? "text-black/70" : "text-white/80";
  const chipIdle = lightOn ? "bg-black/10 text-black/50" : "bg-white/15 text-white/50";
  const title = done ? "Verified" : TITLES[step];
  const subtitle = done ? "Taking your selfie…"
    : notice ?? (presence === "none" && dark ? "It's dark here, so the screen is your light. Hold the camera a little closer."
      : presence === "none" ? "No face yet. Hold the camera at eye level, in good light."
      : presence === "small" ? "Come a little closer."
      : presence === "off" ? "Move your face into the window."
      : stalled ? STALLED[step] : SUBS[step]);

  // Home window (no face yet) and the tracked window that hugs the face. The video is object-cover
  // and mirrored, so x is flipped and the cover scale/offset undone.
  const homeW = Math.min(view.w * 0.72, 300), homeH = homeW * 1.32;
  const home = { cx: view.w / 2, cy: view.h * 0.44, rx: homeW / 2, ry: homeH / 2 };
  let oval = home;
  if (box && view.vw > 0 && view.vh > 0) {
    const scale = Math.max(view.w / view.vw, view.h / view.vh);
    const dw = view.vw * scale, dh = view.vh * scale;
    const ox = (view.w - dw) / 2, oy = (view.h - dh) / 2;
    const fx = ox + (1 - box.x - box.w) * dw, fy = oy + box.y * dh, fw = box.w * dw, fh = box.h * dh;
    const w = Math.min(Math.max(fw * 1.3, 150), homeW * 1.15), h = Math.min(Math.max(fh * 1.5, w * 1.2), homeH * 1.2);
    oval = { cx: fx + fw / 2, cy: fy + fh / 2 - fh * 0.08, rx: w / 2, ry: h / 2 };
  }
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 320, damping: 32 };
  const turning = (step === 1 || step === 2) && !done;
  const rightward = step === 1;

  return (
    <motion.div className={`fixed inset-0 z-[80] bg-black ${ink}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <video ref={videoRef} muted playsInline autoPlay className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
      {/* Dim outside the window — or light it white in the dark. */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <mask id="nx-face-mask">
            <rect width="100%" height="100%" fill="white" />
            <motion.ellipse fill="black" animate={{ cx: oval.cx, cy: oval.cy, rx: oval.rx, ry: oval.ry }} transition={spring} />
          </mask>
        </defs>
        <motion.rect width="100%" height="100%" mask="url(#nx-face-mask)" animate={{ fill: lightOn ? "rgba(255,255,255,0.94)" : "rgba(0,0,0,0.68)" }} transition={{ duration: 0.3 }} />
        {/* Ring: four arcs, starting at the top and going clockwise (dash offset, not a rotation —
            a rotated ellipse swaps its width and height). */}
        <motion.g animate={{ x: oval.cx, y: oval.cy }} transition={spring}>
          {!done && !reduce && (
            <motion.ellipse cx={0} cy={0} rx={oval.rx + 10} ry={oval.ry + 10} fill="none" stroke="hsl(var(--primary))" strokeWidth={9} strokeLinecap="round"
              pathLength={100} strokeDasharray="14 86" opacity={presence === "ok" ? 0.9 : 0.35}
              animate={{ strokeDashoffset: [0, -100] }} transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }} />
          )}
          {[0, 1, 2, 3].map((i) => {
            const s = segState(i);
            return (
              <motion.ellipse key={i} cx={0} cy={0} fill="none"
                stroke={segColor[s]} strokeWidth={s === "current" ? 7 : 5} strokeLinecap="round"
                pathLength={100} strokeDasharray="23.5 76.5" strokeDashoffset={-(75 + i * 25 + 0.75)}
                animate={{ rx: oval.rx + 10, ry: oval.ry + 10, opacity: done ? 0 : s === "current" && !reduce ? [1, 0.55, 1] : 1 }}
                transition={{ rx: spring, ry: spring, opacity: s === "current" && !reduce ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 } }}
              />
            );
          })}
          {presence !== "ok" && !done && step !== 4 && (
            <motion.ellipse cx={0} cy={0} fill="none" stroke="rgba(251,146,60,0.9)" strokeWidth={3} strokeDasharray="8 10"
              animate={{ rx: oval.rx + 22, ry: oval.ry + 22 }} transition={spring} />
          )}
          {done && (
            <motion.ellipse cx={0} cy={0} rx={oval.rx + 10} ry={oval.ry + 10} fill="none" stroke="#22c55e" strokeWidth={7} strokeLinecap="round"
              pathLength={100} strokeDasharray="100 100" initial={{ strokeDashoffset: 100 }} animate={{ strokeDashoffset: 0 }} transition={{ duration: 0.45, ease: "easeOut" }} />
          )}
        </motion.g>
      </svg>

      <AnimatePresence>
        {done && (
          <motion.div className="absolute" style={{ left: oval.cx, top: oval.cy }} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}>
            <div className="grid h-28 w-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_0_48px_rgba(34,197,94,0.5)]">
              <svg viewBox="0 0 100 100" className="h-14 w-14" aria-hidden>
                <motion.path d="M12 55 L42 84 L90 22" fill="none" stroke="white" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.38, delay: 0.12, ease: "easeOut" }} />
              </svg>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {flash && <div className="absolute inset-0 bg-white/85" />}

      {/* Gauge under the home window: what to do, and how far along it is. */}
      <div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-2.5" style={{ top: home.cy + home.ry + 34 }}>
        {turning && (
          <>
            <div className="flex items-center gap-3">
              {!rightward && <motion.div animate={reduce ? {} : { x: [0, -8, 0] }} transition={{ duration: 1.1, repeat: Infinity }}><ArrowLeft className="h-8 w-8 text-primary" strokeWidth={3} /></motion.div>}
              <motion.div animate={reduce ? {} : { rotateY: rightward ? [0, 38, 0] : [0, -38, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} style={{ transformPerspective: 300 }}>
                <ScanFace className="h-9 w-9" />
              </motion.div>
              {rightward && <motion.div animate={reduce ? {} : { x: [0, 8, 0] }} transition={{ duration: 1.1, repeat: Infinity }}><ArrowRight className="h-8 w-8 text-primary" strokeWidth={3} /></motion.div>}
            </div>
            <div className={`relative h-2.5 w-[200px] overflow-hidden rounded-full ${lightOn ? "bg-black/15" : "bg-white/20"}`}>
              <motion.div className={`absolute inset-y-0 left-0 rounded-full ${progress >= 1 ? "bg-emerald-500" : "bg-primary"}`} animate={{ width: `${Math.max(5, progress * 100)}%` }} transition={{ type: "spring", stiffness: 400, damping: 30 }} />
            </div>
          </>
        )}
        {step === 3 && !done && (
          <div className="flex flex-col items-center gap-1">
            <motion.div animate={reduce ? {} : { opacity: [1, 0.25, 1] }} transition={{ duration: 1.1, repeat: Infinity }} className={closed ? "text-emerald-400" : ""}>
              {closed ? <EyeOff className="h-9 w-9" /> : <Eye className="h-9 w-9" />}
            </motion.div>
            <div className={`text-[11px] font-semibold ${inkSoft}`}>close · open</div>
          </div>
        )}
        {step === 4 && !done && <Camera className="h-7 w-7" />}
        {step === 0 && !done && <ScanFace className="h-8 w-8 opacity-90" />}
      </div>

      {/* Header */}
      <div className="absolute inset-x-0 top-0 px-4 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center">
          <button type="button" onClick={onCancel} aria-label="Cancel" className={`grid h-9 w-9 place-items-center rounded-full ${lightOn ? "bg-black/10" : "bg-white/20"}`}><X className="h-4 w-4" strokeWidth={3} /></button>
          <div className={`flex-1 text-center text-[13px] font-semibold ${inkSoft}`}>Face check</div>
          <button type="button" onClick={() => setManualLight((m) => !m)} aria-label="Screen light" aria-pressed={lightOn}
            className={`grid h-9 w-9 place-items-center rounded-full ${lightOn ? "bg-black/10 text-amber-500" : "bg-white/20"}`}><Sun className="h-4 w-4" strokeWidth={2.5} /></button>
        </div>
        <div className="mx-auto mt-3 max-w-sm text-center">
          <AnimatePresence mode="wait">
            <motion.div key={title} className="text-2xl font-black leading-tight" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>{title}</motion.div>
          </AnimatePresence>
          <div className={`mt-1.5 min-h-[40px] text-sm ${inkSoft}`}>{ready ? subtitle : ""}</div>
        </div>
      </div>

      {!ready && (
        <div className={`absolute inset-x-0 bottom-24 flex items-center justify-center gap-2 text-sm ${inkSoft}`}><Loader2 className="h-4 w-4 animate-spin" /> Preparing the face check…</div>
      )}

      {/* Step chips */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 px-4 pb-[max(28px,env(safe-area-inset-bottom))]">
        {CHIPS.map((c, i) => {
          const s = segState(i);
          return (
            <motion.div key={c} layout className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${s === "done" ? "bg-emerald-500 text-white" : s === "current" ? "bg-primary text-white" : chipIdle}`}>
              <AnimatePresence>{s === "done" && <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><Check className="h-3 w-3" strokeWidth={3} /></motion.span>}</AnimatePresence>
              {c}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
