/**
 * Next.js boot hook (root, next to middleware.ts: this repo keeps pages/ at the root, so Next looks here) (runs once per server process). Starts the project-automations clock
 * (lib/automation-ticker.ts: due dates and schedules, 12 Oct 2026). Node runtime only; NEXUS_AUTOMATION_TICKER=0
 * turns it off (the /api/cron/automations route still works).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // First: IPv4-only connects. Node 20 happy eyeballs + no IPv6 in the container + ~230 ms to Google made
  // outbound calls fail whenever the loop stalled (attendance sheet cron, Sep-Oct 2026). lib/network-family.ts.
  const { preferSingleIpv4Connect } = await import("@/lib/network-family")
  preferSingleIpv4Connect()
  // Blue-green (lib/bluegreen.ts): both slots boot this file; only the singleton leader runs the clocks below.
  const { startSingletonLeader } = await import("@/lib/bluegreen")
  startSingletonLeader()
  // Realtime events cross between the two slots (lib/realtime-bridge.ts, race audit 16 Oct 2026, M19).
  const { startRealtimeBridge } = await import("@/lib/realtime-bridge")
  startRealtimeBridge()
  // GIDEON schedules (lib/gideon-triggers.ts, 12 Oct 2026): weekly project digests. Idle unless GIDEON is
  // configured (GIDEON_CHAT_URL) and a project has a schedule. Off with NEXUS_GIDEON_TICKER=0.
  if (process.env.NEXUS_GIDEON_TICKER !== "0") {
    const { startGideonTicker } = await import("@/lib/gideon-triggers")
    startGideonTicker()
  }
  // Meeting notes (lib/meeting-notes.ts, 18 Oct 2026): transcripts and minutes. Leader only. Off with NEXUS_MEETING_TICKER=0.
  if (process.env.NEXUS_MEETING_TICKER !== "0") {
    const { startMeetingTicker } = await import("@/lib/meeting-notes")
    startMeetingTicker()
  }
  if (process.env.NEXUS_AUTOMATION_TICKER === "0") return
  const { startAutomationTicker } = await import("@/lib/automation-ticker")
  startAutomationTicker()
}
