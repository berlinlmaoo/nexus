// Resolves a NEXUS project `icon` value to something renderable.
// Backend stores either an uploaded path ("/..."), an inline emoji, or a
// named icon ("folder", "rocket", ...). We map names → emoji.
import { useLogoTone } from "@/lib/calendar/tone";
import { cn } from "@/lib/utils";
import { thumbUrl } from "@/lib/thumb";

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
    return <UploadedMark src={icon} className={className} />;
  }
  return <span className={className}>{projectEmoji(icon)}</span>;
}

/**
 * An uploaded project / folder image. A dark logo on a transparent background (a black wordmark) would
 * vanish on the dark theme's surfaces, so there it sits on a white tile, as the Calendar's IP logos do.
 * An opaque photo covers the tile; light mode is unchanged.
 */
function UploadedMark({ src, className }: { src: string; className?: string }) {
  // The tone is read from the same small thumbnail the tile shows (one request, same CORS mode), not from
  // the full upload — that was a second, 1–2 MB download per icon (perf pass, 12 Oct 2026).
  const shown = thumbUrl(src, 64);
  const tone = useLogoTone(shown);
  return <img src={shown} crossOrigin={shown.startsWith("/") ? "anonymous" : undefined} alt="" loading="lazy" decoding="async" className={cn(className ?? "h-full w-full rounded-md object-cover", tone === "dark" && "dark:bg-white")} />;
}

/**
 * A PROJECT's mark: its uploaded photo, else the one default every project shares. Owner, 14 Oct 2026
 * (option A): a calm Notion-style page, a thin grey outline document with a folded corner and two text
 * lines, monochrome, no fill, no per-project colour. It replaced the full-colour clipboard-checklist of
 * 11 Oct. Emoji, named icons and the project colour stay ignored on purpose. Sized in em, so it follows
 * the font size of the slot it sits in. iOS and Android draw the same paths (24x24 grid).
 */
export function ProjectMark({ icon, className }: { icon?: string | null; color?: string | null; className?: string }) {
  if (isProjectPhoto(icon)) {
    return <UploadedMark src={icon} className={className} />;
  }
  return <ProjectPageIcon />;
}

/**
 * The default project icon; `size` in px, or omitted to follow the font size (1em). The stroke is the
 * theme's muted Notion grey (--st-gray-dot: #91918e light, #9b9a97 dark).
 */
export function ProjectPageIcon({ size, className }: { size?: number; className?: string }) {
  const side = size ? `${size}px` : "1em";
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="var(--st-gray-dot, #91918e)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={"max-h-full max-w-full shrink-0" + (className ? " " + className : "")} style={{ width: side, height: side }}>
      <path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M8.5 12h7M8.5 15.5h5" />
    </svg>
  );
}
