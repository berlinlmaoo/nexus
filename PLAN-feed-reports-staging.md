The plan is large and self-contained from the four inputs; no further file inspection is needed. Writing it now.

# NEXUS — Implementation Plan: The Wire (Feed) + Integrity (Peer Reports) + Staging

> **Status: PLAN FOR REVIEW. Belum ada code yang ditulis.** Bro, ini gabungan dari tiga design + UX critique + research jadi satu rencana. Semua keputusan teknis udah ada, tapi ada 8 keputusan produk/etika yang harus lo putusin dulu sebelum build (§8). Semua path absolut, semua nyambung ke primitives + convention yang udah ada di codebase.

---

## 1. TL;DR / Scope

Tiga hal yang dikerjain, dalam urutan ini:

1. **Feature 1 — The Wire (Feed):** timeline ala Twitter/X, workspace-scoped, di Phaëthon web app. Post text + foto (≤4), @mention + notif, like, comment (MVP-lite), cursor-pagination, optimistic posting. Low-risk, high-delight. **Ini yang di-ship duluan.**
2. **Feature 2 — Integrity (Peer Reports / "cepu"):** lapor pelanggaran kebijakan antar-karyawan; report yang diverifikasi BoD memindahkan XP (reporter +bounty, reported −penalty) secara atomic + reversible. **Risiko utamanya manusia, bukan teknis.** Butuh governance sign-off + due-process + anti-abuse sebelum XP-nya nyala (§3.8).
3. **Staging — `nexusdev.patsgroup.id`:** karena dua fitur ini bawa Prisma migration, staging dengan DB terpisah itu wajib biar migration bisa dites sebelum kena prod. Staging app-nya udah jalan di LAN; yang kurang cuma DB terpisah + Cloudflare front-door.

**Prinsip lintas-fitur (dari UX critique, paling penting):** **cocokkan motion ke bobot emosi momennya.** `celebrate()` confetti = benar untuk like-milestone di feed (jarang, positif, low-stakes); **salah total untuk verdict cepu** (konsekuensial, ada pihak yang dirugikan). Motion = insentif. Salah nada di cepu = no amount of backend rate-limiting nyelametin.

**Backend:** semua di `nexus-app-beta` (:3002 → prod DB). Frontend `apps/nexus-lovable-ui` di-build ke `dist`. Migration additive, **lo yang apply ke prod DB** (harness diblokir dari DB writes/migrations).

---

## 2. Feature 1 — The Wire (Feed)

Route tetap `/feed`; product name di copy = **"The Wire"** ("What the crew is shipping, shouting, and shipping again.").

### 2.1 Data model (Prisma)

Tambah ke `/Users/jagainmacmini1/Documents/nexus/prisma/schema.prisma`. Convention rumah: `cuid()` PK, `workspaceId` di root entity, FK-chain ke children, `@@index` di kolom query, `onDelete: Cascade`. Plus soft-delete + `editedAt` + denormalized `likeCount`/`commentCount`.

```prisma
model Post {
  id           String   @id @default(cuid())
  text         String   @db.Text          // ≤280 enforced di API
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  editedAt     DateTime?                   // shows "· edited"
  deletedAt    DateTime?                   // soft delete; feed filters deletedAt: null
  workspaceId  String
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  authorId     String
  author       User      @relation("PostAuthor", fields: [authorId], references: [id], onDelete: Cascade)
  images       PostImage[]
  mentions     PostMention[]
  likes        PostLike[]
  comments     PostComment[]
  likeCount    Int @default(0)            // synced inside like tx
  commentCount Int @default(0)
  @@index([workspaceId, deletedAt, createdAt])   // primary feed path
  @@index([authorId, createdAt])
}
// PostImage(url,mimeType,size,width?,height?,position) — width/height to kill CLS
// PostMention @@unique([postId,userId]) @@index([userId])  // "posts mentioning me"
// PostLike    @@unique([postId,userId]) @@index([postId])  // 1 like/user, idempotent toggle
// PostComment(text,deletedAt?,parentId? for v2 threads) @@index([postId,createdAt])
```
`User` += `postsAuthored/postMentions/postLikes/postCommentsAuthored`; `Workspace` += `posts Post[]`.

### 2.2 API (`/src/app/api/feed/`)

Semua **workspace-scoped** (IDOR canon — workspace dari session membership, **bukan** dari body).

