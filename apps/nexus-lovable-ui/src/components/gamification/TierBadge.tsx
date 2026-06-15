// Fun, game-style rank badges for the 10 level tiers.
// Each tier = a distinct lucide icon on its own gradient medallion (no image assets needed).
import {
  Shield,
  Medal,
  Hexagon,
  Gem,
  Swords,
  Crown,
  Trophy,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Visual = { Icon: LucideIcon; from: string; to: string; glow: string };

// index = level - 1
const TIER_VISUALS: Visual[] = [
  { Icon: Shield, from: "#a8b1bd", to: "#5b6675", glow: "#7c8696" }, // 1 Iron
  { Icon: Medal, from: "#e0a36b", to: "#9c5a28", glow: "#c47f43" }, // 2 Bronze
  { Icon: Medal, from: "#eef1f5", to: "#9aa6b5", glow: "#c3ccd8" }, // 3 Silver
  { Icon: Medal, from: "#ffe066", to: "#e0a200", glow: "#f6c632" }, // 4 Gold
  { Icon: Hexagon, from: "#7df0dd", to: "#0d9488", glow: "#2dd4bf" }, // 5 Platinum
  { Icon: Gem, from: "#7dd3fc", to: "#2563eb", glow: "#38bdf8" }, // 6 Diamond
  { Icon: Swords, from: "#c4b5fd", to: "#7c3aed", glow: "#a78bfa" }, // 7 Master
  { Icon: Crown, from: "#f5a8e8", to: "#c026d3", glow: "#e879f9" }, // 8 Elite
  { Icon: Trophy, from: "#fdba74", to: "#ea580c", glow: "#fb923c" }, // 9 Supreme
  { Icon: Sparkles, from: "#fbbf24", to: "#f43f5e", glow: "#fb7185" }, // 10 Anak Kesayangan AA
];

export function tierVisual(level: number): Visual {
  return TIER_VISUALS[Math.max(0, Math.min(TIER_VISUALS.length - 1, level - 1))];
}

export function TierBadge({
  level,
  size = 56,
  rounded = "rounded-2xl",
  active = true,
  className,
}: {
  level: number;
  size?: number;
  rounded?: string;
  active?: boolean;
  className?: string;
}) {
  const v = tierVisual(level);
  const { Icon } = v;
  const iconSize = Math.round(size * 0.5);
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center transition-all", rounded, className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `linear-gradient(150deg, ${v.from} 0%, ${v.to} 100%)`,
        boxShadow: active
          ? `0 5px 14px -5px ${v.glow}, inset 0 1px 0 0 rgba(255,255,255,0.45)`
          : "inset 0 1px 0 0 rgba(255,255,255,0.25)",
        filter: active ? undefined : "grayscale(0.55)",
        opacity: active ? 1 : 0.7,
      }}
    >
      <Icon
        size={iconSize}
        strokeWidth={2.25}
        className="text-white"
        style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.28))" }}
      />
    </span>
  );
}
