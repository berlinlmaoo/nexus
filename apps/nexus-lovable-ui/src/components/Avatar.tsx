import { useQuery } from "@tanstack/react-query";
import { nexusApi } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

function initialsOf(name?: string | null) {
  if (!name || !name.trim()) return "?";
  return (
    name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"
  );
}

const PALETTE = ["#a168be", "#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#ec4899", "#14b8a6"];
function colorFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Workspace-wide directory (id → name/avatar) used to resolve real users for avatars. */
export function useUserLookup() {
  const q = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const map = new Map<string, { name?: string | null; avatar?: string | null }>();
  for (const m of q.data?.members ?? []) {
    if (m.userId) map.set(m.userId, { name: m.name, avatar: m.avatar });
  }
  return map;
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

  if (img) {
    return (
      <img
        src={img}
        alt={dispName ?? ""}
        title={dispName ?? undefined}
        className={cn("inline-block rounded-full object-cover ring-2 ring-background", className)}
        style={{ width: size, height: size, minWidth: size }}
      />
    );
  }
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-background", className)}
      style={{ background: colorFor(dispName || userId), width: size, height: size, minWidth: size, fontSize: size * 0.4 }}
      title={dispName ?? undefined}
    >
      {initialsOf(dispName)}
    </span>
  );
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
