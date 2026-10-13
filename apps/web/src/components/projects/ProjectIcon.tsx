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
 * A PROJECT's mark (owner, 11 Oct 2026): one default for every project — a full-colour task icon (a
 * clipboard with a checklist: amber board, white sheet, slate clip, green ticks) — unless the project
 * has an uploaded photo. The owner turned down a colour square, a grey outline icon and a check on a
 * blue tile. Emoji, named icons and the project colour are ignored on purpose. Sized in em, so it
 * follows the font size of the slot it sits in. iOS and Android draw the same shapes (24×24 grid).
 */
export function ProjectMark({ icon, className }: { icon?: string | null; color?: string | null; className?: string }) {
  if (isProjectPhoto(icon)) {
    return <UploadedMark src={icon} className={className} />;
  }
  return <TaskTile />;
}

/** The default project icon; `size` in px, or omitted to follow the font size (1em). */
export function TaskTile({ size, className }: { size?: number; className?: string }) {
  const side = size ? `${size}px` : "1em";
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={"max-h-full max-w-full shrink-0" + (className ? " " + className : "")} style={{ width: side, height: side }}>
      <rect x="3" y="3" width="18" height="20" rx="3.5" fill="#F59E0B" />
      <rect x="5.5" y="5.5" width="13" height="15.5" rx="1.8" fill="#FFFFFF" />
      <rect x="8.5" y="1.5" width="7" height="4" rx="1.4" fill="#475569" />
      <rect x="7.2" y="8.2" width="3.4" height="3.4" rx="0.8" fill="#22C55E" />
      <path d="M7.9 9.9l0.9 0.9 1.4-1.6" fill="none" stroke="#FFFFFF" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="11.8" y="9.2" width="5.2" height="1.4" rx="0.7" fill="#CBD5E1" />
      <rect x="7.2" y="12.6" width="3.4" height="3.4" rx="0.8" fill="#22C55E" />
      <path d="M7.9 14.3l0.9 0.9 1.4-1.6" fill="none" stroke="#FFFFFF" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="11.8" y="13.6" width="5.2" height="1.4" rx="0.7" fill="#CBD5E1" />
      <rect x="7.2" y="17" width="3.4" height="3.4" rx="0.8" fill="#E2E8F0" />
      <rect x="11.8" y="18" width="3.6" height="1.4" rx="0.7" fill="#CBD5E1" />
    </svg>
  );
}
