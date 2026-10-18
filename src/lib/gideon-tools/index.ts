import type { User } from "@/generated/prisma/client"
import { EXTRA_TOOL_GROUP, EXTRA_TOOL_META } from "./meta"
import { getAppConfig } from "@/lib/app-config"
import type { ExtraTool, Input } from "./types"
import { inboxTools } from "./inbox"
import { chatTools } from "./chat"
import { reminderTools } from "./reminders"
import { leaveTools } from "./leave"
import { bulkTaskTools } from "./tasks-bulk"
import { pipelineTools } from "./pipeline"
import { outletSocialTools } from "./outlet-social"
import { legalTools } from "./legal"
import { vaultTools } from "./vault"
import { announcementTools } from "./announcement"
import { sheetTools } from "./sheets"
import { imageTools } from "./images"
import { fileTools } from "./files"
import { docEditTools } from "./doc-edit"
import { formTools } from "./forms"
import { performanceTools } from "./performance"
import { presenceTools } from "./presence"

/**
 * The GIDEON tools of the 18 Oct 2026 package, by action (see meta.ts for approval rules and why). The tools route
 * dispatches here for any action it does not handle itself; the proposals route applies the `web` ones.
 */
export const EXTRA_TOOLS: Record<string, ExtraTool> = {
  ...inboxTools,
  ...chatTools,
  ...reminderTools,
  ...leaveTools,
  ...bulkTaskTools,
  ...pipelineTools,
  ...outletSocialTools,
  ...legalTools,
  ...vaultTools,
  ...announcementTools,
  ...sheetTools,
  ...imageTools,
  ...fileTools,
  ...docEditTools,
  ...formTools,
  ...performanceTools,
  // Presence status (owner, 19 Oct 2026): "Berlin ke mana?" + a card to set one's own status.
  ...presenceTools,
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
  if (!(await extraToolEnabled(action))) throw new Error(EXTRA_DISABLED_TEXT)
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

/** Is this tool's group switched on (remote config, EXTRA_TOOL_GROUP)? A config read error keeps it on. */
export async function extraToolEnabled(action: string): Promise<boolean> {
  const flag = EXTRA_TOOL_GROUP[action]
  if (!flag) return true
  const cfg = await getAppConfig(null).catch(() => null)
  return (cfg?.flags as Record<string, unknown> | undefined)?.[flag] !== false
}

export const EXTRA_DISABLED_TEXT = "This GIDEON ability is not available yet. Tell the person to use the NEXUS page for it · Kemampuan GIDEON ini belum tersedia; pakai halamannya di NEXUS."
