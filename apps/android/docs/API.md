# NEXUS API — contract for the Android client

The full list of HTTP calls a native Android (Kotlin) client of NEXUS has to make, taken from the
**released iOS client** and checked against the **server source**.

| | |
|---|---|
| iOS source of truth | `nexus-ios` @ `a875c3c` ("Live Activity and Dynamic Island in white instead of violet"), `Sources/` — every `File.swift:LINE` below refers to this commit |
| Server source of truth | `nexus` @ `5c113e7` on the server (`src/app/api/**/route.ts`, `src/lib/**`, root `middleware.ts`) |
| Written | 24 Sep 2026 |
| Rule when they disagree | **the server's behaviour is documented**, and the difference is marked **⚠ Discrepancy** |
| Items the server does not have yet | marked **⏳ PENDING** (iOS work in progress, not committed at `a875c3c`, and no server route) |
| Items the server must change before Android ships | marked **🛠 SERVER CHANGE REQUIRED** and collected in §4 |

Conventions used in the types: `string` for ISO-8601 instants (`"2026-09-24T02:13:05.123Z"`, always
UTC with a `Z`), `DateKey` for `"YYYY-MM-DD"` office dates (Asia/Jakarta), `MonthKey` for `"YYYY-MM"`,
`HHmm` for `"09:00"`. `?` = may be absent; `| null` = present but may be null. The iOS decoders treat
almost every field as optional, and the Android models should too: servers are deployed more often
than apps, and a field that goes missing must not break a whole screen.

---

## Contents

