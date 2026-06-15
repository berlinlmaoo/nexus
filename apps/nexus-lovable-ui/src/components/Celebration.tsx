import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const EMOJIS = ["🎉", "✨", "⭐", "💥", "🚀", "🏆", "⚡", "🔥", "💫", "🎊"];
const PHRASES = [
  "Quest Complete! 🎯",
  "Boom! Nailed it 💥",
  "+1 XP gained ⚡",
  "Slayed! 🗡️",
  "Streak +1 🔥",
  "GG! 🏆",
];

type Particle = {
  id: number;
  emoji: string;
  tx: number;
  ty: number;
  rot: number;
  delay: number;
  size: number;
};

type Burst = { id: number; message?: string; particles: Particle[]; phrase: string };

const listeners = new Set<(b: Burst) => void>();
let counter = 0;

/** Trigger a fun celebration overlay from anywhere in the app. */
export function celebrate(message?: string) {
  if (typeof window === "undefined") return;
  const count = 22;
  const particles: Particle[] = Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = 140 + Math.random() * 180;
    return {
      id: counter++,
      emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
      tx: Math.cos(angle) * dist,
      ty: Math.sin(angle) * dist,
      rot: (Math.random() - 0.5) * 720,
      delay: Math.random() * 80,
      size: 22 + Math.random() * 22,
    };
  });
  const burst: Burst = {
    id: counter++,
    message,
    particles,
    phrase: message ?? PHRASES[Math.floor(Math.random() * PHRASES.length)],
  };
  listeners.forEach((cb) => cb(burst));
}

/** Local trigger (legacy prop API still works). */
type CelebrationProps = { show?: boolean; onDone?: () => void; message?: string };

export function Celebration({ show, onDone, message }: CelebrationProps = {}) {
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    const cb = (b: Burst) => {
      setBursts((prev) => [...prev, b]);
      setTimeout(() => {
        setBursts((prev) => prev.filter((x) => x.id !== b.id));
      }, 1500);
    };
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  // legacy prop trigger
  useEffect(() => {
    if (show) {
      celebrate(message);
      const t = setTimeout(() => onDone?.(), 1400);
      return () => clearTimeout(t);
    }
  }, [show, message, onDone]);

  if (typeof document === "undefined" || bursts.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      {bursts.map((b) => (
        <div key={b.id}>
          {b.particles.map((p) => (
            <span
              key={p.id}
              className="absolute left-1/2 top-1/2 animate-confetti select-none"
              style={
                {
                  fontSize: `${p.size}px`,
                  animationDelay: `${p.delay}ms`,
                  "--tx": `${p.tx}px`,
                  "--ty": `${p.ty}px`,
                  "--rot": `${p.rot}deg`,
                } as React.CSSProperties
              }
            >
              {p.emoji}
            </span>
          ))}
          <div
            className="absolute left-1/2 top-1/2 animate-pop-badge px-5 py-3 rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 text-white font-extrabold text-lg sm:text-2xl shadow-2xl whitespace-nowrap"
            style={{ transform: "translate(-50%, -50%)" }}
          >
            {b.phrase}
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
}
