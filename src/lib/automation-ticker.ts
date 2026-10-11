import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { pruneAutomationRuns, runTimeBasedAutomations } from "@/lib/automation-engine"

/**
 * The clock of project automations (12 Oct 2026): every minute, due-date and scheduled rules
 * (automation-engine.ts runTimeBasedAutomations); every hour, the 90-day run-log trim.
 *
 * Started once per server process from the root instrumentation.ts. Off with NEXUS_AUTOMATION_TICKER=0. It
 * also stands down by itself on a read-only replica (the VPS standby: pg_is_in_recovery()), so a warm
 * standby never fires rules on stale data. Each firing carries a dedup key (AutomationRun unique
 * automationId+dedupKey), so a second process or the /api/cron/automations route cannot double-fire.
 */
const log = createLogger("automation-ticker")
const g = globalThis as unknown as { __nexusAutomationTicker?: boolean }

const TICK_MS = 60_000
const PRUNE_EVERY = 60

export function startAutomationTicker() {
  if (g.__nexusAutomationTicker) return
  g.__nexusAutomationTicker = true
  let ticks = 0
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const rows = await prisma.$queryRaw<Array<{ ro: boolean }>>`select pg_is_in_recovery() as ro`
      if (rows[0]?.ro) return
      const res = await runTimeBasedAutomations()
      if (res.fired > 0) log.info("time-based automations fired", res)
      if (++ticks % PRUNE_EVERY === 0) {
        const n = await pruneAutomationRuns()
        if (n > 0) log.info("automation runs pruned", { n })
      }
    } catch (err) {
      log.error("automation tick failed", { error: String(err) })
    } finally {
      busy = false
    }
  }
  // First pass shortly after boot (catches a slot missed while the app was restarting), then every minute.
  setTimeout(() => { void tick() }, 20_000).unref?.()
  setInterval(() => { void tick() }, TICK_MS).unref?.()
}