| Route | Notes |
|---|---|
| `POST /api/feed/posts` | `multipart/form-data` (text + images sekaligus). Validasi: text 1..280 **atau** ≥1 image; ≤4 images, ≤8MB each, real MIME via `resolveMime()`. Store `/public/uploads/feed/`, serve via gated `/api/files/feed/`. Single `$transaction`: Post + PostImage[] + validated PostMention[]. After-commit: `notifyMention(...)` + `emitPostCreated`. |
| `GET /api/feed/posts?cursor&limit=20` | **Cursor pagination** keyed `createdAt,id` (stable as new posts arrive, offset isn't). `take:limit+1` → `hasMore`+nextCursor. `likedByMe` via **satu** batched `PostLike.findMany`, bukan per-post. `?mentions=me` → Mentions tab. |
| `DELETE /api/feed/posts/{id}` | Soft delete. Author **atau** BoD/Manager (`checkWorkspaceAccess`). Re-fetch server-side. Audit moderation case. |
| `PATCH /api/feed/posts/{id}` | Author-only, ≤15min after create. Diff mentions → notif hanya yang **baru** ditambah. Set `editedAt`. Images not editable MVP. |
| `POST /api/feed/posts/{id}/like` | Body-less toggle. `$transaction`: upsert/delete `PostLike` + `likeCount {inc/dec}` atomik. Returns `{liked, likeCount}`. `@@unique([postId,userId])` **=** idempotency key (DB nolak dupe) — beda dari XP yang key-nya free-text reason, jadi gak butuh advisory lock di sini. |
| `*/comments` (MVP-lite) | Mirror task-comment route (reuse mention-parse + `notifyMention`). Inc `commentCount` in tx; notify post author + mentioned. |

### 2.3 UI/UX + animations

**Files baru di `apps/nexus-lovable-ui/src/`:** `routes/_app/feed.tsx` (FeedPage, `useInfiniteQuery(['feed',tab])`, IntersectionObserver sentinel), `components/feed/{Composer,PostCard,ImageGrid,ImageLightbox,PostDetailModal}.tsx`.

**Reuse yang sudah ada (jangan bikin baru):**
- `@mention autocomplete` → **extract jadi shared `useMentionAutocomplete` hook** dari `TaskDetailPanel.tsx:1067-1144` (regex `(?:^|\s)@(\S*)$`, popover `members.slice(0,6)`, arrow/Enter/Tab/Esc, submit-filter "only keep mentions still in text"). Feed + task comments berhenti duplikat.
- Motion primitives dari `components/motion/index.tsx` (`Reveal/Lift/AnimatedBar/CountUp/Float`), `MorphPanel/rectCenter`, `celebrate()`.

**Animations (real primitives + UX upgrades inline):**

1. **Entry stagger** — `<Reveal delay={Math.min(index,12)*0.04}>` (cap delay supaya page-3 gak nunggu detik-an), inner `whileHover={{y:-2}} whileTap={{scale:0.98}}`.
2. **Like = signature moment** *(UX upgrade — bukan sekadar scale-pop):* (a) **burst 5–6 partikel rose** inline SVG/motion dari pusat heart, **hanya pas transisi liking** (BUKAN `celebrate()` confetti); (b) `CountUp` **odometer roll satu digit**, naik pas +1 / turun pas un-like (arah encode makna); (c) `:active scale(0.92)` press-down **dulu** sebelum pop (sekarang weightless); (d) easing pop = `cubic-bezier(0.34,1.56,0.64,1)` overshoot (like *mau* mantul; panel nggak). Semua <320ms. `celebrate()` **cuma untuk milestone** (like ke-1/10/50 sebuah post).
3. **New-post handling — `↑ N new posts` pill MASUK MVP (BUKAN v2).** *Ini correctness-fix, bukan nicety.* Socket `emitPostCreated` + top-insertion tanpa pill = **nge-yank scroll** siapa pun yang lagi baca ke bawah = bug paling parah di timeline. Aturan: auto-insert-with-slide **hanya** kalau `scrollTop < 200px`; selain itu buffer + munculin pill (`Float`-wrapped, `CountUp` count, avatar 2–3 poster terbaru `-space-x-2`). Klik → smooth-scroll to top (instant kalau reduced-motion) → baru flush buffer.
4. **Optimistic posting — "settling" state, bukan "loading" state** *(UX upgrade):* temp card render **full opacity + full color langsung** (pakai text + local `objectURL`). Satu-satunya sinyal sending = **hairline progress 1.5px** di bawah card + timestamp jadi "Posting…". Sukses: hairline fill sekali → fade, "Posting…" cross-fade ke "now" (2px blur bridge nutupin swap). Gagal: **border shake 6px (3 osilasi, 400ms)** → red retry state. Sukses = quiet default; failure = satu-satunya yang narik perhatian. TanStack `onMutate`/`onError` rollback.
5. **Composer char-ring — state transitions, bukan color-swap doang** *(UX upgrade):* ring **baru muncul** (fade+scale dari 0.8) pas ~220 char (di bawah itu = noise); di boundary 280 **wobble** `rotate:[0,-4,4,0]` sekali; angka sisa cuma render di dalam ring di 20 char terakhir (counting down, merah+bold di <0); Post button disable = `scale(0.98)`+desaturate, bukan mati mendadak.
6. **Empty states = signature moments** *(UX upgrade):* (a) empty feed → ilustrasi line "radio tower / wire" on-brand, composer auto-focus, `Float` down-arrow **one-time** (store flag, jangan muncul lagi); (b) empty Mentions → "No one's tagged you yet ✨", **cross-fade antar-tab** (keyed `motion.div`, 150ms opacity+4px-y); (c) **skeleton harus match geometry PostCard persis** (avatar circle + 2 text-line + image-block) + shimmer halus — skeleton generic = layout snap = ngebatalin kerjaan `width/height`.
7. **Compose morph (mobile)** — pill collapsed → `MorphPanel origin={rectCenter(pill)} originScale={0.3}`. Desktop selalu expanded.

Semua honor `useReducedMotion()` (entrance instant, no spring, MorphPanel auto-fade).

### 2.4 Nav

- **Desktop** `AppSidebar.tsx`: `{ title:"The Wire", url:"/feed", icon: Rss }` di grup **"Home Base"**, setelah "Signal Inbox".
- **Mobile** `MobileTabBar.tsx`: item sama di "Home Base" dalam `moreGroups`. **Jangan** promote ke 4-slot bottom `primary` pill di MVP — taruh di "More" sheet dulu; re-evaluate setelah ada engagement data (open Q #3).
- Unread mention badge dot, fed dari `/api/notifications` unread-by-type yang inbox udah pakai.

### 2.5 Notifications

Reuse stack penuh, **no infra baru**. On post create/edit, per validated mention: `notifyMention({ mentionedUserId, mentionedByName, taskId: postId, taskTitle: text.slice(0,100), commentSnippet: text.slice(0,200) })` → fan-out in-app (`emitNotification`) + email + WA (Hermes) + Slack, respect `NotificationPreference.commentMention` + DND. Link = `/feed?post={id}`. Comment notif → post author + mentioned. **Jangan notif on like** di MVP (high-volume, low-signal). v1 reuse `commentMention`; tambah `feedMention` flag (default true) belakangan biar gak migration.

### 2.6 Abuse controls (ringkas)

≤4 images/8MB/`image/*` (client+server); ≤10 mentions/post (else 422, zero notif); rate-limit ~1 post/20s + ~30/hr (429 "Slow down, hotshot."); empty+no-image = 422; no `@everyone`; deleted-post race → 410; XSS-safe (plain text + ID-based chips); BoD/Manager moderation = soft-delete + audit.

### 2.7 Phasing (Feed)

- **MVP:** post text+images, @mention+notif, cursor feed, like (toggle+count+signature-pop), delete own, lightbox, optimistic "settling", Reveal-stagger, nav, empty states, caps, **`↑ N new posts` pill (pulled in)**, comments MVP-lite (inline reply + count; full thread di detail modal).
- **v2:** comment threads (`parentId`) + reactions, Mentions/Following tabs, edit window UI, mobile compose-morph, BoD pin-announcement, link unfurls, post→XP hook (quality-gated), `Report`/CEPU moderation queue, alt-text a11y, GIF/video.

---

## 3. Feature 2 — Integrity (Peer Reports / "cepu")

> Namespace **`/api/peer-reports`** (karena `/api/reports` udah dipake analytics); route file **`peer-reports.tsx`**. Nav label publik **"Integrity"**; nickname "cepu" gak pernah muncul di UI.

### 3.1 Data model (Prisma)

```prisma
model PeerReport {
  id String @id @default(cuid())
  workspaceId String;  workspace Workspace @relation(...onDelete: Cascade)
  reporterId String;   reporter     User @relation("PeerReportReporter", ...Cascade)
  reportedUserId String; reportedUser User @relation("PeerReportReported", ...Cascade)
  category PeerReportCategory          // whitelist enum
  reason   String                      // 10..1000 chars (API-validated)
  status   PeerReportStatus @default(PENDING)   // PENDING|VERIFIED|REJECTED|WITHDRAWN
  evidenceUrl/MimeType/Size String?    // gated /api/files/peer-reports/
  rebuttal String?; rebuttalAt DateTime?        // reported person's right to respond
  reviewerId String?; reviewer User? @relation("PeerReportReviewer", ...SetNull)
  reviewNote String?; reviewedAt DateTime?      // rationale, shown to BOTH parties
  reporterBountyXp  Int @default(0)             // SNAPSHOT as-applied (immutable)
  reportedPenaltyXp Int @default(0)             // stored positive, applied negative
  xpAppliedAt DateTime?
  events PeerReportEvent[]
  @@index([workspaceId,status,createdAt]) @@index([reportedUserId,status])
  @@index([reporterId,createdAt]) @@index([reviewerId])
}
model PeerReportEvent { // append-only audit: action, fromStatus?, toStatus?, note?, metadata Json?, actorId
  @@index([reportId,createdAt]) }
model ReportCategoryConfig { // per-(workspace,category): enabled, reporterBountyXp(20), reportedPenaltyXp(40), requiresEvidence, label
  @@unique([workspaceId,category]) }
enum PeerReportStatus { PENDING VERIFIED REJECTED WITHDRAWN }
enum PeerReportCategory { SMOKING_INDOORS SMOKING_TOILET SAFETY_VIOLATION CLEANLINESS EQUIPMENT_MISUSE POLICY_OTHER }
```
`User` += `peerReportsFiled/Against/Reviewed` + `peerReportEvents`; `Workspace` += `peerReports` + `reportCategoryConfigs`; `NotificationPreference` += `peerReportVerdict Boolean @default(true)` + `peerReportFiled Boolean @default(true)`.

**Kenapa begini:** XP deltas **di-snapshot ke row report** saat verify (bukan dibaca live dari config) → ganti config nanti gak nulis-ulang history. `PeerReportEvent` = append-only audit terpisah dari verdict fields → timeline lengkap bahkan setelah withdraw. Dedup/cooldown di API layer (§3.2), bukan `@@unique` (timestamp beda gak nge-dedup).

### 3.2 API (`/src/app/api/peer-reports/`)

| Route | Notes |
|---|---|
| `POST /` create | Membership check; **gak boleh self-report**; reason 10–1000; **category whitelist** (`enabled`?) + `requiresEvidence`? gate; reported user must be same workspace (IDOR). **Rate-limits:** cooldown 5min (429), max 5 open/reporter (429), **1 pending/(reporter,reported) pair** (409 anti-pile-on). Log `created` event. Notif reported person (`notifyPeerReportFiled`) + BoD. |
| `GET /?status=` list | Whole workspace lihat (itu poin fiturnya), filter status. **Identity redaction semi-anon:** `canSeeReporter = isBod \|\| reporterId===me \|\| reportedUserId===me`; selain itu reporter = "Anonymous". `_canVerify/_isMineReported/_isMineFiled` flags. |
| `POST /{id}/verdict` | **BoD-only**, gate via workspace **report** (bukan client). **Conflict-of-interest:** BoD yang jadi reporter/reported gak bisa decide (403). Idempotent: `status!==PENDING` → 409. REJECT = status flip + event, no XP. VERIFY = `verifyPeerReport(...)` (§3.3). |
| `POST /{id}/rebuttal` | Reported user only, while PENDING. Editable sampai verdict; ditunjukkan ke BoD sebelum decide + ke kedua pihak sesudahnya. |
| `POST /{id}/withdraw` | Reporter only, while PENDING → WITHDRAWN, no XP. |
| `POST /upload` | Mirror `/api/attachments`: `image/*` via `resolveMime()`, ≤10MB, `/public/uploads/peer-reports/`, served gated (`private`, `nosniff`, session-required). |
| `GET/PATCH /config` | BoD-only: enable/disable category (= whitelist), set per-category bounty/penalty, toggle `requiresEvidence`. |

### 3.3 XP mechanics (atomic + idempotent + reversible)

Tambah `verifyPeerReport()` ke `/Users/jagainmacmini1/Documents/nexus/src/lib/gamification.ts` (reuse private `applyXpDelta`, pola advisory-lock yang ada):

```ts
// ONE $transaction: reporter +bounty, reported −penalty, AND flip report→VERIFIED. Idempotent on reportId.
const reporterKey = `peer:report:${reportId}:bounty`     // immutable, per-report (BUKAN per-pair)
const reportedKey = `peer:report:${reportId}:penalty`
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reporterKey})::int8)` // lock BOTH keys,
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reportedKey})::int8)` // fixed order = no deadlock
const already = await tx.xpTransaction.findFirst({ where:{ userId:reporterId, reason:reporterKey }})
if (already) return false                                  // idempotency → route 409
await applyXpDelta(tx, reporterId, bounty);   tx.xpTransaction.create({reason:reporterKey, amount:bounty})
await applyXpDelta(tx, reportedUserId, -penalty); tx.xpTransaction.create({reason:reportedKey, amount:-penalty})
const upd = await tx.peerReport.updateMany({ where:{ id:reportId, status:"PENDING" },  // optimistic lock #2
  data:{ status:"VERIFIED", reviewerId, reviewedAt, reviewNote, reporterBountyXp:bounty, reportedPenaltyXp:penalty, xpAppliedAt:new Date() }})
if (upd.count===0) throw new Error("ALREADY_DECIDED")      // someone decided mid-flight → full rollback
```

