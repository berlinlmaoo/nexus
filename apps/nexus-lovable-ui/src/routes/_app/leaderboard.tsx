import { createFileRoute } from "@tanstack/react-router";
import { Trophy } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate, nexusApi, ORG_HIERARCHY } from "@/lib/nexus-api";
import { Skeleton } from "@/components/ui/skeleton";
import { LeaderboardCard } from "@/components/ui/leaderboard-card";
import { XpAuditLog } from "@/components/XpAuditLog";
import { UserXpLogModal } from "@/components/UserXpLogModal";
import { useLang } from "@/lib/lang";

export const Route = createFileRoute("/_app/leaderboard")({ component: Leaderboard });

function Leaderboard() {
  const { t } = useLang();
  const [xpUser, setXpUser] = useState<{ id: string; name?: string | null; avatar?: string | null } | null>(null);
  const board = useQuery({ queryKey: ["leaderboard"], queryFn: () => nexusApi.leaderboard(), retry: 1 });
  const profile = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1, staleTime: 300_000 });
  const meId = profile.data?.user?.id;
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 300_000 });
  const isAdmin = (ORG_HIERARCHY[wsm.data?.role ?? ""] ?? 0) >= 3; // BoD ke atas

  const ranked = (board.data?.rows ?? [])
    .slice()
    // BoD+ are excluded server-side; rank the staff by XP then name.
    .sort((a, b) => b.totalXp - a.totalXp || (a.name ?? "").localeCompare(b.name ?? ""))
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const podiumRankings = ranked.slice(0, 3).map((r) => ({
    userId: r.userId,
    userName: r.name ?? "—",
    rank: r.rank,
    value: r.totalXp,
    avatarUrl: r.avatar,
  }));

  const rankings = ranked.map((r) => ({
    userId: r.userId,
    rank: r.rank,
    userName: r.name ?? "—",
    byline: `${t("Level {n}", { n: r.level })}${r.levelName ? ` – ${r.levelName}` : ""}`,
    value: r.totalXp,
    avatarUrl: r.avatar,
    displayed: true,
  }));

  return (
    <div>
      <PageHeader title={t("Leaderboard")} subtitle={t("Everyone's XP this month. It resets on the 1st.")} />
      <div className="p-4 md:p-8">
        <div className="mx-auto max-w-3xl">
          {board.data?.period && (
            <div className="mb-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-border bg-card px-4 py-2.5 text-center text-xs text-muted-foreground shadow-soft">
              <span className="font-bold text-foreground">{t("Current period")}</span>
              <span>{fmtDate(board.data.period.start)} → {fmtDate(board.data.period.end)}</span>
              <span className="hidden sm:inline">·</span>
              <span>{t("XP resets on the 1st at 00:00 WIB")}</span>
            </div>
          )}
          {board.isLoading && (
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <Skeleton className="mb-2 h-6 w-40" />
              <Skeleton className="mb-6 h-4 w-56" />
              <div className="mb-6 flex items-end justify-center gap-3">
                {[24, 32, 20].map((h, i) => <div key={i} className="flex flex-1 flex-col items-center gap-2"><Skeleton className="h-12 w-12 rounded-full" /><Skeleton className="h-3 w-16" /><Skeleton className="w-full rounded-t-xl" style={{ height: h * 4 }} /></div>)}
              </div>
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
            </div>
          )}

          {board.isError && (
            <div className="rounded-2xl border border-dashed bg-card p-8 text-center shadow-sm">
              <div className="text-lg font-black">{t("Couldn't load the leaderboard")}</div>
              <p className="mt-2 text-sm text-muted-foreground">{t("Your session may have ended. Sign in again, then reload this page.")}</p>
            </div>
          )}

          {!board.isLoading && !board.isError && ranked.length === 0 && (
            <EmptyState icon={Trophy} title={t("No XP yet this month")}
              message={t("XP comes from quests the BoD assigns and is kept by showing up on time. The ranking appears as soon as someone earns or loses XP.")} />
          )}

          {!board.isLoading && !board.isError && ranked.length > 0 && (
            <LeaderboardCard
              // The page header already says "Leaderboard" (it showed twice, audit 12 Oct 2026).
              title=""
              subtitle={t("XP ranking for everyone")}
              podiumRankings={podiumRankings}
              rankings={rankings}
              currentUserId={meId}
              onSelectUser={(item) => setXpUser({ id: item.userId, name: item.userName, avatar: item.avatarUrl })}
            />
          )}

          {isAdmin && <XpAuditLog />}
        </div>
      </div>
      <AnimatePresence>
        {xpUser && <UserXpLogModal key={xpUser.id} user={xpUser} onClose={() => setXpUser(null)} />}
      </AnimatePresence>
    </div>
  );
}
