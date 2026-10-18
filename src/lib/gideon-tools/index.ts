import type { User } from "@/generated/prisma/client"
import { EXTRA_TOOL_META } from "./meta"
import type { ExtraTool, Input } from "./types"
import { inboxTools } from "./inbox"
import { chatTools } from "./chat"
import { reminderTools } from "./reminders"

/**
 * The GIDEON tools of the 18 Oct 2026 package, by action (see meta.ts for approval rules and why). The tools route
 * dispatches here for any action it does not handle itself; the proposals route applies the `web` ones.
 */
export const EXTRA_TOOLS: Record<string, ExtraTool> = {
  ...inboxTools,
  ...chatTools,
  ...reminderTools,
}

export function extraTool(action: string): ExtraTool | null {
  return Object.prototype.hasOwnProperty.call(EXTRA_TOOLS, action) && EXTRA_TOOL_META[action] ? EXTRA_TOOLS[action] : null
}

/**
 * Run one of these tools straight from the model (not an Apply). A read runs; a write runs only when its approval
 * rule lets it skip the card (approval "modes" in "don't ask") and it has an in-process apply — everything else is
 * refused here, so a write can never bypass its card even if a caller skipped needsApproval.
 */
export async function runExtraTool(actor: User, action: string, input: Input, opts: { approved: boolean; direct: boolean }): Promise<unknown> {
  const tool = extraTool(action)
  if (!tool) throw new Error(`Unknown GIDEON tool action: ${action}`)
  const meta = EXTRA_TOOL_META[action]
  if (!meta.write) {
    if (!tool.read) throw new Error(`${action} cannot be read`)
    return tool.read(actor, input)
  }
  const allowedDirect = opts.direct && meta.approval === "modes"
  if (!opts.approved && !allowedDirect) {
    throw new Error("This always waits for the person to confirm it on a card in the NEXUS GIDEON chat. Nothing was changed.")
  }
  if (!tool.apply) throw new Error("This change is applied from its card in NEXUS (web or the latest app). Nothing was changed.")
  return tool.apply(actor, input)
}

export { EXTRA_TOOL_META }
