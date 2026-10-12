import { createFileRoute } from "@tanstack/react-router";
import { Lock, Trophy } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PageBody } from "@/components/PageLayout";
import { fmtDate, nexusApi, ORG_HIERARCHY } from "@/lib/nexus-api";
import { Skeleton } from "@/components/ui/skeleton";
import { LeaderboardCard } from "@/components/ui/leaderboard-card";
import { XpAuditLog } from "@/components/XpAuditLog";
import { UserXpLogModal } from "@/components/UserXpLogModal";
import { useLang } from "@/lib/lang";
import { competitionRank } from "@/lib/competition-rank";

export const Route = createFileRoute("/_app/leaderboard")({ component: Leaderboard });

function Leaderboard() {
  const { t } = useLang();
  const [xpUser, setXpUser] = useState<{ id: string; name?: string | null; avatar?: string | null } | null>(null);
  const board = useQuery({ queryKey: ["leaderboard"], queryFn: () => nexusApi.leaderboard(), retry: 1 });
  const profile = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1, staleTime: 300_000 });
  const meId = profile.data?.user?.id;
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 300_000 });
  const isAdmin = (ORG_HIERARCHY[wsm.data?.role ?? ""] ?? 0) >= 3; // BoD ke atas

  // BoD+ are excluded server-side. Standard competition ranking: equal XP shares a rank, the next one skips
  // (1, 1, 1, 4); within a tie the order is by name (lib/competition-rank.ts).
  const ranked = competitionRank(board.data?.rows ?? [], (r) => r.totalXp, (r) => r.name ?? "");

  const podiumRankings = ranked.slice(0, 3).map((r, i) => ({
    userId: r.userId,
    userName: r.name ?? "—",
    rank: i + 1,
    label: r.rank,
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
      {/* The period sits in the header's action slot (it was a floating pill above a centred 3xl column;
          the content now runs full width like every list page, UI sweep 12 Oct 2026). */}
      <PageHeader title={t("Leaderboard")} subtitle={t("Everyone's XP this month. It resets on the 1st.")} actions={board.data?.period ? (
        <span className="text-xs text-muted-foreground" title={t("XP resets on the 1st at 00:00 WIB")}>
          <span className="font-medium text-foreground">{t("Current period")}</span> · {/* `end` is exclusive (the 1st of next month): show the last day that counts, "1 Oct – 31 Oct"
              (QA 13 Oct 2026: it read "1 Oct → 1 Nov"). */}
          {fmtDate(board.data.period.start)} – {fmtDate(new Date(new Date(board.data.period.end).getTime() - 1).toISOString())}
        </span>
      ) : undefined} />
      <PageBody>
        <div className="space-y-6">
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
            <EmptyState icon={Lock} tone="muted" title={t("Couldn't load the leaderboard")} message={t("Your session may have ended. Sign in again, then reload this page.")} />
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
      </PageBody>
      <AnimatePresence>
        {xpUser && <UserXpLogModal key={xpUser.id} user={xpUser} onClose={() => setXpUser(null)} />}
      </AnimatePresence>
    </div>
  );
}