**Properties:** **Atomic** (3 efek commit/rollback bareng) · **Idempotent** keyed `reportId` (event sejati, lebih kuat dari per-pair) · **Race-safe** (advisory locks fixed-order + `updateMany where status:PENDING`) · **Auditable** (2 `XpTransaction` + `PeerReportEvent` + snapshot di row) · **Reversible** (shared `peer:report:<id>:*` reason → `refundXpByReason` untuk appeal). Deltas dari `ReportCategoryConfig` per (workspace,category), default bounty 20 / penalty 40.

### 3.4 UI/UX + animations

Route `routes/_app/peer-reports.tsx`: `PageHeader` "Integrity", subtitle "Report policy violations. Verified reports move XP.", `tabs` (All/Pending/Verified/Rejected segmented). `ReportComposer` (MorphPanel genie-zoom): reported-user picker (self filtered), category chips (dari enabled config), reason textarea, evidence dropzone (required-badge kalau `requiresEvidence`). `ReportCard` (`data-morph-id`) → `MorphPanel` detail (measured-rect FLIP, no-layoutId recipe dari MEMORY, karena status filter bisa unmount card).

**Animations — DIBONGKAR oleh UX critique (nada = insentif):**

1. **Feed entrance** — `Reveal delay={i*0.04}`.
2. **Card→detail morph** — measured-rect FLIP per `data-morph-id={peer-report-${id}}` (no shared `layoutId`).
3. **🔴 BUANG CONFETTI PADA VERIFY — perubahan terpenting di kedua design.** `celebrate("Report verified! ⚖️")` confetti **di momen seorang karyawan baru kehilangan 40 XP + ditandai pelanggar publik** = persis "workplace-harassment engine" yang §3.8 takutin, dirender dalam motion. Ganti jadi **konfirmasi seremonial yang sober:** dual-counter reveal boleh tetap (informatif), tapi vokabuler motion geser dari *celebratory* → *consequential* — easing `ease-in-out` ~600ms, **no particles, no bounce**, `AnimatedBar` "XP transferred" nyapu **deliberate** antar-avatar tone muted, lalu settle tenang. Rasanya "a decision was recorded" (ledger entry), bukan "you scored". **REJECT:** `StatusBadge` cross-fade amber→muted, **no confetti** (nolak rekan kerja bukan "win").
4. **Card → destination-tab morph on verdict** *(UX upgrade — fix trap):* verify mengubah status → card hilang dari list terfilter (mis. tab "Pending"). Close-anim **morph panel ke tab tujuan** (translate+scale-down ke "Verified" di segmented control) + **`CountUp` +1 badge bump** di tab itu. Bukan dissolve-ke-mana-mana yang bikin bingung.
5. **StatusBadge transitions** *(UX upgrade):* PENDING→VERIFIED/REJECTED = **cross-fade 2px blur bridge** + color-temp shift, bukan hard-pop.
6. **`−{penalty} XP` warna SALAH** *(UX upgrade — copy-paste bug):* sekarang `text-emerald-500` (hijau = earning). Penalty harus **muted/restrained-red**, jangan pernah hijau-sukses.
7. **Stat strip — pisahkan register emosi** *(UX upgrade):* untuk **reported** person, "report against you" = high-anxiety. Kasih surface terpisah, calm-toned ("1 report needs your response" + quiet pulse-ring sekali → link ke rebuttal composer), beda visual dari bounty-XP gamification stats.
8. **Tab underline** = `layoutId="peer-tab-underline"` (safe shared-layoutId; tabs mounted in place).
9. **Reduced-motion = pengalaman tenang yang KOHEREN, bukan "animasi mati"** *(UX upgrade — flagged accessibility bug):* `celebrate()` **harus early-return under reduce** (ANIMATIONS.md flag TODO — **audit semua call-site `celebrate()` global** while in there). Counters jump ke final, badge cross-fade (keep opacity, drop transform), AnimatedBar jadi label statis. Jangan biarkan reduced-motion user dapat **−40 XP mendadak tanpa konteks** = lebih jarring dari jalur animated.

