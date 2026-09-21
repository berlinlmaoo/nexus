import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Camera, Check, Eye, EyeOff, Loader2, ScanFace, X } from "lucide-react";

/**
 * The attendance selfie, taken here with a liveness check in front of it.
 *
 * A still photo proves a camera was pointed at something; this proves a person was in front of it:
 * look straight, turn to one side, turn to the other, blink. Face landmarks come from MediaPipe,
 * running in the browser — no frame leaves the device except the one selfie captured at the end.
 * It does not know WHOSE face this is; that would be enrolment, a different decision.
 *
 * Turning direction is deliberately not prescribed: the first turn may go either way and the second
 * must go the opposite way, which is what liveness needs — two poses a photo cannot produce — and
 * it cannot be wrong about left and right on a mirrored preview.
 */
const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type Step = 0 | 1 | 2 | 3 | 4; // straight, side A, side B, blink, hold still
type Presence = "none" | "small" | "off" | "ok";
const CHIPS = ["Straight", "Side", "Other side", "Blink"];
const TITLES = ["Look straight at the camera", "Turn your head to one side", "Now turn to the other side", "Blink", "Hold still"];
const SUBS = ["Keep your face inside the oval.", "Slowly, until the dot reaches the end.", "Same again, the other way.", "Look straight and blink once.", "Look straight, eyes open."];
const STALLED = ["Keep your face inside the oval, in good light.", "Turn a bit further, until the dot reaches the end.", "Turn a bit further, until the dot reaches the end.", "Blink once, slowly. Glasses can make this harder.", "Keep your face inside the oval, in good light."];

const FRONTAL = 0.07; // nose offset over face width
const TURNED = 0.18;

