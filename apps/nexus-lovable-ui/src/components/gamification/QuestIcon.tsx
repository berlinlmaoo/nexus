// Fun, contextual quest icons. Picks a lucide icon + gradient from the quest's
// key/title keywords (falls back to a stable hash so every quest still looks distinct).
import {
  Gift,
  AlarmClock,
  Zap,
  Flame,
  Target,
  CheckCheck,
  Flag,
  MessageSquare,
  Rocket,
  Star,
  Trophy,
  CalendarCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Look = { Icon: LucideIcon; from: string; to: string; glow: string };

const KEYWORD_LOOKS: { match: RegExp; look: Look }[] = [
  { match: /overdue|telat|lewat/i, look: { Icon: AlarmClock, from: "#fb7185", to: "#e11d48", glow: "#fb7185" } },
  { match: /urgent|prior/i, look: { Icon: Zap, from: "#fbbf24", to: "#ea580c", glow: "#fb923c" } },
  { match: /streak|day|hari|harian/i, look: { Icon: Flame, from: "#fdba74", to: "#dc2626", glow: "#fb923c" } },
  { match: /goal|milestone|target/i, look: { Icon: Flag, from: "#7dd3fc", to: "#2563eb", glow: "#38bdf8" } },
  { match: /comment|chat|reply|balas/i, look: { Icon: MessageSquare, from: "#a7f3d0", to: "#059669", glow: "#34d399" } },
  { match: /week|minggu|weekly/i, look: { Icon: CalendarCheck, from: "#c4b5fd", to: "#7c3aed", glow: "#a78bfa" } },
  { match: /complete|done|selesai|beresin|tutup|task/i, look: { Icon: Target, from: "#5eead4", to: "#0d9488", glow: "#2dd4bf" } },
];

// Fallback pool — varied looks so unmatched quests still feel distinct.
const POOL: Look[] = [
  { Icon: Gift, from: "#f5a8e8", to: "#c026d3", glow: "#e879f9" },
  { Icon: Rocket, from: "#93c5fd", to: "#4338ca", glow: "#818cf8" },
  { Icon: Star, from: "#fde047", to: "#eab308", glow: "#facc15" },
  { Icon: Trophy, from: "#fdba74", to: "#ea580c", glow: "#fb923c" },
  { Icon: CheckCheck, from: "#5eead4", to: "#0d9488", glow: "#2dd4bf" },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function questLook(key: string, title = ""): Look {
  const hay = `${key} ${title}`;
  for (const { match, look } of KEYWORD_LOOKS) if (match.test(hay)) return look;
  return POOL[hash(key || title) % POOL.length];
}

export function QuestIcon({
  questKey,
  title,
  size = 56,
  rounded = "rounded-2xl",
  className,
}: {
  questKey: string;
  title?: string;
  size?: number;
  rounded?: string;
  className?: string;
}) {
  const look = questLook(questKey, title);
  const { Icon } = look;
  const iconSize = Math.round(size * 0.46);
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center", rounded, className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `linear-gradient(150deg, ${look.from} 0%, ${look.to} 100%)`,
        boxShadow: `0 6px 16px -6px ${look.glow}, inset 0 1px 0 0 rgba(255,255,255,0.45)`,
      }}
    >
      <Icon size={iconSize} strokeWidth={2.25} className="text-white" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.28))" }} />
    </span>
  );
}
