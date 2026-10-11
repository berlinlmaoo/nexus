/**
 * Next.js boot hook (root, next to middleware.ts: this repo keeps pages/ at the root, so Next looks here) (runs once per server process). Starts the project-automations clock
 * (lib/automation-ticker.ts: due dates and schedules, 12 Oct 2026). Node runtime only; NEXUS_AUTOMATION_TICKER=0
 * turns it off (the /api/cron/automations route still works).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NEXUS_AUTOMATION_TICKER === "0") return
  const { startAutomationTicker } = await import("@/lib/automation-ticker")
  startAutomationTicker()
}