### 3.5 Composer = tempat harm dicegah → friction SENGAJA *(UX upgrade)*

Inversi aturan "reduce friction": (a) reason textarea kasih live reminder "describe the behavior, not the person" + amber-pulse sekali kalau ada `@name`/pronoun-heavy; (b) untuk `requiresEvidence`/restroom-adjacent: **checkbox aktif** "I confirm this photo contains no faces or restroom interiors" yang **gate submit** (bukan banner pasif) — jalur bahaya dibikin lambat, jalur aman normal; (c) submit button bawa **consequence preview selalu-terlihat**: "BoD will review · {reportedUser} will be notified you filed this" — reported-person-notified = deterrent terkuat lawan frivolous report, jadi tunjukin sebelum commit.

### 3.6 Nav + notifications

- **Nav:** icon `ShieldAlert`, label "Integrity", grup **"Missions"** setelah "Leaderboard", di `AppSidebar.tsx` + `MobileTabBar.tsx`. Optional unread badge: "PENDING against me" + (BoD) "PENDING awaiting review".
- **Notifications (kedua pihak on verdict):** `notifyPeerReportFiled` → reported person (transparansi/due-process). `notifyPeerReportVerdict` → reporter ("verified ⚖️ +X XP" / "not upheld") **dan** reported ("upheld −X XP, reason…" / "dismissed, no action") — **selalu** dikabarin, bahkan on reject (mereka berhak closure). Gated `peerReportFiled`/`peerReportVerdict` + `isUserDnd`. BoD dapat `peer_report_new` biar report gak ngendap. WA-on-verdict = open Q #10 (lihat §3.8).

