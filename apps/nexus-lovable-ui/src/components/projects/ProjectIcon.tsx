// Resolves a NEXUS project `icon` value to something renderable.
// Backend stores either an uploaded path ("/..."), an inline emoji, or a
// named icon ("folder", "rocket", ...). We map names → emoji.
import { Check } from "lucide-react";

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
 * A PROJECT's mark (owner, 11 Oct 2026): one default for every project — a coloured task tile, a white
 * check on a blue gradient (the owner found the grey outline icon too flat) — unless the project has an
 * uploaded photo. Emoji, named icons and the project colour are ignored on purpose. Sized in em, so it
 * follows the font size of the slot it sits in. Same tile on iOS and Android: #3B82F6 → #2563EB.
 * Folders keep their own emoji/photo through ProjectIcon above.
 */
export function ProjectMark({ icon, className }: { icon?: string | null; color?: string | null; className?: string }) {
  if (isProjectPhoto(icon)) {
    return <img src={icon} alt="" className={className ?? "h-full w-full rounded-md object-cover"} />;
  }
  return <TaskTile />;
}

/** The default project tile; `size` in px, or omitted to follow the font size (1em). */
export function TaskTile({ size, className }: { size?: number; className?: string }) {
  const side = size ? `${size}px` : "1em";
  return (
    <span
      aria-hidden
      className={"grid max-h-full max-w-full shrink-0 place-items-center text-white" + (className ? " " + className : "")}
      style={{ width: side, height: side, borderRadius: size ? Math.round(size * 0.28) : "0.28em", background: "linear-gradient(180deg, #3B82F6 0%, #2563EB 100%)", boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.12)" }}
    >
      <Check style={{ width: "68%", height: "68%" }} strokeWidth={3.25} />
    </span>
  );
}
