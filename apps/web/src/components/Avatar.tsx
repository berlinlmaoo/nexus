import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { nexusApi } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { thumbUrl } from "@/lib/thumb";
import { PresenceDot, presenceText, usePresence, type PresenceStatus } from "@/lib/presence";
import { getLang } from "@/lib/lang";

/** "Budi Santoso" → "BS"; "?" when there is no name. */
export function initialsOf(name?: string | null): string {
  if (!name || !name.trim()) return "?";
  return (
    name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"
  );
}

/**
 * Backgrounds for the initials. White initials are at least 4.5:1 on every one of them (the previous set
 * had amber at 2.15:1 and three more under 3:1). The Calendar used this set already, so a person without
 * a photo now keeps one colour on every screen.
 */
const PALETTE = ["#1e3a5f", "#0B6FB8", "#B35A00", "#00805E", "#B03A86", "#5B4BD6", "#00838F", "#8D5B3B"];
export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Workspace-wide directory (id → name/avatar) used to resolve real users for avatars. */
export function useUserLookup() {
  const q = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  return useMemo(() => {
    const map = new Map<string, { name?: string | null; avatar?: string | null }>();
    for (const m of q.data?.members ?? []) {
      if (m.userId) map.set(m.userId, { name: m.name, avatar: m.avatar });
    }
    return map;
  }, [q.data]);
}

/**
 * One person's photo, or their initials on a colour, with nothing looked up. A photo that fails to load
 * falls back to the initials. `decorative` when the name is printed right beside it: assistive tech then
 * skips it instead of reading "BS Budi Santoso".
 */
export function AvatarFace({
  name,
  avatar,
  seed,
  size = 28,
  decorative = false,
  className,
  presence,
}: {
  name?: string | null;
  avatar?: string | null;
  /** What picks the colour; the name by default. */
  seed?: string;
  size?: number;
  decorative?: boolean;
  className?: string;
  /** Presence status (19 Oct 2026): a small dot at the bottom right, and the status in the tooltip. */
  presence?: PresenceStatus | null;
}) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const label = name?.trim() || undefined;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const photo = avatar && avatar !== brokenSrc ? avatar : null;
  const dot = presence && size >= 16 ? Math.max(7, Math.min(16, Math.round(size * 0.3))) : 0;
  const tip = presence && label ? `${label} · ${presenceText(presence, getLang())}` : label;
  // The initials are always drawn; a photo lies on top of them. Until a lazy photo has loaded (a long list
  // below the fold, a slow connection) the person still has a face instead of an empty circle (UI tour
  // run 7, 14 Oct 2026: leaderboard ranks 27-43 showed no avatar at all).
  return (
    <span
      aria-hidden={decorative || !label || undefined}
      role={!decorative && label ? "img" : undefined}
      aria-label={!decorative && label ? label : undefined}
      // With a presence dot the face cannot clip its children (the dot sits on the edge); the photo carries the
      // circle itself (rounded-[inherit]), so nothing else shows outside it.
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-background", !dot && "overflow-hidden", className)}
      style={{ background: avatarColor(seed || label || "?"), width: size, height: size, minWidth: size, fontSize: Math.round(size * 0.4) }}
      title={tip}
    >
      {/* Hidden once the photo is in, so a photo with transparent parts never shows letters through. */}
      <span className={photo && loadedSrc === photo ? "invisible" : undefined}>{initialsOf(name)}</span>
      {photo && (
        <img
          src={thumbUrl(photo, size)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoadedSrc(photo)}
          onError={() => setBrokenSrc(photo)}
          className="absolute inset-0 h-full w-full rounded-[inherit] object-cover"
        />
      )}
      {presence && dot > 0 && <PresenceDot status={presence} size={dot} className="absolute -bottom-px -right-px" />}
    </span>
  );
}

export function Avatar({
  userId,
  name,
  avatar,
  size = 28,
  className,
  presence = true,
}: {
  userId: string;
  name?: string | null;
  avatar?: string | null;
  size?: number;
  className?: string;
  /** false = no presence dot (a picture that stands for something else). */
  presence?: boolean;
}) {
  const lookup = useUserLookup();
  const resolved = lookup.get(userId);
  const dispName = name ?? resolved?.name ?? null;
  const img = avatar ?? resolved?.avatar ?? null;
  const status = usePresence(presence ? userId : null);
  return <AvatarFace name={dispName} avatar={img} seed={dispName || userId} size={size} className={className} presence={status} />;
}

export function AvatarStack({
  ids,
  max = 4,
  size = 24,
}: {
  ids: string[];
  max?: number;
  size?: number;
}) {
  const lookup = useUserLookup();
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((id) => {
        const u = lookup.get(id);
        return <Avatar key={id} userId={id} name={u?.name} avatar={u?.avatar} size={size} />;
      })}
      {extra > 0 && (
        <span
          // Positioned like the faces, so it is painted over the last one and its own ring separates them; as a
          // plain box the face before it covered the "+" (UI tour run 15, R15-WM-10).
          className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium tabular-nums text-muted-foreground ring-2 ring-background"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