### 3.7 Phasing (Cepu)

- **Phase 0 — Governance gate (sebelum kode apa pun):** leadership setujui fitur + category whitelist + XP deltas + identity policy. **Dokumentasikan.** Ini keputusan manusia, bukan teknis.
- **Phase 1 — Schema + create/list, NO XP:** models + `POST/GET`, feed+composer UI, semi-anon redaction, rate-limits, whitelist, notify-on-filing, audit log. Verify = **no-op status change** (XP off behind flag). Rasain dinamika sosialnya sebelum duit (XP) gerak.
- **Phase 2 — Verdict + atomic XP:** `verifyPeerReport`, verdict route, dual-party notif, **sober** XP-delta reveal, conflict gate, penalty cap.
- **Phase 3 — Due-process hardening:** rebuttal + appeal flow + XP reversal, bad-faith penalty, BoD config screen.
- **Phase 4 — Polish & guardrails:** evidence privacy (BoD-only sensitive categories, restroom-photo block), retention/auto-archive, serial-reporter/pile-on dashboard, nav badges, reduced-motion `celebrate()` guard.

### 3.8 ⚖️ Etika, anti-abuse & due-process (KONTRAK — bukan opsional)

Fitur ini menggamifikasi melaporkan rekan kerja. Itu **berbahaya** buat trust, psychological safety, dan fairness. **Risiko terbesar = manusia, bukan teknis.** Atomic XP transfer itu bagian *gampang*; yang *susah* (di bawah) yang misahin responsible build dari workplace-harassment engine.

**Core risks:** false/retaliatory reports (panen XP / balas dendam) · harassment/pile-on (feed publik mengamplifikasi humiliation) · **privacy** (motret diam-diam rekan kerja — apalagi **toilet/smoking**; foto "di toilet" itu sendiri pelanggaran martabat) · no due-process (dihukum tanpa sempat jawab) · chilling effect / surveillance culture (framing "cepu" itu sendiri risiko moral).

**MUST-HAVE safeguards (build gak boleh ngilangin satupun):**

*Due process:*
1. Reported person **dinotif saat difiling** — gak pernah dihukum by surprise.
2. **Right to respond:** `rebuttal` field + endpoint, editable sampai verdict, ditunjukkan ke BoD sebelum decide.
3. Verdict bawa **`reviewNote` rationale** terlihat kedua pihak — no black-box punishment.
4. **Appeal + reversible XP:** shared `peer:report:<id>:*` reason → `refundXpByReason`; "Appeal" → BoD kedua; overturn = XP refund + event logged.

*Abuse prevention:*
5. **Category whitelist** — cuma enum + yang `enabled`; BoD curate; no freeform "report for anything".
6. **Rate-limit/cooldown:** 5min cooldown, max 5 open/reporter.
7. **1 pending/(reporter,reported) pair** anti-pile-driving.
8. **Penalty cap/floor per period** — coordinated pile-on gak bisa nol-in seseorang; surface "user ini punya N pending reports" flag ke BoD buat deteksi kampanye.
9. **BoD conflict-of-interest exclusion** — BoD reporter/reported gak bisa self-judge; route ke BoD lain.
10. **Bad-faith-report penalty** — reject "bad-faith" (distinct dari "unproven") bisa kasih reporter XP penalty (BoD-discretionary, logged, appealable) — ngilangin asimetri "report = all-upside". ⚠️ *Risiko: over-penalize nge-chill laporan sah terhadap orang berkuasa.*

*Privacy & audit:*
11. **Full immutable audit log** — tiap transisi = `PeerReportEvent` + `AuditLog` (`entityType:"peer_report"`). Nothing silently mutable.
12. **Evidence guardrails** — `SMOKING_TOILET`/restroom-adjacent: **block face/restroom-interior photos by policy**, consent/privacy warning di composer (§3.5), evidence **BoD-only** untuk kategori sensitif, selalu via gated `/api/files`.
13. **Semi-anonymous identity** (§3.8b).
14. **Rejected reports HIDDEN dari public feed** (mereka udah clear — biarin visible = harm sendiri); visible hanya 2 pihak + BoD.
15. Self-report blocked; cross-workspace blocked (IDOR).
16. **Explicit leadership sign-off** bahwa surveillance feature ini memang diinginkan.

**§3.8b — Identitas reporter: REKOMENDASI = SEMI-ANONYMOUS.** Hidden dari feed umum ("Anonymous" — cegah "snitch list" + retaliation) · Visible ke **BoD** (accountability — deteksi grudge/serial reporter + bad-faith penalty) · Visible ke **reported person** (due-process — berhak hadapi penuduh + deterrent kuat). Satu-satunya opsi yang dukung **both** false-report-detection **and** due-process. Fully-anon ditolak (no accountability); fully-public ditolak (retaliation + chilling effect).

