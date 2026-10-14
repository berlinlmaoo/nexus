// Resolves a NEXUS project `icon` value to something renderable.
// Backend stores either an uploaded path ("/..."), an inline emoji, or a
// named icon ("folder", "rocket", ...). We map names → emoji.
import { useQuery } from "@tanstack/react-query";
import { Filter, Megaphone, Store, type LucideIcon } from "lucide-react";
import { useLogoTone } from "@/lib/calendar/tone";
import { nexusApi } from "@/lib/nexus-api";
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
export function ProjectMark({ icon, className, type }: { icon?: string | null; color?: string | null; className?: string; type?: string | null }) {
  if (isProjectPhoto(icon)) {
    return <UploadedMark src={icon} className={className} />;
  }
  // A dashboard project without a photo wears its template's icon, the one its card shows in New project
  // (UI tour run 14, R14-WB-10), in the same muted outline as the default page. iOS does the same.
  const Dash = type ? DASHBOARD_MARK[type] : undefined;
  if (Dash) return <Dash aria-hidden strokeWidth={1.6} className="h-[1em] w-[1em] shrink-0" style={{ color: "var(--st-gray-dot, #91918e)" }} />;
  return <ProjectPageIcon />;
}

/** The template icon of each dashboard project type (TemplateGallery's DASHBOARDS). */
const DASHBOARD_MARK: Record<string, LucideIcon> = {
  OUTLET_SALES: Store,
  SOCIAL_MEDIA_REPORT: Megaphone,
  PIPELINE: Filter,
};

/**
 * The default project icon. `size` in px, or omitted to follow the font size (1em); the stroke is the
 * theme's muted Notion grey (--st-gray-dot: #91918e light, #9b9a97 dark).
 * Passed where a lucide icon component is expected (className only, no size: a stat tile, a card title,
 * the slash menu) it behaves like one: sized by the class, drawn in the text colour around it.
 */
export function ProjectPageIcon({ size, className }: { size?: number; className?: string }) {
  const lucideLike = !size && !!className;
  const side = size ? `${size}px` : "1em";
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke={lucideLike ? "currentColor" : "var(--st-gray-dot, #91918e)"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={"max-h-full max-w-full shrink-0" + (className ? " " + className : "")} style={lucideLike ? undefined : { width: side, height: side }}>
      <path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M8.5 12h7M8.5 15.5h5" />
    </svg>
  );
}

/**
 * A project's icon as it is NOW (owner, 14 Oct 2026): read from the one project list every screen shares
 * (["nexus","projects"], the sidebar's), which realtime patches the moment someone changes or removes the
 * photo. `known` is what the caller's own payload said (a search hit, a task's project), used only when the
 * project is not in that list (one the viewer is not a member of).
 */
export function useLiveProjectIcon(projectId?: string | null, known?: string | null): string | null {
  const q = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false, staleTime: 60_000, enabled: !!projectId });
  const hit = projectId ? q.data?.find((p) => p.id === projectId) : undefined;
  return hit ? (hit.icon ?? null) : (known ?? null);
}

/** A project's type from the shared project list (a dashboard type picks its template icon). */
function useLiveProjectType(projectId?: string | null): string | null {
  const q = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false, staleTime: 60_000, enabled: !!projectId });
  return (projectId ? q.data?.find((p) => p.id === projectId)?.type : undefined) ?? null;
}

/**
 * THE project mark for any place that knows a project's id: its current photo, else the default page icon,
 * in a `size` px slot. Search, mentions, GIDEON chips, pickers and breadcrumbs all draw through this, so
 * a photo change shows everywhere at once and no screen can drift.
 */
export function ProjectMarkFor({ projectId, icon, size = 16, className }: { projectId?: string | null; icon?: string | null; size?: number; className?: string }) {
  const live = useLiveProjectIcon(projectId, icon);
  const type = useLiveProjectType(projectId);
  return (
    <span aria-hidden className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded leading-none", className)} style={{ width: size, height: size, fontSize: size }}>
      <ProjectMark icon={live} type={type} className="h-full w-full rounded object-cover" />
    </span>
  );
}

/**
 * A project as a square tile, where a person would be a round avatar (a project chat room in Messages,
 * the room's info panel): the project's photo filling the tile, else the page icon on a muted square.
 */
export function ProjectTile({ projectId, size, className }: { projectId: string; size: number; className?: string }) {
  const icon = useLiveProjectIcon(projectId);
  if (isProjectPhoto(icon)) return <ProjectMarkFor projectId={projectId} icon={icon} size={size} className={cn("rounded-lg ring-1 ring-border", className)} />;
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-lg bg-muted ring-1 ring-border", className)} style={{ width: size, height: size }}>
      <ProjectPageIcon size={Math.round(size * 0.55)} />
    </span>
  );
}
