/**
 * Next.js boot hook (runs once per server process). Starts the project-automations clock
 * (lib/automation-ticker.ts: due dates and schedules, 12 Oct 2026). Node runtime only; NEXUS_AUTOMATION_TICKER=0
 * turns it off (the /api/cron/automations route still works).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // GIDEON schedules (lib/gideon-triggers.ts, 12 Oct 2026): weekly project digests. Idle unless GIDEON is
  // configured (GIDEON_CHAT_URL) and a project has a schedule. Off with NEXUS_GIDEON_TICKER=0.
  if (process.env.NEXUS_GIDEON_TICKER !== "0") {
    const { startGideonTicker } = await import("./lib/gideon-triggers")
    startGideonTicker()
  }
  if (process.env.NEXUS_AUTOMATION_TICKER === "0") return
  const { startAutomationTicker } = await import("./lib/automation-ticker")
  startAutomationTicker()
}