**🔴 Risiko UX terbesar (dari critique):** **bahasa animasi merayakan hukuman.** Confetti + `+XP` bounce + "Report verified! ⚖️" di layar yang artinya "rekan kerja bernama baru dihukum + ditandai publik" = mismatch nada yang **melatih** persis bad-faith reporting yang §3.8 berusaha cegah. Motion **adalah** struktur insentif. Pasangkan dengan open-Q #8: **PENDING accusations jangan publik** — UI jangan pernah menganimasikan tuduhan belum-terbukti ke surface celebratory/attention-grabbing.

---

## 4. Staging — `nexusdev.patsgroup.id`

### 4.1 Current state (verified, bukan stale echo)

**Real & running, tapi cuma reachable di LAN — public hostname-nya yang kurang.**

| Layer | Running | Status |
|---|---|---|
| Backend | `nexus-app-staging` `127.0.0.1:3004`→3000, image `nexus-app:staging` | Up (healthy) |
| Frontend | launchd `com.nexus.phaethon-preview` → `vite preview --port 4178`, `VITE_API_TARGET=http://127.0.0.1:3004`, serves `dist-staging/` | loaded |
| DB | **none** — pakai `.env.production` `DATABASE_URL` = **shared prod `nexus_db`** | shared ⚠️ |
| Public route | **MISSING** — gak ada tunnel ingress map `nexusdev` → :4178 | **gap** |

**Koreksi research yang material (verified):** prod domains diserve **token named tunnels dalam Docker** (`nexus-cloudflared-1/-oldnexus/-beta`), **BUKAN** `~/.cloudflared/nexus-dashboard.yml` (itu tunnel terpisah, cuma serve `affine.berlinputro.com`+`dashboard-nexus...`). Edit yml itu **gak ngefek** ke prod-style domains. `promote-to-prod.sh` me-recreate `nexus-app-beta` (:3002, Phaëthon BoD prod) + rsync `dist-staging→dist` — **bukan** staff `:3000`. Prod Postgres asli = user `nexus_user` / db `nexus_db` (bukan `nexus`/`nexus`). Gak ada `nexus-postgres-staging`/`nexus_staging` saat ini.

### 4.2 Target architecture — DB staging terpisah (recommended di sini)

**Kenapa wajib di sini spesifik:** dua fitur ini **butuh additive migration** (`CREATE TABLE Post/PeerReport/…`). Migration justru yang staging eksis buat de-risk. Kalau staging share prod DB, lo gak bisa tes migration tanpa udah jalanin di prod = defeats the purpose. DB terpisah = `prisma db push` ke staging → smoke-test feed/cepu end-to-end → **baru** apply SQL sama ke prod.

```
nexusdev.patsgroup.id ─[named tunnel]→ 127.0.0.1:4178 (vite preview, dist-staging)
                                            │ /api,/auth → 127.0.0.1:3004
                                            ▼  nexus-app-staging (:3004)
                                            │ DATABASE_URL → postgres-staging
                                            ▼
                            nexus-postgres-staging (:55434, nexus_db/nexus_user)
                            ← seeded dari prod pg_dump · volume ./var-staging/postgres
```

**Tradeoff:** DB terpisah = +1 container/volume + ~2–5min re-seed, tapi = satu-satunya cara tes schema-change aman + destructive-test isolation. **Caveat file-reference:** row attachment/avatar nunjuk file di dir upload prod → **mount prod uploads READ-ONLY** ke staging (`attachments/attendance/avatars/project-icons` `:ro`) biar preview jalan + staging gak pernah korup file prod. Crons target :3002 only → staging gak double-run.

### 4.3 Setup steps

**(a) Cloudflare hostname `nexusdev` — USER-only** (karena token tunnels, bukan local yml). Dashboard → Zero Trust → Networks → Tunnels → tunnel yang fronting zone patsgroup.id (kemungkinan UUID sama `nexus-cloudflared-1`) → **Public Hostname** → Add: subdomain `nexusdev`, domain `patsgroup.id`, service `HTTP`→`127.0.0.1:4178` (auto-bikin DNS CNAME). **Extra safety:** Cloudflare Access policy di depan `nexusdev` (BoD emails only). Verify (assistant after DNS): `curl -s -o /dev/null -w '%{http_code}\n' https://nexusdev.patsgroup.id/`.

**(b) nginx = OPTIONAL** (vite preview udah proxy /api+/auth ke :3004). Skip di awal — one less moving part. Kalau mau parity prod (caching, large-upload, CSP): clone `maintenance/phaethon.conf` → `phaethon-staging.conf`, swap tiap `:3002`→`:3004`, keep `client_max_body_size 1024m`.

**(c) Staging container + DB** — tambah `postgres-staging` + `migrate-staging` ke `docker-compose.staging.yml` (mirror beta pattern), repoint `app-staging` `DATABASE_URL` + **drop network `prod_internal`** (biar stray prod URL gak bisa di-resolve):
```yaml
postgres-staging: { image: postgres:15-alpine, container_name: nexus-postgres-staging,
  environment: { POSTGRES_USER: nexus_user, POSTGRES_PASSWORD: ${STAGING_DB_PASSWORD}, POSTGRES_DB: nexus_db },
  ports: ["127.0.0.1:55434:5432"], volumes: ["./var-staging/postgres:/var/lib/postgresql/data"], networks: [nexus_staging] }
migrate-staging: { image: nexus-app:staging, command: ["sh","-c","npx prisma db push --accept-data-loss"],
  environment: { DATABASE_URL: "postgresql://nexus_user:${STAGING_DB_PASSWORD}@postgres-staging:5432/nexus_db?schema=public" },
  depends_on: { postgres-staging: { condition: service_healthy } } }
# app-staging: same DATABASE_URL override, networks:[nexus_staging] (drop prod_internal), uploads :ro
```

**(d) Seed + migration — USER runs the SQL** (harness blocks DB writes/migrations):
```bash
sh backup_postgres.sh                                              # fresh prod dump
docker compose -p nexus-staging -f docker-compose.staging.yml --env-file .env.production up -d postgres-staging
gunzip -c "$(ls -1t backups/postgres/daily/nexus_*.sql.gz|head -1)" | docker exec -i nexus-postgres-staging psql -U nexus_user -d nexus_db   # USER
docker compose -p nexus-staging ... run --rm migrate-staging      # USER — apply new schema to STAGING only
```

