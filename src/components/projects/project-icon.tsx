"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import {
  Folder,
  LayoutGrid,
  Code,
  Briefcase,
  Rocket,
  Star,
  Zap,
  Target,
  Globe,
  Heart,
  Shield,
  Layers,
  Box,
  Cpu,
  Database,
  Feather,
  Flag,
  Megaphone,
} from "lucide-react"
import { cn } from "@/lib/utils"

const EMOJI_MAP: Record<string, string> = {
  folder: "📁", rocket: "🚀", star: "⭐", zap: "⚡", target: "🎯",
  briefcase: "💼", code: "💻", globe: "🌍", heart: "❤️", shield: "🛡️",
  layers: "📚", box: "📦", cpu: "🔧", database: "🗄️", feather: "✏️",
  flag: "🏁", megaphone: "📢",
}

const LUCIDE_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  folder: Folder, grid: LayoutGrid, code: Code, briefcase: Briefcase,
  rocket: Rocket, star: Star, zap: Zap, target: Target, globe: Globe,
  heart: Heart, shield: Shield, layers: Layers, box: Box, cpu: Cpu,
  database: Database, feather: Feather, flag: Flag, megaphone: Megaphone,
}

export function isUploadedIcon(icon: string): boolean {
  return icon.startsWith("/")
}

interface ProjectIconProps {
  icon: string
  color?: string
  size?: "sm" | "md" | "lg" | "xl"
  variant?: "emoji" | "lucide"
  className?: string
}

const sizeConfig = {
  sm: { container: "h-6 w-6", text: "text-sm", image: 24, lucide: "h-3.5 w-3.5" },
  md: { container: "h-10 w-10", text: "text-lg", image: 40, lucide: "h-5 w-5" },
  lg: { container: "h-16 w-16", text: "text-2xl", image: 64, lucide: "h-8 w-8" },
  xl: { container: "h-24 w-24", text: "text-4xl", image: 96, lucide: "h-12 w-12" },
}

export function ProjectIcon({ icon, color, size = "md", variant = "emoji", className }: ProjectIconProps) {
  const cfg = sizeConfig[size] || sizeConfig.md
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [icon])

  if (isUploadedIcon(icon) && !imageFailed) {
    return (
      <div className={cn("relative overflow-hidden rounded-full flex-shrink-0", cfg.container, className)}>
        <Image
          key={icon}
          src={icon}
          alt="Project icon"
          fill
          className="object-cover"
          sizes={`${cfg.image}px`}
          unoptimized
          onError={() => setImageFailed(true)}
        />
      </div>
    )
  }

  if (variant === "lucide") {
    const LucideIcon = LUCIDE_MAP[icon] || Folder
    return (
      <div
        className={cn("flex items-center justify-center rounded-lg flex-shrink-0", cfg.container, className)}
        style={color ? { backgroundColor: `${color}20` } : undefined}
      >
        <LucideIcon className={cfg.lucide} style={color ? { color } : undefined} />
      </div>
    )
  }

  return (
    <span className={cn("flex items-center justify-center flex-shrink-0", cfg.container, cfg.text, className)}>
      {EMOJI_MAP[icon] || "📁"}
    </span>
  )
}
