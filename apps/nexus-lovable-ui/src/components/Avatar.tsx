import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { nexusApi } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

/** "Dadio Emerald" → "DE"; "?" when there is no name. */
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
 * skips it instead of reading "DE Dadio Emerald".
 */
export function AvatarFace({
  name,
  avatar,
  seed,
  size = 28,
  decorative = false,
  className,
}: {
  name?: string | null;
  avatar?: string | null;
  /** What picks the colour; the name by default. */
  seed?: string;
  size?: number;
  decorative?: boolean;
  className?: string;
}) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const label = name?.trim() || undefined;
  if (avatar && avatar !== brokenSrc) {
    return (
      <img
        src={avatar}
        alt={decorative ? "" : label ?? ""}
        aria-hidden={decorative || undefined}
        title={label}
        onError={() => setBrokenSrc(avatar)}
        className={cn("inline-block rounded-full object-cover ring-2 ring-background", className)}
        style={{ width: size, height: size, minWidth: size }}
      />
    );
  }
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn("inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-background", className)}
      style={{ background: avatarColor(seed || label || "?"), width: size, height: size, minWidth: size, fontSize: Math.round(size * 0.4) }}
      title={label}
    >
      {initialsOf(name)}
    </span>
  );
}

export function Avatar({
  userId,
  name,
  avatar,
  size = 28,
  className,
}: {
  userId: string;
  name?: string | null;
  avatar?: string | null;
  size?: number;
  className?: string;
}) {
  const lookup = useUserLookup();
  const resolved = lookup.get(userId);
  const dispName = name ?? resolved?.name ?? null;
  const img = avatar ?? resolved?.avatar ?? null;
  return <AvatarFace name={dispName} avatar={img} seed={dispName || userId} size={size} className={className} />;
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
          className="inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium ring-2 ring-background"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