### 4.4 Deploy flow

```
edit src/ + apps/nexus-lovable-ui/
  → sh scripts/deploy-staging.sh        # build nexus-app:staging, recreate :3004, vite build→dist-staging, kick :4178
    (separate-DB: re-seed + migrate-staging)
  → verify https://nexusdev.patsgroup.id   # feed posts, cepu, XP, attendance, login
  → [USER applies SAME migration SQL to PROD nexus_db]   ⚠️ BEFORE promote
  → sh scripts/promote-to-prod.sh       # retag staging→prod, recreate nexus-app-beta :3002, rsync dist-staging→dist
  → verify https://nexus.patsgroup.id
```
**Disiplin kunci:** apply additive SQL ke **prod sebelum** `promote-to-prod.sh`, biar image prod baru start melawan schema yang udah punya tabel baru. Additive (`CREATE TABLE IF NOT EXISTS`) → prod stays up selama apply.

### 4.5 Who does what

| | Assistant | USER-only |
|---|---|---|
| Rewrite `docker-compose.staging.yml`, update `deploy-staging.sh`, build/recreate containers, `backup_postgres.sh`, vite build, `curl` health | ✓ | |
| **Restore prod dump → staging DB** (`psql` write) | | ✓ harness-blocked |
| **`prisma db push` / apply migration SQL** (staging AND prod) | | ✓ harness-blocked |
| **Cloudflare public-hostname for `nexusdev`** | ◐ prep CLI | ✓ dashboard auth |
| Set `STAGING_DB_PASSWORD` secret | ◐ draft | ✓ owns secrets |

---

## 5. Cross-cutting

### 5.1 Prisma additions + migration mechanics

Semua model baru (`Post*`, `PeerReport*`, `ReportCategoryConfig`, enums, `NotificationPreference` flags) → `/Users/jagainmacmini1/Documents/nexus/prisma/schema.prisma`. Convention: `cuid()` PK, `workspaceId` di root, `@@index` query-cols, `Cascade` ownership / `SetNull` optional reviewer.

**Migration = additive, house-pattern, USER-applied (harness blocked):**
```bash
cd /Users/jagainmacmini1/Documents/nexus
npx prisma migrate diff --script > prisma/manual-migrations/2026-06-XX-feed.sql        # review for IF NOT EXISTS
npx prisma migrate diff --script > prisma/manual-migrations/2026-06-19-peer-reports.sql
# USER applies: STAGING DB first (verify) → then PROD nexus_db (before promote)
npx prisma generate
```
Semua `CREATE TABLE IF NOT EXISTS` + guarded `DO $$` FK blocks (pola `2026-06-06-api-token.sql`). Additive = aman di-`DROP TABLE` kalau rollback; prod stays up.

### 5.2 Shared infra (reuse, no new infra)

- **Upload/serve:** `/api/attachments` pattern (multipart, `resolveMime()`, `/public/uploads/{feed,peer-reports}/`) + gated `/api/files/[...path]` (session-required, `private` cache, `nosniff`). Mount-`:ro` di staging.
- **Notifications:** `notifyMention` (feed) + new `notifyPeerReportFiled`/`notifyPeerReportVerdict` in `notification-service.ts`, mirroring `notifyTaskAssigned` (pref-check + DND + multi-channel `emitNotification`/email/WA/Slack + `createInAppNotification`).
- **Motion:** `components/motion/*` (Reveal/Lift/AnimatedBar/CountUp/Float/MorphPanel/rectCenter) + `Celebration.tsx` `celebrate()`. **Extract `useMentionAutocomplete`** (dedupe feed↔task-comment). **Global TODO: `celebrate()` reduced-motion early-return guard** + audit semua call-site.
- **XP:** `gamification.ts` — feed `likeCount` pakai atomic-increment discipline; cepu pakai new `verifyPeerReport()` (advisory-lock + idempotent + reversible).
- **Nav wiring:** `AppSidebar.tsx` (desktop groups) + `MobileTabBar.tsx` (`moreGroups`); Feed→"Home Base", Integrity→"Missions". Lucide `Rss` + `ShieldAlert`.

---

## 6. Phased rollout — apa yang ke STAGING duluan & urutannya

