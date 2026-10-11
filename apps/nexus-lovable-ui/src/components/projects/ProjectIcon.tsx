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
  return /^(\/|https?:)/.test(icon);
}
export function isProjectPhoto(icon?: string | null): icon is string {
  return !!icon && isUploaded(icon);
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

/**
 * A PROJECT's mark (owner, 11 Oct 2026): one default for every project — a small rounded square in the
 * project's colour — unless the project has an uploaded photo. Emoji and named icons stored by older
 * screens are ignored on purpose. Sized in em, so it follows the font size of the slot it sits in.
 * Folders keep their own emoji/photo through ProjectIcon above.
 */
export function ProjectMark({ icon, color, className }: { icon?: string | null; color?: string | null; className?: string }) {
  if (isProjectPhoto(icon)) {
    return <img src={icon} alt="" className={className ?? "h-full w-full rounded-md object-cover"} />;
  }
  return <span aria-hidden className="inline-block shrink-0" style={{ width: "0.6em", height: "0.6em", borderRadius: "0.17em", background: color || "#7B2FBE" }} />;
}
