# Social Media Report: a new project type (14 Oct 2026)

Spec for a new `feature/social/*`. The server, web and iOS are on `dev`. The server rules are in
`src/lib/social-media.ts` and `src/lib/social-media-server.ts`, the routes in
`src/app/api/projects/[projectId]/social-media/**`. The web code is in `apps/web/src/components/social-media/*`
and the iOS code in `apps/ios/Sources/Views/SocialMediaView.swift`. The Outlet Sales screens
(`OUTLET-CUSTOM-REPORT.md`) are the model: the same month switcher, cards, calendar grid and daily-target
fallback.

## 1. Compatibility (nothing breaks if Android does nothing)

- `Project.type` is `"SOCIAL_MEDIA_REPORT"`. A build that doesn't know this type opens it as an ordinary task
  project. The server still creates the three default sections (To Do / In Progress / Done), so the board
  stays empty but works. The type is read as a plain string, so nothing should crash. Check that
  `ProjectPage` doesn't use an exhaustive `when` on the type.
- Realtime sends `social-media-changed` `{ projectId, date|null, month|null, actorId }` on `project:<id>`.
  Builds that don't know it ignore it.
- `GET /api/projects/:id/views` returns no built-in views for this type, as for OUTLET_SALES and PIPELINE.

## 2. Create

`POST /api/projects { name, workspaceId, type: "SOCIAL_MEDIA_REPORT", folderId?, memberIds?, memberAccessLevel? }`.
In the New project gallery, put it under "Dashboards" next to Outlet Sales and before Pipeline.

- Title: "Social Media Report" / "Laporan Media Sosial".
- Blurb: "Daily views, likes, comments, shares and posts per platform, against monthly and daily targets."
- The create button says "Create project + open dashboard", and the new project opens on its Overview.

## 3. Read: `GET /api/projects/:id/social-media?month=YYYY-MM` (default: this month, WIB)

```jsonc
{
  "canRecord": true,      // Edit access or above: may fill days
  "canManage": false,     // Full access: platforms + monthly / daily targets
  "month": "2026-10", "today": "2026-10-14",
  "config": { "version": 1, "platforms": [
    { "id": "instagram", "name": "Instagram" }, { "id": "tiktok", "name": "TikTok" },
    { "id": "p_k3f9x2ab01", "name": "YouTube", "archived": true } ] },
  "targets":    [{ "platformId": "instagram", "engagementTarget": 31000, "postsTarget": 31, "updatedBy": {...} }],
  "dayTargets": [{ "date": "2026-10-05", "platformId": "instagram", "engagementTarget": 2000, "postsTarget": null }],
  "days": [ {                       // EVERY day of the month
    "date": "2026-10-01",
    "platforms": { "instagram": {
        "views": 12000, "likes": 800, "comments": 40, "shares": 25, "posts": 2,   // null = not filled, 0 is a real 0
        "engagement": 865,                                                       // likes + comments + shares (server)
        "engagementTarget": 1000, "postsTarget": 1,                              // in force that day (may have 2 decimals)
        "engagementTargetSource": "month", "postsTargetSource": "month",         // "day" | "month" | null
        "engagementPct": 86, "postsPct": 200 } },
    "engagement": 865, "views": 12000, "posts": 2,   // all platforms; null when nothing of that kind
    "worked": "Reel at 7 pm", "didntWork": "",
    "recorded": true, "updatedAt": "…", "updatedBy": { "id": "…", "name": "…" } } ],
  "overview": {
    "cutoff": "2026-10-14",          // last day counted; null = the month hasn't started yet
    "recordedDays": 9,               // 0 = empty state
    "platforms": [ {                 // active platforms + archived ones with figures this month
      "platformId": "instagram", "name": "Instagram", "archived": false,
      "engagement": 9100, "views": 150000, "posts": 12, "likes": 8000, "comments": 600, "shares": 500,
      "engagementTargetToDate": 14000, "postsTargetToDate": 14,   // sum of each day's target in force up to cutoff; null = none
      "engagementPct": 65, "postsPct": 85,                        // floor(actual*100/target); null without a target
      "engagementTargetMonth": 31000, "postsTargetMonth": 31,
      "trend": [865, 1200, 0, …],                                 // engagement per day from the 1st to cutoff
      "recordedDays": 9 } ] }
}
```