1. **Staging DB terpisah berdiri dulu** (§4.3): `postgres-staging` up, seed dari prod dump, drop `prod_internal`, uploads `:ro`. *(Tanpa ini, migration gak bisa dites.)*
2. **Feed MVP → staging** (push schema feed ke staging DB, build, verify di `nexusdev`): post/like/mention/notif/feed/optimistic/`↑N pill`/empty-states/comments-lite. **Ship pertama** (low-risk).
3. **Apply feed migration ke PROD** (USER) → `promote-to-prod.sh`. Feed live di `nexus.patsgroup.id`.
4. **Cepu Phase 1 → staging, NO XP** (push peer-reports schema): create/list, semi-anon redaction, rate-limits, whitelist, notify-on-filing, audit, sober-toned UI, composer-friction. Rasain dinamika sosial di staging dulu.
5. **Cepu Phase 2 → staging:** `verifyPeerReport` + atomic XP + **sober** verdict reveal + conflict gate + penalty cap. Verify XP math + idempotency + reversal di staging DB.
6. **Cepu Phase 3–4 → staging:** rebuttal/appeal/bad-faith + BoD config + evidence privacy + reduced-motion guard.
7. **Apply peer-reports migration ke PROD** (USER) → promote. **Hanya setelah Phase 0 governance sign-off (§3.8 #16).**

**Aturan ordering selalu:** STAGING (push+verify) → PROD migration (USER) → `promote-to-prod.sh`.

---

## 7. Effort / sequencing estimate

| Blok | Est. | Catatan |
|---|---|---|
| Staging DB terpisah + Cloudflare front-door | **0.5–1 hari** | Mostly compose edits; USER: psql restore + CF dashboard + `STAGING_DB_PASSWORD` |
| `useMentionAutocomplete` extract + `celebrate()` reduced-motion guard (shared) | **0.5 hari** | Unblocks both features |
| **Feed MVP** (schema, API, FeedPage, Composer, PostCard, ImageGrid, lightbox, like-signature, optimistic-settling, `↑N pill`, empty-states, nav, comments-lite) | **4–6 hari** | `↑N pill` + optimistic-settling + like-burst = chunk UX terbesar |
| Feed migration apply + promote + verify | **0.5 hari** | USER apply SQL |
| **Cepu Phase 1** (schema, create/list, semi-anon, rate-limits, whitelist, notify-filing, audit, sober UI, composer-friction) | **3–4 hari** | No XP |
| **Cepu Phase 2** (`verifyPeerReport` + verdict route + sober reveal + conflict gate + penalty cap) | **2–3 hari** | XP atomic core |
| **Cepu Phase 3–4** (rebuttal/appeal/bad-faith, BoD config, evidence privacy, reduced-motion path) | **3–4 hari** | Due-process hardening |
| **Total** | **~3–3.5 minggu** dev | + Phase 0 governance (kalendar, bukan dev) **harus selesai sebelum cepu Phase 2** |

Critical path: Staging → Feed (ship+promote) → Cepu P1 → [Governance gate] → Cepu P2 → P3/4 → promote. Feed & cepu bisa overlap dikit (shared infra udah jadi setelah blok ke-2).

---

## 8. Open questions — HARUS diputusin founder SEBELUM build

**Feed:**
1. **Audience scope** — strictly per-workspace, atau satu firehose company-wide lintas workspace? (nentuin apakah `workspaceId` satu-satunya scope atau ada channel "global".)
2. **Likes & comments di MVP** — comments inline-lite sekarang, atau text+likes only dulu (comments full di v2)? **Likes notif:** silent di MVP (recommended) atau notif author tiap like?
3. **Mobile real-estate** — Feed di "More" sheet, atau promote ke 4-slot bottom `primary` pill (geser dashboard/messages/inbox/tasks)?
4. **Gamification tie-in** — posting / di-like dapat XP? Drive engagement tapi risiko spam-for-points. Quality-gate, atau no-XP di feed dulu?
5. **BoD broadcast** — pinned announcement post-type (BoD-only, sticks to top) masuk MVP atau v2?
6. **Edit policy** — 15-min window + "edited" marker, atau no-edit Twitter-classic (audit cleaner)?
7. **Image retention/storage** — feed images di `/public/uploads/feed` box prod yang sama — fine short-term, tapi mau size-budget / cleanup policy sebelum gede?

**Cepu (jawab #8 & #9 paling dulu — itu yang nentuin apakah fitur ini responsible atau harassment-engine):**
8. **🔴 Haruskah fitur ini ada sama sekali, & APAKAH PENDING accusations publik?** Framing "cepu" menggamifikasi snitching. Leadership udah nimbang morale/trust-cost vs policy-compliance-benefit? **Rekomendasi kuat: PENDING (belum terverifikasi, mungkin palsu) visible HANYA ke 2 pihak + BoD; public feed cuma VERIFIED.** Showing PENDING publik = vektor harassment terbesar.
9. **Reporter identity** — konfirmasi **semi-anonymous** (§3.8b: hidden dari feed, visible ke BoD + reported), atau preferensi fully-public accountability?
10. **Evidence foto wajib?** — `requiresEvidence` per kategori. **Restroom/toilet:** motret di/dekat toilet itu sah secara hukum & policy lokal (Indonesia privacy/dignity)? Kalau nggak, `SMOKING_TOILET` = written account only, **never** photo.
11. **Exact XP deltas** — bounty 20 / penalty 40 starting? Asimetris sengaja (penalty > bounty, biar cost-of-being-caught > reward-of-catching)? **Penalty floor:** boleh push period-score negatif? Interaksi dgn leaderboard `PERIOD_BASELINE_XP` (1000).
12. **Bad-faith penalty** — penalize rejected reporter? Berapa? (Risiko: over-penalize nge-chill laporan sah ke orang berkuasa.)
13. **Power dynamics** — staff boleh report BoD/Manager? Kalau BoD di-report, siapa review (BoD independen? `ONE_ABOVE_ALL` only)?
14. **WA on verdict** — push XP-loss verdict lewat WA bridge, atau in-app only biar gak embarrassing di channel yang gak bisa dia kontrol?

**Staging:**
15. **Separate staging DB?** — **rekomendasi: YA** (wajib buat tes migration dua fitur ini). Confirm + set `STAGING_DB_PASSWORD`. Cooldown/cap values (5min / 5-open / 1-per-pair) cocok buat headcount lo?

---

**File-file load-bearing:** `prisma/schema.prisma` + `prisma/manual-migrations/{2026-06-XX-feed,2026-06-19-peer-reports}.sql` · `src/lib/gamification.ts` (`verifyPeerReport`, advisory-lock) · `src/lib/notification-service.ts` (`notifyMention` reuse + 2 cepu fns) · `src/lib/peer-reports.ts` (event/audit) · `src/app/api/{feed,peer-reports}/` · `apps/nexus-lovable-ui/src/routes/_app/{feed,peer-reports}.tsx` + `components/feed/*` + `components/motion/*` + `Celebration.tsx` + `TaskDetailPanel.tsx:1067-1144` (mention source) + `AppSidebar.tsx`/`MobileTabBar.tsx` + `lib/nexus-api.ts` · `docker-compose.staging.yml` + `scripts/{deploy-staging,promote-to-prod}.sh` + `backup_postgres.sh` + `.env.production` + the `:4178` launchd preview. **Cloudflare `nexusdev` route = dashboard/token-tunnel, BUKAN `~/.cloudflared/nexus-dashboard.yml`.**