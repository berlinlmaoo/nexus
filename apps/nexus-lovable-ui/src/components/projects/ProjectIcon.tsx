// Resolves a NEXUS project `icon` value to something renderable.
// Backend stores either an uploaded path ("/..."), an inline emoji, or a
// named icon ("folder", "rocket", ...). We map names → emoji.

const EMOJI_MAP: Record<string, string> = {
  folder: "📁", rocket: "🚀", star: "⭐", zap: "⚡", target: "🎯",
  briefcase: "💼", code: "💻", globe: "🌍", heart: "❤️", shield: "🛡️",
  layers: "📚", box: "📦", cpu: "🔧", database: "🗄️", feather: "✏️",
  flag: "🏁", megaphone: "📢", grid: "🔲",
};

function isUploaded(icon: string) {
  return icon.startsWith("/");
}
function isInlineEmoji(icon: string) {
  return (icon.codePointAt(0) ?? 0) > 127;
}

export function projectEmoji(icon?: string | null, fallback = "📁"): string {
  if (!icon) return fallback;
  if (isInlineEmoji(icon)) return icon;
  return EMOJI_MAP[icon.toLowerCase()] ?? fallback;
}

export function ProjectIcon({ icon, className }: { icon?: string | null; className?: string }) {
  if (icon && isUploaded(icon)) {
    return <img src={icon} alt="" className={className ?? "h-full w-full rounded-md object-cover"} />;
  }
  return <span className={className}>{projectEmoji(icon)}</span>;
}