1. [Basics](#1-basics): base URL, LAN shortcut, auth, headers, timeouts, retries, errors, 426, NEXUS_DOWN, uploads, cache
2. Endpoint catalogue
   - [2.1 Auth & account](#21-auth--account) (login, sign-up + workspace code + OTP, password reset, change email, delete account, profile/avatar, passkeys)
   - [2.2 Attendance](#22-attendance-staff-facing) (today, check-in/out, offline queue, history/board, requests, offsite, ⏳ location trail)
   - [2.3 Attendance administration](#23-attendance-administration) (offices, day-offs, red-date quota, holidays, reflections, records, offsite review, exports)
   - [2.4 Tasks, projects & work](#24-tasks-projects--work) (projects, folders, tasks, custom fields, attachments + chunks, comments, dependencies, time, sprints, automations, finance, search, docs, rooms, calendar, teams)
   - [2.5 Messages, Threads, Tickets, Inbox & announcements](#25-messages-threads-tickets-inbox--announcements) (incl. push device registration)
   - [2.6 Forms, Z Vault, Reports, Gamification, Control Room, GIDEON & version policy](#26-forms-z-vault-reports-gamification-control-room-gideon--version-policy)
3. [Push notifications](#3-push-notifications): every `type`, deep links, notification actions, FCM
4. [Server changes required for Android](#4-server-changes-required-for-android-checklist): checklist
5. [Appendix: endpoint index](#appendix-endpoint-index)

## 1. Basics

### 1.1 Base URL

| Constant | Value | iOS |
|---|---|---|
| Public base | `https://nexus.znetworks.id` | `Config.swift:17` |
| Office LAN base | `https://lan.nexus.znetworks.id` | `Config.swift:23` |

- Every endpoint is under `/api/…` on the same origin. There is no API version prefix.
- Always use the **canonical** host. A redirecting legacy host makes HTTP clients follow a
  301/302 by turning POST into GET, and login then fails with 405 (`Config.swift:3-7`).
- `nexus.znetworks.id` is also the passkey relying-party ID and the host every image URL is built
  from. Treat it as the app's identity, not as a setting.
- Relative file paths in responses (`/api/files/attendance/checkin-….jpg`, `/api/files/…`,
  `/uploads/…`) are resolved against the public base (`AttendanceModels.swift` `AttendanceRow.fileURL`).
  **`/api/files/**` requires the session cookie.** Do not pass these URLs to a browser, a system
  viewer, or an image library that does not add the cookie. Fetch the bytes through the API client,
  then hand over a local file or a `content://` URI (`APIClient.swift:1972-2021`).
- Only send the session to the **two NEXUS hosts** (exact match, not a suffix match:
  `Config.isNexusHost`, `Config.swift:40-43`). Image URLs on any other host are fetched without the cookie.

### 1.2 The office LAN shortcut (`LANRoute`)

**What it does.** Inside the office, the same server (same nginx, same app container, same `/api`
and `/auth` routes) is also reachable at `https://lan.nexus.znetworks.id`. That hostname has a public
DNS record (grey-cloud, not proxied) pointing at the private address of the server
(`<server-lan-ip>`), with a real Let's Encrypt certificate (renewed with DNS-01 by
`scripts/renew-lan-cert.sh`). So TLS works without any exception. A phone on the office Wi-Fi then
uploads its selfie across the switch, not out to Cloudflare and back through the same office
uplink. It also **keeps working when the office's internet connection is down**. During the ISP
outage on 15 Sep 2026, 164 requests went through the LAN route while every phone outside the office
got 530.

**How iOS decides** (`LANRoute.swift`, per request, never blocking):

| Rule | Value / behaviour | iOS |
|---|---|---|
| Probe | `GET https://lan.nexus.znetworks.id/api/user/profile` with the session `Cookie`, `Accept: application/json` | `LANRoute.swift:41, 172-176` |
| Why this path | It requires the session. A health check proves only that the box is up, and a 401 on the LAN host would look like being logged out. **Only HTTP 200 promotes the route** (401 or anything else = not LAN). | `:18-23, 177-182` |
| Probe timeout | 300 ms (request and resource), `waitsForConnectivity=false`, **never over cellular**, no cookie store, no cache | `:29, 65-75` |
| When it probes | On launch or first use (the first request goes to the public host while the probe runs in the background), on every network path change, on every app foreground, and 30 s after a LAN failure. Cooldown of 2 s between lazy probes. No session → state stays "unknown". | `:77-91, 105-111, 124-126, 146-170` |
| Plausibility | Wi-Fi or wired Ethernet with a satisfied path. Cellular or no link → public host immediately, no probe. | `:141-144` |
| Timeout on LAN requests | 10 s (`Config.lanRequestTimeout`, an inactivity timeout), except for requests that carry a body, which get the standard 60 s | `Config.swift:30`, `APIClient.swift:163, 359-365` |
| Failure on LAN | Any transport failure (not a cancellation) **demotes the route at once** (`noteUnreachable`). If the request may be replayed (§1.6), it is sent again once over the public host with the same method, headers (including `Cookie`) and body, and the user never sees the first failure. An HTTP status from the server is an answer, not a route failure, and is returned as it is. | `APIClient.swift:289-314, 393-412` |
| Images | Image URLs on a NEXUS host are re-aimed at the current base with the same 10 s leash | `APIClient.swift:424-433` |
| Not covered | GIDEON (`Gideon.swift:280`) builds its own requests against the public base and never takes the LAN route | |

**Recommendation for Android: implement it, as a single OkHttp layer, in the first release that
ships attendance.** The two benefits are the same on Android. The main reason to do it is that
attendance keeps working during an ISP outage, which is exactly when a selfie check-in would
otherwise be queued. Design notes:

- Put the decision in **one** place: an `Interceptor` that rewrites the host
  (`nexus.znetworks.id` ↔ `lan.nexus.znetworks.id`) for every request (API, images, downloads,
  chunk uploads). Keep a single send path; do not add a second client that has its own replay rules.
- Probe with a separate `OkHttpClient` (connect/read/call timeout 300 ms, no retries) bound to the
  **Wi-Fi `Network`** (`ConnectivityManager.registerDefaultNetworkCallback` +
  `network.socketFactory`). This guarantees that a probe never leaves over mobile data, where the
  name resolves to a private address on somebody else's network. Re-probe on `onCapabilitiesChanged`/
  `onLost`, on `ProcessLifecycleOwner` `ON_START`, and 30 s after a demotion.
- LAN calls: `connectTimeout`/`readTimeout` = 10 s for bodiless requests, 60 s once a body is
  attached. On `IOException` from a LAN call: demote, then replay over the public host **only**
  under the rule in §1.6.
- Caveats that iOS does not have: Android "Private DNS" (DoT) and some resolvers with DNS-rebinding
  protection refuse to return private addresses for public names. In that case the probe simply
  fails and the app stays on the public host, which is the correct fallback. Do not add a
  hard-coded IP.
- If time is short, ship without it and keep the interceptor seam. Everything still works over the
  public host.

### 1.3 Authentication

**Session = a NextAuth (Auth.js) JWT sent as a cookie header.** There is no bearer token and no
refresh endpoint.

1. `POST /api/auth/app-login` `{email, password}` (details in §2.1) →
   `{ok:true, token, cookieName, expiresInSeconds, user:{id,name,email,avatar}}`.
   `/api/auth/passkey/login/verify` returns **the same payload**.
2. Persist `Session {token, cookieName, userId, userName, userEmail}` (`Keychain.swift:52-62`,
   stored as one JSON blob, accessible after first unlock). On Android, use Keystore-backed
   encrypted storage (EncryptedSharedPreferences, or DataStore + Tink). It must **not** go into an
   Auto Backup set.
3. Send it on every authenticated request as **`Cookie: <cookieName>=<token>`**
   (`Keychain.swift:61`, `APIClient.swift:149-155`). Build the header yourself. Do **not** use an
   OkHttp `CookieJar`: the cookie name is `__Secure-authjs.session-token` in production, and a cookie
   jar would apply domain and "secure prefix" rules that can quietly drop it. The token does not
   depend on the host. The server validates it with `AUTH_SECRET`, using the **cookie name as the
   salt**, so the same header works on both the public and the LAN host. Always use the
   `cookieName` the server returned. Never hard-code it.
4. Lifetime: `expiresInSeconds` = 2 592 000 (30 days, `app-login/route.ts:12`). There is no refresh
   call. When it expires, requests start answering 401.
5. **401 handling.** Any `401` from an authenticated call → `unauthorized` → the screen calls
   `logout()` (e.g. `Views/AttendanceView.swift:756`). Exceptions:
   - A form submit that gets 401 shows "log in again" and does **not** log out, because that would
     throw away the form the person just filled in (`FormFillAPI.swift:93-97`).
   - The attendance queue stops draining on 401 and keeps its entries (`AttendanceQueue.swift:216-218`).
6. **Logout** (`AuthStore.swift:83-108`), in this order:
   `DELETE /api/push/devices {token}`, sent with the **old** cookie explicitly
   (`APIClient.swift:1633-1641`) → delete the stored session → clear the response cache → delete
   offline files → end the live activity/ongoing notification → clear the GIDEON transcript →
   **delete the offline attendance queue**, selfies included (otherwise it would be replayed under
   the next person's cookie) → stop location tracking. Everything in this list must go, because the
   phone may be handed to someone else.
7. Passkeys: see §2.1. **🛠 SERVER CHANGE REQUIRED:** the server must accept the Android origin and
   serve `assetlinks.json`.

### 1.4 Required request headers

| Header | Value | Notes |
|---|---|---|
| `Accept` | `application/json` | every request (`APIClient.swift:140`) |
| `X-Nexus-Client` | **`android/<versionName>/<versionCode>`**, e.g. `android/0.1.0/1` | every request, **including unauthenticated ones** and image/file downloads. iOS sends `ios/<CFBundleShortVersionString>/<CFBundleVersion>` (`APIClient.swift:2406-2411`, set at `:148`). |
| `Cookie` | `<cookieName>=<token>` | authenticated calls only, and only to the two NEXUS hosts |
| `Content-Type` | `application/json`, `multipart/form-data; boundary=…`, or `application/octet-stream` (chunks) | per endpoint |
| `User-Agent` | anything that does **not** start with `NEXUS/<digits>` | Recommended: `NEXUS-Android/<versionName> (<versionCode>; Android <sdk>)`. `NEXUS/<build>` is how the server recognises iOS builds older than 0.1.6 (`client-version.ts` `parseLegacyIosUserAgent`). Copying it would get Android judged by the table of iOS builds. |

**How the server reads `X-Nexus-Client`** (`src/lib/client-version.ts`):

```
TAG_RE = /^([a-z][a-z0-9_-]*)\/(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[^/\s]*)(?:\/([^/\s]+))?/i
```

`android/0.1.0/1` already parses today as `{platform:"android", version:[0,1,0], build:"1"}`.
The **parser** accepts it. The problem is that **no code that uses the result knows about `android`**:

| Consumer | Today | What happens to `android/…` | Needed |
|---|---|---|---|
| `middleware.ts` matcher | matches only `x-nexus-client: [iI][oO][sS]/.*` (and the legacy UA) | the gate middleware never runs → **never 426** | add the same two matchers for `[aA][nN][dD][rR][oO][iI][dD]/.*` |
| `version-policy.ts` `iosUpgradeGate` | `if (client.platform !== "ios") return null` | never gated | an Android branch against an **Android** minimum (its own floor env + release rows) |
| `attendance/requests/route.ts` `clientCanObeyRequestPolicy` | `web` → true; anything not `ios` → **false** | Android is treated like iOS ≤ 0.1.5 (looser rules: multi-day ranges allowed, izin without lat/lng accepted) | `android` → `true` (every Android build is born able to send one date + a position) |
| `app-login` audit | `metadata.nativeApp: "ios"` hard-coded | Android logins are audited as iOS | read the platform from the tag |
| `/api/app/version-policy`, `/api/app/latest` | iOS App Store only | wrong store URL/versions | platform-aware contract (§2.6 version policy) |

**🛠 SERVER CHANGE REQUIRED:** teach the server `android` in all five places, **and** add an Android
profile to the compatibility harness (`scripts/compat/fixtures.mjs` + `runner.mjs` — `gateBlocks`
and `baseHeaders` key on `profile.style === "ios"` today). Keep the harness's rule for unknown
callers: a tag the server cannot read falls to the **looser** side.

Version strings: always send a three-part `versionName` (`x.y.z`). The iOS branch rejects tags
without three parts, and the Android branch should do the same.

### 1.5 Timeouts

| Call | Timeout | iOS |
|---|---|---|
| Default (all API calls, uploads, downloads) | 60 s (URLRequest default, an inactivity timeout) | `APIClient.swift:369` |
| Any request aimed at the LAN host without a body | 10 s | `Config.swift:30` |
| LAN probe | 300 ms | `LANRoute.swift:29` |
| `GET /api/app/version-policy` | 8 s | `AppVersionGate.swift:267` |
| GIDEON `POST /api/gideon` (SSE) | 180 s | `Gideon.swift:222` (`request.timeoutInterval = 180`) |

On OkHttp, map "inactivity" to `readTimeout`/`writeTimeout`, not `callTimeout`: a 140 MB upload that
keeps moving must never be cut off.

### 1.6 Retries: what may be sent twice (`isReplayable`)

The only automatic retry in the client is the silent LAN → public replay (§1.2)
(`APIClient.swift:379-391`):

- `GET`/`HEAD`: always replayable.
- Anything else, **only if the error proves the body never reached the server**: cannot find
  host, cannot connect, DNS lookup failed, not connected, TLS handshake failed. OkHttp equivalents:
  `UnknownHostException`, `ConnectException`, `NoRouteToHostException`, `SSLHandshakeException`
  raised **before** the request was written.
- **Never** after a timeout or a dropped connection (`SocketTimeoutException`,
  `IOException: unexpected end of stream`, …). The server may already have acted: a second
  check-in, a second chat message, a second form submission (which also creates a task, runs
  automations and fires webhooks).
- Cancellation is never retried.
- Turn **off** OkHttp's `retryOnConnectionFailure` for non-idempotent requests, or rely only on the
  rule above. Its default silently retries some POSTs.

Attendance writes have their own durable retry: the offline queue with an idempotency key (§2.2).
Nothing else is queued.

### 1.7 Error shape and how the app maps it

Every route that refuses on purpose answers JSON: **`{ error: string, code?: string, …extra }`**.
The `error` text is written for the person reading it, often in Indonesian ("Jatah cuti tahunan
2026 nggak cukup…"). **Show it word for word** (`APIClient.swift:20-26, 49-58`). Useful variants:

- `{ error: "Validation failed", details: { field: string[] } }` (zod). Show the first message of
  the first field in on-screen order. For sign-up and reset, iOS uses the order name, email,
  password, code (`APIClient.swift:563-570`). Some routes already put the first message in `error`
  (e.g. PATCH `/api/attendance/requests/[id]`).
- `{ error, code }`. Codes the UI acts on: `UPGRADE_REQUIRED`, `OUTSIDE_RADIUS`, `PENDING_CHECKOUT`,
  `REFLECTION_REQUIRED`, `REFLECTION_REPETITIVE`, `SINGLE_DAY_ONLY`, `PERMIT_NOT_DAYOFF`,
  `PERMIT_NOT_FORGOT_CHECKIN`, `PERMIT_BACKDATED`, `DOCUMENT_TYPE`, `LEAVE_NOT_ELIGIBLE`,
  `LEAVE_QUOTA_EXCEEDED`, `SELF_REVIEW`, `SELF_ONLY` (reports), … (see each endpoint).
- `serverMessage` reads `error`, falling back to `message` (`APIClient.swift:2450-2460`).
- `429` from the rate limiter: `{error:"Too many requests. Please try again later."}` +
  `Retry-After: <s>` + `X-RateLimit-Reset`. Routes wrapped in `apiHandler` default to 60 requests
  per 60 s **per user per path** (`src/lib/rate-limit.ts`, `api-handler.ts`). Sign-up and reset
  answer 429 with `retryAfterSeconds` in the body. Change-email uses `resendInSeconds`. Count down,
  and don't invite another tap.

Client-side classification (the Android error type should keep these as separate cases,
`APIClient.swift:19-108`):

| Case | When | UI |
|---|---|---|
| `Http(status, message?)` | any non-2xx with or without a sentence | the sentence. With no sentence and an edge-only status (502–504, 520–527, 530), the calm "Can't reach NEXUS right now…" line; otherwise "Server error (N)." |
| `Unauthorized` | 401 | log out (§1.3) |
| `Decoding` | 2xx that does not decode | "Couldn't read data from the server." |
| `Transport(msg)` | no response at all (DNS, TLS, timeout) | "Can't reach NEXUS right now. Check your connection, or try again in a moment." (a cancellation keeps its own text) |
| `Offline` | **attendance only**: no response, *or* a status that means the origin never decided (see below) | queue the tap |
| `UpgradeRequired(msg)` | 426 + `code:"UPGRADE_REQUIRED"` | lock screen (§1.8) |

"Nobody answered" (`nobodyAnswered`, `APIClient.swift:101-107`) = `Transport`/`Offline`, or an
edge-only status **without** a sentence. For **reads**, this is the only situation where a cached copy
(§1.11) is shown in place of an error.

"Origin unreachable" (`meansOriginUnreachable`, `APIClient.swift:2438-2444`) = **500, 502, 503, 504,
520–527, 530**. It is used **only** by check-in/check-out to decide whether a tap can be queued.
It is a list on purpose, not `>= 500`: 501/505 mean the request itself was unacceptable.
Everything else (400, 409, 422, …) is the server's opinion and must **never** be queued.

### 1.8 `426 UPGRADE_REQUIRED` (forced update)

Body (`src/lib/version-policy.ts`):

```ts
{ error: string, code: "UPGRADE_REQUIRED", minSupported: "x.y.z", storeUrl: string }
```

- Today it is sent only to `ios/…` tags below the iOS minimum, on **every** `/api/*` except
  `/api/app/version-policy` and `/api/health`, and only for bodies with `Content-Length` of at most
  7 digits or no body. Larger or chunked uploads pass ungated, and the next ordinary call is refused
  anyway. It goes to iOS ≤ 0.1.5 (no header, UA `NEXUS/<build>`) only on attendance writes.
  Android is never gated until the server change in §1.4.
- Recognise it **only** when status == 426 **and** `code == "UPGRADE_REQUIRED"`. A bare 426 from a
  proxy is an ordinary error (`APIClient.swift:2421-2431`).
- Handle it in the transport layer, once, for every request, uploads and downloads included (a
  download that got a 426 deletes the partial file) (`APIClient.swift:261-279`).
- It is **not** "offline": nothing shows a cache as if the server were away, and nothing queues
  a tap to replay. A live check-in/out that gets 426 is saved to the queue **and** the queue is
  marked *held for update*. It is replayed by the updated build under its original tap time and id
  (`Views/AttendanceView.swift:779-800`, `AttendanceQueue.swift:71-102, 137-143, 219-225`).
- Lock state is **persisted** (`AppVersionGate.swift:79-130`): `minSupported` + the version that
  was locked. It is lifted only by running a version ≥ `minSupported` (or, if no floor was named, any
  version newer than the one that was locked), or by a successful policy fetch that returns a lower
  floor. A failed fetch never raises the lock and never lifts it.
- Policy check: `GET /api/app/version-policy` (unauthenticated, 8 s timeout) at launch/sign-in with
  force, then on foreground at most every 30 min (`AppVersionGate.swift:95, 185-219`). Response
  `{minSupported, latest, storeUrl, graceUntil?, nextMinimum?}`. `latest > mine` → soft "update
  available". `mine < nextMinimum` and now < `graceUntil` → warning shown at most once per office day
  (Asia/Jakarta). `mine < minSupported` → lock. Versions are compared **numerically per component**
  (`0.1.10 > 0.1.9`), missing parts count as 0 (`AppVersionGate.swift:28-42`).
- Android: the lock screen opens the Play Store (`market://details?id=<applicationId>`, falling back
  to https). **🛠 SERVER CHANGE REQUIRED:** a platform-aware policy (§2.6, §4).

### 1.9 Cloudflare down-worker (`NEXUS_DOWN`)

A Cloudflare Worker on `nexus.znetworks.id/*` (`maintenance/nexus-down-worker.js`) passes every
request through. Only when the origin is unreachable (502, 503 from Cloudflare, 504, 520–527,
530) does it replace the response. For `/api/…` requests it returns
`{"error":"NEXUS is down","code":"NEXUS_DOWN","down":true}` with the **original status** (usually
530) and the header `x-nexus-down: 1`. A 503 that came from the origin itself (not from Cloudflare)
is passed through untouched.

- Treat it as the edge speaking, not the app: `serverMessage` returns **nil** for
  `code == "NEXUS_DOWN"` or `down == true` (`APIClient.swift:2455-2457`). The status then decides:
  edge-only → "can't reach NEXUS", attendance → `Offline` → queue.
- The LAN host does not go through Cloudflare and never produces this body.

### 1.10 Uploads and chunked uploads

| Limit | Value | Where |
|---|---|---|
| Cloudflare request-body wall | ~100 MB. A 120 MB POST is cut at the edge with 502 after ~2 MB; 95 MB goes through | `APIClient.swift:1840-1848` |
| Single-request ceiling (client) | **64 MiB** (`64 << 20`) | `APIClient.swift:1857` |
| Chunk size | **16 MiB** (`16 << 20`) | `APIClient.swift:1861` |
| Avatar / folder icon | 5 MiB (`iconByteLimit`) | `APIClient.swift:1787` |
| Attendance selfie | ≤ 10 MB (server) | `check-in/route.ts` `MAX_SELFIE_SIZE` |
| Request attachment | ≤ 10 MB (server) | `requests/route.ts` |
| Feed post | ≤ 4 images, 8 MB each | `APIClient.swift:1177-1178` |

Destinations **with** a chunk route (task attachments, Z Vault) take anything above 64 MiB through
**`POST /api/attachments/chunk`** (`APIClient.swift:1921-1964`). Metadata goes in the query string
and the chunk is the **raw body** (`Content-Type: application/octet-stream`, not multipart):

```
POST /api/attachments/chunk?uploadId=<uuid>&chunkIndex=<0..n-1>&totalChunks=<n>&totalSize=<bytes>
     &filename=<urlencoded name>&taskId=<id>                  ← task attachment
     &filename=<…>&target=vault[&parentId=<folderId>]          ← Z Vault
```

Chunks are sent sequentially, each as an ordinary request (LAN route and replay rule included).
Read each slice from disk at its offset; never hold the whole file in memory. Leave out `mime`: the
server derives it from the filename. Any refusal carries `{error}`. Show it. The server's own
limits (max chunks, max size, finalize) are in §2.4 Attachments. Destinations **without** a chunk
route (form submit, chat photo, ticket evidence, icons, selfies) must refuse a file over their
ceiling **before** reading it, with a sentence ("This file is too big to upload here. (140.2 MB → max
64.0 MB)", `APIClient.swift:1819-1821`).

Multipart conventions the server relies on:
- Text parts have **no** `Content-Type` (like a browser's `FormData.append(name, string)`).
- File parts: `Content-Disposition: form-data; name="<part>"; filename="<name>"` + a `Content-Type`.
  iOS sends `image/jpeg` for selfies, feed images and ticket evidence, and
  `application/octet-stream` for request attachments, task attachments, folder icons and vault
  files. The request route falls back to the file extension when the type is octet-stream. Android
  should send the real MIME type.
- Strip `"`, CR and LF from filenames (`FormFillAPI.swift:155-159`, `VaultAPI.swift:242-246`).
- Repeated part names are meaningful (`images`, `evidence`, `file:<fieldId>`). Build bodies with a
  list, not a map.

### 1.11 Response cache and offline behaviour

`ResponseCache` (`ResponseCache.swift`) stores the **raw bytes** of the last response that decoded
cleanly, one file per key under `Caches/responses/`. Entries over 8 MB are not stored.
`load(key)` also returns the save time, so the UI can say "Showing data from 5 minutes ago"
(`OfflineSync.swift:75-82`). The **whole** cache is wiped on logout.

| Key | Endpoint | iOS |
|---|---|---|
| `projects` | `GET /api/projects` | `APIClient.swift:657` |
| `project-<id>` | `GET /api/projects/<id>` | `:661` |
| `project-tasks-<projectId>` | `GET /api/tasks?projectId=` | `:667` |
| `task-<id>` | `GET /api/tasks/<id>` | `:845` |
| `task-attachments-<taskId>` | `GET /api/attachments?taskId=` | `:1837` |
| `tasks-<assigneeId>` | `GET /api/tasks?assigneeId=` (per user, so two people on one phone never see each other's list) | `:918` |
| `profile` | `GET /api/user/profile` | `:897` |
| `gamification` | `GET /api/gamification/me` | `:901` |
| `leaderboard` | `GET /api/gamification/leaderboard` | `:927` |
| `my-submissions` | `GET /api/forms/my-submissions` | `:949` |
| `reports-<days>` | `GET /api/reports?days=` | `:961` |
| `conversations` | `GET /api/conversations` | `:1569` |
| `messages-<conversationId>` | `GET /api/conversations/<id>/messages` | `:1575` |
| `audit-first-page` | `GET /api/audit` (unfiltered first page only) | `:1429` |
| `attendance-today` | `GET /api/attendance/today` | `:2069` |
| `attendance-history-<scope>-<MonthKey>` | `GET /api/attendance/history?scope=&month=` | `:2082` |
| `attendance-requests-<scope>` | `GET /api/attendance/requests?scope=` | `:2093` |
| `report-person-<userId>-<period\|current>` | `GET /api/reports/people/<userId>` | `ReportsPeopleModels.swift:411` |
| `report-roster-<period\|current>-<teamId\|all>` | `GET /api/reports/people` | `ReportsPeopleModels.swift:485` |

Screens read the cache first, then refresh. A read that fails with "nobody answered" keeps showing
the cached copy with its age. A read that the server refused (4xx/5xx with a sentence) shows the
error.

**Prefetch** (`OfflineSync.swift`), after sign-in and in background refresh:
1. *Data* (blocks the splash): today's attendance → my tasks → projects → profile + gamification →
   history(me, month) + requests(me), plus history(workspace, month) if `canManageAttendance` and
   requests(workspace) if `canReviewAttendanceRequests` → my submissions (`:88-135`).
2. *Behind the app*: every project's detail + tasks (`:231-240`).
3. *Media*, only on unmetered networks unless the user allows mobile data: this period's check-in and
   check-out selfies, then task attachments ≤ 40 MB for up to 80 tasks per project
   (`:139-208`), into an offline file store with a 1 GB budget, evicted least-recently-used
   (`APIClient.swift:2528`). Files opened casually live in a separate cache (24 h, 512 MB).

Android: WorkManager (`NetworkType.CONNECTED` for data, `UNMETERED` for media) +
`ProcessLifecycleOwner` for foreground triggers. Keep the files in `cacheDir` / `noBackupFilesDir`
and delete them on logout. **The offline attendance queue is not a cache**: keep it in `filesDir`
(`noBackupFilesDir`), because an OS cache purge must never delete a check-in.

⚠ Discrepancy (iOS bug, not server): `OfflineSync.monthKey()` uses the **calendar** month. The
server's attendance period runs from the 28th to the 27th (`attendancePeriodRange`: `"2026-10"` =
28 Sep–27 Oct). On the 28th–31st the current period is next month's key (`attendancePeriodKey`).
Android should compute the period key with the cut-off.

### 1.12 Realtime

The iOS app **does not use the Socket.IO realtime channel** (`Views/MessagesView.swift:483`: an open
thread polls). The web uses `pages/api/socket.ts` (Engine.IO path `/api/socket`, JWT from the
cookie; rooms `project:{id}`, `conversation:{id}`, `user:{id}`; events `task-*`, `comment-added`,
`message-created`, `notification`, …). For parity with iOS, Android v1 may poll too. Push (§3)
carries the urgent events.
---

## 2. Endpoint catalogue

The format of each entry: **Auth** (session = the `Cookie` header from §1.3; roles are listed only
where the server enforces them), **iOS** (the call site at `a875c3c`, plus the §1.11 cache key when
there is one), **Request**, **Response** (a compact TypeScript-style type; the iOS decoders treat
almost everything as optional), **Errors** the UI must handle, and **Notes**. Entries marked
*web-only* are not called by iOS. They are listed because they matter for parity with the web.

## 2.1 Auth & account

Session model, in one paragraph: the server issues a NextAuth v5 **JWE session token** (not a refresh/access pair). The client stores `{token, cookieName, userId, userName, userEmail}` (iOS: Keychain item `service=id.znetworks.nexus, account=nexus.session`, `Keychain.swift:52-61`; Android: EncryptedSharedPreferences / Keystore-backed DataStore) and sends `Cookie: <cookieName>=<token>` on **every** request (`APIClient.swift:149-155`). `cookieName` is whatever the server returned. In production it is always `__Secure-authjs.session-token` (`src/lib/session-cookie.ts`: `__Secure-` prefix when `NODE_ENV=production` or the auth URL is https). The token is encrypted with `AUTH_SECRET` and salted with the **cookie name**, never the Host header. The same token therefore works on `nexus.znetworks.id` and on the LAN host, and it **must be sent under exactly the returned name**.
- **Lifetime:** `maxAge` is 30 days from issue (`expiresInSeconds: 2592000`). Nothing in the app flow rolls the token or refreshes it: it expires 30 days after login, then every call returns 401. When that happens, clear the session and send the user to the login screen. The server's `jwt` callback re-reads the user row on every request (`src/lib/auth.ts:55-88`). Name, email and avatar changes show up without a new login. A **deleted** account (anonymised email) makes `auth()` return signed-out, so the next call is 401.
- **Revocation:** there is none for issued tokens. `/api/user/sessions` lists `UserSession` rows, but JWT validation never consults that table. A password reset or change also leaves existing tokens valid.
- **Cookie jar:** turn OkHttp's `CookieJar` off (`CookieJar.NO_COOKIES`). `passkey/login/verify` also answers with `Set-Cookie`. Every other route may still emit NextAuth cookies. The header you build yourself must be the only session source.
- **401 handling:** iOS treats any 401 from `run`-style calls as `APIError.unauthorized` → `AuthStore.logout()` (`AuthStore.swift:83-108`). Logout unregisters the push token (DELETE `/api/push/devices` with the old cookie), clears the Keychain, the response cache, the offline files, the Live Activity, the GIDEON transcript, the **attendance queue**, and location tracking. Exception: the form submit 401 does *not* log out (`FormFillAPI.swift:93-97`).

#### `POST /api/auth/app-login`
- **Auth:** none. **iOS:** `APIClient.swift:464` `login(email:password:)` → `AuthStore.swift:23` `persist`.
- **Request:** JSON `{ email: string, password: string }`. The server canonicalises the email (trim/lowercase) and also retries the password with a "mobile-normalised" variant (smart quotes etc., `normalizePasswordForMobileInput`).
- **Response 200:** `{ ok: true, token: string, cookieName: string, expiresInSeconds: 2592000, user: { id: string, name: string|null, email: string, avatar: string|null } }` + `Cache-Control: no-store`.
- **Errors:** 401 `{ ok:false, error:"CredentialsSignin" }` → "wrong email/password" (iOS shows `T("Login failed…")` fallback). The 401 here is **not** a session expiry, so do not route it through the global 401→logout handler. 500 `{ok:false,error:"Configuration"}`.
- **Notes:** there is no rate limit on this route. The audit row is written with `metadata: { provider:"credentials", nativeApp:"ios" }`, hard-coded (`app-login/route.ts:61`). Control Room's "App" column reads it. ⚠ **SERVER CHANGE REQUIRED:** derive `nativeApp` from `X-Nexus-Client` (`android`), otherwise every Android login is logged as iOS.

#### `POST /api/auth/register` (sign-up step 1: send code)
- **Auth:** none. **iOS:** `APIClient.swift:480` `registerStart` (via `runSignup`, `:540`).
- **Request:** JSON `{ name: string(1–100), email: string(email), password: string(8–128), workspaceCode?: string }`. The server strips spaces and dashes from `workspaceCode` and uppercases it. iOS omits the key when it is empty.
- **Response 200:** `{ ok: true, email: string /*canonical — use this for later calls*/, expiresInSeconds: 600, resendCooldownSeconds: 60, verificationId: string }`.
- **Errors:** 400 `{error:"Validation failed", details:{name?:[],email?:[],password?:[]}}`: show the first message in field order name→email→password→code (`APIClient.swift:563-570`). 400 `"That workspace code is not valid."`. 409 "This email already has a NEXUS account — … Use Forgot password…" (invited users): offer the reset flow. 429 has two shapes: `{error, retryAfterSeconds}` in the body (pending code still cooling down), or `{error:"Too many requests…"}` + header `Retry-After: <s>` (IP limit 5/15 min, per-email limit 3/15 min). Count the wait down. 503 "Verification email could not be delivered…" is **the app answering**, not the edge, so show the text.

#### `POST /api/auth/register/verify` (sign-up step 2: create account)
- **Auth:** none. **iOS:** `APIClient.swift:490` `registerVerify`. After it succeeds, the client calls `app-login` with the same email and password. Verify does not sign the user in.
- **Request:** JSON `{ email: string, code: string /^\d{6}$/, workspaceCode?: string }`. **`workspaceCode` must be sent again here**: `/register` only validates the code, and `/verify` is the call that acts on it.
- **Response 201:** the created `User` row without `password` (ignore it).
- **Semantics:** with a valid code the user joins that workspace as `STAFF`. Without one, they get a new personal workspace (`"<name>'s workspace"`, role `ONE_ABOVE_ALL`). There is no "no workspace" state.
- **Errors:** 400 `{error:"Verification code is incorrect.", attemptsRemaining:n}`. 429 when attempts are exhausted (5 max, no retry-after, so tell the user to request a new code). 404 no pending sign-up. 410 code expired. 409 already exists. 400 invalid workspace code. 429 rate limits (10/15 min).

#### `POST /api/auth/register/resend`
- **Auth:** none. **iOS:** `APIClient.swift:499` `registerResend`.
- **Request:** `{ email }`. **Response 200:** same shape as `/register` minus `verificationId`.
- **Errors:** 429 `{error, retryAfterSeconds}` (cooldown) or `Retry-After` header. 404 no pending registration. 409 user exists. 503 email failed.

#### `POST /api/auth/password/reset/request`
- **Auth:** none. **iOS:** `APIClient.swift:514` `passwordResetRequest`.
- **Request:** `{ email }`. **Response 200 always:** `{ ok:true, email, expiresInSeconds:600, resendCooldownSeconds }`. The shape is the same whether or not the account exists, so the endpoint can't be used to probe for accounts. While a code is still cooling down it answers 200 **without sending**, and `resendCooldownSeconds` then holds the remaining wait.
- **Errors:** 400 validation. 429 IP/email rate limit (`Retry-After`).
- **Notes:** the invite email's "set your password" link is `/forgot-password?email=…&invited=1`. iOS routes that link to this screen (`AppRouter.swift:290-300`). Android should register the same link.

#### `POST /api/auth/password/reset/verify`
- **Auth:** none. **iOS:** `APIClient.swift:520`.
- **Request:** `{ email, code: /^\d{6}$/, password: string(8–128) }`. **Response 200:** `{ ok:true }`. The password is set and the user then signs in normally.
- **Errors:** 400 wrong code (+`attemptsRemaining`). 429 attempts exhausted or rate limited. 404 no active session / "No operative account". 410 expired.

#### `POST /api/auth/password/reset/resend`
- **Auth:** none. **iOS:** `APIClient.swift:529`.
- **Request:** `{ email }`. **Response 200:** `{ ok, email, expiresInSeconds, resendCooldownSeconds }`.
- **Errors:** unlike `/request`, a cooldown here is **429 `{error, retryAfterSeconds}`**.

#### `POST /api/user/email/request` (change sign-in email, step 1)
- **Auth:** session. **iOS:** `Views/ChangeEmailSheet.swift:32` `requestEmailChange` (the helper is at `:44`).
- **Request:** `{ email: string }` (the NEW address). **Response 200:** `{ ok:true, resendInSeconds:number }`. The code is sent to the new address.
- **Errors:** 400 invalid email / "Itu email kamu yang sekarang." · 409 taken · 429 `{error, resendInSeconds}` (per-address cooldown) or `Retry-After` (IP 5/15 min, per-address 5/15 min) · 500 `"Gagal ngirim email…"` (this carries an app sentence, so show it and do **not** treat it as offline).

#### `POST /api/user/email/verify` (step 2)
- **Auth:** session. **iOS:** `Views/ChangeEmailSheet.swift:38` `verifyEmailChange`.
- **Request:** `{ email, code }`. **Response 200:** `{ ok:true, email:string /*canonical*/ }`. Write this email into the stored session (`AuthStore.updateEmail`, `AuthStore.swift:75`). The token stays valid.
- **Errors:** 400 invalid/wrong code · 403 "Kode ini bukan buat akun kamu." · 404 no pending change · 410 expired · 429 too many wrong codes (5) or rate limit · 409 taken meanwhile.

#### `POST /api/user/account/delete`
- **Auth:** session. **iOS:** `APIClient.swift:584` `deleteOwnAccount` (the screen makes the user type DELETE first). Required for Play Store policy too.
- **Request:** `{ confirm: "DELETE" }` (the literal string). **Response 200:** `{ ok:true }`. Then run the full logout locally.
- **Semantics:** deactivates and anonymises, with no hard delete. Removed: identity, passkeys, push devices, memberships and approver edges. Kept: attendance, tasks, XP and messages, which show as "(Deleted account)". Tokens die on their next use.
- **Errors:** 400 missing confirm · 401 · 404 · 410 already deleted · 409 has two causes: the user is the only `ONE_ABOVE_ALL` of a workspace that others are still in (the message names the workspace), or the user is the last system ADMIN. Show the sentence.

#### `GET /api/user/profile`
- **Auth:** session. **iOS:** `APIClient.swift:896` `profile()` (cache key `profile`). This is also the LAN probe path (`LANRoute.swift:41`).
- **Response 200:** `{ user: { id, name, email, avatar: string|null /*"/api/files/avatars/<id>.<ext>?t=<ms>"*/, phoneNumber: string|null, dndUntil: string|null, onboardedAt: string|null, googleWorkspaceEmail: string|null } }`.
- **Errors:** 401 · 404.

#### `PATCH /api/user/profile`
- **Auth:** session. **iOS:** `APIClient.swift:1560` `updateProfile(name:)` sends `{name}` only.
- **Request (all optional, at least one):** `{ name?: string, phoneNumber?: string|null /*Indonesian WA number, normalised to +62…; ""/null clears*/, dndUntil?: ISO|null, markOnboarded?: true }`.
- **Response 200:** `{ user: <same as GET> }`. **Errors:** 400 "No valid fields to update" / invalid phone.

#### `PATCH /api/user/password` (also accepts `POST`)
- **Auth:** session. **iOS:** `APIClient.swift:1140` `changePassword`.
- **Request:** `{ currentPassword: string, newPassword: string(≥8) }`. **Response 200:** `{ success:true, message }`.
- **Errors (all 400 with sentence):** missing fields · new < 8 chars · "Password login not configured for this account" · "Current password is incorrect". Existing tokens stay valid.

#### `POST /api/upload/avatar`
- **Auth:** session. **iOS:** `APIClient.swift:744` `uploadAvatar(fileName:mime:data:)`.
- **Request:** `multipart/form-data`, one part `file` (filename any). **The part's `Content-Type` must be `image/png`, `image/jpeg` or `image/webp`.** The server checks `file.type`, not the extension. Maximum size is 5 MB. iOS caps icons at `iconByteLimit = 5<<20` before reading (`APIClient.swift:1787`).
- **Response 200:** `{ user: { id, name, email, avatar }, url: string }`. `avatar` carries `?t=<ms>` as a cache-buster, so use it verbatim as the image cache key.
- **Errors:** 400 "No file provided" / "Invalid file type. Allowed: PNG, JPG, WEBP" / "File too large. Maximum size is 5MB".

#### `DELETE /api/upload/avatar`
- **Auth:** session. **iOS:** `APIClient.swift:792` `deleteAvatar`. **Response 200:** `{ user: { id, name, email, avatar: null } }`. The avatar is removed and the UI falls back to initials.

#### `GET /api/user/sessions` · `DELETE /api/user/sessions` · `DELETE /api/user/sessions/{sessionId}` (web only)
- These are not used by iOS. They list and revoke `UserSession` rows, which do **not** gate the JWT (see above). Skip them on Android.

### Passkeys (WebAuthn)
Server: `@simplewebauthn/server`, `src/lib/passkey.ts`: `RP_ID = env PASSKEY_RP_ID ?? "nexus.znetworks.id"`, **`EXPECTED_ORIGINS = [env PASSKEY_ORIGIN ?? "https://nexus.znetworks.id"]`**. Challenges are stored server-side with a 10-minute TTL. Each is single-use, looked up by the **exact challenge string** the options call returned, and bound to a purpose (`register`/`login`). Register challenges are also bound to the user.

⚠ **SERVER CHANGE REQUIRED (Android passkeys cannot work today):**
1. Credential Manager puts `origin: "android:apk-key-hash:<base64url(SHA-256 of the signing cert)>"` in `clientDataJSON`. `EXPECTED_ORIGINS` accepts only `https://nexus.znetworks.id`, so both `verifyRegistrationResponse` and `verifyAuthenticationResponse` throw. The user sees 400 "Could not verify that passkey" or 401 CredentialsSignin. The fix is to add the release (and debug, if wanted) `android:apk-key-hash:…` origins to `EXPECTED_ORIGINS`, e.g. a comma-separated `PASSKEY_ANDROID_ORIGINS` env. `rpID` stays `nexus.znetworks.id`.
2. Credential Manager requires Digital Asset Links at `https://nexus.znetworks.id/.well-known/assetlinks.json` with `delegate_permission/common.get_login_creds` (and `handle_all_urls` if app links for `/f/*`, `/v/*` are wanted) for package + SHA-256. **Nothing serves it today.** `~/nexus/public/.well-known` does not exist. `apps/web/public/.well-known/` holds only `apple-app-site-association`. In `maintenance/phaethon.conf`, nginx has `location = /.well-known/apple-app-site-association { try_files … }` followed by `location /.well-known/ { return 404; }`. So the fix needs the file in the SPA's `public/.well-known/` **plus** an explicit `location = /.well-known/assetlinks.json { default_type application/json; try_files $uri =404; }` before the catch-all 404. `scripts/deploy-phaethon.sh` protects `.well-known` (`LINDUNGI=".well-known"`), so check that the deploy copies the new file.

#### `GET /api/auth/passkey`
- **Auth:** session. **iOS:** `APIClient.swift:642` `passkeyList`.
- **Response 200:** `{ passkeys: { id: string, label: string|null, createdAt: ISO, lastUsedAt: ISO|null }[] }` (newest first).

#### `DELETE /api/auth/passkey/{passkeyId}`
- **Auth:** session. **iOS:** `APIClient.swift:651` `passkeyRevoke(id:)`.
- **Response 200:** `{ ok:true }`. **404** `{error:"Not found"}` means it is already gone. Treat that as success and refresh the list. The route only ever touches the caller's own credentials.

#### `POST /api/auth/passkey/register/options`
- **Auth:** session. **iOS:** `APIClient.swift:602`. Send the body `{}` (not empty). The iOS comment says a zero-length body 500s on routes that parse JSON. This route doesn't parse, but keep `{}`.
- **Response 200:** the standard `PublicKeyCredentialCreationOptionsJSON`: `{ challenge: b64url, rp:{name:"NEXUS", id:"nexus.znetworks.id"}, user:{ id: b64url(utf8 userId), name: email, displayName }, pubKeyCredParams, timeout, attestation:"none", excludeCredentials:[{id,type,transports}], authenticatorSelection:{ residentKey:"preferred", userVerification:"preferred" }, extensions? }`. Pass it **verbatim** as `requestJson` to `CreatePublicKeyCredentialRequest` on Android.

#### `POST /api/auth/passkey/register/verify`
- **Auth:** session. **iOS:** `APIClient.swift:614` `passkeyRegisterVerify`. The payload is built at `Passkeys.swift:219-246`.
- **Request:** `{ credential: RegistrationResponseJSON, challenge: string /*verbatim from options*/, label?: string /*≤60, device name*/ }`. The `credential` shape is `{ id: b64url, rawId: b64url, type:"public-key", authenticatorAttachment:"platform", clientExtensionResults:{}, response:{ clientDataJSON: b64url, attestationObject?: b64url /*omit rather than null*/ } }`. Android's `CreatePublicKeyCredentialResponse.registrationResponseJson` already has this shape and can be sent as-is (it may add `response.transports`/`publicKey*`, which the server tolerates).
- **Response 200:** `{ ok:true }`. **Errors:** 400 `"Malformed request"` / `"Challenge expired or not yours"` / `"Could not verify that passkey"` (this last one is what an origin mismatch produces).

#### `POST /api/auth/passkey/login/options`
- **Auth:** none. **iOS:** `APIClient.swift:625` (body `{}`).
- **Response 200:** `PublicKeyCredentialRequestOptionsJSON` `{ challenge, rpId:"nexus.znetworks.id", allowCredentials: [] /*discoverable*/, userVerification:"preferred", timeout }`. Pass it to `GetPublicKeyCredentialOption`.

#### `POST /api/auth/passkey/login/verify`
- **Auth:** none. **iOS:** `APIClient.swift:634` `passkeyLoginVerify`. The payload is built at `Passkeys.swift:264-293`.
- **Request:** `{ credential: AuthenticationResponseJSON, challenge }`. The `credential` shape is `{ id, rawId, type:"public-key", authenticatorAttachment:"platform", clientExtensionResults:{}, response:{ clientDataJSON, authenticatorData, signature, userHandle? } }`, all base64url. The server looks up the account by `credential.id`, **not** `userHandle`.
- **Response 200:** **identical to app-login** `{ ok, token, cookieName, expiresInSeconds, user }` (it also sets a `Set-Cookie`, which you should ignore). Store it through the same code path as a password login.
- **Errors:** 400 `{ok:false,error:"Malformed request"|"Challenge expired"}` · 401 `{ok:false,error:"CredentialsSignin"}` (unknown credential, bad signature, counter regression, **or a wrong origin**) · 500 Configuration. A user cancelling the system sheet is not an error, so leave the screen untouched (`AuthStore.swift:46`).

## 2.2 Attendance (staff-facing)

Office time is **Asia/Jakarta** throughout. An "attendance date" is the office-local date
(`getAttendanceDate()`), stored as `YYYY-MM-DDT00:00:00.000Z`. An attendance **period** (`MonthKey`)
runs from the **28th of the previous month to the 27th** (`attendancePeriodRange`), and is used by
the board, exports and the DAY_OFF quota. The RED_DATE quota uses the calendar month
(`attendanceMonthRange`).

Shared record type returned by check-in, check-out, `today` and history (`serializeAttendanceRecord`,
`src/lib/attendance.ts:1062-1134`):

```ts
type AttendanceRecord = {
  id: string; attendanceDate: string
  checkInAt: string|null; checkOutAt: string|null
  checkInStatus: "ON_TIME"|"LATE"|null; checkOutStatus: "ON_TIME"|"EARLY_LEAVE"|"OVERTIME"|null
  lateMinutes: number|null; earlyLeaveMinutes: number|null; workedMinutes: number|null
  shiftStartAt: string|null; shiftEndAt: string|null
  effectiveShiftSource: string; effectiveTeamId: string|null; effectiveTeamName: string|null
  effectiveShiftStartTime: HHmm; effectiveShiftEndTime: HHmm
  checkInLat, checkInLng, checkOutLat, checkOutLng: number|null
  checkInAddress, checkOutAddress: string|null            // reverse-geocoded server-side
  checkInPhotoUrl, checkOutPhotoUrl: string|null          // "/api/files/attendance/…" (cookie required)
  checkInDistanceMeters, checkOutDistanceMeters: number|null
  checkOutOffsite: boolean; checkOutApproval: "PENDING"|"APPROVED"|"REJECTED"|null
  checkOutReason: string|null; checkOutReflection: string|null; checkOutReflectionAt: string|null
  notes: string|null; status: "CHECKED_IN"|"COMPLETED"|"INCOMPLETE"
  correctedAt: string|null; correctionReason: string|null; isCorrected: boolean
  officeLocation: { id, name, address|null, latitude, longitude, radiusMeters, timezone,
                    workdays: number[], shiftStartTime, shiftEndTime, lateGraceMinutes,
                    earlyLeaveGraceMinutes, isActive }
  user: { id, name, email, avatar }
  correctedBy: { id, name, email } | null
}
```

iOS decodes only `id,status,checkInAt,checkOutAt,lateMinutes,checkOutApproval,officeLocation.name`
(`AttendanceModels.swift` `AttendanceRecord`).

#### `GET /api/attendance/today`
- **Auth:** session.
- **iOS:** `APIClient.swift:2068` `attendanceToday()`, cache `attendance-today`. Called on the
  Attendance screen, the dashboard, prefetch, reminders and background refresh.
- **Request:** none.
- **Response 200:**
  ```ts
  {
    attendanceDateKey: DateKey
    workspace: { id, name, slug }
    activeOfficeCount: number
    today: AttendanceRecord|null            // today's record
    pendingCheckout: AttendanceRecord|null  // an EARLIER day still CHECKED_IN → must check out first
    todayRequest: AttendanceRequest|null    // a request covering today (serializeAttendanceRequest)
    dayOffQuota: number                     // default 4
    dayOffUsedThisMonth: number             // capped at the quota, current PERIOD
    restDays: number[]                      // ISO weekday 1=Mon…7=Sun
    isRestDayToday: boolean
    redDateQuota: number; redDateUsedThisMonth: number   // calendar month
    myShift: { startTime: HHmm, endTime: HHmm, source: string, flexi?: boolean } | null
    noGeofence: boolean                     // "Mobile" members: no radius check anywhere
    canManageAttendance: boolean            // BoD / One Above All / admin
    canReviewAttendanceRequests: boolean    // also true for a manager with direct reports
    annualLeave: { eligible, reason|null, employmentStartDate|null, eligibleFrom|null,
                   year, quota: 12, used, remaining }
    viewerId: string                        // hide Approve/Reject on your own requests
  }
  ```
- **Errors:** 401; 404 `No workspace membership found`; 500.
- **Notes:** Drives the check-in/out buttons: `today.checkInAt == null` → Check in; checked in and
  no `checkOutAt` → Check out; `pendingCheckout != null` → the check-out closes that older day first.
  `todayRequest` / `isRestDayToday` → explain why no button is shown.

#### `POST /api/attendance/check-in`
- **Auth:** session.
- **iOS:** `APIClient.swift:2270` `checkIn(…)` → `attendanceUpload` `:2348-2400`. Live tap at
  `Views/AttendanceView.swift:730`, queue replay at `AttendanceQueue.swift:176`.
- **Request:** `multipart/form-data`:

  | Part | Type | Req | Notes |
  |---|---|---|---|
  | `selfie` | file, `filename="selfie.jpg"`, `Content-Type: image/jpeg` | **yes** | 1 B–10 MB. iOS: the liveness camera frame, JPEG quality 0.7 (`Views/LivenessCaptureView.swift:715`) |
  | `lat`, `lng` | decimal string | **yes** | `-90..90` / `-180..180`; `Number(x)` |
  | `notes` | string ≤ 500 | no | not sent by the live UI |
  | `accuracyM` | decimal string | no | horizontal accuracy (m). Android: `Location.accuracy` |
  | `altitudeM` | decimal string | no | only when the fix has one (`hasAltitude()`) |
  | `speedMps` | decimal string | no | sent by iOS, **ignored by the server** |
  | `simulated` | `"1"`/`"0"` | no | iOS `sourceInformation.isSimulatedBySoftware`. Android: `Location.isMock()` (API 31+) / `isFromMockProvider()` |
  | `fromAccessory` | `"1"`/`"0"` | no | iOS-only concept. Android: always `"0"`. **Ignored by the server** |
  | `clientId` | string (UUID) | no but **always send** | idempotency key = `checkInClientId` (unique). One per tap, reused on every retry of that tap |
  | `deviceAt` | ISO-8601 | **only on a queued replay** | the moment of the tap. Its presence marks the record `checkInOffline=true` |
  | `uptimeSec` | integer string | only on a replay | seconds since boot at the tap (`SystemClock.elapsedRealtime()/1000`) |

  Anti-spoof ("layer 2") is server-side and does not depend on the device being honest:
  `assessLocationIntegrity` compares the fix with the person's previous attendance point (implied
  speed > 900 km/h impossible, > 200 km/h suspicious, readings < 60 s apart skipped, identical
  coordinates to the last digit suspicious) and stores `checkInSuspect/Reason/ImpliedKmh`. It
  **never blocks** a check-in. The device signals above are "layer 1". Send them honestly and do
  not try to "fix" them on the phone.

  **Liveness:** the selfie comes from a client-side liveness check (iOS: Vision face landmarks,
  look straight → turn → turn the other way → blink, `Views/LivenessCaptureView.swift`, then
  `FaceGuard.check` rejects a photo with no face, `Views/AttendanceView.swift:706`). **No liveness
  evidence is sent to the server**: there are no fields for it, and it is not identity matching.
  Android should run an equivalent check (ML Kit Face Detection: head Euler Y for the turns,
  eye-open probability for the blink) and reject a faceless photo before taking a location fix.
- **Response:** `201 { record: AttendanceRecord }`. A replay of a `clientId` that was already
  stored → `200 { record, duplicate: true }`. This is checked **before** any validation, so a
  replay always succeeds.
- **Errors** (in the order the server checks them):

  | Status | Body | UI |
  |---|---|---|
  | 401 | | log out |
  | 404 | `No workspace membership found` | message |
  | 409 | `{error, code:"PENDING_CHECKOUT", pendingCheckout:{id, attendanceDate, checkInAt}}` | an earlier day is still open → offer check-out first (checked before the selfie is read) |
  | 400 | `Validation failed` + `details.lat/lng/notes` | message |
  | 400 | `Selfie photo is required.` / `…smaller than 10MB.` | message |
  | 400 | `No active office location configured…` / `No office location could be matched.` | message |
  | 422 | `{error, officeName, distanceMeters, radiusMeters}` (**no `code`**) | "You're 340 m from <office>, and check-in works within 150 m. Move closer and try again." There is **no offsite check-in** (`APIClient.swift:2394-2398`) |
  | 409 | `Attendance cannot be recorded because an approved <type> request already covers today.` | message |
  | 409 | `You have already checked in today.` | refresh `today` |
  | 426 | `UPGRADE_REQUIRED` | queue + hold (§1.8) |
  | 500 / edge | | **queue** (§2.2.1) |
- **Notes:** The nearest active office decides the radius, unless `noGeofence`. The server
  reverse-geocodes, applies the late XP penalty (–1 XP/min, max 120) and sets `checkInStatus`.
  A PENDING izin/sick request covering today holds the late penalty. The recorded time is the server
  clock for a live tap, or `deviceAt` for a replay if it is not in the future and not older than
  7 days.

#### `POST /api/attendance/check-out`
- **Auth:** session.
- **iOS:** `APIClient.swift:2304` `checkOut(…)`. Live `Views/AttendanceView.swift:731`, offsite
  retry `:816`, queue `AttendanceQueue.swift:181, 188`.
- **Request:** `multipart/form-data`. The same parts as check-in (`selfie`, `lat`, `lng`, `notes`,
  `accuracyM`, `altitudeM`, `speedMps`, `simulated`, `fromAccessory`, `clientId` →
  `checkOutClientId`, `deviceAt`, `uptimeSec`), plus:

  | Part | Type | Req | Notes |
  |---|---|---|---|
  | `reflection` | string | **yes** | trimmed. **Minimum 200 characters**, stored up to 4000 (the rest is cut off). The "daily reflection". iOS omits the part when it is empty, and the server then answers `REFLECTION_REQUIRED` |
  | `offsite` | `"1"` (or `"true"`) | no | only after a 422 `OUTSIDE_RADIUS` → "check out from outside the office for approval" |
  | `reason` | string ≤ 500 | if `offsite` and actually outside | why the person is outside |

- **Response:** `200 { record: AttendanceRecord, pendingApproval: boolean }`. `pendingApproval`
  is true for an offsite check-out (`checkOutApproval: "PENDING"` until a BoD/manager decides; the
  approvers are notified). A replayed `clientId` → `200 {record, duplicate:true}`.
- **Errors:**

  | Status | Body | UI |
  |---|---|---|
  | 400 | `Validation failed` / selfie errors | message |
  | 400 | `{code:"REFLECTION_REQUIRED", minChars:200, currentChars}` | keep the text, show the counter |
  | 400 | `{code:"REFLECTION_REPETITIVE", error}` | padded/pasted/repeated text compared with the last 10 reflections. Show `error` (it says what to change) |
  | 400 | `Check-in is required before check-out.` | refresh |
  | 409 | an approved request covers `<date>` | message |
  | 422 | `{code:"OUTSIDE_RADIUS", error, officeName, distanceMeters, radiusMeters}` | **typed outcome**, not an error: open the "offsite check-out" sheet (reason), then resend with `offsite=1&reason=…` and the **same selfie and fix** but a **new** `clientId` (`Views/AttendanceView.swift:808-860`) |
  | 400 | `Alasan checkout di luar area wajib diisi.` | reason is empty |
  | 426 / 500 / edge | | as check-in |
- **Notes:** Closes the **oldest** open record (a forgotten earlier day before today's). Validation
  order: reflection length and quality → open record → covering request → geofence. `offsite` inside
  the radius is ignored (never offsite). Members with `noGeofence` never get `OUTSIDE_RADIUS`.

#### 2.2.1 Offline queue: replay semantics (`AttendanceQueue.swift`)

The one durable write queue in the app. Attendance is the only data that cannot be honestly
recreated later.

1. **When a tap is queued:** only when the live attempt ended in `Offline` (no response, or 500/502–504/520–527/530, including the NEXUS_DOWN worker)
   **or** `UpgradeRequired`, and only when a location fix exists (`Views/AttendanceView.swift:757-800`).
   Never after a 4xx.
2. **Entry** (`PendingAttendance`, `:10-39`): `id` (= the `clientId` already sent live, **the same
   UUID**), `kind` (checkIn|checkOut), `deviceAt` (tap time), `uptimeSec`, `lat`, `lng`,
   `accuracyM?`, `altitudeM?`, `speedMps?`, `simulated?`, `fromAccessory?`, `notes?`, `reflection?`,
   `offsite`, `reason?`, `attempts`. The selfie is stored as a separate file `<id>.jpg`. Everything
   lives in app-private storage that survives app updates (`Application Support/attendance-queue/`).
   Android: `noBackupFilesDir/attendance-queue/` + a JSON index written atomically.
3. **Flush triggers:** the Attendance screen opening (before it loads), sign-in (`userId` change),
   app activation, background refresh. Android: the same + a WorkManager job with
   `NetworkType.CONNECTED`, unique by name, `KEEP`.
4. **Replay:** skip completely while a version lock is active. **Oldest `deviceAt` first**, one at a
   time (a check-out must not land before its check-in). Every replay sends `clientId=id`,
   `deviceAt`, `uptimeSec` and the stored fix fields (`AttendanceQueue.swift:149-197`).
5. **Outcomes:**
   - 2xx (including `duplicate:true`) → remove the entry and its selfie. Clear the "held" flag. After a
     check-in, reconcile today.
   - `OUTSIDE_RADIUS` on a **check-out** → resend it **automatically** as offsite with the fixed
     reason "Checked out while NEXUS was unreachable; the phone was outside the office radius at the
     time." (`:187-195`).
   - Outside the radius on a **check-in**. There is no offsite check-in, so the entry is dropped. Show
     the message in the app **and** post a local notification (type `attendance_queue_refused`,
     link `/attendance`) (`:199-206`, `NotificationManager.swift:219-228`).
   - `Offline` → stop the whole flush and keep everything.
   - `Unauthorized` → stop and keep everything.
   - `UpgradeRequired` → keep, mark *held for update* (persisted), stop (`:219-225`).
   - Any other error → `attempts += 1`, stop. At **5** attempts the entry is dropped and the error is
     kept for display (`:52, 259-270`).
6. **Logout deletes the queue** (§1.3).
7. Always show the number of queued taps in the UI. A tap that looks sent but is still queued only
   comes to light at payroll.

#### `GET /api/attendance/history`
- **Auth:** session. `scope=workspace` needs `canManageAttendance`, **or** a manager with direct
  reports (the view is then limited to the reports + self).
- **iOS:** `APIClient.swift:2080` `attendanceHistory(scope:month:)` (cache
  `attendance-history-<scope>-<month>`). `:2073` `attendanceRecent(scope:days:)` (compact, last
  N days: widget, Watch, presence dots, reflections). Exports: `Views/AttendanceView.swift:1366`,
  `Views/MemberAttendanceSheet.swift:74`.
- **Query** (`attendanceHistoryQuerySchema`): `scope` = `me` (default) | `workspace`;
  `month=YYYY-MM` (**period**, 28→27) **or** `dateFrom`/`dateTo` (`DateKey`, default today);
  `userId`; `officeLocationId`; `status` CHECKED_IN|COMPLETED|INCOMPLETE; `checkInStatus`;
  `checkOutStatus`; `isCorrected`; `attendanceDayType` PRESENT|LEAVE_APPROVED|SICK_APPROVED|
  PERMIT_APPROVED|DAY_OFF_APPROVED|ABSENT; `requestType`; `requestStatus`;
  `format` json|csv|xlsx; `compact=1`.
- **Response (json):** `200 { scope, records: HistoryRow[] }`. Each row is an `AttendanceRecord`
  plus `recordKind: "ATTENDANCE"|"REQUEST"|"ABSENT"`, `attendanceDayType`, `requestType`,
  `requestStatus`, `reviewedBy`, `supportingDocumentUrl/Name`. The server **synthesises** rows for
  approved requests and for absent workdays. BoD/One-Above-All are left out of the workspace board.
  iOS decodes `rows ?? records` (`AttendanceModels.swift` `AttendanceHistoryResponse`). **The server
  sends `records`.**
- **Response (`compact=1`):** `200 { scope, records: [{ userId, name, date: DateKey, tone, checkInAt,
  checkOutAt, lateMinutes, kind }] }`. `tone`: `P` present, `L` late, `I` permit, `C` leave, `S` sick,
  `D` day off, `A` absent, `""` nothing. **Use the server's tone. Do not recompute it.**
- **Response (`format=xlsx`|`csv`):** a file (`Content-Disposition: attachment`). With `userId` +
  xlsx → one person's sheet. iOS downloads it with the session and opens the share sheet.
- **Errors:** 400 validation, 403 `Forbidden` (workspace scope without rights), 404 no workspace.

#### `GET /api/attendance/requests`
- **Auth:** session. `scope=approvals|workspace` requires `canReviewAttendanceRequests`. A manager
  who is not a BoD sees **only direct reports**.
- **iOS:** `APIClient.swift:2092` `attendanceRequests(scope:)`, cache `attendance-requests-<scope>`.
  The screen uses `workspace` if the viewer can review, else `me` (`Views/AttendanceRequestsView.swift:848`).
- **Query** (`attendanceRequestQuerySchema`): `scope` me (default)|approvals|workspace; `month`
  (calendar month overlap); `userId`; `teamId`; `type` LEAVE|SICK|PERMIT|DAY_OFF|RED_DATE; `status`
  PENDING|APPROVED|REJECTED|CANCELED; `includeAutoDeductions=1|true` (the nightly cron's own
  "Auto:" day-off penalties are **excluded by default**).
- **Response 200:**
  ```ts
  { scope, dayOffUsedThisMonth: number,
    requests: Array<AttendanceRequest & { requesterDayOff?: { period, quota, used, remaining, … } }> }
  type AttendanceRequest = {
    id, userId, workspaceId, teamId|null
    type: "LEAVE"|"SICK"|"PERMIT"|"DAY_OFF"|"RED_DATE"
    status: "PENDING"|"APPROVED"|"REJECTED"|"CANCELED"
    startDate: string; endDate: string          // ISO midnight UTC of the DateKey
    reason: string; reviewNote: string|null; approvalSource: string|null
    supportingDocumentUrl: string|null; supportingDocumentName: string|null
    submittedLat: number|null; submittedLng: number|null; submittedAddress: string|null
    reportDelayMinutes: number|null
    createdAt, updatedAt, reviewedAt|null
    attendanceDayType: string|null               // when APPROVED
    user: { id, name, email, avatar }; reviewedBy: { id, name, email }|null; team: { id, name }|null
  }
  ```
  `requesterDayOff` is present only on PERMIT rows in approvals/workspace scope. It shows the
  reviewer the requester's day-off balance. Limits: 200 rows for `me`, 1000 otherwise, newest first.
  iOS accepts a bare array or `{requests}`.
- **Notes:** `isAutoDeduction` = `approvalSource=="ADMIN" && reviewedBy==null && reason.startsWith("Auto:")`.
  Hide Approve/Reject when `userId == viewerId` (the server refuses with `SELF_REVIEW`).

#### `POST /api/attendance/requests`
- **Auth:** session.
- **iOS:** `APIClient.swift:2099` `createAttendanceRequest(…)`. Composer
  `Views/AttendanceRequestsView.swift:1470-1488`.
- **Request:** `multipart/form-data`:

  | Part | Type | Req | Notes |
  |---|---|---|---|
  | `type` | `LEAVE`\|`SICK`\|`PERMIT`\|`DAY_OFF`\|`RED_DATE` | yes | |
  | `startDate` | `DateKey` | yes | |
  | `endDate` | `DateKey` | yes | **send the same value as `startDate`**. One request = one date (see rules) |
  | `reason` | string 3–1000 | yes | iOS trims whitespace |
  | `lat`, `lng` | decimal strings | **PERMIT: yes** | where the person is while filing. Send both or neither. A missing or empty part is NaN (not 0) |
  | `supportingDocument` | file | SICK and PERMIT: yes | image/* or PDF, ≤ 10 MB. iOS names camera shots `sick-note.jpg` / `permit-photo.jpg` (the Files picker keeps the original name) and sends `application/octet-stream` |
  | `targetUserId` | string | no | BoD filing **for someone else** (grant). The iOS composer never sends it |

- **Server rules** (`requests/route.ts:311-470`, in the order they are checked). "Self-filed" = not
  `canManageAttendance`:
  1. Validation → 400 `Validation failed` + `details`.
  2. `endDate < startDate` is quietly clamped to a single day (0.1.4 picker bug).
  3. Self-filed PERMIT whose `reason` reads as "forgot to check in" → 422 `PERMIT_NOT_FORGOT_CHECKIN`.
     Reads as "a day off" → 422 `PERMIT_NOT_DAYOFF` `{dayOff:{period,…}|null}`. Both apply to every client.
  4. Self-filed SICK without a document → 400 `Request sakit wajib melampirkan foto surat sakit.`
  5. **Capable client** (`clientCanObeyRequestPolicy`: `web/…` or `ios/≥0.1.6`) and not BoD and
     `endDate ≠ startDate` → 400 `SINGLE_DAY_ONLY`. Applies to **every** type.
  6. Document not image/PDF (MIME, or the extension when the type is empty or octet-stream) → 400
     `DOCUMENT_TYPE`.
  7. Self-filed PERMIT: no document → 400 `Izin wajib melampirkan foto sebagai bukti.`. **Capable
     client** without finite lat/lng → 400 `Izin wajib menyertakan lokasi…`. Date in the past → 422
     `PERMIT_BACKDATED`. iOS limits the picker to today onward for izin.
  8. `targetUserId` ≠ self without BoD rights → 403. Not a member → 400.
  9. Overlap with an active request → 409. Attendance already recorded on the date → 409. Document
     > 10 MB → 400.
  10. DAY_OFF / RED_DATE monthly quota → 422 `Jatah … terlampaui…`.
  11. Self-filed LEAVE: fewer than 12 months of service → 403 `LEAVE_NOT_ELIGIBLE`. Annual allowance
      of 12 days exceeded → 422 `LEAVE_QUOTA_EXCEEDED`.
- **Response:** `201 { request: AttendanceRequest }`.
- **Notes:** Offer only the types the person can use (iOS `:1163-1177`): LEAVE if
  `annualLeave.eligible && remaining > 0`. SICK, PERMIT and DAY_OFF always. RED_DATE if
  `redDateQuota - redDateUsedThisMonth > 0`. Ask for location as soon as PERMIT is picked.
  **🛠 SERVER CHANGE REQUIRED:** until `android` is added to `clientCanObeyRequestPolicy`, the
  server applies the looser rules to Android (ranges and izin without a position are accepted).
  Android should obey the strict rules on its own anyway.

#### `PATCH /api/attendance/requests/{id}`
- **Auth:** session. `cancel` is for the requester only. `approve`/`reject` need the requester's
  manager on the approval chart, or a BoD override. Never your own request.
- **iOS:** `APIClient.swift:2127` `reviewAttendanceRequest(id:action:reviewNote:)`. Callers
  `Views/AttendanceRequestsView.swift:832, 1043, 1120`.
- **Request:** JSON `{ action: "approve"|"reject"|"cancel", reviewNote?: string ≤ 1000 }`. `reject`
  **requires** `reviewNote` of at least 3 characters (trimmed). Leave it out when empty.
- **Response:** `200 { request: AttendanceRequest }`.
- **Errors:** 400 `{error:"Alasan penolakan wajib diisi (minimal 3 karakter).", details}`. 404. 403
  `Only the requester can cancel…`. 409 `Only pending attendance requests can be canceled/reviewed.`
  403 `SELF_REVIEW`. 403 `Forbidden`.
- **Notes:** Approving refunds penalties for the covered days, server-side.

#### `GET /api/attendance/offsite-checkouts`
- **Auth:** session. `canManageAttendance`, or a reviewer with direct reports (reports only). Else 403.
- **iOS:** `APIClient.swift:2144` `offsiteCheckouts(status:)`, default `ALL`.
- **Query:** `status` = PENDING (default) | APPROVED | REJECTED | anything else (e.g. `ALL`) = all.
- **Response 200:** `{ items: OffsiteCheckout[], pendingCount: number }`, where
  `OffsiteCheckout = { id /* recordId */, attendanceDate, checkOutAt|null, reason|null, address|null,
  lat|null, lng|null, distanceMeters|null, photoUrl|null, checkOutStatus, approval:
  "PENDING"|"APPROVED"|"REJECTED"|null, approvedAt|null, approverName|null, officeName|null,
  user:{id,name,email,avatar} }`. Maximum 200, pending first.
- The review (`PATCH /api/attendance/offsite-checkouts/{recordId}`) is in §2.3.

#### ⏳ PENDING: working-hours location trail (iOS 0.1.6 WIP, **no server route yet**)

At `a875c3c` these calls **do not exist in the committed iOS client or on the server**
(`src/app/api/attendance/` has no `location-trail`, `location-status` or `records/[id]/trail`).
The contract below comes from uncommitted iOS work (`WorkLocationTracker.swift`,
`WorkTrailPolicy.swift`, `Views/LocationTrailView.swift`). Build against it only after the server
routes ship, and re-check the shapes then.

- Rules (owner's): only between an accepted check-in and the check-out. Nothing is sent while inside
  the office geofence. Outside, one point about every **15 min**, plus one immediately on exit and one
  on re-entry. The server has the last word: `tracking:false` stops everything.
- `POST /api/attendance/location-trail` JSON
  `{ recordId, points: [{ lat, lng, accuracy?, at: ISO, event: "exit"|"enter"|"point" }] }` →
  `{ ok?, tracking?: boolean /* missing = keep going */, stage?: string, outsideSince?: ISO,
  nextAt?: ISO /* the server wants the next point by then */ }`.
- `POST /api/attendance/location-status` JSON `{ recordId, state: "on"|"denied" }` → `{success}`.
  Tells the manager's board that background location was refused, so an empty trail is not read as
  "stayed inside".
- `GET /api/attendance/records/{recordId}/trail` → `{ record:{id,userId?,userName?,date?,checkInAt?,
  checkOutAt?,checkOutOffsite?,office?:{name?,lat,lng,radiusMeters?},locationTrackingState?},
  points?:[{lat,lng,accuracy?,at,inside?,event?}], outsideSpans?:[{from,to?}] }`.
- Records would gain `locationTrackingState: "on"|"denied"|null` and `officeLocation.{id,latitude,longitude,radiusMeters}` (already sent today).
- Related pushes (also PENDING, see §3): 1 h 30 min / 2 h "outside the office" reminders with category
  `NEXUS_OUTSIDE_OFFICE` and a "File a permit" action (→ `/attendance?permit=today`), and
  `attendance_auto_offsite_checkout` (the server checked the person out → stop tracking and reload today).
- Android: `ACCESS_BACKGROUND_LOCATION` + geofencing (`GeofencingClient`) for exit/enter, plus a
  15-minute WorkManager/foreground-service heartbeat while outside. Play policy requires a prominent
  disclosure and a declaration for background location.

## 2.3 Attendance administration

Roles: `canManageAttendance` = system ADMIN, or workspace role `BOD` / `ONE_ABOVE_ALL` (`src/lib/attendance.ts:1021`). `canReviewAttendanceRequests` = canManage **or** has ≥1 direct report in the approval chart (`:1033`). Both come back on `GET /api/attendance/today`, so use them to decide what to show. The server re-checks on every call. "Month" in these routes means one of two things. The **attendance period** (`attendancePeriodRange`, the 28th→27th cut-off, keyed by `YYYY-MM`) applies to day-offs and deductions. The **calendar month** applies to holidays and the red-date quota.

#### `GET /api/attendance/offices`
- **Auth:** session (any member). **iOS:** `APIClient.swift:2174` `attendanceOffices` (no cache). The model is `Views/AttendanceOfficesView.swift:6-18`.
- **Response 200:** `{ offices: OfficeLocation[], canManage: boolean }`. Archived offices are excluded, and the list is sorted active first, then by name. `OfficeLocation = { id, name, address: string|null, latitude: number, longitude: number, radiusMeters: int, timezone: string /*"Asia/Jakarta"*/, workdays: int[] /*ISO 1=Mon..7*/, shiftStartTime:"HH:mm", shiftEndTime:"HH:mm", lateGraceMinutes: int, earlyLeaveGraceMinutes: int, isActive: boolean, archivedAt: null, createdAt, updatedAt, workspaceId }`.

#### `POST /api/attendance/offices`
- **Auth:** canManageAttendance, otherwise 403 `{error:"Forbidden"}`. **iOS:** `APIClient.swift:2178` `createOffice(fields:)`, called from `Views/AttendanceOfficesView.swift:188-202`.
- **Request (`createOfficeLocationSchema`):** `{ name: string(1–120), address?: string(≤300)|null, latitude: number, longitude: number, radiusMeters: int 10–5000, timezone?: string, workdays?: int[1..7] (1–7 items), shiftStartTime?: "HH:mm", shiftEndTime?: "HH:mm", lateGraceMinutes?: int 0–180, earlyLeaveGraceMinutes?: int 0–180, isActive?: boolean }`. On create, iOS sends name, latitude, longitude, radiusMeters, lateGraceMinutes, address (if set) and `shiftStartTime:"09:00", shiftEndTime:"18:00"`.
- **Response 201:** `{ office: OfficeLocation }`. **Errors:** 400 `Validation failed`+details · 403.

#### `PATCH /api/attendance/offices/{officeId}`
- **Auth:** canManage. **iOS:** `APIClient.swift:2192` `updateOffice(id:fields:)`. The edit sheet sends `{name,address|null,latitude,longitude,radiusMeters,lateGraceMinutes}`, and the active toggle sends `{isActive}` (`AttendanceOfficesView.swift:78`).
- **Request:** any subset of the create fields, all optional. **Do not send the shift on edit.** iOS stopped doing so because it silently reset an office's custom shift (`AttendanceOfficesView.swift:196-198`).
- **Response 200:** `{ office }`. **Errors:** 400 · 403 · 404 "Office not found".

#### `DELETE /api/attendance/offices/{officeId}`
- **Auth:** canManage. **iOS:** `APIClient.swift:2186` `deleteOffice(id:)`.
- **Response 200:** `{ ok:true, archived: boolean, records: number }`. An office that has ever been checked into is **archived** (`isActive:false, archivedAt`) rather than deleted.
- **Errors:** 403 · 404.

#### `GET /api/attendance/dayoffs?userId=&month=YYYY-MM`
- **Auth:** canManage, otherwise 403 "Hanya BoD ke atas yang bisa atur day-off.". **iOS:** `APIClient.swift:2214` `dayoffs(userId:month:)`. The model is `Views/AttendanceAdminView.swift:5-18`.
- **Query:** `userId` (required, else 400). `month` is the attendance period key and defaults to the current period.
- **Response 200:** `{ month, quota: int /*effective*/, quotaOverride: int|null, defaultQuota: 4, used: int /*days inside the period*/, dayoffs: AttendanceRequest[] /*DAY_OFF, PENDING|APPROVED, serializeAttendanceRequest*/ }`.

#### `POST /api/attendance/dayoffs` (BoD grants a day off)
- **Auth:** canManage. **iOS:** `APIClient.swift:2218` `grantDayoff`.
- **Request:** `{ userId: string, date: "YYYY-MM-DD", reason?: string }`. **Response 201:** `{ dayoff: AttendanceRequest }`.
- **Errors:** 400 missing userId / bad date · 404 not a member · 409 "Sudah ada day-off di tanggal itu.".

#### `PATCH /api/attendance/dayoffs` (per-member monthly quota override)
- **Auth:** canManage. **iOS:** `APIClient.swift:2228` `setDayoffQuota`, which also sends `workspaceId`. The server ignores it and uses the caller's workspace.
- **Request:** `{ userId, quota: int 0–366 | null | "" /*reset to default 4*/ }`. **Response 200:** `{ quota: int, quotaOverride: int|null }`.
- **Errors:** 400 "Jatah day-off harus angka bulat 0–366." · 404 not a member.

#### `DELETE /api/attendance/dayoffs?id=`
- **Auth:** canManage. **iOS:** `APIClient.swift:2238` `deleteDayoff(id:)`. **Response 200:** `{ message:"Day-off dihapus." }`. **Errors:** 400 id missing · 404.

#### `GET /api/attendance/red-date-quota?month=YYYY-MM`
- **Auth:** session (any member). **iOS:** `APIClient.swift:2242` (model `AttendanceAdminView.swift:19`). `month` is a calendar month and defaults to the current one.
- **Response 200:** `{ month, quota: int /*0 when unset*/, canManage: boolean }`.

#### `POST /api/attendance/red-date-quota`
- **Auth:** canManage, otherwise 403. **iOS:** `APIClient.swift:2246` `setRedDateQuota`.
- **Request:** `{ month: "YYYY-MM", quota: int 0–31 }`. **Response 200:** `{ month, quota, canManage:true }`. **Errors:** 400 bad month/quota.

#### `GET /api/attendance/holidays?month=YYYY-MM`
- **Auth:** session. **iOS:** `APIClient.swift:2253` (model `AttendanceAdminView.swift:24-33`).
- **Response 200:** `{ month, canManage: boolean, holidays: { id, date:"YYYY-MM-DD", name }[] }` (calendar month).

#### `POST /api/attendance/holidays`
- **Auth:** canManage. **iOS:** `APIClient.swift:2257` `addHoliday`.
- **Request:** `{ date:"YYYY-MM-DD", name: string }`. **Response 201:** `{ holiday:{id,date,name} }`. **Errors:** 400 bad date · 403 · 409 "Tanggal itu sudah jadi tanggal merah.".

#### `DELETE /api/attendance/holidays?id=` (or `?date=YYYY-MM-DD`)
- **Auth:** canManage. **iOS:** `APIClient.swift:2265` `deleteHoliday(id:)`. **Response 200:** `{ message }`. **Errors:** 400 neither given · 404.

#### `GET /api/attendance/reflections?month=YYYY-MM[&userId=]`
- **Auth:** session. Allowed when `userId` is the caller (or omitted), when the caller has canManage, or when `userId` is one of the caller's direct reports. Otherwise 403. **iOS:** `APIClient.swift:2161` `reflections(userId:month:)`. The models are in `Views/ReflectionsView.swift:5-21`.
- **Response 200:** `{ userId, month, days: { date:"YYYY-MM-DD", reflection: string, summary: string|null /*GIDEON*/ }[], monthly: { summary: string, sourceDays: int, updatedAt: ISO } | null }`.
- **Errors:** 400 "month must be YYYY-MM" · 403 · 404 no workspace.

#### `POST /api/attendance/reflections/summarize`
- **Auth:** same access rule. **iOS:** `APIClient.swift:2166` `summarizeReflections`. This call is slow: the route's `maxDuration` is 300 s, so give it a long timeout (≥120 s).
- **Request:** `{ month: "YYYY-MM", userId?: string, force?: boolean }`. **Response 200:** `{ summary, sourceDays, updatedAt, cached: boolean }`.
- **Errors:** 404 `{error:"No reflections in this month yet.", sourceDays:0}` · **503 `{error:"GIDEON didn't answer…", sourceDays}`**. That 503 is an app answer with a sentence, so show it. Don't treat it as "server unreachable" and don't queue it.

#### `DELETE /api/attendance/records/{recordId}[?part=checkout][&reason=]`
- **Auth:** canManage, otherwise 403. **iOS:** `APIClient.swift:2086` `deleteAttendanceRecord(_:part:)` (BoD cleanup on the crew board).
- **Query:** no `part` deletes the whole record (e.g. an accidental check-in). `part=checkout` clears only the check-out, which reopens the day. `reason` is optional and goes to the audit log.
- **Response 200:** whole delete → `{ deleted:true, date:"YYYY-MM-DD" }`. `part=checkout` → `{ record: AttendanceRecord }`.
- **Errors:** 400 "Record ini belum ada check-out-nya." (part=checkout on an open record) · 404.

#### `PATCH /api/attendance/records/{recordId}` (BoD correction, web only; not in iOS)
- **Auth:** canManage. **Request (`attendanceCorrectionSchema`):** `{ officeLocationId?, checkInAt?: ISO|null, checkOutAt?: ISO|null, notes?: string|null, correctionReason: string(3–500) /*required in practice*/ }`. **Response 200:** `{ record }`. **Errors:** 400 reason required / check-in required / check-out before check-in · 404.
- **Notes:** this matters for parity only if Android ships a BoD board editor. iOS instead corrects via ticket proposals (`/api/complaints/{id}/correction`, documented in the Tickets section).

#### `GET /api/attendance/offsite-checkouts?status=PENDING|APPROVED|REJECTED|ALL`
- Documented with the Attendance core section (list shape `{items, pendingCount}`). Cross-reference only.

#### `PATCH /api/attendance/offsite-checkouts/{recordId}`
- **Auth:** `canReviewAttendanceRequests` **and** the approver resolver must say this reviewer may decide for this person. Otherwise 403. **iOS:** `APIClient.swift:2150` `reviewOffsiteCheckout(id:action:)`.
- **Request:** `{ action: "approve" | "reject" }`. There is **no note field**; any other key is ignored.
- **Response 200:** `{ ok:true, id, approval: "APPROVED"|"REJECTED" }`.
- **Errors:** 400 bad action · 403 own checkout ("Kamu nggak bisa approve checkout kamu sendiri.") or not your report · 404 · 409 "Checkout ini sudah diproses." (already decided, so refresh the list).

#### `GET /api/attendance/deductions?month=YYYY-MM[&userId=]` (web only, BoD)
- Not used by iOS. It is relevant for crew-board parity. **Auth:** canManage, otherwise 403.
- Without `userId`: `{ month, defaultQuota, redDateQuota, members: { userId, quota, used, remaining, redDate:{quota,used,remaining}, xp:{score,level,levelName} }[] }`. With `userId`: `{ month, userId, dayOff:{quota,used,remaining}, totalXpLost, entries: { id, dateKey, kind /*XP_LATE|XP_NOCHECKOUT|XP_ALPHA|DAY_OFF…*/, label, amount, unit:"XP"|"DAY_OFF", detail|null, cleared }[] }`.

#### `POST /api/attendance/override` (web only, BoD)
- Not used by iOS. **Request:** `{ userId, date:"YYYY-MM-DD" (not future), action: "PRESENT"|"LEAVE"|"SICK"|"DAY_OFF"|"CLEAR_PENALTY", note?, checkInAt?: "HH:mm"|ISO, checkOutAt?: …|null }`. **Response 200:** `{ ok, action, date, refunded, alreadyCovered?, canceledRequests?, replacedRequests?, multiDayRequestsLeft? }`. **Errors:** 400 · 403 "Forbidden — khusus BoD." · 404 · 409.
- **Notes:** this is the only way to clear a penalty (XP refund, auto day-off restore, waiver). Skip it unless Android gets the BoD board tools.

#### `GET /api/attendance/reverse-geocode?lat=&lng=`
- **Auth:** session. Not used by iOS: the server geocodes check-in, check-out and permit positions itself. **Response 200:** `{ address: string|null, lat, lng }`. Optional for Android, e.g. showing an address before submitting.

#### `GET /api/attendance/history?scope=workspace&month=YYYY-MM&format=xlsx[&userId=]` (export)
- **Auth:** `scope=workspace` needs canManage, or team-manager access limited to the manager's direct reports plus themselves. Otherwise 403. **iOS:** whole crew at `Views/AttendanceView.swift:1361-1371` `exportMonth`. One person (adds `&userId=`) at `Views/MemberAttendanceSheet.swift:70-85`.
- **Response 200:** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` binary (`format=csv` gives `text/csv`). iOS streams it to a temp file (`absensi-<month>.xlsx` / `absensi-<slug>-<month>.xlsx`) with `APIClient.download` and opens the share sheet. On a non-2xx it shows "Server error (<code>)." and discards the body. Android: stream to cache dir, then `ACTION_SEND` via `FileProvider`.
- **Notes:** the JSON form of this endpoint is documented in the Attendance core section.

#### Team / member shift settings
- Per-member shift and per-weekday overrides go through `PATCH /api/workspaces/members` (`APIClient.swift:2203` `setAttendanceShift`). Flexi, no-geofence and rest days use `APIClient.swift:1121`. Team shift is `POST /api/teams {action:"update-attendance-shift"}` (`APIClient.swift:1025`). All three are documented in the Workspace / Teams section.

## 2.4 Tasks, projects & work

Conventions for this section: every route requires the session cookie (401 `{error:"Unauthorized"}` → log out). Unless noted, iOS decodes mutation replies as `SuccessResponse {success?: Bool}`, which accepts ANY JSON object, so the body is ignored; Android may do the same, or read the richer body listed under **Response**. "LEAD / MEMBER / VIEWER" means `checkProjectAccess` project role; workspace BOD / MANAGER / ONE_ABOVE_ALL rank as LEAD on every project in their workspace. A 500 is always `{error:"Internal server error"}`. File line numbers are for `nexus-ios@a875c3c`.

### Projects

#### `GET /api/projects`
- **Auth:** session. Without `workspaceId`, BOD/MANAGER/ONE_ABOVE_ALL see every project in their workspaces and STAFF see only the projects they belong to. System admins see everything.
- **iOS:** `APIClient.swift:656` `projects()`, cache key `projects`
- **Request:** optional query `workspaceId`, `includeAllWorkspace=1`, `teamId`. iOS sends none of them.
- **Response:** `200 Array<{id, name, description|null, color|null, icon|null, status, workspaceId, folderId|null, position, createdAt, updatedAt, _count:{members, taskLists, tasks?}, taskLists:[{id, _count:{tasks}}], members:[{id, role, userId, projectId, user:{id,name,email,avatar}}]}>`. `icon` is an emoji, or a path starting with `/` for an uploaded icon.
- **Errors:** 403 when `workspaceId` names a workspace you do not belong to. A missing schema returns `[]`, not an error.

#### `GET /api/projects/{projectId}`
- **Auth:** project MEMBER. The server loads the project first, then checks access, so an unknown id is 404 and an existing project you cannot access is 403.
- **iOS:** `APIClient.swift:660` `project(_:)`, cache `project-{id}`
- **Response:** `200 Project & {taskLists: Lane[], members:[{userId, role, user:User}], pages[], customFields[], enableTaskBatchDuplicate, enablePnlDashboard, autoAssignEnabled, autoAssignAssigneeIds[], requireAttachmentForDone, disableTaskStatus, tableColumns}`.
  - A `Lane` is `{id, name, position, tasks: BoardTask[], taskProjects:[{task: BoardTask & {taskList:{id,name,projectId,project:{id,name}}}}]}`.
  - Lane `tasks` contain top-level tasks only (`parentId:null`). Each task carries `assignees[{user}]`, `subtasks[{id,status}]`, `customFieldValues[{customFieldId, value, customField:{name,type,options}}]` and `quests?[{id,title,xpReward}]`.
- **Notes:** `taskProjects` holds tasks multi-homed into this project from another project. iOS ignores it. For the board, iOS merges in `GET /api/tasks?projectId=` to pick up subtasks.

#### `POST /api/projects`
- **Auth:** session plus membership of `workspaceId`.
- **iOS:** `APIClient.swift:675` `createProject`
- **Request:** JSON `{name: string (req), workspaceId: string (req), color?: string, icon?: string, description?: string, folderId?: string}`.
- **Response:** `201 Project` (full row).
- **Errors:**
  - 400 `"Name and workspaceId are required"`.
  - 400 when the folder is in a different workspace.
  - 403 when you are not a member of the workspace.

#### `PATCH /api/projects/{projectId}`
- **Auth:** project LEAD. Changing `enablePnlDashboard` also requires workspace BOD+ (403 `"Forbidden: hanya BoD ke atas…"`).
- **iOS:**
  - `APIClient.swift:1713` `updateProject(_:fields:)`, used by settings for name/description/color/icon/flags.
  - `APIClient.swift:830` `setProjectFolder`, which sends `{folderId: string|null}`.
- **Request:** JSON, any subset of `name, description, color, icon, status, folderId (string | null = move to root), position, enableTaskBatchDuplicate, autoAssignEnabled, autoAssignAssigneeIds: string[], enablePnlDashboard, requireAttachmentForDone, disableTaskStatus, tableColumns`.
- **Response:** `200 Project`.
- **Errors:**
  - 400 when the auto-assign config is invalid (assignee is not a project member).
  - 400 when the folder is in another workspace.
  - 403 without LEAD.
  - 404 when the project is not found.
- **Notes:** To clear `folderId`, send an explicit JSON `null`. Omitting the key leaves it unchanged.

#### `DELETE /api/projects/{projectId}`
- **Auth:** project lead or workspace admin.
- **iOS:** `APIClient.swift:1777` `deleteProject`
- **Response:** `200 {message:"Project deleted"}`.
- **Errors:** 403, 404.

#### `POST /api/projects/{projectId}/duplicate`
- **Auth:** org role BOD+ AND project VIEWER.
- **iOS:** `APIClient.swift:1772` `duplicateProject`. It decodes `{id}` and opens the copy.
- **Request:** no body. iOS sends none. The route does not call `request.json()`, so an empty body is safe here.
- **Response:** `201 Project & {taskLists[{tasks[{assignees[{user}]}]}], members[{user}]}`. Read `id`.
- **Errors:**
  - 403 `"Cuma BoD ke atas yang boleh nyalin project."`
  - 403 `Forbidden`.
  - 404.

#### `POST /api/projects/{projectId}/members`
- **Auth:** project LEAD.
- **iOS:** `APIClient.swift:1748` `addProjectMember`
- **Request:** JSON `{userId: string (req), role?: "LEAD"|"MEMBER"|"VIEWER"|"GUEST"}`. iOS sends `"MEMBER"`.
- **Response:** `201 ProjectMember`.
- **Errors:**
  - 400 `"userId is required"`.
  - 400 `"User is already a member"` (400, not 409).
  - 403.

#### `DELETE /api/projects/{projectId}/members`
- **Auth:** project LEAD.
- **iOS:** `APIClient.swift:1756` `removeProjectMember`
- **Request:** JSON body `{userId}` on a DELETE. Android's HTTP client must allow a body on DELETE: OkHttp does, through `Request.Builder().delete(body)`.
- **Response:** `200 {message:"Member removed"}`.
- **Errors:** 400, 403, 404 `"Member not found"`.

#### `POST /api/projects/{projectId}/invite`
- **Auth:** your project role must be something other than GUEST or VIEWER.
- **iOS:** `APIClient.swift:1764` `inviteProjectMember`
- **Request:** JSON `{email: string (req), role?: "GUEST"|"MEMBER"|"VIEWER"}` (default `GUEST`).
- **Response:** 2xx and an invite object (ignored).
- **Errors:**
  - 400 `"Email is required"` or `"Invalid role"`.
  - 403.
  - 409 `"User is already a member of this project"` or `"An invite is already pending for this email"`.

### Project folders

#### `GET /api/project-folders`
- **Auth:** session. Passing `workspaceId` requires membership of it (else 403).
- **iOS:** `APIClient.swift:685` `projectFolders(workspaceId:)`
- **Request:** query `workspaceId?`.
- **Response:** `200 Array<{id, name, icon ("📁" default | "/api/files/project-icons/folder-…?v=…"), color, position, parentFolderId|null, aggregateProjectIds: string[], workspaceId, createdAt, updatedAt}>`. These are raw rows.

#### `POST /api/project-folders`
- **Auth:** workspace BOD, MANAGER or ONE_ABOVE_ALL.
- **iOS:** `APIClient.swift:690` `projectFolderCreate`. It decodes `{id}` so the photo icon can be uploaded next.
- **Request:** JSON `{workspaceId (req), name (req), icon?: emoji (sliced to 20 chars, default "📁"), color?: "#RRGGBB" (else "#111827"), parentFolderId?: string}`.
- **Response:** `201 ProjectFolder`.
- **Errors:**
  - 400 when name or workspaceId is missing, or the placement is invalid (depth or cycle).
  - 403.
  - 409 `"A folder with this name already exists"`.

#### `PATCH /api/project-folders/{folderId}`
- **Auth:** workspace BOD, MANAGER or ONE_ABOVE_ALL.
- **iOS:**
  - `APIClient.swift:699` `projectFolderUpdate`, which sends `{name, icon, color}`.
  - `APIClient.swift:713` `setFolderAggregate`, which sends `{aggregateProjectIds: string[]}`.
- **Request:** JSON, any subset of `name, icon (emoji ≤20 chars, or a "/…" URL ≤300 chars), color ("#RRGGBB", anything else silently ignored), position: int, parentFolderId (string | null = root)`.
- **Response:** `200 ProjectFolder`.
- **Errors:** 400 `"Folder name is required"` or bad placement, 403, 404, 409 duplicate name.
- ⚠ **Discrepancy:** The server does NOT read `aggregateProjectIds`. It answers 200 and changes nothing. The column exists (`ProjectFolder.aggregateProjectIds String[]`) and is returned by GET, but nothing on the server writes it through this route. `setFolderAggregate` (iOS `FolderAggregateView.swift:381`) is therefore a silent no-op today. **SERVER CHANGE REQUIRED:** accept `aggregateProjectIds: string[]` in the PATCH (validate that the ids are projects in the same workspace) before Android ships the curated folder view.

#### `DELETE /api/project-folders/{folderId}`
- **Auth:** workspace BOD, MANAGER or ONE_ABOVE_ALL.
- **iOS:** `APIClient.swift:707` `projectFolderDelete`
- **Response:** `200 {message:"Folder deleted"}`. Child folders are reparented to the deleted folder's parent, and its projects go to root.
- **Errors:** 403, 404.

#### `POST /api/upload/folder-icon`
- **Auth:** workspace BOD, MANAGER or ONE_ABOVE_ALL (or system admin).
- **iOS:** `APIClient.swift:726` `uploadFolderIcon`. It uses the upload progress bar.
- **Request:** `multipart/form-data` with text part `folderId` and file part `file`. Accepted types are `image/png`, `image/jpeg`, `image/svg+xml` and `image/webp`, up to 5 MiB. The server checks the file PART's `Content-Type`, not the filename.
- **Response:** `200 {url: "/api/files/project-icons/folder-{id}.{ext}?v={ms}"}`. The folder's `icon` is updated server-side at the same time.
- **Errors:**
  - 400 `"No file provided"` or `"No folderId provided"`.
  - 400 `"Invalid file type. Allowed: PNG, JPG, SVG, WEBP"`.
  - 400 `"File too large. Maximum size is 5MB"`.
  - 403, 404.
- ⚠ **Discrepancy:** iOS labels the part `Content-Type: application/octet-stream` (`APIClient.swift:734`), so the server always refuses it with 400. Folder photo icons cannot be uploaded from iOS. **Android must send the real image MIME type on the part.** It is optional to also loosen the server to fall back to the extension, the way the attendance-request route does.

#### `GET /api/tasks?projectIds={id1,id2,…}` (folder aggregate calendar)
- **iOS:** `APIClient.swift:721` `folderTasks`. It returns `[]` without calling the server when the list is empty.
- The server contract is the same as `GET /api/tasks` below. iOS decodes `FolderTask {id, title, status, priority, dueDate, assignees[{user}], taskList:{projectId}}`.

### Tasks

#### `GET /api/tasks`
- **Auth:** session. Results are scoped: BOD, MANAGER and ONE_ABOVE_ALL see every task in their workspaces, STAFF see only tasks in projects they belong to, and a user with no workspace gets `[]`.
- **iOS:** three variants.
  - `APIClient.swift:666` `projectTasks`: `?projectId=`, cache `project-tasks-{projectId}`. It includes subtasks.
  - `APIClient.swift:916` `myTasks`: `?assigneeId={me}`, cache `tasks-{userId}`.
  - `APIClient.swift:721` `folderTasks`: `?projectIds=a,b`. This parameter is ignored when `projectId` is also sent.
- **Request:** query parameters, all optional: `projectId`, `projectIds` (comma-separated), `taskListId`, `status` (comma list of `TODO|IN_PROGRESS|IN_REVIEW|DONE|CANCELLED`), `priority` (comma list of `URGENT|HIGH|MEDIUM|LOW|NONE`), `assigneeId`, `search` (matched against title and description, case-insensitive).
- **Response:** `200 Array<Task>`, sorted by position ascending then createdAt descending. Top-level and subtasks both appear, flat.
  - Each item is `{id, title, description, status, priority, startDate, dueDate, parentId|null, taskListId, position, tags[], createdAt, …, assignees:[{userId, user:User}], creator:User, taskList:{id, name, projectId, …}, _count:{subtasks, comments}, quests?:[{id,title,xpReward}]}`.
  - `quests` is only present when at least one active `specific_tasks` quest touches one of the returned tasks.
- **Notes:** No `subtasks[]` or `customFieldValues[]` here (unlike the project detail lanes). iOS `BoardTask` treats both as optional.

#### `GET /api/tasks/{taskId}`
- **Auth:** session only. ⚠ The server does NOT check project access on this read: any signed-in user can read any task by id. Flag this as a server hardening item. Android should not depend on the gap.
- **iOS:** `APIClient.swift:844` `taskDetail`, cache `task-{id}`
- **Response:** `200 Task` with these relations:
  - `assignees[{user}]`, `comments[{id, content, parentId, createdAt, user:User}]` (ascending), `parent:{id,title}|null`, `subtasks[{…, assignees[{user:{id,name,avatar}}]}]`
  - `activityLogs[{id, action, details, createdAt, user}]` (descending), `taskList:{id, name, project:{id,name,color,icon}}`, `creator`
  - `likeCount: number`, `liked: boolean`, `taskProjects[{project, taskList}]`, `quests:[{id,title,xpReward,total,done}]`
- **Notes:** `description` may be a plain string or a BlockNote JSON array or object. iOS flattens it through `blockText()`.
- **Errors:** 404 `"Task not found"`.

#### `POST /api/tasks`
- **Auth:** project MEMBER.
- **iOS:** `APIClient.swift:1682` `createTask`. It returns `id`.
- **Request:** JSON (zod `createTaskSchema`):
  - Required: `title (1–500)`, `projectId`, `taskListId`.
  - Optional: `status: TODO|IN_PROGRESS|IN_REVIEW|DONE|CANCELLED`, `priority: URGENT|HIGH|MEDIUM|LOW|NONE`, `dueDate: string|null`, `startDate: string|null`, `description ≤10000|null`, `parentId|null` (subtask), `assigneeIds ≤50`, `tags ≤20`, `estimatedHours`, `taskType: TASK|MILESTONE|APPROVAL`, `isRecurring`, `recurPattern`.
  - iOS sends `status:"TODO"` and omits `priority` when it is `NONE`.
- **Response:** `201 Task`. Read `id`.
- **Errors:**
  - 400 `{error:"Validation failed", details:{field:[msg]}}`.
  - 400 `"Parent task not found in this project"`.
  - 400 `"Maximum subtask depth (5) reached"`.
  - 403, 404 `"TaskList not found"`.

#### `PATCH /api/tasks/{taskId}`
- **Auth:** project MEMBER. Rate limit: 60 per minute per user, then 429 `{error:"Too many requests. Please try again later."}` with a `Retry-After` header.
- **iOS:**
  - `APIClient.swift:1667` `updateTask(_:_:)`, used for title, status, priority, dueDate, startDate, description and assigneeIds (`TaskDetailView.swift:156–378`).
  - `APIClient.swift:1676` `setTaskStatus`.
  - Board drag, which sends `{taskListId}` (`ProjectBoardView.swift:415`).
- **Request:** JSON (zod `updateTaskSchema`), any subset of:
  - Content: `title`, `description|null`, `status`, `priority`, `dueDate|null`, `startDate|null`, `tags`.
  - Placement: `taskListId`, `position:int`, `projectContextId` (for a task multi-homed into another project).
  - People and time: `assigneeIds` (replaces the whole set), `estimatedHours`, `actualHours`.
  - Type and recurrence: `taskType`, `isRecurring`, `recurPattern`.
  - Send JSON `null` to clear a date.
- **Response:** `200 Task`, the updated row with assignees.
- **Errors:**
  - 400 `Validation failed`.
  - 400 `{code:"PROOF_REQUIRED", error:"Task ini butuh minimal 1 Bukti Pencairan dulu…"}` when moving to DONE on a project with `requireAttachmentForDone` and no `kind:PROOF` attachment. Show the error sentence to the user.
  - 403, 404, 429.
- ⚠ **Discrepancy:** `startDate`, `estimatedHours` and `actualHours` pass validation but the handler never writes them. iOS "Start date" edits (`TaskDetailView.swift:180`) are silently dropped with a 200. **SERVER CHANGE REQUIRED:** persist `startDate` in `PATCH /api/tasks/{id}`.

#### `DELETE /api/tasks/{taskId}`
- **Auth:** project LEAD.
- **iOS:** `APIClient.swift:839` `deleteTask`
- **Response:** `200 {message:"Task deleted"}`.
- **Errors:** 403 `"Forbidden: LEAD role required to delete tasks"`, 404.

### Custom fields

Types (server `SUPPORTED_CUSTOM_FIELD_TYPES`): `TEXT, URL, FILE, NUMBER, SELECT, MULTI_SELECT, STATUS, DATE, CREATED, PLACE`.

`options` is normalised per type:
- NUMBER: `{format:"currency-idr"}|null`
- SELECT, MULTI_SELECT and STATUS: `{options: string[], optionTemplates?}`. It may also arrive as a bare array. iOS `CFOptions` accepts `[..]`, `{options}` and `{choices}`.

#### `GET /api/custom-fields?projectId=…[&taskId=…][&includeLibrary=1]`
- **Auth:** workspace routing access to the project.
- **iOS:** `APIClient.swift:1693` `projectCustomFields` (definitions) and `APIClient.swift:1706` `taskCustomFields` (with values).
- **Response:** `200 {fields: Array<{id, projectId, libraryId|null, libraryName|null, libraryUsageCount, name, type, position, options, value (only with taskId, else null): string | string[] | {label, mapUrl} | null, createdMeta?:{userName,timestamp}}>, libraryFields: [...]}`. `libraryFields` is only non-empty with `includeLibrary=1`.
- **Errors:**
  - 400 `"projectId required"`.
  - 403.
  - 404 when the project is not found, or the task is not in the project.

#### `POST /api/custom-fields`
- **Auth:** project member.
- **iOS:** `APIClient.swift:1721` `createCustomFieldDef`
- **Request:** JSON `{projectId (req), name (req), type (req), options?, libraryId?, saveToLibrary?: bool}`.
- **Response:** `201 {field:{…}}`.
- **Errors:**
  - 400 `"Missing fields"` or `"Unsupported custom field type"`.
  - 403, 404.
  - 409 when the library field is already used in the project.

#### `PATCH /api/custom-fields`
One route with three modes:
- **Set a value:** `{id: fieldId, taskId, value}`. This is iOS `APIClient.swift:1699` `setCustomFieldValue`.
  - `value` is a string for TEXT, SELECT, STATUS, NUMBER and DATE; `string[]` for MULTI_SELECT; `{label, mapUrl}` for PLACE.
  - Response: `200 {fieldValue:{id, value, createdMeta?}}`.
- **Edit a definition:** `{id, name?, type?, options?, position?, promoteToLibrary?}`. This is iOS `APIClient.swift:1731` `updateCustomFieldDef`.
  - Response: `200 {field:{…}}`.
- **Reorder:** `{projectId, reorder: string[]}` → `{success:true}`. iOS does not use this.
- **Errors:**
  - 400 `"Missing field id"` or unsupported type.
  - 403.
  - 404 when the field is not found, or the task is not in the project.

#### `DELETE /api/custom-fields?id={fieldId}`
- **iOS:** `APIClient.swift:1743` `deleteCustomFieldDef`
- **Response:** `200 {success:true}`.
- **Errors:** 400 `"id required"`, 403, 404.

### Attachments & files

Size policy, shared with Z Vault:
- **Single request:** used for files ≤ **64 MiB** (`APIClient.singleRequestCeiling`, `APIClient.swift:1857`). The Cloudflare edge drops bodies of roughly 100 MB or more (measured: 120 MB answered 502 after 2.3 MB), so larger files must be chunked.
- **Chunked:** used above 64 MiB, with **16 MiB** chunks (`chunkBytes`, `APIClient.swift:1861`).
- **Server limits:**
  - At most 1 GiB per file.
  - Each chunk must be under 100 MiB (`MAX_CHUNK`, checked against `Content-Length`).
  - At most **64 chunks** per upload.
  - At most **4** concurrent upload sessions per user (else 429).
  - An idle session is reaped after 1 h.
  - 1 GiB ÷ 64 = 16 MiB is why the chunk size is exactly 16 MiB.
- **Endpoints without a chunk route:** form submits, chat photos, ticket evidence and icons have no chunk route and must fit in one request (≤64 MiB is the client-side ceiling; show `"This file is too big to upload here."`).

#### `GET /api/attachments?taskId=…`
- **Auth:** project VIEWER on the task's project.
- **iOS:** `APIClient.swift:1836` `taskAttachments`, cache `task-attachments-{taskId}`
- **Response:** `200 Array<{id, filename, name (= filename), url:"/api/files/attachments/{random}{ext}", mimeType, size, kind:"GENERAL"|"PROOF", taskId, uploaderId, createdAt}>`, newest first.
- **Errors:** 400 `"taskId is required"`, 403, 404 `"Task not found"`.
- **Notes:** iOS decodes `uploader?.name`, but the server does not include `uploader`. It is always absent.

#### `POST /api/attachments` (single request, ≤64 MiB)
- **Auth:** project MEMBER.
- **iOS:** `APIClient.swift:1869` `uploadAttachment(taskId:file:…)`, which routes by size, and `:1887` for the in-memory variant.
- **Request:** `multipart/form-data`:
  - text part `taskId` (req)
  - file part `file` (req). The iOS part Content-Type is `application/octet-stream`; the server resolves the MIME type from the filename.
  - optional text part `kind=PROOF` to mark a disbursement proof that satisfies `requireAttachmentForDone`.
- **Response:** `201 Attachment`.
- **Errors:**
  - 400 `"No file provided"` or `"taskId is required"`.
  - 400 `"File too large. Maximum size is 1GB"`.
  - 403, 404.
  - A 502 or 520–530 from the edge means the body was too big for Cloudflare. Switch to chunking.

#### `POST /api/attachments/chunk` (chunked, >64 MiB; also the Z Vault large-file path)
- **Auth:**
  - Task target: project MEMBER.
  - Vault target: write access to the parent folder, plus the workspace quota.
- **iOS:** `APIClient.swift:1921` `uploadInChunks`. It is called by `uploadAttachment` for task attachments and by `VaultAPI.swift:151` for the vault.
- **Request:** One POST per chunk, sent **sequentially, index 0…N-1**. All metadata goes in the QUERY string, and the body is the **raw chunk bytes**: `Content-Type: application/octet-stream`, not multipart. Query parameters:
  - `uploadId`: `^[A-Za-z0-9_-]{8,64}$`. iOS uses a fresh UUID string per file; reuse it for every chunk and every retry of the same file.
  - `chunkIndex`: int, `0 ≤ i < totalChunks`.
  - `totalChunks`: int, 1–64.
  - `totalSize`: int bytes, 1 ≤ n ≤ 1 GiB. It must equal the sum of the chunks.
  - `filename`: required. Percent-encode it as a query VALUE (`&`, `=`, `+`, `#` and `?` must be escaped).
  - `mime`: optional. iOS omits it; the server derives the type from the filename.
  - Task target: `taskId` (req), `kind=PROOF` (optional).
  - Vault target: `target=vault`, `parentId` (optional folder id).
  - A `Content-Length` header is required: a 1..MAX_CHUNK integer. Chunked transfer-encoding is refused.
- **Response:**
  - Non-final chunk: `200 {ok:true, received:i}`.
  - Final chunk (index N-1), which assembles the file:
    - Task target: `201 Attachment`.
    - Vault target: `201 VaultItem`.
  - A retry of a finalized upload with the same `uploadId` returns `200` with the stored result (idempotent). Re-sending the same chunk index overwrites that part.
- **Errors**, each a JSON `{error}`. Show the sentence and abort the whole upload.
  - 400 `Bad uploadId`, `Bad totalChunks`, `Bad chunkIndex`, `Bad chunk size`, `filename is required`, `taskId is required`, `No chunk body`, `Chunk write failed`, `Missing chunk {i}`, `Size mismatch`.
  - 400 `"File too large. Maximum size is 1GB"`.
  - 403, 404 (task or folder not found), 400 `"Tujuan bukan folder"`.
  - 409 `"Finalize lagi jalan, coba lagi."`: another finalize is running. Retry the final chunk after a short wait.
  - 413 `"Exceeds declared size"`.
  - 429 `"Terlalu banyak upload berjalan. Coba lagi sebentar."`: more than 4 sessions.
  - 507: the vault is over quota.
- **Notes:**
  - Finalize runs only when index N-1 arrives. If it arrives while earlier parts are missing, the result is 400 `Missing chunk i`, which is why the chunks must be sequential.
  - A chunk is a write. Replaying one over a second route is only safe under the same rule as other writes (see §1 `isReplayable`), although re-sending a chunk is idempotent by construction.
  - A single progress bar should span the whole file (iOS `beginWhole`/`endWhole`).

#### `DELETE /api/attachments/{attachmentId}`
- **Auth:** the uploader, or project MEMBER.
- **iOS:** `APIClient.swift:1967` `deleteAttachment`
- **Response:** 200.
- **Errors:** 403, 404 `"Attachment not found"`.

#### `GET /api/files/{…path}` (download any stored file: attachments, selfies, icons, chat images)
- **Auth:** a valid session JWT. This is a cookie-decode check only, with no per-file ACL; the random filename is the only obscurity.
- **iOS:** `APIClient.swift:1981` `downloadAttachment` (streams to disk), plus `ImageLoader` through `APIClient.routedRequest(for:)` (`APIClient.swift:424`).
- **Request:** `url` from a row may be relative (`/api/files/…`) or absolute. Resolve relative paths against the chosen base (LAN or public). Attach `Cookie` ONLY for the two NEXUS hosts (`nexus.znetworks.id` and `lan.nexus.znetworks.id`). `Range` is supported (206) for video.
- **Response:** the bytes, with `Content-Type` from the extension and inline disposition.
- **Errors:** 401 → log out, 403 for a path-traversal attempt, 404.
- **Notes:**
  - The URL→file mapping is permanent (a random name per upload), so the file can be cached on disk keyed by URL.
  - iOS keeps a 24 h / 512 MB browse cache and a separate 1 GB offline cache (`AttachmentCache`, `APIClient.swift:2513`). Both are wiped on logout.

### Comments, dependencies, time

#### `POST /api/tasks/{taskId}/comments`
- **Auth:** project MEMBER.
- **iOS:** `APIClient.swift:2058` `addComment`
- **Request:** JSON `{content: string (req), parentId?: string (reply), mentionedUserIds?: string[]}`. iOS sends `{content}` only.
- **Response:** `201 Comment {id, content, parentId, createdAt, user}`.
- **Errors:** 400 `"Content is required"`, 403, 404 when the task or parent comment is not found.
- **Notes:** Comments are READ through `GET /api/tasks/{id}` → `comments[]`. The dedicated `GET /api/tasks/{id}/comments` returns `{comments: threaded top-level with replies, currentUserId}`; iOS does not use it.

#### `GET /api/tasks/{taskId}/dependencies`
- **Auth:** session only. ⚠ No project access check.
- **iOS:** `APIClient.swift:2025` `taskDependencies`
- **Response:** `200 {dependencies: [{id, type, taskId, dependsOnTaskId, dependsOnTask:{id,title,status}}], dependedOnBy: [{id, type, …, task:{id,title,status}}]}`.

#### `POST /api/tasks/{taskId}/dependencies`
- **Auth:** session only. ⚠ No access check, and no cycle or self check.
- **iOS:** `APIClient.swift:2044` `addDependency`
- **Request:** JSON `{dependsOnTaskId (req), type?: "BLOCKING"}` (default BLOCKING).
- **Response:** `201 {dependency}`.
- **Errors:** 400. A duplicate dependency is a 500 (DB unique constraint), so guard against it client-side.

#### `DELETE /api/tasks/{taskId}/dependencies?id={dependencyId}`
- **iOS:** `APIClient.swift:2052` `removeDependency`
- **Response:** `200 {success:true}`.
- **Errors:** 400 `"id required"`. An unknown id is a 500.

#### `GET /api/time-entries?taskId=…`
- **Auth:** project VIEWER.
- **iOS:** `APIClient.swift:2029` `timeEntries`
- **Response:** `200 {entries: [{id, duration (minutes)|null, description|null, startTime, endTime|null, user:{id,name}, …}]}`.

#### `POST /api/time-entries`
- **Auth:** project MEMBER.
- **iOS:** `APIClient.swift:2033` `logTime`
- **Request:** JSON `{taskId (req), duration?: minutes 0…44640, description?: ≤1000, startTime?: ISO (default now), endTime?: ISO}`.
- **Response:** `201 {entry}`.
- **Errors:** 400 `Invalid date` or `Invalid duration`, 403, 404.
- The web also uses `PATCH /api/time-entries {id, …}` to edit an entry (owner or LEAD). iOS does not call it.

### Sprints & automations

#### `GET /api/sprints?projectId=…`
- **Auth:** session only (no project check).
- **iOS:** `APIClient.swift:850` `sprints`
- **Response:** `200 {sprints: [{id, name, status: PLANNING|ACTIVE|COMPLETED, startDate, endDate, tasks:[{task:{id,title,status,priority,assignees[{user:{id,name}}]}}]}]}`, ordered by startDate descending.

#### `POST /api/sprints`
- **iOS:** `APIClient.swift:854` `createSprint`
- **Request:** JSON `{projectId, name, startDate, endDate}`, all required. The dates are ISO or `yyyy-MM-dd`.
- **Response:** `201 {sprint}`.
- **Errors:** 400 `"Missing fields"`.

#### `PATCH /api/sprints`
- **iOS:** `APIClient.swift:862` `updateSprint`, which sends `{id, status}`.
- **Request:** JSON `{id (req), status?, name?, startDate?, endDate?, addTaskId?, removeTaskId?, moveIncompleteTo?: sprintId|"backlog"}`.
- **Response:** `200 {sprint}`, OR, when completing a sprint that still has unfinished tasks and `moveIncompleteTo` was not given, `200 {incompleteTasks:[…], requiresAction:true}`.
- ⚠ In the second case nothing is changed. iOS ignores the reply, so its "Selesaikan" button silently does nothing. Android should detect `requiresAction`, ask where the tasks go, and re-send with `moveIncompleteTo`.

#### `GET /api/automations?projectId=…`
- **Auth:** project MEMBER.
- **iOS:** `APIClient.swift:872` `automations`
- **Response:** `200 {automations: [{id, name, enabled, trigger:{type,field?,value?}, action:{type,field?,value?}}]}`.

#### `PATCH /api/automations`
- **Auth:** project LEAD.
- **iOS:** `APIClient.swift:876` `updateAutomation`, which sends `{id, enabled}`.
- **Request:** `{id (req), enabled?, name?, trigger?, action?}`.
- **Response:** `200 {automation}`.
- **Errors:** 403 `"Forbidden: LEAD role required…"`, 404.

### Finance / P&L dashboards (project tabs)

#### `GET /api/finance/dashboard?projectId=…&year=YYYY`
- **Auth:** project MEMBER.
- **iOS:** `APIClient.swift:883` `financeDashboard`
- **Response:** `200 {year, categories:[{id, kind, name, lineItems:[{id,name,total, …monthly}], subtotal}], totals:{opexByMonth[12], revenueByMonth[12], profitByMonth[12], opexTotal, revenueTotal, profitTotal}}`.
- **Errors:** 400, 403.

#### `GET /api/pnl/dashboard?projectId=…&year=YYYY[&month=1-12]`
- **Auth:** `checkPnlAccess`: the project must have `enablePnlDashboard`, and the caller needs finance access. On refusal, show `{error}` with the given status.
- **iOS:** `APIClient.swift:886` `pnlDashboard`
- **Response:** `200 {year, totals:{income, expense, profit, pipelineTotal, pipelineOutstanding, paidAllTime}, stages:[{id,name,color,count,outstanding}], incomes:[{id,title,totalAmount,paid,outstanding}], categories:[{id,name,color,total}], …}`.

### Search & docs

#### `GET /api/search?q=…`
- **Auth:** session. Scoped to your workspaces.
- **iOS:** `APIClient.swift:890` `search`
- **Request:** `q` (req; an empty value returns empty arrays). Optional: `projectId`, `assigneeId`, `status`, `startDate`, `endDate`.
- **Response:** `200 {tasks:[{id,title,…,relevance}], projects:[{id,name,color}], comments:[], docs:[{id,title}], members:[{id,name,email,avatar}], goals:[], forms:[{id,name}], sprints:[]}`. `relevance` is `"exact"|"partial"`.

#### `GET /api/docs[?projectId=…]`
- **Auth:** session. Only docs in projects you are a member of.
- **iOS:**
  - `APIClient.swift:939` `docs()` returns all your docs.
  - `APIClient.swift:957` `projectDocs` passes `projectId`.
- **Response:** `200 {docs: [{id, title, content, contentText?, icon, updatedAt, author, owner, project:{id,name,color}}]}`.

#### `GET /api/docs/{docId}`
- **Auth:** session only. ⚠ No membership check.
- **iOS:** `APIClient.swift:942` `doc`
- **Response:** `200 {doc}`.
- **Errors:** 404 `"Not found"`.
- The web also creates, edits and deletes docs (`POST /api/docs`, `PATCH`/`DELETE /api/docs/{id}`). iOS is read-only.

### Room booking & team calendar

#### `GET /api/room-bookings?rangeStart=ISO&rangeEnd=ISO[&room=…]`
- **Auth:** session. Covers your workspaces, ACTIVE bookings only.
- **iOS:** `APIClient.swift:1063` `roomBookings`
- **Response:** `200 {bookings: [{id, room, title, description, startsAt, endsAt, status, createdBy:{name,…}}]}`.
- **Errors:** 400 when a range bound is missing or invalid.
- The web also creates bookings (`POST /api/room-bookings {room, title, startsAt, endsAt, description?}` → 201, or 409 on overlap). iOS is read-only.

#### `GET /api/master-calendar?teamId=…&rangeStart=ISO&rangeEnd=ISO`
- **Auth:** team visible to the caller.
- **iOS:** `APIClient.swift:1072` `masterCalendar`
- **Request:** `teamId` is **REQUIRED**. For "all teams", call once per team and merge.
- **Response:** `200 {events: [{id, title, startsAt, endsAt, isAllDay, location, …}]}`.
- **Errors:**
  - 400 `"teamId, rangeStart, and rangeEnd are required"` or `"Invalid date range"`.
  - 403, 404 `"Team not found"`.

### Teams & divisions

#### `GET /api/teams`
- **Auth:** session.
- **iOS:** `APIClient.swift:1060` `teams`
- **Response:** `200 Array<{id, name, color, divisionId|null, workspaceId, position, attendanceShiftOverrideEnabled, attendanceShiftStartTime, attendanceShiftEndTime, division:{id,name,color}|null, members:[{id, userId, role, isAttendancePrimary, user:{id,name,email,avatar}}], projects:[{id, projectId, project:{id,name,color,icon,status}}], workspace:{slug,name}, isPrimaryTeam, canManage, canManageAttendanceSettings}>`.
- Hide mutating controls unless `canManage` is set. The server re-checks every action anyway.

#### `GET /api/teams?resource=divisions`
- **iOS:** `APIClient.swift:1039` `divisions`
- **Response:** `200 Array<{id, name, color, position, workspaceId}>`.

#### `POST /api/teams` (one route, dispatched on `action`)
iOS funnel: `APIClient.swift:969` `teamAction`. Every action needs manage rights on the team's workspace (BOD, MANAGER or ONE_ABOVE_ALL); refusal is 403 `{error}`.

| `action` | body | reply | iOS |
|---|---|---|---|
| *(none)*: create team | `{name (req), color?}` | `201 Team` | `:1032` `teamCreate` (decodes `Team`) |
| `add-member` | `{teamId, userId}` or `{userIds[]}` / `{email}` / `{emails[]}` | 200 `{…}` | `:978` |
| `remove-member` | `{teamId, userId}` | `{removed:true}`. 400 when removing someone from the required primary team | `:983` |
| `link-project` | `{teamId, projectId}` | `201 link`. 400 when the project is in another workspace | `:988` |
| `unlink-project` | `{teamId, projectId}` | `{unlinked:true}` | `:993` |
| `rename-team` | `{teamId, name}` | `Team`. 409 on duplicate name | `:998` |
| `delete-team` | `{teamId}` | `{deleted:true}`. 400 for the primary team | `:1003` |
| `set-team-division` | `{teamId, divisionId: string\|null}`. Send JSON `null` to detach; do not omit the key | `{updated:true, divisionId}` | `:1008` |
| `set-attendance-primary` | `{teamId, userId, isAttendancePrimary: bool}` | `{updated:true}` | `:1017` |
| `update-attendance-shift` | `{teamId, attendanceShiftOverrideEnabled: bool, attendanceShiftStartTime: "HH:mm"\|null, attendanceShiftEndTime: "HH:mm"\|null}`. Send nulls when disabled | `{team}`. 400 `"Valid team shift start and end time are required"` | `:1025` |
| `create-division` | `{name (req), color?, workspaceId?}` | `201 Division`. 409 on duplicate | `:1043` (decodes `Division`) |
| `update-division` | `{divisionId, name?, color?}` | `Division`. 409 on duplicate | `:1051` |
| `delete-division` | `{divisionId}` | `{deleted:true}` | `:1056` |
| `reorder-team` | `{teamId, position:number}` | `Team` | web-only |
| `set-member-role` | *(any)* | **410** `"Lead tim sudah tidak ada…"`. Team leads were removed; approvers live in the approval chart | none; do not implement |

Common errors are 400 (missing ids), 403, 404 and 409.

### Workspace roster (read side)

#### `GET /api/workspaces/members[?includeRegistered=1][&workspaceId=…][&teamId=…]`
- **Auth:** session plus a workspace membership (else 404 `"No workspace found"`).
- **iOS:**
  - `APIClient.swift:670` `workspaceInfo` decodes only `{workspaceId, role}`.
  - `APIClient.swift:1079` `roster(includeRegistered:)` decodes the full `WorkspaceRoster`.
- **Response:** `200` with this shape:
  ```ts
  {
    workspaceId: string, workspaceName: string,
    role: "ONE_ABOVE_ALL"|"BOD"|"MANAGER"|"STAFF",       // the CALLER's role
    members: Array<{
      id: string /* membership id — the `memberId` for PATCH/DELETE */, userId: string,
      name: string, email: string, avatar: string|null,
      phoneNumber?: string|null,          // key OMITTED unless caller is BOD+/system admin, or it is yourself
      googleWorkspaceEmail: string|null,
      role: string, attendanceRole: string,
      attendanceShiftStartTime: string|null, attendanceShiftEndTime: string|null,
      attendanceShiftByDay: { [isoWeekday: string]: {start: string, end: string} } | null,
      flexiTimeEnabled: boolean, noGeofenceMode: boolean, restDays: number[] /* 1=Mon…7=Sun */,
      approverId: string|null, approver: {id, name, avatar}|null,
      joinedAt: string
    }>,
    availableUsers?: Array<{id, name, email, avatar}>   // only with includeRegistered=1 AND caller MANAGER+/team manager; accounts in no workspace (Control Room "Masukkan")
  }
  ```
- **Notes:**
  - The member fields are FLAT on the member object, not nested under `user`. iOS keeps a `user` fallback for other endpoints.
  - The mutations on this route (`POST` invite, `PATCH` role/approver/shift/flags, `DELETE ?memberId=&workspaceId=`) are documented under Admin / Control Room.

### Web-only task endpoints (parity; iOS does not call any of these)

- `GET /api/tasks/{id}/likes` → `{count, liked}`. `POST` toggles and returns `{liked, count}`. `DELETE` → `{liked:false, count, likeCount}`. `GET /api/tasks/{id}` already carries `likeCount` and `liked`. *(web-only, iOS does not call)*
- `POST /api/tasks/{id}/comments/{commentId}/reactions {emoji}` toggles and returns `{toggled:"added", reaction}` (201) or `{toggled:"removed"}`. `DELETE` takes body `{emoji}` or `?emoji=` → `{toggled:"removed", removed, success}`. *(web-only, iOS does not call)*
- `PATCH /api/tasks/{id}/comments/{commentId} {content}` edits your own comment. `DELETE` works for the author or the project lead → `{success:true}`. *(web-only, iOS does not call)*
- `GET /api/tasks/{id}/followers` → `{followers, isFollowing}`. `POST` toggles and returns `{following}` (201 when it starts following). *(web-only, iOS does not call)*
- `POST /api/tasks/{id}/assignees {userId}` → 201 assignee, or 400 when the user is already assigned. `DELETE` with body `{userId}` → `{message}`. iOS instead sends `PATCH /api/tasks/{id} {assigneeIds}`, which replaces the whole set. *(web-only, iOS does not call)*
- `GET /api/tasks/{id}/relations` → `{relations}`. `POST {targetTaskId, type}` → 201 `{relation}`. `DELETE /api/tasks/{id}/relations/{relationId}`. *(web-only, iOS does not call)*
- `GET /api/tasks/{id}/comments` → `{comments (threaded), currentUserId}`. *(web-only; iOS reads comments from the task detail)*

## 2.5 Messages, Threads, Tickets, Inbox & announcements

All routes below require the session cookie (`Cookie: <cookieName>=<token>`) unless stated. A missing/expired session is `401 {error:"Unauthorized"}` on every one of them. `500 {error:"Internal server error"}` is the generic crash answer. iOS line numbers refer to `Sources/APIClient.swift` @ `a875c3c` unless another file is named.

### Messages (chat)

There is **no socket on mobile**: the iOS app polls an open thread (`Views/MessagesView.swift:483`). The web joins Socket.IO room `conversation:{id}` and listens for `message-created`; Android may do the same later (`/api/socket`, Engine.IO v4, JWT via cookie) but the contract below works without it.

#### `GET /api/conversations`
- **Auth:** session. **Side effect:** provisions a `PROJECT` room for every project the caller is a member of (and adds the caller to existing ones) before listing.
- **iOS:** `APIClient.swift:1568` `conversations()` — cached under key `conversations`.
- **Request:** none.
- **Response:** `200 { conversations: Conversation[] }`, newest activity first (`updatedAt desc`).
  ```ts
  type Conversation = {
    id: string; type: "DM" | "GROUP" | "PROJECT"; name: string | null; projectId: string | null
    members: { id: string; conversationId: string; userId: string; lastReadAt: string | null; joinedAt: string
               user: { id: string; name: string; avatar: string | null; email: string } }[]
    lastMessage: Message | null      // with user {id,name} only
    unreadCount: number              // messages by others after the caller's lastReadAt
  }
  ```
- **Notes:** DM title = the other member's name (`MessagesModels.swift:24`). `unreadCount` only goes down when `POST …/read` is called — see below.

#### `POST /api/conversations`
- **Auth:** session.
- **iOS:** `APIClient.swift:800` `createConversation(type:userIds:name:)`.
- **Request (JSON):** `{ type: "DM" | "GROUP", userIds: string[], name?: string }` — `userIds` excludes/ignores the caller. Any `type` other than `"GROUP"` is stored as `DM`.
- **Response:** `201 { conversation: Conversation }` (new), or `200 { conversation }` when a DM with exactly that one other person already exists (de-duplicated — treat as "open chat with").
- **Errors:** `400 {error:"userIds required"}`.
- **Notes:** no workspace check on `userIds` here (server trusts the picker).

#### `GET /api/conversations/{conversationId}`
- **Auth:** member (PROJECT rooms: project MEMBER access). **iOS:** not used. Web uses it (`nexus-api.ts` `conversation(id)`) — optional for Android.
- **Response:** `200 { conversation: Conversation }` (members only, no lastMessage/unreadCount). `403`, `404`.

#### `PATCH /api/conversations/{conversationId}`
- **Auth:** member. **iOS:** `APIClient.swift:811` `renameConversation(_:name:)`.
- **Request:** `{ name: string }` (trimmed, 1–80 chars).
- **Response:** `200 { conversation: Conversation }`.
- **Errors:** `400 "A project chat is named after its project"` / `"A direct message has no name"` (only `GROUP` can be renamed), `400 "name required"`, `400 "name too long"`, `403`, `404`.

#### `POST /api/conversations/{conversationId}/members`
- **Auth:** member of a `GROUP`. **iOS:** `APIClient.swift:821` `addConversationMembers(_:userIds:)`.
- **Request:** `{ userIds: string[] }`. People the caller cannot reach (`reachableUserIds` — outside their workspace) or already in the room are silently skipped.
- **Response:** `200 { conversation: Conversation, added: number }`. Each added person gets a `MESSAGE` notification (push) "X added you to …" with link `/messages?c=<id>`.
- **Errors:** `400 "Only group chats can change members"`, `400 "userIds required"`, `403`, `404`.

#### `DELETE /api/conversations/{conversationId}/members`  *(web-only parity; iOS does not use)*
- **Request:** `{ userId: string }`. **Response:** `200 { conversation }`. **Errors:** `400 "userId required"`, `400 "A group needs at least one member"`.

#### `GET /api/conversations/{conversationId}/messages`
- **Auth:** member (PROJECT: project access). **iOS:** `APIClient.swift:1573` `conversationMessages(_:)` — cached under `messages-<id>`; iOS never pages.
- **Query:** `limit?` (default 50, max 100), `before?` (ISO timestamp; returns messages strictly older — web uses it for "load earlier").
- **Response:** `200 { messages: Message[], hasMore: boolean }`, **oldest → newest** (the server reverses its desc query).
  ```ts
  type Message = {
    id: string; conversationId: string; userId: string; content: string   // "" when the message is only a photo
    attachmentUrl: string | null      // always "/api/files/chat/<uuid>.<ext>" when set
    attachmentType: string | null     // MIME, e.g. "image/jpeg"
    replyToId: string | null
    createdAt: string
    user: { id: string; name: string; avatar: string | null }
    replyTo: { id: string; content: string; attachmentType: string | null; user: { id: string; name: string } } | null
  }
  ```
- **Errors:** `403 {error:"Forbidden"}`, `404` (status carried in the 403 body path: unknown conversation answers **404** with `error:"Forbidden"`).

#### `POST /api/conversations/{conversationId}/messages`
- **Auth:** member. **iOS:** `APIClient.swift:1580` `sendMessage(_:content:mentionedUserIds:attachmentUrl:attachmentType:replyToId:)`.
- **Request (JSON):**
  | field | type | req | notes |
  |---|---|---|---|
  | `content` | string | yes* | trimmed; *may be empty when an attachment is present |
  | `mentionedUserIds` | string[] | no | filtered to room members; server ALSO resolves `@NameWithoutSpaces` tags in `content` |
  | `attachmentUrl` | string | no | **must start with `/api/files/chat/`** (i.e. the `url` from `/api/upload/chat`); anything else is silently dropped |
  | `attachmentType` | string | no | kept only with a valid attachment, truncated to 64 chars |
  | `replyToId` | string | no | must be a message in the same conversation |
- **Response:** `201 { message: Message }`.
- **Errors:** `400 "content required"` (no text and no valid attachment), `400 "replyToId is not in this conversation"`, `403`, `404`.
- **Side effects:** socket `message-created`; every other member gets a push-enabled notification: type `MESSAGE_MENTION` ("X mentioned you") or `MESSAGE` ("New message from X"), link `/messages?c=<conversationId>`.
- **Notes:** not idempotent — never auto-retry after a timeout (see `isReplayable`).

#### `POST /api/conversations/{conversationId}/read`  *(web uses; iOS does NOT)*
- **Auth:** member (non-member → `403`). **Request:** no body. **Response:** `200 { success: true }`; sets the caller's `lastReadAt = now`.
- ⚠ **Discrepancy / parity gap:** iOS never calls this, so a conversation read on iPhone keeps its `unreadCount` until opened on the web. **Android should call it when a thread is opened and when new messages arrive while it is open.**

#### `POST /api/upload/chat`
- **Auth:** session + membership row in the conversation (`ConversationMember`; PROJECT rooms are provisioned by `GET /api/conversations`, so call that first).
- **iOS:** `APIClient.swift:1596` `uploadChatImage(conversationId:fileName:mime:data:progress:)`; caller sends `photo.jpg`, `image/jpeg` (`Views/MessagesView.swift:920`).
- **Request (multipart/form-data):** `conversationId` (text), `file` (file part). The part's **Content-Type must be one of** `image/png, image/jpeg, image/jpg, image/webp, image/gif` — the server checks `file.type`, NOT the filename, so `application/octet-stream` is refused. Max **8 MB** (single request; no chunk route).
- **Response:** `200 { url: "/api/files/chat/<uuid>.<ext>", type: string }` → pass `url`/`type` as `attachmentUrl`/`attachmentType` to `POST …/messages`.
- **Errors:** `400 "No file provided"`, `400 "conversationId required"`, `400 "Invalid file type. Allowed: PNG, JPG, WEBP, GIF"`, `400 "File too large. Maximum size is 8MB"`, `403`.
- **Notes:** the returned path is served by `GET /api/files/chat/…`, which requires the session cookie (load images through the authenticated client).

### Threads (company feed)

Limits (`src/lib/feed.ts`): text ≤ 280 chars, ≤ 4 images/post, ≤ 8 MB/image, ≤ 10 mentions, edit window 15 min, ≥ 20 s between posts, ≤ 30 posts/hour.

#### `GET /api/feed/posts`
- **Auth:** session. **iOS:** `APIClient.swift:1152` `feedPosts(limit:)` (sends `limit=30`, no cursor).
- **Query:** `limit` (1–50, default 20), `cursor` (opaque, from `nextCursor`), `mentions=me` (only posts mentioning the caller).
- **Response:** `200 { posts: Post[], nextCursor: string | null, hasMore: boolean }`
  ```ts
  type Post = {
    id: string; text: string; createdAt: string; editedAt: string | null
    likeCount: number; commentCount: number
    author: { id: string; name: string; avatar: string | null }
    images: { id: string; url: string; width: number | null; height: number | null; position: number }[]
    mentions: { userId: string; name: string | null }[]
    likedByMe: boolean; canDelete: boolean /* own post or BoD+ */; canEdit: boolean /* own post */
  }
  ```
- **Notes:** iOS decodes `posts ?? items` defensively; server only sends `posts`. iOS does not paginate — Android should.

#### `POST /api/feed/posts`
- **Auth:** session. **iOS:** `APIClient.swift:1180` `createPost(text:images:imageMeta:progress:)`.
- **Request — multipart/form-data (NOT JSON):**
  | part | type | notes |
  |---|---|---|
  | `text` | text | trimmed, ≤ 280 |
  | `mentions` | text | **a JSON-encoded string** array of user ids, e.g. `"[]"` (not a repeated field) |
  | `imageMeta` | text | JSON array of `{w,h}` positionally matching `images`; `{}` for unknown. Optional but lets the feed reserve aspect ratio |
  | `images` | file, repeated | same part name for every photo; iOS: `photo-<n>.jpg`, `image/jpeg` |
- **Response:** `201 Post` (bare object, `likedByMe:false`, `canDelete:false`).
- **Errors (all with Indonesian `error` sentences — show verbatim):** `422` text too long / empty post with no images / > 4 images / image > 8 MB / non-image; `429` "jeda 20 detik antar post" or hourly cap.
- **Side effects:** each valid mention → `feed_mention` notification (link `/threads?post=<id>`).

#### `PATCH /api/feed/posts/{id}`  *(web-only parity; iOS does not edit)*
- **Request:** `{ text: string, mentions: string[] }` (JSON). Own post only, within 15 min. **Response:** `200 Post`. **Errors:** `404`/`410` gone, `403`, `422` window passed / too long / empty.

#### `DELETE /api/feed/posts/{id}`
- **Auth:** author, or BoD+ (moderation). **iOS:** `APIClient.swift:1234` `deletePost(_:)`.
- **Response:** `200 { success: true }` — soft delete (`deletedAt`). **Errors:** `404 "Post tidak ditemukan."`, `403`.

#### `POST /api/feed/posts/{id}/like`
- **Auth:** session. **iOS:** `APIClient.swift:1241` `likePost(_:)`. **Request:** no body. **Toggle.**
- **Response:** `200 { liked: boolean, likeCount: number }` — use it to reconcile optimistic UI. **Errors:** `404`.

#### `GET /api/feed/posts/{id}/comments`
- **iOS:** `APIClient.swift:1155` `postComments(_:)`.
- **Response:** `200 { comments: { id: string; text: string; postId: string; authorId: string; createdAt: string; deletedAt: null; author: { id, name, avatar } }[] }` (oldest first).

#### `POST /api/feed/posts/{id}/comments`
- **iOS:** `APIClient.swift:1221` `addPostComment(postId:text:)`.
- **Request (JSON):** `{ text: string, mentions: string[] }` (text ≤ 1000).
- **Response:** `201` the comment object (bare). **Errors:** `422 "Komentar gak boleh kosong."` / `"Komentar terlalu panjang."`, `404`.
- **Side effects:** `feed_comment` notification to the post author and mentioned users (link `/threads?post=<id>`).

### Tickets ("complaints" — private line to the BoD)

Statuses: `OPEN | AWAITING_DECISION | IN_REVIEW | RESOLVED | CLOSED`. Categories accepted: `ATTENDANCE | EXP | DAY_OFF | OTHER` (iOS `Views/TicketsView.swift:1312`). Subject 4–140 chars, body 10–4000 chars. Viewer is scoped to the first workspace membership: BoD+ sees all tickets of the workspace, everyone else only their own.

#### `GET /api/complaints`
- **iOS:** `APIClient.swift:1250` `complaints()` (no filter; filters client-side).
- **Query:** `status?` comma list of statuses or `ALL`.
- **Response:** `200 { complaints: Complaint[], counts: Record<Status | "INBOX" | "REVIEW", number>, viewerIsBod: boolean }` (≤ 200, `lastMessageAt desc`).
  ```ts
  type Complaint = {
    id: string; category: string; subject: string; evidenceUrl: string | null
    attachments: { id: string; url: string; mimeType: string; size: number }[]
    status: Status; lastMessageAt: string; resolvedAt: string | null; createdAt: string
    reporter: { id: string; name: string; avatar: string | null } | null   // null = anonymous to this viewer
    messageCount: number; gideonReplied: boolean; pendingCorrection: boolean
    isMine: boolean; canReply: boolean; canManage: boolean
  }
  ```
- **Errors:** `403` (no workspace membership).

#### `POST /api/complaints`
- **iOS:** `APIClient.swift:1263` `createComplaint(category:subject:body:evidence:progress:)`.
- **Request — multipart/form-data:** `category`, `subject`, `body` (text parts) + **1–5** `evidence` file parts (all share the part name `evidence`; iOS names them `evidence-<n>.jpg`, `image/jpeg`). Each ≤ 8 MB and must resolve to `image/*` (MIME or extension).
- **Response:** `201 Complaint`.
- **Errors (422, sentence in `error`):** invalid category, subject/body length, `"Foto bukti wajib dilampirin."` (no photo), `> 5` photos, photo too big / not an image.
- **Side effects:** `complaint_filed` push to every BoD; categories handled by GIDEON Support get an automatic reply.

#### `GET /api/complaints/{id}`
- **iOS:** `APIClient.swift:1296` `complaintDetail(_:)`.
- **Response:** `200 ComplaintDetail = Complaint & { resolvedBy: {id,name} | null; messages: { id; body; fromReviewer: boolean; createdAt; author: {...}; mine: boolean; fromGideon: boolean }[]; corrections: AttendanceCorrection[] }`.
- **Errors:** `403`, `404`.

#### `PATCH /api/complaints/{id}`
- **Auth:** BoD+ only. **iOS:** `APIClient.swift:1340` `updateComplaintStatus(_:status:)`.
- **Request:** `{ status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "CLOSED" }`. `AWAITING_DECISION` is refused (set automatically).
- **Response:** `200 ComplaintDetail`. RESOLVED/CLOSED stamp `resolvedAt/resolvedBy`.
- **Errors:** `403`, `404`, `422 "Status gak valid."`, `422 "Status ini diatur otomatis, gak bisa disetel manual."`.
- **Side effects:** `complaint_status` push to the reporter.

#### `POST /api/complaints/{id}/messages`
- **Auth:** reporter or BoD+. **iOS:** `APIClient.swift:1308` `replyToComplaint(_:body:)`.
- **Request:** `{ body: string }` (≥ 10, ≤ 4000).
- **Response:** `200 ComplaintDetail` (redraw from it; a BoD reply to an OPEN/AWAITING ticket moves it to IN_REVIEW).
- **Errors:** `422 "Balasan minimal 10 karakter."`, `409 "Keluhan ini sudah ditutup."`, `403`, `404`.
- **Side effects:** `complaint_reply` push (to reporter, or to every BoD).

#### `GET /api/complaints/{id}/correction`
- **Auth:** reporter or BoD+. **iOS:** `APIClient.swift:1369` `attendanceCorrections(complaintId:)`.
- **Response:** `200 { corrections: AttendanceCorrection[], canDecide: boolean }` (`canDecide` = viewer may APPROVE/REJECT).
  ```ts
  type AttendanceCorrection = {
    id: string; complaintId: string; status: "PENDING" | "APPROVED" | "REJECTED"
    kind: "TIME_CORRECTION" | "PENALTY_CANCELLATION"
    date: string /* YYYY-MM-DD, office time */; user: {...}
    proposedCheckInAt: string | null; proposedCheckOutAt: string | null; reason: string; proposedBy: {...}
    before: { recordId: string | null; checkInAt: string | null; checkOutAt: string | null; status: string | null }
    beforePenaltyXp: number | null; beforeAutoDayOffs: number | null; /* + decision fields */
  }
  ```

#### `POST /api/complaints/{id}/correction`
Two shapes on one route. **iOS:** `APIClient.swift:1376` `decideAttendanceCorrection(…)`, `:1389` `proposeAttendanceCorrection(…)`, both through `:1401` `postCorrection`.
- **PROPOSE** (reporter or BoD): `{ decision: "PROPOSE", date: "YYYY-MM-DD", checkInAt?: "HH:mm", checkOutAt?: "HH:mm", reason: string, kind?: "TIME_CORRECTION" | "PENALTY_CANCELLATION" }`. Omit a time you are not changing (do not send null). `kind` defaults to `TIME_CORRECTION`; `PENALTY_CANCELLATION` takes no times.
  - **Response:** `200 { correction }`. **Errors:** `422` with a sentence (ticket category not ATTENDANCE/EXP, not your day, one live proposal already, bad time…), `404` (not accessible), `422` bad `kind`.
  - ⚠ **Parity:** iOS never sends `kind` (only time corrections); the web offers both. Android should offer both.
- **APPROVE / REJECT** (BoD / One-Above-All / admin — `canManageAttendance`): `{ decision: "APPROVE" | "REJECT", correctionId?: string, note?: string }`.
  - **Response:** `200 { correction, record: AttendanceRecord | null }` (APPROVE of a time correction returns the rewritten record).
  - **Errors:** `403`, `404 "Gak ada usulan koreksi di tiket ini."`, `409` already decided, **`409` optimistic lock** — the record moved since the proposal's snapshot; re-sending the same proposal will keep failing, the reporter must file a new one (iOS shows a fixed sentence, `APIClient.swift:1419`), `422` time validation, `500` "Gagal mengembalikan XP-nya…" (still PENDING — retry allowed).

### Inbox (in-app notifications)

#### `GET /api/notifications`
- **Auth:** session. **iOS:** `APIClient.swift:1643` `notifications()`; `:922` `unreadCount()` uses the same call and reads only `unreadCount`.
- **Query:** `unread=true` → unread only.
- **Response:** `200 { notifications: Notification[] /* ≤ 50, newest first */, unreadCount: number }`
  ```ts
  type Notification = { id: string; type: string; title: string; message: string; read: boolean
                        link: string | null; createdAt: string; userId: string; taskId: string | null; projectId: string | null }
  ```
- **Notes:** tapping a row routes exactly like a push tap (§3): `taskId` → task, else `projectId` → project, else `link`. Type strings are in §3.

#### `PATCH /api/notifications`
- **iOS:** `APIClient.swift:1648` `markNotificationRead(id:)`, `:1657` `markAllNotificationsRead()`.
- **Request:** `{ id: string }` or `{ markAllRead: true }`. **Response:** `200 { success: true }`. **Errors:** `400 "id or markAllRead required"`.

#### `DELETE /api/notifications`  *(web-only parity)*
- `?clearRead=true` → `200 { deleted: n }` (all read ones); body `{ ids: string[] }` → `{ deleted }`; body `{ id }` → `{ success: true }`.

#### `GET | PUT | PATCH /api/notifications/preferences`  *(web-only; optional for Android)*
- GET → `200 { emailEnabled, waEnabled, slackEnabled, desktopEnabled, desktopSoundEnabled, waPhone, slackWebhook, taskAssigned, taskDueSoon, commentMention, projectInvite, statusUpdate, preferences: <same object> }`.
- PATCH: any subset of the booleans (+ `waPhone`, `slackWebhook`); non-boolean → `400`. PUT replaces all.
- **Push-relevant:** `taskAssigned`, `taskDueSoon`, `commentMention`, `projectInvite`, `statusUpdate` decide whether the matching notification is also pushed (the inbox row is always written). Do-not-disturb is `dndUntil` on `PATCH /api/user/profile` (suppresses attendance-reminder pushes).

### Push device registration

#### `POST /api/push/devices`
- **Auth:** session. **iOS:** `APIClient.swift:1612` `registerPushDevice(token:deviceId:environment:)`, called from `NotificationManager.swift:117` after every token delivery and on every activation.
- **Request (JSON):**
  | field | iOS value | server rule |
  |---|---|---|
  | `token` | APNs token, hex | **lower-cased, must match `/^[a-f0-9]{32,200}$/`** |
  | `deviceId` | persisted random UUID (`nexus.device-id`) | non-empty |
  | `bundleId` | `"id.znetworks.nexus"` | **must equal `id.znetworks.nexus`** |
  | `environment` | `"sandbox"` \| `"production"` | must be one of those two |
  | `appVersion`, `buildNumber`, `osVersion`, `deviceModel` | from bundle/UIDevice | optional, trimmed to 40 chars; shown in Control Room → App tab |
- **Response:** `200 { success: true }`. Upserts `DeviceInstallation` by `token` (re-enables a disabled one, re-assigns to the caller), and deletes the caller's older tokens with the same `(deviceId, bundleId)`.
- **Errors:** `400 {error:"Invalid device registration"}`.
- ⚠ **Android cannot register today.** An FCM token contains `:`, `-`, `_` and upper-case letters, is case-sensitive, and there is no `platform` field — the regex refuses it, and lower-casing would corrupt it even if it passed. `bundleId` is pinned to the iOS id. **SERVER CHANGE REQUIRED** — see §3 and §4.

#### `DELETE /api/push/devices`
- **Auth:** the session being signed out (iOS builds the request `authed:false` then sets the old session's Cookie explicitly, `APIClient.swift:1634`, called from `AuthStore.logout()` → `NotificationManager.unregister`).
- **Request:** `{ token: string }` (lower-cased server-side). **Response:** `200 { success: true }` (deletes the caller's row for that token). **Errors:** `400 "token required"`.
- **Notes:** send it BEFORE clearing the stored session, otherwise the server can no longer attribute the token.

### Announcements

Tones: `info | success | warning`. "BoD" here = platform `ADMIN` or any workspace role `BOD`/`ONE_ABOVE_ALL`.

#### `GET /api/announcements/active`
- **Auth:** optional — signed out answers `200 { announcements: [] }` (also on any error). **iOS:** `APIClient.swift:1487` `activeAnnouncements()` drives the pop-up.
- **Response:** `200 { announcements: { id, title, body, tone, imageUrl: string | null, createdAt }[] }` — active, not yet seen by the caller, targeted at everyone or at the caller; ≤ 5, newest first.
- **Notes:** repeating announcements come back daily: the cron `/api/cron/announcement-repeat` deletes `AnnouncementSeen` rows until `repeatUntil`.

#### `GET /api/announcements/{id}`
- **Auth:** session; targeted announcements are `404` to non-targets unless BoD. **iOS:** `APIClient.swift:1499` `announcement(_:)` — resolves a tapped `/dashboard?announcement=<id>` even if already seen/inactive.
- **Response:** `200 { announcement: { id, title, body, tone, imageUrl, active, createdAt, authorName: string | null } }`. **Errors:** `404`, `500 {error:"Failed"}`.

#### `POST /api/announcements/{id}/seen`
- **iOS:** `APIClient.swift:1505` `markAnnouncementSeen(_:)`. **Response:** `200 { ok: true }` (idempotent upsert).

#### `GET /api/announcements`
- **Auth:** BoD. **iOS:** `APIClient.swift:1510` `announcements()` (Control Room).
- **Response:** `200 { announcements: { id, title, body, tone, active, createdAt, seenCount, repeatUntil, repeatAtTime, lastRepeatedAt, targetUserIds: string[], targetCount }[] }`. **Errors:** `403`.

#### `POST /api/announcements`
- **Auth:** BoD. **iOS:** `APIClient.swift:1518` `createAnnouncement(title:body:tone:repeatDays:repeatAtTime:)`.
- **Request:** `{ title: string, body: string, tone?: Tone, targetUserIds?: string[], repeatDays?: number /* 0–30, days AFTER today */, repeatAtTime?: "HH:mm" /* Asia/Jakarta, required when repeatDays > 0 */ }`. iOS omits both repeat keys when `repeatDays == 0`; it never sends `targetUserIds` (web does — parity optional).
- **Response:** `201 { announcement }` (raw row). Pushes `announcement` to every target (title `📣 <title>`, link `/dashboard?announcement=<id>`).
- **Errors:** `400 "title & body required"`, `422 "Jam pengulangan harus format HH:mm (24 jam)."`, `403`.

#### `PATCH /api/announcements/{id}`
- **Auth:** BoD. **iOS:** `APIClient.swift:1532` `updateAnnouncementActive(id:active:)` (sends only `active`).
- **Request:** any of `{ title, body, tone, active }`. **Response:** `200 { announcement }`. **Errors:** `403`, `500` for an unknown id (Prisma throws — no 404).

#### `DELETE /api/announcements/{id}`
- **Auth:** BoD. **iOS:** `APIClient.swift:1540` `deleteAnnouncement(_:)`. **Response:** `200 { ok: true }`. Unknown id → `500`.

## 2.6 Forms, Z Vault, Reports, Gamification, Control Room, GIDEON & version policy

Unless stated otherwise every endpoint here: session cookie required (401 `{error:"Unauthorized"}` → logout), errors are `{error: string, code?: string}`, 500 = `{error:"Internal server error"}` (or a route-specific sentence). iOS line numbers refer to nexus-ios @ a875c3c.

### Forms

#### `GET /api/forms?projectId=<id>`
- **Auth:** session + project access.
- **iOS:** `APIClient.swift:945` `forms(projectId:)` (no cache).
- **Request:** `projectId` required.
- **Response:** 200 `Form[]` — raw Prisma rows: `{id, name, description|null, slug, isPublic, requireAuth, projectId, fields: FormField[], branding, accessSchedule, createdAt, updatedAt, _count:{submissions:number}}`. The client only needs `id,name,description,isPublic,projectId,_count.submissions`.
- **Errors:** 400 `projectId is required`, 403 `Forbidden`.
- **Notes:** a form without a slug gets one generated on read (side effect).

#### `GET /api/forms/{idOrSlug}/public`
- **Auth:** none required (send the cookie anyway; harmless).
- **iOS:** `FormFillAPI.swift:47` `publicForm(_:)` → `fetchForm` (`:59`).
- **Response:** 200 `{id, name, description, fields: FormField[], branding, accessSchedule, isPublic, requireAuth, taskLists:{id,name}[]}`. Any field with `mapping.target == "task_list"` has its `options` replaced by the project's CURRENT section names.
- **Errors:** 404 `Form not found`; 403 `{error:"This form is not publicly accessible"}` (private form → fall back to the member route below); 403 `{error:<schedule sentence>, accessSchedule:{…}}` = "closed right now, come back later" — show the sentence, do NOT fall back. Distinguish the two 403s by the **presence** of `accessSchedule`.

#### `GET /api/forms/{id}` (fallback for non-public forms)
- **Auth:** session + project MEMBER.
- **iOS:** `FormFillAPI.swift:51` (only after the public route refused without `accessSchedule`).
- **Response:** 200 raw form row (same `fields`). Id only (no slug), options NOT re-synced, schedule NOT checked (submit re-checks it).
- **Errors:** 401, 403 `Forbidden`, 404 `Form not found` → show "private or no longer exists".

**FormField** (as decoded by `FormFillModels.swift:38`): `{id, name?, label?, type, required, placeholder?, options: string[] | {choices:string[]} (scalars may be bool/number → stringify), attachmentEnabled?, autofill?, numberFormat?, showIf?: {fieldId, operator: "equals"|"not_equals"|"contains"|"is_empty"|"is_not_empty", value}}`. Render order (`Views/FormFillView.swift:199`): `textarea` → multiline; `dropdown`/`select` → single choice; `multi_select`; `checkbox` → bool; `file` → multi-file picker; else: currency when `numberFormat` is currency, read-only when `autofill` set, `date` → date picker (`yyyy-MM-dd`), `email`/`number` keyboards, otherwise text. Skip `section`/`heading` for answers. Hidden (`showIf` false) fields are not submitted.

#### `POST /api/forms/{idOrSlug}/submit`
- **Auth:** optional unless `form.requireAuth` or form is not public (then session + project MEMBER).
- **iOS:** `FormFillAPI.swift:81` `submitForm(_:data:files:progress:)`; body builder `:132`.
- **Request:** `multipart/form-data`:
  - part `data` (no filename, no Content-Type): JSON object `{<fieldId>: value}` — text/number/date → string, checkbox → bool, multi_select → string[], `file` field → comma-joined filenames; optional extra attachment recorded as `"attachment:<fieldId>": filename`.
  - file parts named `file:<fieldId>` (repeat for multi-file) and `attachment:<fieldId>`, each with `filename` and a real Content-Type. Strip `"`, CR, LF from filenames.
  - (Server also accepts `application/json` `{data}` without files.)
- **Response:** 201 `{submission:{id,…}, task:{id,title,status,…}}`.
- **Errors:** 400 `data is required` / `"<field> is required"` / `Invalid due date` / project config sentences; 401 `{code:"LOGIN_REQUIRED"}` — **do NOT log out** (iOS keeps the filled form, `FormFillAPI.swift:93`); 403 `Forbidden` or schedule sentence; 404 `Form not found`; 429 rate limit (20/min per user/IP, `Retry-After` header).
- **Limits:** 50 MB per file (client pre-checks `FormUpload.maxBytes`); whole request must fit one request (≤ 64 MiB client ceiling, Cloudflare ~100 MB).
- **Notes:** NOT replayable after a timeout (creates task, submission, attachments, automations, webhook). ⚠ Discrepancy: a file > 50 MB makes the server throw inside parsing → **500 "Internal server error"** instead of a 400; the client must enforce the 50 MB limit itself. SERVER FIX suggested (return 413 with the sentence).

#### `GET /api/forms/my-submissions`
- **iOS:** `APIClient.swift:948` `mySubmissions()` (cache `my-submissions`).
- **Response:** 200 `{submissions: {id, createdAt, formId|null, formName|null, projectId|null, projectName|null, taskId|null, taskTitle|null, status: TaskStatus|null, stage: string|null /*board column*/, procStatus: string|null /*"Status" custom field; null = not processed*/, proofs:{id,name,url,mimeType,size}[]}[], statusColumns: string[]}`.

#### `GET /api/forms/my-submissions/{submissionId}`
- **iOS:** `APIClient.swift:954` `mySubmissionDetail(_:)`.
- **Response:** 200 `{id, createdAt, formName, projectName, taskId, taskTitle, status, stage, procStatus, proofs:[…], answers:{id, label, type, value: any}[]}`.
- **Errors:** 404 `Submission not found` (also when it is not yours).
- (Server also has `DELETE` → `{deleted:true}`; iOS does not use it.)

### Z Vault

Common: `404 {error}` item missing, `403 {error:"No workspace"}` / `Forbidden` / Indonesian ownership sentences; show `error` verbatim (`VaultAPI.swift:228`). Ids are percent-encoded with `.alphanumerics` (`:236`). Quota 60 GB per workspace; max file 1 GB.

**VaultItem** = `{id, kind:"FOLDER"|"FILE", name, position, icon|null, color|null, mimeType|null, size|null, width|null, height|null, parentId|null, url: "/api/vault/items/<id>/raw"|null, downloadUrl: "…/raw?download=1"|null, uploader, owner, childCount, shareCount, minReadRole, minWriteRole, trashed, deletedAt|null, createdAt, updatedAt, canModify}`.

#### `GET /api/vault/items?parentId=&trash=1&q=`
- **iOS:** `VaultAPI.swift:18` `vaultList(parentId:trash:query:)`.
- **Request:** all optional. `trash=1` → flat trash view; `q` (≤100 chars) → workspace-wide search; else browse `parentId` (null = root).
- **Response:** 200 `{items: VaultItem[], breadcrumb:{id,name}[], parentId|null, canWrite:boolean, canManageAccess:boolean, quota:{usedBytes, totalBytes}}`. Folders first. Max 500 (200 for search/trash).
- **Errors:** 404 `Folder not found`, 400 `Not a folder`, 403.

#### `POST /api/vault/items` (create folder)
- **iOS:** `VaultAPI.swift:28` `vaultCreateFolder(name:parentId:)`.
- **Request:** JSON `{name, parentId?}`. **Response:** 201 `VaultItem`. **Errors:** 400/403/404.

#### `PATCH /api/vault/items/{id}`
- **iOS:** `VaultAPI.swift:38` `vaultRename` (`{name}`), `:43` `vaultRestore` (`{restore:true}`).
- **Request:** any of `{name?, parentId? /*move*/, icon?, color?, restore?: true, minReadRole?, minWriteRole? /*BoD only*/}`. Names are de-duplicated server-side.
- **Response:** 200 `VaultItem`. **Errors:** 400 `Tidak ada yang diubah` / bad move; 403 not uploader/BoD; 404.

#### `DELETE /api/vault/items/{id}[?purge=1]`
- **iOS:** `VaultAPI.swift:56` `vaultDelete(_:purge:)`.
- **Response:** 200 `{trashed:n}` (soft) or `{purged:n, filesUnlinked:n}` (purge, irreversible).

#### `POST /api/vault/trash/empty`
- **iOS:** `VaultAPI.swift:63`. **Response:** 200 `{purged, filesUnlinked, bytesFreed?}`.

#### `GET /api/vault/items/{id}/raw[?download=1]`
- **iOS:** `VaultAPI.swift:113` `vaultDownload(item:)` → `downloadAttachment(url: item.url)` (streams to disk, cached by URL).
- **Response:** 200 bytes. **Notes:** requires the session cookie → must be fetched by the app, never handed to a browser. ⚠ Cache key = stable item URL; if bytes can ever be replaced under the same id, key the cache on `updatedAt` too.

#### `POST /api/vault/upload` (≤ 64 MiB client-side; server single-shot cap 90 MiB)
- **iOS:** `VaultAPI.swift:126` `vaultUpload(file:fileName:parentId:progress:)`.
- **Request:** multipart: optional text part `parentId`, file part `file` (`filename` sanitized, `application/octet-stream`).
- **Response:** 201 `VaultItem`.
- **Errors:** 400 `file is required`/`File kosong`; 413 over 90 MB; 404/400 bad folder; 403; **507** quota full (`Vault penuh. Sisa X GB…`).
- **> 64 MiB:** chunked `POST /api/attachments/chunk?…&target=vault[&parentId=<id>]` (same transport as task attachments, 16 MiB chunks, ≤ 64 chunks, 1 GB max; quota checked on every chunk → 507). Last chunk answers 201 with the created `VaultItem`.

#### `GET /api/vault/shares?itemId=<id>`
- **iOS:** `VaultAPI.swift:69`. **Response:** 200 `{shares: VaultShare[]}`.
- **VaultShare** = `{id, slug, itemId, url /*https://nexus.znetworks.id/v/<slug> if requireAuth else /s/<slug>*/, requireAuth, allowDownload, expiresAt|null, revokedAt|null, status:"active"|"revoked"|"expired", viewCount, lastViewedAt|null, createdAt, createdBy|null}`.

#### `POST /api/vault/shares`
- **iOS:** `VaultAPI.swift:74` `vaultCreateShare(itemId:requireAuth:allowDownload:expires:)`.
- **Request:** JSON `{itemId, requireAuth: bool (default true), allowDownload: bool (default true), expires: "3d"|"7d"|"14d"|"30d"|"permanent" (default permanent)}`.
- **Response:** 201 `VaultShare`. **Errors:** 400 folder (`Folder belum bisa dibagikan`) / unknown `expires`; 403 external link (`requireAuth:false`) needs modify rights.

#### `DELETE /api/vault/shares/{shareId}`
- **iOS:** `VaultAPI.swift:88` `vaultRevokeShare`. **Response:** 200 `VaultShare` (status `revoked`). **Errors:** 403 someone else's link.

#### `GET /api/vault/public/{slug}`
- **Auth:** none for `/s/` links; session for `requireAuth` (`/v/`) links. iOS always sends the cookie.
- **iOS:** `VaultAPI.swift:95` `vaultPublic(slug:)` (opened from a `/v/<slug>` app link).
- **Response:** 200 `{slug, requireAuth, allowDownload, file:{name,mimeType,size,width,height}, previewUrl:"/api/vault/public/<slug>/raw", downloadUrl: "…/raw?download=1"|null}`.
- **Errors:** 401 `{reason:"auth_required", requireAuth:true}`; 404 `{reason:"missing"}`; 410 `{reason:"revoked"|"expired"|"gone"}`.
- **Android:** claim `https://nexus.znetworks.id/v/*` only (App Links / `assetlinks.json` — SERVER CHANGE REQUIRED, see checklist); never `/s/*`.

### Reports

#### `GET /api/reports?days=<n>`
- **iOS:** `APIClient.swift:960` `reports(days:)` (cache `reports-<days>`).
- **Request:** `days` 1…365 (default 30). Also accepted: `projectIds`, `memberIds` (BoD only), `from`, `to`.
- **Response:** 200 `{metrics:{totalTasks, completedTasks, overdueTasks, completionRate, completionTrend, avgCompletionDays, completedInPeriod, completedPrevPeriod}, tasksByStatus:{status,count}[], tasksByPriority:{priority,count}[], completionTimeline, tasksByAssignee, overdueTrend, sprintBurndowns, workloadHeatmap, projectHealth, projects}`.

#### `GET /api/reports/people?period=YYYY-MM&teamId=`
- **iOS:** `ReportsPeopleAPI.swift:19` `reportRoster(period:teamId:)` (cache `report-roster-<period|current>-<teamId|all>`).
- **Request:** `period` (attendance period 28th→27th, omit = current; the server decides "current"), or `from`+`to` (YYYY-MM-DD, ≤ max window), `teamId?`, `userIds?` (comma list, `me` allowed), `includeExempt=1`.
- **Response:** 200 `{scope:"SELF"|"DIRECT_REPORTS"|<all>, period: ReportPeriod, previousPeriod, team:{id,name}|null, rows:{userId,name,email,avatar,role,approverId,teams:{id,name}[], headline: Headline, previous: Headline, flags:{overdue3,late3,lowReflections}, flagCount}[], generatedAt}`.
  - `ReportPeriod = {key|null, from, to, timezone, isCurrent, days, daysElapsed}`; `Ratio = {num, den}`; `Headline = {assigned, completed, onTime:Ratio, overdue, medianCycleDays|null, present, late, lateMinutes, earlyLeave, absent, leave, sick, permit, dayOff, avgWorkedMinutes|null, attendanceRate:Ratio, lateRate:Ratio, reflectionRate:Ratio, xpScore, xpPenalty}`.
- **Errors:** 403 `{code:"REPORT_SELF_ONLY"}` = staff; not a fault → hide the team view, show own report. 403 `{code:"REPORT_OUT_OF_SCOPE"}`; 400 bad period; 404 team/workspace.

#### `GET /api/reports/people/{userId|me}?period=YYYY-MM`
- **iOS:** `ReportsPeopleAPI.swift:10` `personReport(userId:period:)` (cache `report-person-<userId>-<period|current>`).
- **Response:** 200 `{person:{id,name,email,avatar,role,approverId,teams,isSelf}, viewerScope, period, previousPeriod, headline, previous, work: {assigned, completed, onTime, dueWithDate, overdueNow, overdueList:{id,title,projectId,projectName,dueDate,dueKey,daysOverdue,priority,assigneeCount,share}[], openTotal, openByPriority:{URGENT,HIGH,MEDIUM,LOW,NONE}, dueNext7, medianCycleDays, cycleSample, weekly:{from,to,completed,onTime}[], perProject:{projectId,projectName,completed,open,overdue}[]}, attendance:{present, late, lateMinutes, earlyLeave, absent, leave, sick, permit, dayOff, avgWorkedMinutes, workedDays, reflections, checkouts, attendanceRate, lateRate, reflectionRate}, xp:{periodScore, baseline, level:{level,name,floor,nextFloor,pct,isMax}, streak:{current,longest}, penalties:{kind,count,xp}[], penaltyTotal}, generatedAt}`.
- **Errors:** 403 `REPORT_OUT_OF_SCOPE`; 404. Decode leniently (iOS drops bad array elements).

### Gamification

#### `GET /api/gamification/me`
- **iOS:** `APIClient.swift:900` `gamification()` (cache `gamification`).
- **Response:** 200 `{xp:{totalXp, level, levelName, floor, nextFloor|null, pct}, streak:{current, longest}, quests: Quest[]}`; `Quest = {key, title, description|null, progress, target, xpReward, deadline|null, source:"auto"|"admin", kind:"count"|"tasks", claimed, claimable, eligible?/*tasks only: you are an assignee*/}`.

#### `POST /api/gamification/quests/claim`
- **iOS:** `APIClient.swift:909` `claimQuest(_:)`.
- **Request:** JSON `{questKey}` (= `Quest.key`). XP is granted ONLY here, never on completion.
- **Response:** 200 `{xp:{totalXp, level, levelName, floor, nextFloor, pct}}`.
- **Errors:** 400 `questKey required` / `Quest tidak aktif` / past deadline / `Quest not complete yet`; 403 not your task/team; 404; 409 `Already claimed this period`.

#### `GET /api/gamification/leaderboard`
- **iOS:** `APIClient.swift:926` `leaderboard()` (cache `leaderboard`).
- **Response:** 200 `{rows:{userId, name|null, avatar|null, totalXp /*this period's score, baseline 1000*/, level, levelName}[], period:{start, end, resetDay:28, timezone:"Asia/Jakarta"}}`. BoD+ excluded. ⚠ iOS decodes an optional `atBottom` the server never sends (harmless).

#### `GET /api/gamification/xp-log?userId=<id>&limit=20[&offset=&scope=all]`
- **iOS:** `APIClient.swift:934` `xpLog(userId:limit:)`.
- **Response:** 200 `{rows:{id, amount, reason, createdAt, lateMinutes|null}[], hasMore, nextOffset, user, scope:"period"|"all"}`. limit 1…100 (default 50).
- **Errors:** 400 `userId wajib`; 403 peer outside your workspace (the profile screen uses this as "may I show this person").

#### `GET /api/gamification/quests/admin?workspaceId=<id>`
- **iOS:** `APIClient.swift:1446` `adminQuests(workspaceId:)`.
- **Response:** 200 `{quests: {id, workspaceId, title, description, requirementType, requiredCount, xpReward, teamIds, taskIds, deadline, isActive, createdById, createdAt}[]}` (active only). No `workspaceId` → `{quests:[]}`. 403 non-member.

#### `POST /api/gamification/quests/admin`
- **Auth:** ADMIN or workspace BOD/MANAGER/ONE_ABOVE_ALL.
- **iOS:** `APIClient.swift:1450` `createAdminQuest` / `:1462` `createTaskQuest`.
- **Request:** JSON `{workspaceId, title, requirementType: "task_count"|"priority_done"|"overdue_cleared"|"has_overdue", requiredCount, xpReward, deadline?, description?, teamIds?}`, or `{title, xpReward, requirementType:"specific_tasks", taskIds:[…]}` (workspace + requiredCount derived from the tasks). `xpReward` is capped to 0…50.
- **Response:** 201 `{quest}`. **Errors:** 400 missing fields / tasks not found / tasks across workspaces; 403.

#### `DELETE /api/gamification/quests/admin?id=<questId>`
- **iOS:** `APIClient.swift:1472`. **Response:** 200 `{success:true}`. **Errors:** 400/403/404.

### Control Room (admin)

#### `GET /api/workspaces/members[?includeRegistered=1&workspaceId=&teamId=]`
- **iOS:** `APIClient.swift:670` `workspaceInfo()`, `:1079` `roster(includeRegistered:)`.
- **Response:** 200 `{workspaceId, workspaceName, role /*caller's*/, members: {id /*WorkspaceMember.id = memberId*/, userId, name, email, avatar, phoneNumber? /*omitted unless caller is BoD+ or self*/, googleWorkspaceEmail|null, role, attendanceRole, attendanceShiftStartTime|null, attendanceShiftEndTime|null, attendanceShiftByDay|null, flexiTimeEnabled, noGeofenceMode, restDays:number[], approverId|null, approver:{id,name,avatar}|null, joinedAt}[], availableUsers?: {id,name,email,avatar}[] /*only with includeRegistered=1 AND caller Manager+*/}`.
- **Notes:** workspace = caller's oldest membership unless `workspaceId`.

#### `POST /api/workspaces/members` (invite / add)
- **Auth:** BoD / One Above All.
- **iOS:** `APIClient.swift:1086` `inviteWorkspaceMember(email:role:workspaceId:absorbPersonalWorkspace:)`.
- **Request:** JSON `{email, role:"ONE_ABOVE_ALL"|"BOD"|"MANAGER"|"STAFF" (default STAFF; only roles strictly below yours), workspaceId, attendanceRole?, absorbPersonalWorkspace?: bool}` — `absorbPersonalWorkspace` moves a self-signed-up user out of their personal workspace.
- **Response:** 201 `{member:{id,userId,name,email,avatar,role,attendanceRole,joinedAt}, absorbed, kept, emailSent, accountCreated}`.
- **Errors:** 400 invalid role/email; 403 role above yours; 409 already a member.

#### `PATCH /api/workspaces/members` (all member edits; send ONLY the keys being changed)
- **Auth:** BoD+ (tier ≥ 3) for everything.
- **Request:** JSON `{memberId, workspaceId, …}` plus any of:
  - `role` — iOS `APIClient.swift:1094` `updateWorkspaceMemberRole`.
  - `approverId: string|null` (Approval chart; null = detach) — `:1107` `setAttendanceApprover`. Errors: self, not a member, cycle (`Itu bikin lingkaran…`).
  - `flexiTimeEnabled: bool`, `noGeofenceMode: bool`, `restDays: int[] /*ISO 1=Mon…7=Sun, < 7 entries*/` — `:1121` `updateWorkspaceMemberAttendanceFlags`.
  - `attendanceShiftStartTime`, `attendanceShiftEndTime` ("HH:mm" or null — both set or both null; start ≠ end, overnight allowed), `attendanceShiftByDay: {"1".."7": {start,end}} | null | {}` (whole map replaced) — `:2203` `setAttendanceShift` (sends all three, nulls explicit).
  - `attendanceRole`, `phoneNumber` (web only).
- **Response:** 200 `{member:{…}}`.
- **Errors:** 400 validation sentences; 403 `Only One Above All / BoD can manage members` / role above yours; 404 `Member not found`.
- **Notes:** JSON `null` must be emitted literally (Kotlin: `explicitNulls`), omitted ≠ null.

#### `DELETE /api/workspaces/members?memberId=<id>&workspaceId=<id>`
- **iOS:** `APIClient.swift:1135`. **Response:** 200 `{message:"Member removed"}`. **Errors:** 400 self, 403, 404.

#### `POST /api/workspaces/members/{memberId}/avatar`
- **Auth:** BoD+. **iOS:** `APIClient.swift:760` `uploadMemberAvatar`.
- **Request:** multipart part `file` (PNG/JPG/WEBP by **declared Content-Type**, ≤ 5 MB).
- **Response:** 200 `{user, url}`. **Errors:** 400 type/size, 403, 404.

#### `PATCH /api/admin/users/{userId}`
- **Auth:** name/email/password: system ADMIN or BoD+; `role` (system role) admin only.
- **iOS:** `APIClient.swift:778` `updateAdminAccount(userId:name:email:password:)`; `VaultAPI.swift:168` `linkGoogleWorkspace(userId:email:)`.
- **Request:** JSON any of `{name /*2–80*/, email, password /*≥8*/, googleWorkspaceEmail: string|null, role}`. Send only changed keys (sending your unchanged email can 409).
- **Response:** 200 `{user:{id,name,email,role,googleWorkspaceEmail,…}}`.
- **Errors:** 400 `Tidak ada yang diubah`/validation; 403; 404; 409 email taken / Google address already linked; 404 Google address does not exist.

#### `DELETE /api/admin/users/{userId}`
- **Auth:** system ADMIN or BoD/One Above All. **iOS:** `APIClient.swift:1545` `deleteUser`.
- **Response:** 200 `{ok:true, deletedUser:{id,name,email}, purged:{…}}`.
- **Errors:** 400 self; 403 system-admin target; 409 `{code:"still-member", workspaces:string[]}` (remove from Members first) / last admin.

#### `GET /api/admin/users/memberships`
- **Auth:** user-management access. **iOS:** `VaultAPI.swift:181` `adminUserMemberships()`.
- **Response:** 200 `{byUser: {[userId]: {projects:{id,name,icon,color,status,role,viaTeam|null}[], teams:{id,name,color,role,division|null}[]}}}`.

#### `GET /api/admin/app-installs`
- **Auth:** ADMIN or BoD/One Above All. **iOS:** `APIClient.swift:1477` `appInstalls()`.
- **Response:** 200 `{installs:{id, appVersion|null, buildNumber|null, osVersion|null, deviceModel|null, environment, lastSeenAt, user:{id,name,email,avatar}}[] /*one per person, newest device*/, notInstalled:{id,name,email,avatar,role,joinedAt,lastActiveAt|null}[], totals:{people, devices, members, notInstalled, versions:{version,count}[]}}`.
- **Notes:** built from `DeviceInstallation` rows written by `POST /api/push/devices`. There is **no platform column**: an Android phone would be indistinguishable from iOS and its versions (`1.0.0 (5)`) would be mixed into the iOS histogram. SERVER CHANGE REQUIRED: add `platform` (derive from the registration/bundleId), return it, and group `totals.versions` by platform.

#### `GET /api/audit?limit=&offset=&action=&search=`
- **Auth:** ADMIN / One Above All / BoD / Manager (scoped to actors in the caller's admin workspaces).
- **iOS:** `APIClient.swift:1434` `auditLogs(...)` (first unfiltered page cached as `audit-first-page`).
- **Request:** `limit` (default 50, max 100), `offset`, `action` (exact), `search` (insensitive on entityName/action/entityType); also `userId`, `entityType`, `from`, `to`.
- **Response:** 200 `{logs:{id, action, entityType, entityId, entityName, metadata, ipAddress, userAgent, createdAt, userId, user:{id,name,email,avatar}|null, summary:string}[], total, limit, offset}`.

#### `GET /api/audit/{id}`
- **iOS:** `APIClient.swift:1443` `auditEntry(id:)`.
- **Response:** 200 `{entry:{id, action, entityType, entityId|null, entityName|null, createdAt, ipAddress|null, userAgent|null, user|null, metadata:any}, title, changes:{field,label,from|null,to|null}[], details:{label, value, link?:{type,id}}[]}`. **Errors:** 403, 404.

#### `GET /api/admin/google-workspace/accounts`
- **Auth:** BoD. **iOS:** `VaultAPI.swift:160`.
- **Response:** 200 `{configured:false, accounts:[], error}` or `{configured:true, domains:string[], accounts:{email, …, linkedTo:{id,name}|null}[]}`. 500 `{error}` when Google is unreachable.

#### `POST /api/admin/google-workspace/users`
- **Auth:** BoD. **iOS:** `VaultAPI.swift:190` `createGoogleWorkspaceAccount`.
- **Request:** JSON `{userId, localPart, domain, givenName, familyName}`. Uses a paid Google seat.
- **Response:** 201 `{created:true, linked:true, account:{email, temporaryPassword, …}, notified:{inApp,email,emailTo}}`; **207** `{created:true, linked:false, account, error}` (created but not linked — show `error`).
- **Errors:** 400 missing names/bad domain; 403; 404; 409 exists / Google not connected / already linked.

### GIDEON

⚠ Discrepancy (iOS): `GideonClient` (`Gideon.swift:130` `authed`) builds its own `URLRequest` on `Config.baseURL` — **no `X-Nexus-Client` header, no LAN route, no 426 screening** (it runs on `URLSession.shared` directly). Because the header is missing, the 426 gate never touches GIDEON on iOS today. **Android: send GIDEON through the common client** (same headers, cookie, LAN choice, 426 handling); once the server gates `android/*`, GIDEON on an outdated Android build will correctly get 426 — handle it like any other call. Use a long read timeout (180 s) for the POST.

#### `GET /api/gideon/history`
- **iOS:** `Gideon.swift:172` `history()`.
- **Response:** 200 `{messages:{role:"user"|"assistant", content, tools:string[], attachments:{kind:"image"|"document", url, name, mime}[]}[]}` (last 100, oldest first). Drop attachments without `url`.

#### `DELETE /api/gideon/history`
- **iOS:** `Gideon.swift:195` `clearHistory()`. **Response:** 200 `{ok:true, deleted, files}`.

#### `POST /api/gideon` (Server-Sent Events)
- **iOS:** `Gideon.swift:211` `stream(messages:model:image:document:)`.
- **Request:** headers `Content-Type: application/json`, `Accept: text/event-stream`; body `{messages:{role,content}[], model:"astra"|"luna"|"terra"|"experimental" /*unknown → luna*/, image?: base64 or data URL, file?: {name /*with extension*/, type /*MIME*/, data /*base64*/}}`. Document ≤ 10 MB; accepted extensions: pdf, txt, md, csv, tsv, json, log, yml, yaml, xml, html, docx, doc, xlsx, xls, pptx, ppt, odt, ods, odp, rtf, epub, ipynb.
- **Response:** 200 `text/event-stream`, frames `data: {"type":"text"|"error"|"done"|"tool_result", "content"?:string}\n\n`. Today the server sends ONE `text` frame then `done` (append, don't replace — streaming may arrive later); `error` content is a user-facing sentence; stop at `done`. Skip malformed frames.
- **Errors (before the stream):** 401 JSON; 415 `{error, code:"unsupported_file_type"}`; 413 `{error, code:"file_too_large", maxBytes}`. Non-JSON 413/415 from the proxy: show "File is over the 10MB limit." / "GIDEON can't read that kind of file yet.".
- **Notes:** the question and answer are persisted together AFTER the reply; closing the screen does not cancel the server work — keep the transcript outside the screen (iOS `GideonChat` singleton) and clear it on logout.

#### `GET /api/gideon/usage`
- **Auth:** BoD. **iOS:** `APIClient.swift:1482` `gideonUsage()`.
- **Response:** 200 `{users:{id,name,email,avatar,asked,answered,toolCalls,firstUsed,lastUsed}[], totals:{people, asked, toolCalls, …}}`.

### App version policy (iOS-only today)

#### `GET /api/app/version-policy`
- **Auth:** none; exempt from the 426 gate. **iOS:** `AppVersionGate.swift:265` `fetchPolicy()` (8 s timeout, re-checked every 30 min and on "Check again").
- **Response:** 200 `{minSupported:"x.y.z", latest:"x.y.z"|null, storeUrl:"https://apps.apple.com/id/app/id6807031457", graceUntil?:ISO, nextMinimum?:"x.y.z"}`. Client: `running < minSupported` → blocking update screen (persisted until the running version passes the floor or the server lowers it); `latest > running` → soft "update available"; `running < nextMinimum && now < graceUntil` → daily warning. A failed fetch changes nothing.

#### `GET /api/app/latest`
- **Auth:** none. **iOS:** `APIClient.swift:1492` `appLatest()`.
- **Response:** 200 `{ios:{version|null, storeUrl}}`.

⚠ Both endpoints describe **the iOS App Store only**: `minSupported` is computed from `AppReleaseSeen` rows with `platform:"ios"` (filled from iTunes lookups) plus `NEXUS_IOS_MIN_VERSION`; `storeUrl` is the App Store. An Android client must NOT compare its versionName against these numbers. **SERVER CHANGE REQUIRED** — proposed contract:
- `GET /api/app/version-policy?platform=android` → `{platform:"android", minSupported, latest|null, storeUrl:"https://play.google.com/store/apps/details?id=<applicationId>", graceUntil?, nextMinimum?}`. Without `platform` (or `platform=ios`) the response stays byte-identical to today (released iOS builds depend on it). Alternatively infer the platform from `X-Nexus-Client: android/…` when the query param is absent.
- `GET /api/app/latest` → add `android:{version|null, storeUrl}` beside `ios` (additive).
- Sourcing "latest" for Play: there is no anonymous lookup API like iTunes. Either (a) record releases in `AppReleaseSeen` with `platform:"android"` via a deploy/CI step or an admin endpoint when a Play release goes live (the rolling 3-day grace then works unchanged), or (b) poll the Google Play Developer API (`androidpublisher` edits → tracks/production, needs a service account). Floor via a new `NEXUS_ANDROID_MIN_VERSION` env. `computeIosVersionPolicy` is already platform-agnostic given a floor and rows; generalise `getIosVersionPolicy`/its cache per platform and extend `iosUpgradeGate` to `android` (see §4).

---

## 3. Push notifications

### 3.1 How the server sends push today (APNs only)

Every push is a side effect of an **inbox row**: `createInAppNotification({ userId, type, title, message, link?, taskId?, projectId?, push?, dedupeWindowMs? })` (`src/lib/notification-service.ts:219`) always writes a `Notification` row and emits socket event `notification` to room `user:<id>`; only when `push` is truthy does it call `sendPushToUser` (`src/lib/apns.ts`). `sendPushToUser` is the **only** push sender in the codebase.

- Targets: every `DeviceInstallation` of the user with `disabledAt = null` — there is no platform column; every row is assumed to be an APNs token.
- Transport: HTTP/2 to `api.push.apple.com` (or `api.sandbox.push.apple.com` when the row's `environment == "sandbox"`), ES256 provider JWT (`APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY[_PATH]`), headers `apns-topic: <row.bundleId>`, `apns-push-type: alert`, `apns-priority: 10`.
- Payload — exactly this, nothing else:
  ```json
  { "aps": { "alert": { "title": "<title>", "body": "<message>" }, "sound": "default" },
    "type": "<type>", "taskId": "<id, only if set>", "projectId": "<id, only if set>", "link": "<path or URL, only if set>" }
  ```
  No `badge`, no `category`, no `thread-id`, no `mutable-content`, no notification id. (The inbox row id is not in the push.)
- Dead tokens: HTTP 410 or reason `BadDeviceToken` / `Unregistered` → row gets `disabledAt = now` (re-enabled by the next `POST /api/push/devices` with the same token).
- Throttling/dedupe is per notifier (e.g. attendance reminders key on `link`, `dedupeWindowMs` on some). Do-not-disturb (`User.dndUntil`) suppresses the push (and for reminders the whole row) only in `notifyAttendanceReminder` and `notifyAttendanceAbsentRecorded`.
- Per-user preferences (`/api/notifications/preferences`) gate the push of the task/mention/invite/status families (column "push" below says which flag).

### 3.2 Every notification `type` the server creates

"Push" = whether `push` is set. iOS routing = `AppRouter.openNotification` (`AppRouter.swift:174`): **`taskId` → task sheet (`:176`); else `projectId` → project (`:177`); else `link` starting `http` → open externally (`:179`); else `NotificationTarget(path: link)` (`DashboardModels.swift:296`); else keyword fallback on `type` (`AppRouter.swift:181-186`: contains attendance/offsite/checkout → Attendance, message → Messages, complaint → Tickets, announcement → Dashboard, otherwise Inbox).** The inbox row uses the same routing.

| type | trigger (where) | title pattern | link | push | iOS lands on |
|---|---|---|---|---|---|
| `MESSAGE` | chat message to other members (`conversations/[id]/messages` POST); also "X added you to <group>" (`…/members` POST) | `New message from <name>` / `<actor> added you to <group>` | `/messages?c=<conversationId>` | yes | conversation (`.conversation`) |
| `MESSAGE_MENTION` | chat message that @mentions the member | `<name> mentioned you` | `/messages?c=<conversationId>` | yes | conversation |
| `attendance_checkin_reminder` / `attendance_checkout_reminder` | reminder cron (`lib/attendance-reminders.ts` → `notifyAttendanceReminder`): check-in 30, 15 and 0 min before shift start; check-out at shift end; skipped under DND | `Absen masuk 15 menit lagi` / `Waktunya absen masuk` / `Absen pulang …` | `/attendance?reminder=checkin\|checkout&date=YYYY-MM-DD&t=<offset>` | yes | Attendance screen |
| `attendance_absent_recorded` | `/api/cron/absence-notify` (morning after the 02:00 absence cut) | `Tercatat tanpa keterangan` | `/attendance?absent=YYYY-MM-DD` | yes unless DND | Attendance |
| `attendance_request_pending` | staff files leave/sick/permit/day-off (`notifyAttendanceRequestPending`) → approvers | `<name> mengajukan <type>` | `/attendance?request=<requestId>` | yes | request with Approve/Reject (`.attendanceRequest`) |
| `attendance_request_reviewed` | approve/reject (`lib/wa-bot.ts:439`), or a BoD grant (`attendance/requests` POST :783) → requester | `Permintaan absen di-approve` / `… ditolak` / `<BoD> mencatat <type> …` | `/attendance?request=<requestId>` | yes | that request |
| `attendance_request_escalated` | `/api/cron/attendance-escalation` (*/30) → BoD and the stale approver | `<label> <name> belum ditanggapi` / `… masih menunggu kamu` | `/attendance?request=<id>` or `/attendance?offsite=<recordId>` | yes | that request / offsite check-out |
| `offsite_checkout_pending` | check-out outside the geofence → approvers | `<name> check-out di luar kantor` | `/attendance?offsite=<recordId>` (or `/attendance`) | yes | offsite review (`.offsiteCheckout`) |
| `offsite_checkout_reviewed` | offsite check-out approved/rejected (`lib/wa-bot.ts:524`) | `Checkout di luar di-approve` / `… ditolak` | `/attendance?offsite=<recordId>` | yes | offsite item |
| `attendance_override` | BoD overrides a day (`lib/wa-bot.ts:502`) | (sentence) | `/attendance` | yes | Attendance |
| `dayoff_quota_low` / `red_date_quota_low` | `notifications/quota-check` cron | `<n> <label> day left` | `/attendance` | pref `statusUpdate` | Attendance |
| `task_assigned` | assignee added (`tasks`, `tasks/[id]`, `tasks/[id]/assignees`, GIDEON tools) | `<by> assigned you: <task>` | `/projects/<p>/tasks/<t>` (+ `taskId`,`projectId`) | pref `taskAssigned` | task sheet |
| `comment_mention` | @mention in a task comment | `<by> mentioned you on: <task>` | `/projects/<p>/tasks/<t>` | pref `commentMention` | task |
| `comment_added` | comment on a task (to assignees + followers) | `<by> commented on: <task>` | `/projects/<p>/tasks/<t>` | yes | task |
| `task_completed` | task moved to done (to assignees + followers) | `<by> completed: <task>` | `/projects/<p>/tasks/<t>` | yes | task |
| `task_due_2d` / `task_due_1d` / `task_due_now` | `notifications/due-check` cron (`notifyDueSoon`) | `Due in 2 days: …` / `Due tomorrow: …` / due now | `/projects/<p>/tasks/<t>?reminder=<stage>&due=<iso>` or `/tasks/<t>?…` | pref `taskDueSoon` | task |
| `project_invite` | added to a project | `<by> invited you to <project>` | `/projects/<p>` | pref `projectInvite` | project |
| `status_update` | project status update | `Status Update` | `/projects/<p>` | pref `statusUpdate` | project |
| `automation` | project automation action "notify" (`automation-engine.ts:198`) | `Automation Notification` | — (may carry `taskId`) | no | task, else Inbox |
| `submission_status` | a form submission moved column | `Submission update` | `/submissions?id=<submissionId>` | pref `statusUpdate` | submission sheet (`.submission`) |
| `streak_at_risk` | `notifications/streak-check` | `Your streak ends at midnight` | `/my-tasks` | pref `statusUpdate` | Tasks tab |
| `quest_claimable` | `notifications/quest-check` | `Quest ready to claim` | `/dashboard?quest=<questKey>:<periodKey>` | pref `statusUpdate` | Dashboard (the `quest` param is ignored by iOS) |
| `booking_soon` | `notifications/booking-reminder` | `<room> in <n> min` | `/master-calendar?booking=<id>` | pref `statusUpdate` | Team calendar |
| `booking_confirmed` / `booking_changed` | room-bookings POST / PATCH / DELETE | `Ruangan dibooking: …` / `Booking … diubah\|dibatalkan\|dihapus` | `/room-booking` | yes | Room booking |
| `feed_mention` | mention in a Threads post (create/edit) | `Mentioned on Threads` | `/threads?post=<postId>` | pref `commentMention` | post (`.post`) |
| `feed_comment` | comment on your post / mention in a comment | `<name> commented on your post` / `<name> mentioned you` | `/threads?post=<postId>` | pref `commentMention` | post |
| `complaint_filed` | new ticket → every BoD | `Tiket baru dari <name>` (anonymous → `Keluhan baru masuk`) | `/complaints?id=<id>` | yes | ticket (`.complaint`) |
| `complaint_reply` | reply on a ticket (also a new correction proposal) | `<replier> membalas tiket kamu` / `<reporter> membalas tiket` | `/complaints?id=<id>` | yes | ticket |
| `complaint_status` | status change / correction approved | `Tiket "<subject>" selesai ✓` / `Update tiket …` | `/complaints?id=<id>` | yes | ticket |
| `announcement` | BoD posts an announcement (and daily repeats) | `📣 <title>` | `/dashboard?announcement=<id>` | yes | announcement pop-up (`.announcement`, fetched via `GET /api/announcements/{id}`) |
| `peer_report_filed` | someone filed an integrity report about you | `Ada laporan tentang kamu` | `/peer-reports` | yes | Reports screen (iOS maps `peer-reports` → `.reports`) |
| `peer_report_rebuttal` / `peer_report_decided` | rebuttal / verdict | `<who> membantah laporan` / (verdict) | `/peer-reports` | yes | Reports |
| `violation_announcement` | proven violation broadcast | `⚠️ Pelanggaran terbukti` | `/peer-reports` | no | Reports |
| `google_workspace_created` / `google_workspace_linked` | admin creates/links a Google mailbox | `Email kantor kamu sudah jadi` / `Akun Google Workspace kamu ditautkan` | `/settings` | yes | Settings |
| `app_update` | daily 10:00 WIB (`lib/app-update.ts` `remindOutdatedApps`) to users whose newest device is below the App Store version | `NEXUS <v> is on the App Store` | `https://apps.apple.com/id/app/id6807031457?v=<v>` | yes | opens App Store externally |
| `system_disk` | `/api/cron/disk-watch` → admins | disk warning/alarm | `/admin` | only at `alarm` | Control Room |
| `system_gideon` | `/api/cron/gideon-watch` | `GIDEON Support tidak menjawab` | `/complaints` | yes | Tickets |
| `test_notification` | `POST /api/notifications/test` | `Test Notification` | `/inbox` | no | Inbox |

Notes: `fanOutHandledToApprovers` in `lib/wa-bot.ts:395` (type from caller, link `/attendance`) is defined but has no caller today. Type strings are not an enum — Android must treat unknown types as "route by link, else Inbox".

**Local notifications the iOS app schedules itself** (`NotificationManager.swift`; Android should mirror with `AlarmManager`/WorkManager):
| type (in userInfo) | when | condition |
|---|---|---|
| `task_due` (+`taskId`) | 2 d, 1 d, 0 d before each of the 20 nearest due tasks (all-day due → 09:00 WIB), and once "Task overdue" (`:155-195`) | only while push is **not** delivering (`pushDeliveryActive == false`) |
| `attendance_checkin` (+`date`) | 15 min before today's `myShift.startTime` if not checked in (`:197-214`) | same fallback rule |
| `attendance_queue_refused` (link `/attendance`) | immediately, when an offline-queued tap is refused on replay (outside radius) (`:219-228`) | always |

`pushDeliveryActive` (`:26`) becomes `true` the moment `POST /api/push/devices` succeeds and `false` whenever it fails; when true, all locally-scheduled `task`/`attendance` reminders are cancelled (`:105`) because the server sends the same reminders. Android: same switch, keyed on the FCM registration result.

### 3.3 Deep-link grammar (the `link` field) → Android destination

Parse the path before `?`/`#`, then the query (`DashboardModels.swift:296-343`; query read by `queryValue`, `+` = space, percent-decoded).

| link | iOS target | Android destination |
|---|---|---|
| `http(s)://…` (not a NEXUS host) | external open (`AppRouter.swift:179`) | `ACTION_VIEW` intent. For `app_update` Android needs a Play Store URL — see §4 |
| `/tasks` · `/my-tasks` | Tasks tab | Tasks |
| `/tasks/<taskId>[?reminder=…&due=…]` | `.task` sheet | Task detail |
| `/projects` · `/projects/<id>` | Projects / `.project` | Project |
| `/projects/<p>/tasks/<t>` | `.task(<t>)` (deeper id wins) | Task detail |
| `/attendance` (incl. `?reminder=…`, `?absent=…`) | Attendance | Attendance |
| `/attendance?request=<id>` | `.attendanceRequest` → RequestFocusSheet (Approve/Reject inline) | Attendance → request detail with Approve/Reject |
| `/attendance?offsite=<recordId>` | `.offsiteCheckout` | Attendance → offsite review |
| `/attendance?permit=today` | `.permitToday` — **iOS WIP only, not in `a875c3c`** | Attendance → permit composer prefilled for today (PENDING) |
| `/messages` · `/messages?c=<id>` · `/messages/<id>` (pre-0.1.5 rows) | Messages / `.conversation` | Chat thread |
| `/threads` · `/social` · `/threads?post=<id>` | Threads / `.post` | Threads → post |
| `/complaints` · `/complaints?id=<id>` | Tickets / `.complaint` | Ticket detail |
| `/dashboard` · `/dashboard?announcement=<id>` · `/dashboard?quest=…` | Dashboard / `.announcement` | Dashboard (+ announcement dialog) |
| `/submissions` · `/submissions?id=<id>` | Submissions / `.submission` | Submission detail |
| `/inbox` | Inbox | Inbox |
| `/docs…` · `/folders…` | Docs | Docs |
| `/forms…` | Forms | Forms |
| `/vault…` | Vault | Vault |
| `/teams…` | Teams | Teams |
| `/reports…` · `/peer-reports` | Reports | Reports |
| `/leaderboard` | Leaderboard | Leaderboard |
| `/room-booking` | Room booking | Room booking |
| `/master-calendar[?booking=]` | Team calendar | Team calendar |
| `/settings` | Settings | Settings |
| `/admin` | Control Room | Control Room |
| anything else | `nil` → fall back to `type` keywords | same fallback, finally Inbox |

A target that needs data (request, offsite, ticket, conversation, announcement, post, submission, task, project) must survive a cold start and a login: iOS holds it in `AppRouter.focus`/`.detail` until the owning screen claims it. Android: keep the parsed target in a singleton/`SavedStateHandle` and consume it after auth + first load.

Universal links the app claims (not push): `https://nexus.znetworks.id/f/<formIdOrSlug>` (form), `/v/<slug>` (vault share); `/register?code=` and `/forgot-password?email=&invited=1` only via the `nexus://` scheme on iOS (`AppRouter.swift:222-300`). Android equivalents need `assetlinks.json` on the server (§4).

### 3.4 Notification actions: `NEXUS_OUTSIDE_OFFICE` / `FILE_PERMIT` — PENDING

- **Status: not shipped.** The category exists only in uncommitted iOS work-in-progress (`NotificationManager.registerCategories`, part of "live location while checked in", target 0.1.6+). It is **not** in iOS `a875c3c`, and the server has **no** sender for it: no `category` in the APNs payload, no `NEXUS_OUTSIDE_OFFICE`, no outside-office reminder, no `attendance_auto_offsite_checkout` type, no `/attendance?permit=today` link anywhere in `src/`.
- **Intended iOS contract (WIP):** the "1h30 outside the office" reminder and the "2h" warning arrive with `aps.category = "NEXUS_OUTSIDE_OFFICE"`; the category has one action `FILE_PERMIT` ("File a permit", `.foreground`). Tapping the action forces `link = /attendance?permit=today` regardless of the payload's own link. A push of type `attendance_auto_offsite_checkout` (the 2h30 automatic offsite check-out) makes the app re-read `/api/attendance/today` so location tracking stops, both when shown in foreground and when tapped.
- **Android equivalent:** the server must put the category into the data payload (e.g. `category: "NEXUS_OUTSIDE_OFFICE"`, see §3.5). The app builds the notification itself and, for that category, adds `NotificationCompat.Action("File a permit", PendingIntent → MainActivity with deep link /attendance?permit=today)`; the body tap uses the normal `link`. Suggested channels (Android 8+): `attendance` (reminders, outside-office, high importance), `approvals` (requests/offsite/escalations), `messages` (MESSAGE*, feed_*), `tasks`, `tickets`, `announcements`, `system` (app_update, system_*). On `attendance_auto_offsite_checkout` receipt (FirebaseMessagingService.onMessageReceived, also in background for data messages) re-fetch today and stop the location service.

### 3.5 What Android needs from the server: FCM (all SERVER CHANGE REQUIRED)

1. **Device model:** add `platform` (`"ios" | "android"`, default `"ios"` for existing rows) and optionally `provider` (`"apns" | "fcm"`) to `DeviceInstallation`. `bundleId` for Android = the applicationId (proposal `id.znetworks.nexus` too, or `id.znetworks.nexus.android`); `environment` is meaningless for FCM (store `"production"`).
2. **Registration contract (`POST /api/push/devices`):** accept `{ platform: "android", token: <FCM registration token>, deviceId, bundleId: <applicationId>, appVersion: versionName, buildNumber: versionCode, osVersion: "Android <release> (SDK <n>)", deviceModel: "<manufacturer> <model>" }`. For `platform == "android"`: **do not lower-case** the token and validate with something like `/^[A-Za-z0-9_:\-]{100,4096}$/`; skip the `environment` requirement; accept the Android applicationId. Keep the iOS branch byte-for-byte as today. `DELETE` must stop lower-casing Android tokens too (it lower-cases unconditionally today, so it would never match).
3. **Sender:** `sendPushToUser` must branch per row: APNs as now for `platform = ios`; **FCM HTTP v1** (`POST https://fcm.googleapis.com/v1/projects/<project>/messages:send`, OAuth2 access token from a Google service-account JSON with scope `https://www.googleapis.com/auth/firebase.messaging`, cached ~55 min) for `platform = android`. New env, e.g. `FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT_JSON[_PATH]` (do not reuse the finance `GOOGLE_SERVICE_ACCOUNT_*` names). Add the key names to the compat harness's forbidden-env pattern.
4. **Message shape:** send a **data message** (all values strings) so the app always gets `onMessageReceived` and can route/tap correctly in every app state: `{ message: { token, android: { priority: "HIGH", collapse_key?: <type|link> }, data: { title, body, type, link?, taskId?, projectId?, category?, notificationId? } } }`. A `notification` block would make the system tray own the notification in background and drop routing/actions. Adding `notificationId` (the inbox row id) would also let Android mark the row read on tap (APNs payload could get it too).
5. **Invalidation:** on FCM `404 UNREGISTERED` or `400 INVALID_ARGUMENT` for the token set `disabledAt = now` (mirror of APNs 410/BadDeviceToken). Treat `429/503` as transient (log, no disable).
6. **Badge:** APNs sends no badge today; Android launcher badges come from active notifications, so nothing is required. If a count is wanted on both, add `unreadCount` to the payload (iOS would need `aps.badge`).
7. **`app_update` reminder (`lib/app-update.ts`):** currently compares **every** device's `appVersion` against the iOS App Store version and links to the App Store. Must filter devices by platform, compare Android devices against the Play version (or skip Android until a Play lookup exists) and send a Play Store link (`https://play.google.com/store/apps/details?id=<applicationId>`) to Android users. Same for `GET /api/admin/app-installs` (Control Room App tab) — show platform.
8. **Categories/actions:** when the outside-office reminders ship, put `category` into the FCM data payload (and `aps.category` for iOS) — see §3.4.
9. **Local-reminder fallback:** unchanged server-side; Android decides fallback from its own registration result (see §3.2).

---

## 4. Server changes required for Android: checklist

Everything the Android client needs from the server that is not there at `nexus@5c113e7`. Items in
**A–C** block a production Android release. **D** is required before the matching Android feature
ships. **E** lists server bugs found while writing this contract. They affect iOS today and Android
tomorrow, and fixing them is recommended but does not block.

Direction rule for every item (from `client-version.ts` / `requests/route.ts`): **an unknown or
unreadable caller falls to the looser side.** A new rule may only get stricter for a tag the server
positively recognises.

### A. Teach the server the `android` client tag (`X-Nexus-Client: android/<x.y.z>/<versionCode>`)

- [ ] **A1 Middleware matchers** (`middleware.ts` `config.matcher`). Add the same two `/api/:path*`
      entries used for iOS, with `value: "[aA][nN][dD][rR][oO][iI][dD]/.*"` (bodiless, and
      `content-length` ≤ 7 digits). Without them the gate code never runs for Android.
- [ ] **A2 Minimum-version gate** (`src/lib/version-policy.ts`). Generalise `getIosVersionPolicy` and
      its cache to one per platform (`computeIosVersionPolicy` is already platform-agnostic given a
      floor + release rows). Add `NEXUS_ANDROID_MIN_VERSION` (floor) and read `AppReleaseSeen` rows
      with `platform:"android"`. In `iosUpgradeGate` (rename it), gate `android` tags below the Android
      minimum with the same 426 body, with `storeUrl` = the Play Store URL. Keep the exemptions
      (`/api/app/version-policy`, `/api/health`). An Android tag without three version parts →
      treat it as unreadable and **never block** it.
- [ ] **A3 Release source for Play.** There is no anonymous Play lookup like the iTunes API. Either
      record Android releases in `AppReleaseSeen` from CI or an admin endpoint when a Play release goes
      live (the 3-day grace then works unchanged), or poll the Play Developer API with a service
      account.
- [ ] **A4 `GET /api/app/version-policy`.** Make it platform-aware: `?platform=android`, or infer
      the platform from `X-Nexus-Client`. It returns `{platform, minSupported, latest, storeUrl, graceUntil?,
      nextMinimum?}` for Android. The iOS response must stay byte-for-byte the same.
      **`GET /api/app/latest`**: add `android: {version, storeUrl}` next to `ios`.
- [ ] **A5 Request policy** (`src/app/api/attendance/requests/route.ts` `clientCanObeyRequestPolicy`).
      `client.platform === "android"` → `true`. Every Android build sends one date and a position, so
      it should be held to `SINGLE_DAY_ONLY` and "izin needs lat/lng" from day one.
- [ ] **A6 Login audit** (`src/app/api/auth/app-login/route.ts:61`). `metadata.nativeApp` is
      hard-coded to `"ios"`. Derive it from the tag (`ios`/`android`), so Control Room tells the two apart.
- [ ] **A7 Compatibility harness** (`scripts/compat/`). Add an `android-<x.y.z>` profile: cookie login
      via `/api/auth/app-login`, `X-Nexus-Client: android/x.y.z/N`, a non-`NEXUS/` User-Agent, and
      multipart bodies byte-for-byte like the Android client (real MIME types). `runner.mjs`
      `gateBlocks`/`baseHeaders`/`login` key on `profile.style === "ios"`. Introduce a
      `style:"native"` + `platform` split. Expected results: 0.1.6-level strictness (`SINGLE_DAY_ONLY`,
      PERMIT without lat/lng → 400), and the gate at the Android minimum. Add the new FCM env names to
      the harness's forbidden-env pattern (B3).

### B. Push via FCM

- [ ] **B1 Device model.** Add `platform` (`"ios"|"android"`, default `"ios"` for existing rows)
      and optionally `provider` (`"apns"|"fcm"`) to `DeviceInstallation`. Apply it with explicit SQL
      or `db push`, as for other columns.
- [ ] **B2 `POST /api/push/devices`.** Accept `{platform:"android", token, deviceId, bundleId:<applicationId>,
      appVersion, buildNumber, osVersion, deviceModel}`. For Android: **do not lower-case** the token
      (FCM tokens are case-sensitive and contain `:`, `-`, `_`), validate with something like
      `/^[A-Za-z0-9_:\-]{100,4096}$/`, do not require `environment`, and accept the Android
      applicationId as `bundleId`. **`DELETE /api/push/devices`** lower-cases unconditionally today, so
      it would never match an FCM token. Fix it for Android.
- [ ] **B3 Sender** (`src/lib/apns.ts` `sendPushToUser`). Branch per device row: APNs as today, or
      **FCM HTTP v1** (`POST https://fcm.googleapis.com/v1/projects/<id>/messages:send`, OAuth2 token
      from a service account with scope `…/auth/firebase.messaging`, cached ~55 min). Use new env names,
      e.g. `FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT_JSON[_PATH]`. **Do not reuse the finance
      `GOOGLE_SERVICE_ACCOUNT_*` names.**
- [ ] **B4 Payload.** Send a **data-only** message (all values strings) with high priority:
      `{title, body, type, link?, taskId?, projectId?, category?, notificationId?}`. A `notification`
      block would let the system tray own the notification in the background, and tap routing and
      action buttons would be lost. `notificationId` (the inbox row id) is new for both platforms and
      lets a tap mark the row read.
- [ ] **B5 Invalidation.** FCM `404 UNREGISTERED` / `400 INVALID_ARGUMENT` → `disabledAt = now`
      (mirrors APNs 410/`BadDeviceToken`). 429/503 → transient.
- [ ] **B6 `app_update` reminder** (`src/lib/app-update.ts` `remindOutdatedApps`). It compares every
      device with the iOS App Store version and links to the App Store. Filter by platform: compare
      Android devices with the Android `latest` (A3) and link `https://play.google.com/store/apps/details?id=<applicationId>`.
      Skip Android until A3 exists.
- [ ] **B7 Control Room App tab** (`GET /api/admin/app-installs`). Return `platform` per device and
      group the version counts by platform. Otherwise Android `0.1.0` would be counted as an outdated
      iOS build.
- [ ] **B8 Categories.** When the outside-office reminders ship (D2), put `category:"NEXUS_OUTSIDE_OFFICE"`
      in the FCM data **and** `aps.category` in the APNs payload.

### C. Passkeys and app links (Digital Asset Links)

- [ ] **C1 Android origin for WebAuthn** (`src/lib/passkey.ts`). Today only
      `https://nexus.znetworks.id` is accepted as origin. Credential Manager sends
      `android:apk-key-hash:<base64url(SHA-256 of the signing certificate)>`. Allow the release key
      (Play App Signing key) and, optionally, the upload/debug keys, e.g. with
      `PASSKEY_ANDROID_ORIGINS`. The RP ID stays `nexus.znetworks.id`. Without this, register and login
      verify fail (400 "Could not verify that passkey" / 401 `CredentialsSignin`).
- [ ] **C2 Serve `https://nexus.znetworks.id/.well-known/assetlinks.json`** (`application/json`, no
      redirect). Today `maintenance/phaethon.conf` serves only the Apple association file and answers
      404 for the rest of `/.well-known/`, and `deploy-phaethon.sh` protects that directory. So:
      put the file in `apps/web/public/.well-known/`, add an explicit nginx `location`, and
      have the deploy copy it. Relations: `delegate_permission/common.get_login_creds` (passkeys and
      password autofill) and `delegate_permission/common.handle_all_urls` (App Links), with
      `package_name` + `sha256_cert_fingerprints` (Play signing key).
- [ ] **C3 App Links scope.** The Android manifest may claim only what iOS claims: `/f/*` (forms) and
      `/v/*` (vault shares). Optionally `/register` and `/forgot-password`. **Never `/s/*`** (the
      external vault share must open in a browser for people without an account).

### D. Features still landing (build the Android side only after these ship)

- [ ] **D1 Working-hours location trail**: `POST /api/attendance/location-trail`,
      `POST /api/attendance/location-status`, `GET /api/attendance/records/{id}/trail`, and
      `locationTrackingState` on records (§2.2 ⏳). These are not in the server at `5c113e7`, and not in
      the committed iOS client.
- [ ] **D2 Outside-office pushes**: the 1 h 30 min reminder and the 2 h warning with category
      `NEXUS_OUTSIDE_OFFICE` + action `FILE_PERMIT` → `/attendance?permit=today`. Also the
      `attendance_auto_offsite_checkout` type (§3.4).

### E. Server bugs found while cross-checking iOS (recommended, non-blocking)

- [ ] **E1** `PATCH /api/project-folders/{id}` ignores `aggregateProjectIds`: the iOS
      `setFolderAggregate` gets a 200 and nothing is saved (§2.4).
- [ ] **E2** `PATCH /api/tasks/{id}` accepts `startDate`, `estimatedHours` and `actualHours` but
      never writes them (§2.4).
- [ ] **E3** `POST /api/upload/folder-icon` checks the part's Content-Type only, so iOS
      (`application/octet-stream`) always gets 400. Fall back to the file extension, as
      `attendance/requests` does. `POST /api/upload/avatar` and `POST /api/upload/chat` check the
      same way (§2.1, §2.5). Android must send the real MIME type in any case.
- [ ] **E4** Form submit: a file over 50 MB fails inside multipart parsing and returns 500
      "Internal server error". Return 413 with a sentence. A 500 is also one of the statuses
      clients treat as "origin unreachable".
- [ ] **E5** Access control: `GET /api/tasks/{id}`, `GET /api/docs/{id}`, the task dependency routes
      and the sprint routes check only that a session exists, not project membership.
      `GET /api/files/*` relies on unguessable names. Dependencies have no cycle, self or duplicate
      checks (a duplicate, or an unknown id on delete, → 500).
- [ ] **E6** Session revocation: issued JWTs can't be revoked (a password change or reset leaves
      them valid, and `/api/user/sessions` is not consulted). Consider a per-user token version
      checked in the `jwt` callback, before a second native client multiplies long-lived tokens.
- [ ] **E7** Small ones: PATCH/DELETE of an unknown announcement id → 500 (should be 404). An
      unknown message id → 404 with `error:"Forbidden"`. iOS never calls
      `POST /api/conversations/{id}/read`, so unread counts clear only from the web. Android should
      call it (§2.5).

---

## Appendix: endpoint index

Every endpoint heading in §2, in document order.

| § | Endpoint |
|---|---|
| 2.1 | `POST /api/auth/app-login` |
| 2.1 | `POST /api/auth/register` (sign-up step 1: send code) |
| 2.1 | `POST /api/auth/register/verify` (sign-up step 2: create account) |
| 2.1 | `POST /api/auth/register/resend` |
| 2.1 | `POST /api/auth/password/reset/request` |
| 2.1 | `POST /api/auth/password/reset/verify` |
| 2.1 | `POST /api/auth/password/reset/resend` |
| 2.1 | `POST /api/user/email/request` (change sign-in email, step 1) |
| 2.1 | `POST /api/user/email/verify` (step 2) |
| 2.1 | `POST /api/user/account/delete` |
| 2.1 | `GET /api/user/profile` |
| 2.1 | `PATCH /api/user/profile` |
| 2.1 | `PATCH /api/user/password` (also accepts `POST`) |
| 2.1 | `POST /api/upload/avatar` |
| 2.1 | `DELETE /api/upload/avatar` |
| 2.1 | `GET /api/user/sessions` · `DELETE /api/user/sessions` · `DELETE /api/user/sessions/{sessionId}` (web only) |
| 2.1 | `GET /api/auth/passkey` |
| 2.1 | `DELETE /api/auth/passkey/{passkeyId}` |
| 2.1 | `POST /api/auth/passkey/register/options` |
| 2.1 | `POST /api/auth/passkey/register/verify` |
| 2.1 | `POST /api/auth/passkey/login/options` |
| 2.1 | `POST /api/auth/passkey/login/verify` |
| 2.2 | `GET /api/attendance/today` |
| 2.2 | `POST /api/attendance/check-in` |
| 2.2 | `POST /api/attendance/check-out` |
| 2.2 | `GET /api/attendance/history` |
| 2.2 | `GET /api/attendance/requests` |
| 2.2 | `POST /api/attendance/requests` |
| 2.2 | `PATCH /api/attendance/requests/{id}` |
| 2.2 | `GET /api/attendance/offsite-checkouts` |
| 2.3 | `GET /api/attendance/offices` |
| 2.3 | `POST /api/attendance/offices` |
| 2.3 | `PATCH /api/attendance/offices/{officeId}` |
| 2.3 | `DELETE /api/attendance/offices/{officeId}` |
| 2.3 | `GET /api/attendance/dayoffs?userId=&month=YYYY-MM` |
| 2.3 | `POST /api/attendance/dayoffs` (BoD grants a day off) |
| 2.3 | `PATCH /api/attendance/dayoffs` (per-member monthly quota override) |
| 2.3 | `DELETE /api/attendance/dayoffs?id=` |
| 2.3 | `GET /api/attendance/red-date-quota?month=YYYY-MM` |
| 2.3 | `POST /api/attendance/red-date-quota` |
| 2.3 | `GET /api/attendance/holidays?month=YYYY-MM` |
| 2.3 | `POST /api/attendance/holidays` |
| 2.3 | `DELETE /api/attendance/holidays?id=` (or `?date=YYYY-MM-DD`) |
| 2.3 | `GET /api/attendance/reflections?month=YYYY-MM[&userId=]` |
| 2.3 | `POST /api/attendance/reflections/summarize` |
| 2.3 | `DELETE /api/attendance/records/{recordId}[?part=checkout][&reason=]` |
| 2.3 | `PATCH /api/attendance/records/{recordId}` (BoD correction, web only; not in iOS) |
| 2.3 | `GET /api/attendance/offsite-checkouts?status=PENDING\|APPROVED\|REJECTED\|ALL` |
| 2.3 | `PATCH /api/attendance/offsite-checkouts/{recordId}` |
| 2.3 | `GET /api/attendance/deductions?month=YYYY-MM[&userId=]` (web only, BoD) |
| 2.3 | `POST /api/attendance/override` (web only, BoD) |
| 2.3 | `GET /api/attendance/reverse-geocode?lat=&lng=` |
| 2.3 | `GET /api/attendance/history?scope=workspace&month=YYYY-MM&format=xlsx[&userId=]` (export) |
| 2.4 | `GET /api/projects` |
| 2.4 | `GET /api/projects/{projectId}` |
| 2.4 | `POST /api/projects` |
| 2.4 | `PATCH /api/projects/{projectId}` |
| 2.4 | `DELETE /api/projects/{projectId}` |
| 2.4 | `POST /api/projects/{projectId}/duplicate` |
| 2.4 | `POST /api/projects/{projectId}/members` |
| 2.4 | `DELETE /api/projects/{projectId}/members` |
| 2.4 | `POST /api/projects/{projectId}/invite` |
| 2.4 | `GET /api/project-folders` |
| 2.4 | `POST /api/project-folders` |
| 2.4 | `PATCH /api/project-folders/{folderId}` |
| 2.4 | `DELETE /api/project-folders/{folderId}` |
| 2.4 | `POST /api/upload/folder-icon` |
| 2.4 | `GET /api/tasks?projectIds={id1,id2,…}` (folder aggregate calendar) |
| 2.4 | `GET /api/tasks` |
| 2.4 | `GET /api/tasks/{taskId}` |
| 2.4 | `POST /api/tasks` |
| 2.4 | `PATCH /api/tasks/{taskId}` |
| 2.4 | `DELETE /api/tasks/{taskId}` |
| 2.4 | `GET /api/custom-fields?projectId=…[&taskId=…][&includeLibrary=1]` |
| 2.4 | `POST /api/custom-fields` |
| 2.4 | `PATCH /api/custom-fields` |
| 2.4 | `DELETE /api/custom-fields?id={fieldId}` |
| 2.4 | `GET /api/attachments?taskId=…` |
| 2.4 | `POST /api/attachments` (single request, ≤64 MiB) |
| 2.4 | `POST /api/attachments/chunk` (chunked, >64 MiB; also the Z Vault large-file path) |
| 2.4 | `DELETE /api/attachments/{attachmentId}` |
| 2.4 | `GET /api/files/{…path}` (download any stored file: attachments, selfies, icons, chat images) |
| 2.4 | `POST /api/tasks/{taskId}/comments` |
| 2.4 | `GET /api/tasks/{taskId}/dependencies` |
| 2.4 | `POST /api/tasks/{taskId}/dependencies` |
| 2.4 | `DELETE /api/tasks/{taskId}/dependencies?id={dependencyId}` |
| 2.4 | `GET /api/time-entries?taskId=…` |
| 2.4 | `POST /api/time-entries` |
| 2.4 | `GET /api/sprints?projectId=…` |
| 2.4 | `POST /api/sprints` |
| 2.4 | `PATCH /api/sprints` |
| 2.4 | `GET /api/automations?projectId=…` |
| 2.4 | `PATCH /api/automations` |
| 2.4 | `GET /api/finance/dashboard?projectId=…&year=YYYY` |
| 2.4 | `GET /api/pnl/dashboard?projectId=…&year=YYYY[&month=1-12]` |
| 2.4 | `GET /api/search?q=…` |
| 2.4 | `GET /api/docs[?projectId=…]` |
| 2.4 | `GET /api/docs/{docId}` |
| 2.4 | `GET /api/room-bookings?rangeStart=ISO&rangeEnd=ISO[&room=…]` |
| 2.4 | `GET /api/master-calendar?teamId=…&rangeStart=ISO&rangeEnd=ISO` |
| 2.4 | `GET /api/teams` |
| 2.4 | `GET /api/teams?resource=divisions` |
| 2.4 | `POST /api/teams` (one route, dispatched on `action`) |
| 2.4 | `GET /api/workspaces/members[?includeRegistered=1][&workspaceId=…][&teamId=…]` |
| 2.5 | `GET /api/conversations` |
| 2.5 | `POST /api/conversations` |
| 2.5 | `GET /api/conversations/{conversationId}` |
| 2.5 | `PATCH /api/conversations/{conversationId}` |
| 2.5 | `POST /api/conversations/{conversationId}/members` |
| 2.5 | `DELETE /api/conversations/{conversationId}/members`  *(web-only parity; iOS does not use)* |
| 2.5 | `GET /api/conversations/{conversationId}/messages` |
| 2.5 | `POST /api/conversations/{conversationId}/messages` |
| 2.5 | `POST /api/conversations/{conversationId}/read`  *(web uses; iOS does NOT)* |
| 2.5 | `POST /api/upload/chat` |
| 2.5 | `GET /api/feed/posts` |
| 2.5 | `POST /api/feed/posts` |
| 2.5 | `PATCH /api/feed/posts/{id}`  *(web-only parity; iOS does not edit)* |
| 2.5 | `DELETE /api/feed/posts/{id}` |
| 2.5 | `POST /api/feed/posts/{id}/like` |
| 2.5 | `GET /api/feed/posts/{id}/comments` |
| 2.5 | `POST /api/feed/posts/{id}/comments` |
| 2.5 | `GET /api/complaints` |
| 2.5 | `POST /api/complaints` |
| 2.5 | `GET /api/complaints/{id}` |
| 2.5 | `PATCH /api/complaints/{id}` |
| 2.5 | `POST /api/complaints/{id}/messages` |
| 2.5 | `GET /api/complaints/{id}/correction` |
| 2.5 | `POST /api/complaints/{id}/correction` |
| 2.5 | `GET /api/notifications` |
| 2.5 | `PATCH /api/notifications` |
| 2.5 | `DELETE /api/notifications`  *(web-only parity)* |
| 2.5 | `GET \| PUT \| PATCH /api/notifications/preferences`  *(web-only; optional for Android)* |
| 2.5 | `POST /api/push/devices` |
| 2.5 | `DELETE /api/push/devices` |
| 2.5 | `GET /api/announcements/active` |
| 2.5 | `GET /api/announcements/{id}` |
| 2.5 | `POST /api/announcements/{id}/seen` |
| 2.5 | `GET /api/announcements` |
| 2.5 | `POST /api/announcements` |
| 2.5 | `PATCH /api/announcements/{id}` |
| 2.5 | `DELETE /api/announcements/{id}` |
| 2.6 | `GET /api/forms?projectId=<id>` |
| 2.6 | `GET /api/forms/{idOrSlug}/public` |
| 2.6 | `GET /api/forms/{id}` (fallback for non-public forms) |
| 2.6 | `POST /api/forms/{idOrSlug}/submit` |
| 2.6 | `GET /api/forms/my-submissions` |
| 2.6 | `GET /api/forms/my-submissions/{submissionId}` |
| 2.6 | `GET /api/vault/items?parentId=&trash=1&q=` |
| 2.6 | `POST /api/vault/items` (create folder) |
| 2.6 | `PATCH /api/vault/items/{id}` |
| 2.6 | `DELETE /api/vault/items/{id}[?purge=1]` |
| 2.6 | `POST /api/vault/trash/empty` |
| 2.6 | `GET /api/vault/items/{id}/raw[?download=1]` |
| 2.6 | `POST /api/vault/upload` (≤ 64 MiB client-side; server single-shot cap 90 MiB) |
| 2.6 | `GET /api/vault/shares?itemId=<id>` |
| 2.6 | `POST /api/vault/shares` |
| 2.6 | `DELETE /api/vault/shares/{shareId}` |
| 2.6 | `GET /api/vault/public/{slug}` |
| 2.6 | `GET /api/reports?days=<n>` |
| 2.6 | `GET /api/reports/people?period=YYYY-MM&teamId=` |
| 2.6 | `GET /api/reports/people/{userId\|me}?period=YYYY-MM` |
| 2.6 | `GET /api/gamification/me` |
| 2.6 | `POST /api/gamification/quests/claim` |
| 2.6 | `GET /api/gamification/leaderboard` |
| 2.6 | `GET /api/gamification/xp-log?userId=<id>&limit=20[&offset=&scope=all]` |
| 2.6 | `GET /api/gamification/quests/admin?workspaceId=<id>` |
| 2.6 | `POST /api/gamification/quests/admin` |
| 2.6 | `DELETE /api/gamification/quests/admin?id=<questId>` |
| 2.6 | `GET /api/workspaces/members[?includeRegistered=1&workspaceId=&teamId=]` |
| 2.6 | `POST /api/workspaces/members` (invite / add) |
| 2.6 | `PATCH /api/workspaces/members` (all member edits; send ONLY the keys being changed) |
| 2.6 | `DELETE /api/workspaces/members?memberId=<id>&workspaceId=<id>` |
| 2.6 | `POST /api/workspaces/members/{memberId}/avatar` |
| 2.6 | `PATCH /api/admin/users/{userId}` |
| 2.6 | `DELETE /api/admin/users/{userId}` |
| 2.6 | `GET /api/admin/users/memberships` |
| 2.6 | `GET /api/admin/app-installs` |
| 2.6 | `GET /api/audit?limit=&offset=&action=&search=` |
| 2.6 | `GET /api/audit/{id}` |
| 2.6 | `GET /api/admin/google-workspace/accounts` |
| 2.6 | `POST /api/admin/google-workspace/users` |
| 2.6 | `GET /api/gideon/history` |
| 2.6 | `DELETE /api/gideon/history` |
| 2.6 | `POST /api/gideon` (Server-Sent Events) |
| 2.6 | `GET /api/gideon/usage` |
| 2.6 | `GET /api/app/version-policy` |
| 2.6 | `GET /api/app/latest` |