type Landmark = { x: number; y: number };
type Result = { faceLandmarks?: Landmark[][]; faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }> };

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
  const [yaw, setYaw] = useState(0);
  const [closed, setClosed] = useState(false);
  const [firstSide, setFirstSide] = useState(0);
  const [stalled, setStalled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: { detectForVideo: (v: HTMLVideoElement, t: number) => Result; close?: () => void } | null = null;
    // Loop-confined state; React state is only what the screen draws.
    const st = { step: 0 as Step, hold: 0, side: 0, blinkSeen: false, lost: 0, stepStart: 0, cooldown: 0, finished: false, lastYaw: 0, stalled: false };

    const setStepAnim = (s: Step) => { st.step = s; st.hold = 0; st.blinkSeen = false; st.stepStart = performance.now(); st.cooldown = performance.now() + 700; st.stalled = false; setStalled(false); setNotice(null); setStep(s); try { navigator.vibrate?.(20); } catch { /* not everywhere */ } };
    const reset = (why: string) => { st.side = 0; setFirstSide(0); setStepAnim(0); setNotice(why); setTimeout(() => setNotice((n) => (n === why ? null : n)), 2500); };

    const capture = (v: HTMLVideoElement) => {
      st.finished = true;
      const max = 1280;
      const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      setFlash(true); setTimeout(() => setFlash(false), 160);
      setDone(true);
      c.toBlob((blob) => {
        if (!blob) { st.finished = false; setDone(false); return; }
        const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
        setTimeout(() => { if (alive) onCapture(file); }, 800);
      }, "image/jpeg", 0.8);
    };

    const evaluate = (res: Result, v: HTMLVideoElement) => {
      const now = performance.now();
      const lm = res.faceLandmarks?.[0];
      if (!lm) {
        st.lost += 1; st.hold = 0;
        // Gone for ~1.5 s after the first move: whoever comes back starts over.
        if (st.lost > 40 && st.step > 0) reset("Face lost. Let's start again.");
        setPresence("none"); setYaw(0); setClosed(false);
        return;
      }
      st.lost = 0;
      const nose = lm[1], left = lm[234], right = lm[454], top = lm[10], chin = lm[152];
      const widthPx = Math.abs(right.x - left.x) * v.videoWidth;
      const cx = (left.x + right.x) / 2, cy = (top.y + chin.y) / 2;
      let presence: Presence = "ok";
      if (widthPx < 0.26 * Math.min(v.videoWidth, v.videoHeight)) presence = "small";
      else if (Math.abs(cx - 0.5) > 0.17 || Math.abs(cy - 0.5) > 0.2) presence = "off";
      const yawRatio = (nose.x - cx) / Math.abs(right.x - left.x);
      const cats = res.faceBlendshapes?.[0]?.categories ?? [];
      const blink = (name: string) => cats.find((c) => c.categoryName === name)?.score ?? 0;
      const blinkScore = (blink("eyeBlinkLeft") + blink("eyeBlinkRight")) / 2;
      const eyesClosed = blinkScore > 0.5;
      setPresence(presence);
      if (Math.abs(yawRatio - st.lastYaw) > 0.005) { st.lastYaw = yawRatio; setYaw(yawRatio); }
      setClosed(eyesClosed);
      if (presence !== "ok" || now < st.cooldown) { st.hold = 0; return; }
      if (!st.stalled && now - st.stepStart > 18000) { st.stalled = true; setStalled(true); }
      const held = (n: number) => { st.hold += 1; return st.hold >= n; };
      switch (st.step) {
        case 0:
          if (Math.abs(yawRatio) >= FRONTAL) { st.hold = 0; return; }
          if (held(8)) setStepAnim(1);
          return;
        case 1:
          if (Math.abs(yawRatio) < TURNED) { st.hold = 0; return; }
          st.side = yawRatio > 0 ? 1 : -1;
          if (held(4)) { setFirstSide(st.side); setStepAnim(2); }
          return;
        case 2:
          if (Math.abs(yawRatio) < TURNED || (yawRatio > 0 ? 1 : -1) !== -st.side) { st.hold = 0; return; }
          if (held(4)) setStepAnim(3);
          return;
        case 3:
          if (Math.abs(yawRatio) > FRONTAL + 0.06) return;
          if (!st.blinkSeen) { if (blinkScore > 0.5) st.blinkSeen = true; }
          else if (blinkScore < 0.25) setStepAnim(4);
          return;
        case 4:
          if (Math.abs(yawRatio) >= FRONTAL || eyesClosed) { st.hold = 0; return; }
          if (held(5)) capture(v);
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
      st.stepStart = performance.now();
      let lastT = -1;
      const loop = () => {
        if (!alive || st.finished) return;
        raf = requestAnimationFrame(loop);
        if (v.readyState < 2) return;
        const t = performance.now();
        if (t <= lastT) return;
        lastT = t;
        try { evaluate(landmarker!.detectForVideo(v, t), v); } catch { /* one bad frame */ }
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
  const segColor = { todo: "rgba(255,255,255,0.28)", current: "hsl(var(--primary))", done: "#22c55e" };
  const title = done ? "Verified" : TITLES[step];
  const subtitle = done ? "Taking your selfie…"
    : notice ?? (presence === "none" ? "No face yet. Hold the camera at eye level, in good light."
      : presence === "small" ? "Come a little closer."
      : presence === "off" ? "Move your face into the oval."
      : stalled ? STALLED[step] : SUBS[step]);

  // Oval geometry in a 100x100 viewBox-free layout: the SVG covers the screen, the oval is centred.
  const W = 260, H = 344;
  const dot = Math.max(-92, Math.min(92, yaw * 420));

  return (
    <motion.div className="fixed inset-0 z-[80] bg-black text-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <video ref={videoRef} muted playsInline autoPlay className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
      {/* Dim outside the oval */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <mask id="nx-oval-mask">
            <rect width="100%" height="100%" fill="white" />
            <ellipse cx="50%" cy="44%" rx={W / 2} ry={H / 2} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.68)" mask="url(#nx-oval-mask)" />
        <g style={{ transform: "translate(50%, 44%)" }}>
          {[0, 1, 2, 3].map((i) => {
            const s = segState(i);
            return (
              <motion.ellipse key={i} cx={0} cy={0} rx={W / 2 + 10} ry={H / 2 + 10} fill="none"
                stroke={segColor[s]} strokeWidth={s === "current" ? 7 : 5} strokeLinecap="round"
                pathLength={100} strokeDasharray="23.5 76.5" strokeDashoffset={-(i * 25 + 0.75) + 25}
                style={{ transform: "rotate(-90deg)" }}
                animate={s === "current" && !reduce ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
                transition={s === "current" && !reduce ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
              />
            );
          })}
          {presence !== "ok" && !done && step !== 4 && (
            <ellipse cx={0} cy={0} rx={W / 2 + 22} ry={H / 2 + 22} fill="none" stroke="rgba(251,146,60,0.9)" strokeWidth={3} strokeDasharray="8 10" />
          )}
          {done && (
            <motion.ellipse cx={0} cy={0} rx={W / 2 + 10} ry={H / 2 + 10} fill="none" stroke="#22c55e" strokeWidth={7}
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20 }} />
          )}
        </g>
      </svg>

      <AnimatePresence>
        {done && (
          <motion.div className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}>
            <div className="grid h-28 w-28 place-items-center rounded-full bg-emerald-500 shadow-2xl"><Check className="h-16 w-16" strokeWidth={3} /></div>
          </motion.div>
        )}
      </AnimatePresence>
      {flash && <div className="absolute inset-0 bg-white/85" />}

      {/* Gauge under the oval: a dot that follows the head, two zones to reach; an eye for the blink. */}
      <div className="absolute left-1/2 -translate-x-1/2" style={{ top: `calc(44% + ${H / 2 + 30}px)` }}>
        {(step === 1 || step === 2) && !done && (
          <div className="relative h-5 w-[200px]">
            <div className="absolute inset-y-1 inset-x-0 rounded-full bg-white/20" />
            {[-1, 1].map((side) => {
              const reached = firstSide === side;
              const wanted = step === 2 && firstSide === -side;
              return (
                <motion.div key={side} className={`absolute top-0.5 h-4 w-9 rounded-full ${reached ? "bg-emerald-500" : wanted ? "bg-primary" : "bg-white/35"}`}
                  style={side < 0 ? { left: 0 } : { right: 0 }}
                  animate={wanted && !reduce ? { opacity: [1, 0.5, 1] } : { opacity: 1 }} transition={wanted && !reduce ? { duration: 1.4, repeat: Infinity } : {}} />
              );
            })}
            <motion.div className="absolute top-0 h-5 w-5 rounded-full bg-white shadow" style={{ left: "calc(50% - 10px)" }} animate={{ x: dot }} transition={{ type: "spring", stiffness: 400, damping: 30 }} />
          </div>
        )}
        {step === 3 && !done && (
          <motion.div animate={reduce ? {} : { opacity: [1, 0.35, 1] }} transition={{ duration: 1.4, repeat: Infinity }}>
            {closed ? <EyeOff className="h-8 w-8" /> : <Eye className="h-8 w-8" />}
          </motion.div>
        )}
        {step === 4 && !done && <Camera className="h-7 w-7" />}
        {step === 0 && !done && <ScanFace className="h-8 w-8 opacity-90" />}
      </div>

      {/* Header */}
      <div className="absolute inset-x-0 top-0 px-4 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center">
          <button type="button" onClick={onCancel} aria-label="Cancel" className="grid h-9 w-9 place-items-center rounded-full bg-white/20"><X className="h-4 w-4" strokeWidth={3} /></button>
          <div className="flex-1 text-center text-[13px] font-semibold text-white/70">Face check</div>
          <div className="h-9 w-9" />
        </div>
        <div className="mx-auto mt-3 max-w-sm text-center">
          <AnimatePresence mode="wait">
            <motion.div key={title} className="text-2xl font-black leading-tight" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>{title}</motion.div>
          </AnimatePresence>
          <div className="mt-1.5 min-h-[40px] text-sm text-white/80">{ready ? subtitle : ""}</div>
        </div>
      </div>

      {!ready && (
        <div className="absolute inset-x-0 bottom-24 flex items-center justify-center gap-2 text-sm text-white/80"><Loader2 className="h-4 w-4 animate-spin" /> Preparing the face check…</div>
      )}

      {/* Step chips */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 px-4 pb-[max(28px,env(safe-area-inset-bottom))]">
        {CHIPS.map((c, i) => {
          const s = segState(i);
          return (
            <motion.div key={c} layout className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${s === "done" ? "bg-emerald-500 text-white" : s === "current" ? "bg-primary text-white" : "bg-white/15 text-white/50"}`}>
              <AnimatePresence>{s === "done" && <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><Check className="h-3 w-3" strokeWidth={3} /></motion.span>}</AnimatePresence>
              {c}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
