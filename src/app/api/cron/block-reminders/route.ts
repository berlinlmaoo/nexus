export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/cron-auth"
import { runCronJob } from "@/lib/cron-lock"
import { sendDueReminders } from "@/lib/personal-reminders"

// "Remind me" chips in docs and task bodies (block editor) and personal reminders (GIDEON / the Reminders page).
// Each reminder is one-shot. The singleton leader sends due ones itself: a 60 s ticker (lib/automation-ticker.ts)
// calls sendDueReminders in lib/personal-reminders.ts. This route is only the manual / host-cron handle for the
// same function (POST with the cron secret). Delivery = in-app notification (live over the socket) + push, in the
// person's language, times shown in WIB; no email. A reminder is claimed before it is sent, so the ticker and this
// route never send one twice. One more than 24 h late (server off for a while) is not sent as a normal reminder:
// the person gets one "Missed reminder" notice instead.

export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // One run at a time, cron calls only on the singleton leader (lib/cron-lock.ts).
  return runCronJob("block-reminders", { fromCron: true }, async () => {
    const res = await sendDueReminders(new Date())
    return NextResponse.json({ ok: true, ...res })
  })
}
