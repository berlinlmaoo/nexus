export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/cron-auth"
import { runCronJob } from "@/lib/cron-lock"
import { sendDueReminders } from "@/lib/personal-reminders"

// "Remind me" chips in docs and task bodies (block editor, 12 Oct 2026) and personal reminders (GIDEON / the
// Reminders page, 18 Oct 2026). Since 18 Oct 2026 the singleton leader sends them every minute by itself
// (lib/automation-ticker.ts); this route stays as the manual / host-cron handle (POST with the cron secret).
// Each reminder is claimed before it is sent, so this route and the ticker never send one twice.
// Reminders more than a day late (clock off for a while) are marked fired without a notification.

export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // One run at a time, cron calls only on the singleton leader (lib/cron-lock.ts).
  return runCronJob("block-reminders", { fromCron: true }, async () => {
    const res = await sendDueReminders(new Date())
    return NextResponse.json({ ok: true, ...res })
  })
}
