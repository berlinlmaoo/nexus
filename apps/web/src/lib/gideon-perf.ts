import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/nexus-api";
import { useRealtime, useRealtimeRoom } from "@/lib/realtime";

/**
 * Control Room › GIDEON › Performance (18 Oct 2026). BoD / One Above All. The server shape is PerfSummary in
 * src/lib/gideon-perf.ts; the native contract is docs/internal/gideon-performance-native.md.
 */

export type PerfTierId = "astra" | "luna" | "terra" | "experimental";
export const PERF_TIERS: PerfTierId[] = ["astra", "luna", "terra", "experimental"];
export const PERF_TIER_NAME: Record<PerfTierId, string> = { astra: "Artemis", luna: "Phaëthon", terra: "Aphrodite", experimental: "Model 0" };

export type PerfTier = {
  id: PerfTierId;
  status: "online" | "busy" | "unavailable" | "loading";
  reason: string | null;
  inFlight: number;
  answers15m: number;
  failures15m: number;
  /** Answers lost to a shim restart (not errors; older servers omit it). */
  restarts15m?: number;
  restarts24h?: number;
  errorRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  avgCredits15m: number | null;
  avgCredits24h: number | null;
  answers24h: number;
};

export type PerfLive = {
  at: string;
  gpu: { name: string | null; util: number | null; memUsedMiB: number | null; memTotalMiB: number | null; tempC: number | null; powerW: number | null; powerLimitW: number | null } | null;
  engine: { up: boolean; model: { name: string; sizeBytes: number; sizeVramBytes: number; gpuShare: number | null; contextLength: number | null; expiresAt: string | null } | null } | null;
  whisper: { up: boolean; busy: boolean; queued: number } | null;
};

export type PerfHour = {
  t: string;
  questions: Record<PerfTierId, number>;
  p50Ms: Record<PerfTierId, number | null>;
  credits: number;
  inputTokens: number;
  cachedTokens: number;
  cacheHit: number | null;
};

export type PerfAlertKey = "model0_down" | "error_rate" | "vram_full" | "gpu_hot";

export type PerfSummary = {
  now: string;
  thresholds: { model0DownMin: number; errorRatePct: number; errorRateWindowMin: number; errorRateMinAnswers: number; vramFullPct: number; gpuHotC: number; sustainMin: number };
  telemetry: { lastAt: string | null; stale: boolean; cadenceSec: number };
  tiers: PerfTier[];
  live: PerfLive | null;
  model0: {
    recent: { at: string; evalTps: number | null; promptTps: number | null; outTokens: number | null; totalMs: number | null }[];
    loads: { at: string; loadSec: number | null }[];
    avgEvalTps24h: number | null;
    gens24h: number;
  };
  hours: PerfHour[];
  quality: {
    routerMisses24h: number;
    answers24h: number;
    recentMisses: { at: string; tier: string | null }[];
    topTools: { tool: string; calls: number; failures: number }[];
    failingTools: { tool: string; calls: number; failures: number }[];
    thumbsDown: number | null;
  };
  alerts: { key: PerfAlertKey; active: boolean; since: string | null; value: string | null }[];
};

export const PERF_KEY = ["gideon-perf"] as const;
export const PERF_ROOM = "gideon:perf";

/**
 * The panel's data, live: joins `gideon:perf` (the server only lets BoD+ in) and listens for `gideon-perf`.
 * A GPU sample ({ kind: "gpu", live }) patches the cached summary in place; "runs" / "alerts" pings refetch
 * (folded to one per 1.5 s). A reconnect refetches whatever was missed; a 60 s poll is the safety net.
 */
export function useGideonPerf() {
  const qc = useQueryClient();
  const { socket } = useRealtime();
  useRealtimeRoom(PERF_ROOM);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!socket) return;
    const on = (data: { kind?: string; live?: PerfLive | null }) => {
      let engineFlipped = false;
      if (data?.live) {
        const live = data.live;
        qc.setQueryData<PerfSummary>(PERF_KEY, (old) => {
          if (!old) return old;
          // Model 0's card status depends on the engine being up: a flip needs the server's view of the tiers.
          engineFlipped = (old.live?.engine?.up ?? null) !== (live.engine?.up ?? null);
          return { ...old, live, telemetry: { ...old.telemetry, lastAt: live.at, stale: false } };
        });
      }
      if (data?.kind === "gpu" && !engineFlipped) return;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void qc.invalidateQueries({ queryKey: PERF_KEY });
      }, 1500);
    };
    const re = () => { void qc.invalidateQueries({ queryKey: PERF_KEY }); };
    socket.on("gideon-perf", on);
    socket.on("connect", re);
    return () => {
      socket.off("gideon-perf", on);
      socket.off("connect", re);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [socket, qc]);
  return useQuery({
    queryKey: PERF_KEY,
    queryFn: () => apiFetch<PerfSummary>("/api/gideon/perf"),
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