**Engagement = Likes + Comments + Shares.** Views are not part of it. Never compute your own target
fallback or percentage: read the ones the server sends.

## 4. Writes

- **Day** (`canRecord`): `PUT …/social-media/days/:date { platforms?: { [platformId]: { views?, likes?, comments?, shares?, posts? } }, worked?, didntWork? }`.
  Send only what changed. `null` clears a number and `""` clears a note. Errors:
  - `400 FUTURE_DATE`: the day is after today (WIB). The sheet is read-only for future days.
  - `400 CONFIG_CHANGED`: the platform is gone. Refetch the month and keep what was typed.
  - `403 NEEDS_EDIT_ACCESS`.
- **Monthly targets** (`canManage`): `PUT …/social-media/targets { month, platforms: { [id]: { engagementTarget?, postsTarget? } } }`.
  Whole numbers; `null` clears.
- **Daily targets** (`canManage`): `PUT …/social-media/day-targets { date, platforms: { [id]: { engagementTarget?, postsTarget? } } }`.
  A cleared part falls back to the month's target split evenly over the month's days.
- **Platforms** (`canManage`):
  - `GET …/social-media/config` returns `{ config, usage: { id: count }, canManage }`.
  - `PUT …/social-media/config { config: { platforms: [...] } }` sends the whole list in order. A new platform
    omits `id` (the server mints one), and renaming keeps the id.
  - Archive = `"archived": true`. If `usage > 0`, ask first with a centred alert. Restore = drop `archived`.
  - At least one platform must stay active (otherwise `400 PLATFORM_REQUIRED`), with at most 12 platforms.
    Names can be 40 characters long.
- `403 SETTINGS_FORBIDDEN` for target and platform writes without Full access.
- Every write emits `social-media-changed`. On that event, refetch the month on screen.

## 5. UI (match web / iOS)

Tabs: Overview · Calendar · Chat. There are no task tabs, and the Project settings → Tabs card is hidden for
this type.

- **Header**: ‹ Month › and "This month". "Platforms & targets" (Full access) opens settings. "Record today"
  (Edit access) opens today's day sheet.
- **Overview** (month to date):
  - `cutoff == null`: show an empty state ("{Month} hasn't started yet", with "Set targets" for managers).
  - `recordedDays == 0`: show an empty state ("Nothing recorded for {Month} yet", with "Record today").
  - Otherwise show "Month to date" with an (i) button. It opens an alert: "Engagement = Likes + Comments +
    Shares" / "Views are counted on their own and are not part of engagement."
  - One card per platform, two side by side when there's room:
    - the engagement number, "/ target to date" and a pct pill (green at 100% or above), then a progress bar;
    - "Target to date · month target N", or "No engagement target";
    - a small sparkline of `trend`: one 2dp line in the brand colour and a faint fill;
    - a footer row with Views, Likes, Comments and Shares.
  - Then a "Contents posted" card, one row per platform: "12 / 15 posts (80%)" with a thin bar, or "12 posts"
    without a target. Below the rows, a caption explains the target to date.
- **Calendar**: a Monday-first grid with 6 weeks.
  - Each cell shows the compact engagement (1,2 rb / 1.2K) and, on wide screens, the posts.
  - A small note icon marks days with notes and a target icon marks days with their own target. Today is a
    filled circle.
  - Tapping a day opens its sheet.
- **Day sheet**:
  - One section per platform (active ones, plus archived ones that hold figures that day) with five numeric
    boxes: Views, Likes, Comments, Shares and Posts published. Use digits only, grouped while typing.
  - A live "Engagement: N / target" line, and a footer with the day target and its source.
  - The notes "What worked" and "What didn't work", multi-line, up to 2000 characters each.
  - Full access: "Set this day's targets", with two boxes per platform. The placeholder is the month's share.
  - Ask before discarding unsaved changes.
  - View / Comment access: read-only.
- **Platforms & targets sheet**:
  - "Targets for {Month}", with engagement and posts boxes per saved active platform.
  - A platform list where you can rename, reorder, add ("Add platform, e.g. YouTube") and archive (confirm when
    used). Archived platforms are listed below with Restore.
  - One Save button: PUT config first, then targets.
- Strings: EN + ID. Copy them from `apps/web/src/lib/i18n/id-social.ts`. "Views" is "Tayangan" in Indonesian.
  Don't reuse the shared "Views" key, which means saved views.
