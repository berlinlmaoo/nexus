# NEXUS Android: audit

Setiap audit ditulis sebagai bagian baru di paling atas. Path kode relatif ke
`app/src/main/java/id/znetworks/nexus/` kecuali disebut lain.

## Audit pra-rilis 29 Sep 2026: KEAMANAN + paritas (HEAD b122e0f, build 5)

Pembanding: iOS `apps/ios` sampai 77818ba, server `the server repo` (read-only, tanpa POST,
tanpa deploy). Tidak ada kode Android yang diubah. Nilai rahasia tidak pernah ditulis di sini (hanya nama
file/variabel).

**RILIS: LAYAK** (0 KRITIS, 0 TINGGI, 0 SEDANG, 8 RENDAH). Syarat administratif sebelum terbit: sha256 build 5
dicatat di STATUS.md (R8).

### A. Keamanan

| Cek | Hasil | Bukti |
|---|---|---|
| Rahasia di repo + seluruh riwayat git (`git log -p --all`, 137 commit) | **Bersih.** Tidak ada `.jks`, `keystore.properties`, `google-services.json`, `firebase.properties` yang pernah di-commit. Nilai `storePassword`/`keyPassword`/`apiKey`/`applicationId`/`senderId` dari `<android-secrets-dir>/` dicari persis di riwayat: 0 kena. Tidak ada token, sandi tes, private key | `.gitignore:10-13` (`*.jks`, `*.keystore`, `keystore.properties`, `app/google-services.json`); `app/build.gradle.kts:25-44` baca keystore dari luar repo |
| Rahasia di APK (`strings` classes.dex + resources.arsc + assets) | **Bersih.** Sandi keystore dan path keystore tidak ada. Satu-satunya kunci = Firebase `apiKey` (awalan `AIza`) + projectId/applicationId/senderId, disuntik ke BuildConfig: ini identitas klien Firebase, bukan rahasia (kirim push butuh kredensial server OAuth). Tidak ada URL privat/IP LAN/staging; host hanya `nexus.znetworks.id`, `lan.nexus.znetworks.id` + tile peta OSM. Email di dex hanya placeholder (`name@company.com`) | `app/build.gradle.kts:69-72`; lihat R2 |
| Manifest APK (aapt2) | `debuggable` tidak ada (= false), `allowBackup=false`, `fullBackupContent` + `dataExtractionRules` mengecualikan semua domain, `networkSecurityConfig` = `cleartextTrafficPermitted="false"` tanpa `<trust-anchors>` user (hanya CA sistem), `usesCleartextTraffic` tidak diset | `AndroidManifest.xml:27-31`, `res/xml/network_security_config.xml`, `res/xml/backup_rules.xml`, `res/xml/data_extraction_rules.xml` |
| Komponen exported | Hanya `MainActivity` (launcher + deep link) dan `AttendanceWidgetReceiver` (APPWIDGET_UPDATE, standar) tanpa permission. Sisanya dari library dan terlindung permission sistem: FirebaseInstanceIdReceiver (`c2dm.SEND`), SystemJobService (`BIND_JOB_SERVICE`), GlanceRemoteViewsService (`BIND_REMOTEVIEWS`), Diagnostics/ProfileInstall (`DUMP`), RevocationBoundService. Service FCM, WorkTrailService, boot receiver, InstallResultReceiver, FileProvider: `exported=false` | `AndroidManifest.xml:37-119` |
| FileProvider | Hanya `cache/evidence/`, `cache/shared/`, `cache/offline/`; tidak ada `root-path`/`external-path`; `exported=false`, grant per intent | `res/xml/file_paths.xml` |
| PendingIntent | Semua `FLAG_IMMUTABLE`, kecuali callback PackageInstaller yang memang wajib `FLAG_MUTABLE` dan intent-nya eksplisit ke receiver non-exported | `feature/update/ApkUpdater.kt:205-208`, `WorkTrailService.kt:187,235,267`, `push/Push.kt:216,223` |
| Deep link / App Link | Tidak ada link yang memicu aksi tanpa tap: semua target hanya navigasi (form, vault `/v/`, pengajuan, dll.), kirim tetap lewat tombol. App Link hanya `/f/` dan `/v/` di host persis `nexus.znetworks.id` (`autoVerify`). Link ke host lain → browser eksternal tanpa cookie; tidak ada WebView sama sekali (grep `WebView`/`addJavascriptInterface` kosong). Lihat R3 (crash) | `core/nav/Router.kt:76-88`, `ui/shell/SignedInShell.kt:172-199,621-625` |
| Sesi: Keystore AES-GCM | **Benar.** AES-256-GCM, kunci non-exportable di AndroidKeyStore (StrongBox bila ada), IV acak per seal, tag 128 bit, file di `noBackupFilesDir/session/session.bin`, tulis-lalu-rename; blob tak terbaca = keluar, bukan crash | `core/session/SessionStore.kt:27-100`, `core/AppContainer.kt:56-59` |
| Cookie hanya ke host NEXUS | **Benar, exact match** (bukan suffix) `nexus.znetworks.id` / `lan.nexus.znetworks.id`, dicek di keempat jalur kirim; tanpa cookie jar. Lihat R1 (redirect) | `core/net/NexusConfig.kt:14-16`, `core/net/ApiClient.kt:116,145,198,238` |
| Log di rilis | Hanya satu `Log.w` berisi nama kelas exception; tidak ada `println`/`printStackTrace`/HttpLoggingInterceptor, tidak ada token/PII | `core/AppContainer.kt:53` |
| R8 | `isMinifyEnabled = true`, `isShrinkResources = true`; di dex hanya 15 nama kelas app yang tersisa (komponen manifest) | `app/build.gradle.kts:80-82` |
| Updater APK in-app | **Benar.** Urutan: sha256 (bila server kirim) → package harus `id.znetworks.nexus` → set sertifikat penanda tangan arsip == yang terpasang (K1: GET_SIGNATURES di API 28-29) → versionCode arsip harus > yang berjalan (tanpa downgrade) → cocok dengan versionCode/Name yang diumumkan. File di `cacheDir/updates` (privat), unduhan hanya HTTPS (cleartext diblok NSC), cookie hanya ke host NEXUS | `feature/update/ApkUpdater.kt:141-164,180-188,239-253`, `core/net/ApiClient.kt:131-176` |
| Antrean absen offline | **Benar.** `noBackupFilesDir/attendance-queue` (bukan cache, ikut dikecualikan backup), per owner (`ownerId`), hanya milik yang login yang dikirim, `keepOnly` saat orang lain login, `clearAll` saat logout sengaja, ditahan untuk orang yang sama saat 401 | `core/AppContainer.kt:120-129,141-158`, `feature/attendance/AttendanceQueue.kt:121,143,210-231` |

#### Temuan keamanan (semua RENDAH)

- **R1 RENDAH: header Cookie ikut redirect lintas host.** Cookie ditambahkan manual sebagai header aplikasi
  (`core/net/ApiClient.kt:198-200`), dan OkHttp default mengikuti redirect (`ApiClient.kt:52-60`, tidak ada
  `followRedirects(false)`); OkHttp hanya membuang `Authorization` saat redirect ke host lain, bukan `Cookie`.
  Saat ini tidak bisa dieksploitasi: route API yang dipanggil app tidak pernah redirect ke host asing (dicek di
  server: redirect hanya di `/api/auth/*`, `/api/sso/authorize` dengan allowlist, `/api/drive/auth`), APK
  disajikan langsung oleh `/api/app/android/apk`. Saran: interceptor jaringan yang membuang Cookie bila host
  bukan `isNexusHost`, atau `followRedirects(false)` untuk panggilan ber-sesi.
- **R2 RENDAH: kunci Firebase tanpa pembatasan aplikasi Android.** GET read-only ke Identity Toolkit dengan
  kunci dari `firebase.properties` (`apiKey`, awalan `AIza`) tanpa header paket Android diterima (jawaban
  `CONFIGURATION_NOT_FOUND`, bukan "Android client application blocked"). Kunci ini memang publik by design
  (ada di setiap APK) dan tidak bisa mengirim push, jadi bukan kebocoran; tapi sebaiknya di Google Cloud
  Console proyek `nexus-znetworks-android` dibatasi ke aplikasi Android `id.znetworks.nexus` + SHA-256
  `53:22:FE:…:AD:26` dan ke API Firebase Installations/FCM saja.
- **R3 RENDAH: link dengan id berisi "/" bikin app crash.** Id dari query di-URL-decode
  (`core/nav/Router.kt:146`) lalu ditempel mentah ke rute navigasi: `ticket/$it`, `submission/$it`, `chat/$it`
  (`ui/shell/SignedInShell.kt:183,185,196`). `nexus://complaints?id=a%2Fb` → rute tak cocok →
  `IllegalArgumentException` di `LaunchedEffect` → crash. Tidak ada kebocoran data; cukup `Uri.encode(id)`
  seperti Form (`SignedInShell.kt:184`). Terkait: link relatif dari extra notifikasi yang tidak diawali "/"
  (mis. `@host`) jadi `PUBLIC_BASE + path` (`Router.kt:140`, `SignedInShell.kt:621`) dan bisa membuka browser
  ke host lain, tanpa cookie (dampak nol; app lain toh bisa membuka browser sendiri).
- **R4 RENDAH: berkas di `cache/shared` dan `cache/evidence` tidak dihapus saat logout.** Ekspor XLSX absensi
  kru (`feature/admin/AttendanceAdmin.kt:262`, `history/BoardUi.kt:241`), lampiran pengajuan
  (`requests/RequestsUi.kt:420`), lampiran yang dibuka (`core/files/FileOpener.kt:21`) dan foto kamera
  (`ui/components/CameraCapture.kt:40`) tertinggal setelah logout (`core/AppContainer.kt:149-173` hanya
  menghapus `cache/offline` dan `responses`). Privat untuk app, tidak ter-backup, tidak terlihat di UI orang
  berikut, tapi iOS menghapus berkas offline saat serah-terima HP. Saran: hapus `cache/shared` + `cache/evidence`
  di `onSignedOut`.
- **R5 RENDAH (sama dengan iOS, batas server): logout hanya lokal.** `AuthRepository.signOut()`
  (`feature/auth/AuthRepository.kt:101-105`) menghapus token di HP; token JWT tetap sah di server sampai
  kedaluwarsa atau `sessionVersion` dinaikkan. iOS `AuthStore.swift:104` sama. Bukan pemblokir.

### B. Paritas iOS (28-29 Sep)

| Fitur | iOS | Android | Status |
|---|---|---|---|
| Tidak bisa sign-out saat hari kerja jalan (b186172) | `AuthStore.swift:95-96` | `core/AppContainer.kt:183`, `feature/widget/AttendancePresence.kt:66-73` (WorkdayRule identik), dicek 2x `ui/shell/SignedInShell.kt:507,528`, teks server `signout.blocked.*` `:534-535` | SAMA |
| Remote config `GET /api/app/config` (77818ba) | `RemoteConfig.swift:50-52,70` (fail-closed `?? true`, disimpan) | `AppContainer.kt:178-180` (`platform=android`, tanpa sesi, 8 s), `core/config/RemoteConfig.kt:41-45,71-75` (fail-closed, disimpan, jeda 5 mnt); field cocok server `src/lib/app-config.ts:18-35`. Android juga memakai `outsideHourAlertMinutes` (`WorkTrailService.kt:250`), iOS belum | SAMA (Android lebih lengkap) |
| Check-in diblok tanpa lokasi Always + Precise (77818ba) | `WorkLocationTracker.swift:122-125`, `AttendanceView.swift` | `feature/attendance/trail/AlwaysLocation.kt:30-40` (tanpa FINE = PRECISE kurang; SDK ≥ 29 tanpa BACKGROUND = ALL_THE_TIME kurang), satu-satunya jalan ke check-in `AttendanceScreen.kt:151-158`, tanya ulang saat resume `SignedInShell.kt:209-214` | SAMA |
| Tinjauan Fake GPS (c977091, AdminSuspectViews.swift) | BoD + flag `fakeGpsReview`; GET `/api/attendance/suspects?periodKey=`, POST `/suspects/{id}/review {verdict,note}` | `feature/admin/ControlRoom.kt:61-63,100`, `feature/admin/FakeGps.kt:99-111,131-134`; cocok server `suspects/[recordId]/review/route.ts:32-78` | SAMA |
| Flag simulated/mock selalu dikirim | `APIClient.swift:2420`, `AttendanceQueue.swift:31,127,170` | `feature/attendance/AttendanceApi.kt:23,45,85` (field `simulated` selalu ada), replay pakai fix tersimpan `AttendanceQueue.kt:303,306`, di model disk `AttendanceModels.kt:157`, sumber `LocationProvider.kt:89-95`; server `check-in/route.ts:102`, `check-out/route.ts:51` | SAMA |
| Multi-kantor inside + "Now at <office>" (45ea4ea) | `WorkTrailPolicy.swift`, `WorkLocationTracker.swift` | `trail/TrailMachine.kt:91-94,168-176,187-191`, alert/notifikasi/widget `:303,338`, `WorkTrailService.kt:176,184`, `AppContainer.kt:115`, label `AttendanceScreen.kt:459,466` | SAMA (R6) |
| Antrean offline 409 already-checked-in (db9295c) | `AttendanceQueue.swift` +8 | `AttendanceQueue.kt:165-171,289-291`; teks server `check-in/route.ts:203` | SAMA |

- **R6 RENDAH (paritas kecil):** label "Now at" di Android tidak mengecek bahwa sesi trail milik record yang
  sedang ditampilkan (iOS: `recordId == dispRec.id`; Android hanya `rec.checkOutAt == null`,
  `AttendanceScreen.kt:459`), dan `officeHere` hanya melihat `state.latest` (iOS: `latest` atau `lastGood`).
- **R7 RENDAH:** `FakeGps.kt:133` menaruh `recordId` di path tanpa URL-encode (iOS meng-encode); nilainya cuid
  dari server, dampak praktis nihil.

Cek ulang perbaikan audit sebelumnya (ada di jalur yang benar-benar dijalankan):

| Temuan | Status | Bukti |
|---|---|---|
| K1 update di Android 9-10 | BERES | `ApkUpdater.kt:155` → `verify()` `:183-184` → `signatureFlags` `:228-232`, fallback `p.signatures` `:274` |
| T3 konfirmasi install tak hilang | BERES | `ApkUpdater.kt:90-97,108-118`, Continue/Cancel `feature/update/UpdateFlow.kt:102,108`, `reset()` abandon `ApkUpdater.kt:74-87` |
| T4 bagan approval hanya BoD/OAA | BERES | `feature/admin/UsersAdmin.kt:143`, `ApprovalChart.kt:201,229,236` |
| T5 kamera minta izin dulu | BERES | `ui/components/CameraCapture.kt:32-60`; semua pemanggil lewat `rememberCameraCapture` (Requests, Chat, Task, Tickets) |
| T6 papan kru tidak campur periode | BERES | `history/BoardUi.kt:154-159` (cancel load lama), `:300` `rowsFor(period, …)` |

### C. Build dan APK

| Apa | Hasil |
|---|---|
| `./gradlew -q assembleRelease testDebugUnitTest` di clone bersih `/tmp/audit-clone` (HEAD b122e0f, `local.properties` disalin, rahasia dari `<android-secrets-dir>`) | **OK, exit code gradle 0** (`--no-daemon`; percobaan pertama mati karena daemon di-OOM-kill kernel saat build 5 sesi lain jalan bersamaan, bukan kesalahan kode). **300 tes JVM: 0 gagal, 0 error, 0 skip** |
| APK diverifikasi | `NEXUS-0.1.6-5.apk` (build 5 sudah ada) |
| `aapt2 dump badging` | package `id.znetworks.nexus`, versionCode **5**, versionName **0.1.6**, minSdk 26, targetSdk 36 |
| `apksigner verify --print-certs` | lolos (skema v2), 1 signer `CN=NEXUS Android, O=Z Networks, L=Jakarta, C=ID`, SHA-256 sertifikat `5322fe4c…a6ad26` = kunci rilis, RSA 4096 |
| sha256 APK | `4d75566d2e21e24d4ac93835e8cd7c1ba3875455168306c8de2bfb63c0943c38` = file `.sha256`. **Belum ada di STATUS.md** (R8) |
| APK vs build bersih HEAD | 1454 entri zip, semuanya byte-identik (dex, manifest, arsc, lib, assets); `META-INF/version-control-info.textproto` = revisi b122e0f. Hanya blok tanda tangan/metadata zip yang beda |

- **R8 RENDAH (dokumen):** STATUS.md belum mencatat build 5: bagian "APK ready" (`docs/STATUS.md:310-316`) masih
  build 4 (`98b608ff…`), dan header `docs/STATUS.md:7-8` masih "295 JVM tests" dan "versionCode 3 in the tree"
  (sebenarnya 300 dan 5). Catat sha256 build 5 di atas sebelum terbit.

## Audit ulang 28 Sep 2026, malam (HEAD 8842c35, kandidat rilis build 3)

Pembanding: iOS `apps/ios` sampai db9295c (semua commit sejak 0.1.5, 6a8f36a → db9295c),
server + web `the server repo` sampai 02abb38 (read-only, tidak ada POST). Tidak ada kode Android yang diubah.

**RILIS: BELUM LAYAK (K1: update in-app tidak pernah bisa lolos verifikasi tanda tangan di Android 9–10; plus 4 temuan TINGGI: T3 dialog "Installing…" bisa macet tanpa jalan keluar, T4 Bagan Approval bisa diedit Manager tapi semua simpan ditolak 403, T5 tombol Kamera di form pengajuan bisa bikin app crash, T6 papan kru menampilkan data periode lain)**

### Build dan APK

| Apa | Hasil |
|---|---|
| `./gradlew -q assembleRelease testDebugUnitTest` di clone bersih `/tmp/na-audit` (HEAD 8842c35, `local.properties` disalin; Firebase + keystore dari `<android-secrets-dir>`) | **OK**, exit code gradle 0. 268 tes JVM: 0 gagal, 0 error, 0 skip |
| `NEXUS-0.1.6-3.apk` → `aapt2 dump badging` | package `id.znetworks.nexus`, versionCode **3**, versionName **0.1.6**, minSdk 26, targetSdk 36 |
| `apksigner verify --print-certs` | lolos (skema v2), 1 signer `CN=NEXUS Android, O=Z Networks`, SHA-256 sertifikat `5322fe4c…a6ad26` = kunci rilis (assetlinks) |
| sha256 APK | `e63ca19dfb66e8922c283e99e266d8177790d5db0e9ae216607085604133a326`, **sama** dengan STATUS.md:234 dan `.sha256` |
| APK kandidat vs build bersih HEAD | `classes.dex`, `AndroidManifest.xml`, `resources.arsc` byte-identik: APK memang dibangun dari 8842c35 |

Catatan kecil: STATUS.md:8 masih menulis "versionCode 1" dan "236 JVM tests".

### Status temuan audit sebelumnya (28 Sep 22:12)

| Temuan | Status | Bukti |
|---|---|---|
| T1 hari tertutup request → tombol Check in | **BERES** | `feature/attendance/AttendanceButton.kt:97,102`: mode `CoveredByRequest` saat `todayRequest` ada (status null/APPROVED), kartu seperti iOS `coveredByRequestCard`, `AttendanceScreen.kt:218-220`, tes di `AttendanceButtonTest`. Urutan (lupa check-out → sudah check-in → sudah check-out → tertutup request) sama dengan iOS `AttendanceView.swift:522-533`. Soal PENDING lihat Pertanyaan 1. |
| T2 build baru dengan versionName sama tidak ditawarkan | **BERES lewat keputusan** (tiap APK terbit menaikkan versionName) | `core/version/VersionGate.kt:171-172` (versionName), c283de2 dibalik e86b974. Sisa risiko lihat S5. |
| S1 tempat check-in per record | **BERES** | `feature/attendance/AttendanceModels.kt:38-47,56-74` (`AttendancePlace.isAway/label`), `AttendanceScreen.kt:444-460`, `history/BoardUi.kt:448-449,660-661`, `AttendancePlaceTest` |
| S2 multi-kantor | **BERES** | `trail/TrailMachine.kt:91-94,168-176` (di dalam salah satu kantor = di dalam; di luar hanya jika di luar semuanya dengan margin radius+max(acc,50 m)), `WorkTrail.kt:115-124` (daftar kantor aktif per record), "Sekarang di <kantor>" di kartu `AttendanceScreen.kt:455-457` dan notifikasi Work session `trail/WorkTrailService.kt:184,203`; tes di `TrailMachineTest`. Countdown/alarm tidak muncul karena zona tetap INSIDE. |
| S3 replay check-in 409 "already checked in" | **BERES** (setara iOS db9295c) | `feature/attendance/AttendanceQueue.kt:165-169,287-289`: dibuang diam-diam, entri berikut lanjut. Teks server `check-in/route.ts:203` cocok. |
| R1 jam dari record | **BERES** | `AttendanceViewModel.kt:47-50,240` |
| R2 "Selesai hari ini" | **BERES** | `AttendanceButton.kt:94-95` (`workedMinutes` server dulu, check-out antre = `savedOnPhone`), `AttendanceScreen.kt:218-219` |
| R3 teks ID extra day off | **BERES** | `res/values-in/strings.xml:1303-1305` = iOS 6144f2c |
| R4 entri antrean tanpa owner | **BERES** | `AttendanceQueue.kt:143` (hanya `ownerId == me`), `:229` (`keepOnly` membuang yang tanpa owner) |

### Paritas fitur vs iOS (semua commit sejak 0.1.5)

| iOS | Fitur | Android | Bukti / catatan |
|---|---|---|---|
| db9295c | Replay check-in 409 = selesai | sama | `AttendanceQueue.kt:165-169` |
| 45ea4ea | Kantor aktif mana pun = di dalam; "Now at <office>" | sama | lihat S2 di atas |
| 6144f2c | Pesan extra day off (tanpa "Everyone was notified") | sama | `feature/admin/ExtraDayOff.kt:298-299`, strings 1303-1311; grep "Everyone was notified" kosong |
| a0f1de4 | Alamat untuk check-in di luar kantor (per record) | sama | lihat S1 |
| 5ba2e93, 4bb25f8 | Peta hero (kantor, ≥300 m; bebas lokasi ikut GPS) | sama | STATUS §11, `HeroMapTest` |
| 87ada44 | Keyboard refleksi bisa ditutup, tombol tetap terlihat | sama | STATUS §11 |
| b22f030, 91d7e98 | Papan kru: nama + Score tetap, tanggal+titik geser bareng | sama | `history/BoardUi.kt:344-385` |
| 0f729e1 | Papan kru dari roster server | sama | `history/BoardModel.kt:75-90` |
| e2568d2, 263de6b | Satu tombol, tanpa konfeti | sama | `AttendanceButton.kt`; grep "confetti/konfeti" kosong di `app/src` |
| 81abc62 | Margin keluar radius+max(acc,50 m) | sama | `TrailMachine.kt:141,174` |
| 3479cde | Notifikasi lokal saat keluar dan +60 mnt, rute presisi di luar | sama | `trail/OutsideClock.kt:65-86`, `WorkTrailService.kt:243-281`, `TrailMachine.kt:135-143,351-356` |
| 8a36fd2 | Live Activity tahap 90/120/150 + countdown | sama (analog: notifikasi Work session) | `OutsideClock.kt:11-13,33-63`, `WorkTrailService.kt:207-232`; angka sama dengan server `attendance-outside.ts:22-26` |
| 7910755 | Rekap anggota: periode, baris streak, log XP + alasan, BoD hapus potongan | beda (sebagian) | `feature/people/PeopleScreens.kt:153-305`; gating hapus potongan benar (`:271`). Kurang: S6, R7 |
| c4ab55d, 59aa75a | Key terjemahan dobel bikin crash | n/a (aman) | aapt2 menolak key dobel; values 1414 / values-in 1413 key (hanya `app_name`), tanpa dobel, format argumen cocok semua |
| eec56a7 | Tab Extra day off (BoD) | sama | `feature/admin/ControlRoom.kt:61,113`, `ExtraDayOff.kt` |
| 8838eec | Papan/detail anggota buka PERIODE 28→27 | sama | `BoardModel.kt:92-93`, `core/time/OfficeTime.kt:27-36` |
| 461cb65 | BoD "Change status" | sama | `BoardUi.kt:148-168,495-571` |
| 05fc869, 433b1cf, 8d3312f, a9ca4f4 | Score, kuota per orang, freeze panes, label hari | sama | `BoardModel.kt:44,56-62,86`, `BoardUi.kt:316-398` |
| 64b1bfb | Presence check tiap jam | sama | `TrailMachine.kt:151-155,362-430` |
| afadd5c | Manager langsung meninjau offsite | sama | `requests/RequestsViewModel.kt:68-69,101` |
| caaca89 | Check-in antre yang ditolak karena jarak dibuang + diberi tahu | sama | `AttendanceQueue.kt:182-186`, `AttendanceApi.kt:99-104` |
| 13e7784 | Jejak lokasi lanjut setelah app dibunuh | sama | `TrailMachine.kt:282-290`, `WorkTrailService.kt:78-100` |
| db14372 | Live location, 401 menyimpan antrean | sama | `trail/*`, `core/AppContainer.kt:109-125` |
| 74c6750 | Tab App: siapa yang belum pakai app | beda (kecil) | `feature/admin/AdminMore.kt:371-379`: `lastActiveAt` dibaca (`:95`) tapi label "Web only · tgl" / "Never signed in" tidak ada (R9) |
| 3ae2630 | Audit terbaca, label lampiran, satu tanggal per request | beda (kecil) | `AuditAdmin.kt:168-236`: tanpa coret nilai lama dan tanpa tautan (R10) |
| 59cf9d9 | Reports per crew + kunci update | sama | `ReportsScreen.kt`, `VersionGate.kt`; tenggat grace tidak disebut di More (R11) |
| 38dc5c1, d3680a3 | Lupa sandi, ganti email, daftar pakai kode, hapus akun | sama, satu beda | link undangan `invited=1` diabaikan (`core/nav/Router.kt:136`): judul "Reset password" bukan "Set password" (R12) |
| e7a51c1, bd0e20c, 535d60b, 4660b9b | Offline: ambil duluan + "Salinan tersimpan HH:mm" | beda | Attendance/Home/Projects/Tasks/Chat/Tickets menandai; papan kru, daftar pengajuan dan Reports tidak (S4) |
| 672314b | Izin mati → bilang + buka Settings | beda | face check ya (`LivenessCaptureScreen.kt:110-120`); tombol Kamera lain tidak (T5) |
| 17f777f, 2a9ac9d, c532bb3, d561d63, 62c6391, 02eabab, c9a9d6b, 348a3dd, d9a1a4e, ec7a85a, b678c94, 620513d | Aturan pengajuan, izin + foto + koordinat, jarak, alasan lengkap, kantor terdekat, lampu layar, mode read-only, papan ke hari ini, klaim XP quest, ikon | sama | `RequestRules.kt:18-77`, `RequestsUi.kt:295-312`, `AttendanceViewModel.kt:395-409`, `BoardUi.kt:339-343`, `HomeScreen.kt:175-193` |
| 6a8f36a | Face check: jendela ikut wajah | beda (kosmetik) | oval tetap `LivenessCaptureScreen.kt:274`; ambang/arah sama |
| n/a | Mac webcam/camera gate (d111669, 8bb6c7b), catatan rilis, build tooling, warna Live Activity (a875c3c), revert 3256a26/c51bc9c | n/a | khusus iOS/Mac atau tidak mengubah perilaku |

Cek lain yang bersih: satu tombol + liveness wajib (hanya `LiveSelfie` masuk `onSelfie`, `AttendanceViewModel.kt:172-176`), refleksi 200 karakter (`:131,393`), offsite check-out pakai selfie+fix yang sama dan clientId baru (`:212-231`), lupa check-out didahulukan (`AttendanceButton.kt:92`), antrean offline (clientId sama live & replay, 426 ditahan bukan dibuang, 401 tidak menghapus), periode 28→27 WIB (tidak ada `LocalDate.now()`/zona sistem di `feature/attendance` dan `core`), 426 lock (dipersist, update route dikecualikan server `version-policy.ts:191`, header `android/0.1.6/3` cocok parser), pintu masuk Control Room hanya Manager+ (`core/Viewer.kt:20`), tab BoD-only sama dengan iOS.

### Temuan baru

**K1 · KRITIS · Update in-app selalu gagal di Android 9 dan 10 (API 28–29): tanda tangan APK tidak pernah terbaca.**
`feature/update/ApkUpdater.kt:128` memakai hanya `GET_SIGNING_CERTIFICATES` untuk `getPackageArchiveInfo` di SDK ≥ 28. Di AOSP android-9.0.0_r1 dan android-10.0.0_r1, `PackageManager.getPackageArchiveInfo` hanya mengumpulkan sertifikat bila flag berisi `GET_SIGNATURES` (`if ((flags & GET_SIGNATURES) != 0) PackageParser.collectCertificates(...)`); baru Android 11 (android-11.0.0_r1) menerima `GET_SIGNING_CERTIFICATES` juga. Akibatnya di API 28–29 `signingInfo` arsip null, `signers()` (`:193-197`) kosong, `verdict()` (`:174`) = WRONG_APP, APK dihapus dan orang melihat "bukan build NEXUS". Di layar kunci 426 hanya ada "Coba lagi" yang gagal dengan cara sama, jadi saat lantai versi dinaikkan, HP Android 9/10 tidak bisa absen dari app sampai orangnya sendiri mengunduh dari browser. `UpdateVerdictTest` hanya menguji `verdict()` murni, jadi tidak tertangkap. Perbaikan: untuk arsip di SDK < 30 pakai `GET_SIGNING_CERTIFICATES or GET_SIGNATURES` (atau `GET_SIGNATURES` lalu baca `signatures`); tes instrumentasi/robolectric atau minimal uji manual di emulator API 28/29. Karena build 3 akan jadi APK pertama yang terbit, bug ini ikut terpasang di semua HP dan baru terasa di update pertama, jadi harus beres sebelum terbit.

**T3 · TINGGI · Dialog update bisa macet di "Installing…" tanpa jalan keluar.**
`InstallResultReceiver` (`ApkUpdater.kt:210-214`) menangani `STATUS_PENDING_USER_ACTION` dengan `context.startActivity(confirm)` di dalam `runCatching`. Kalau orang pindah app selama unduhan 23 MB (wajar), Android 10+ memblokir start activity dari latar diam-diam; langkah tetap `Installing`. `UpdateFlow.kt:275-277` membuat dialog tak bisa ditutup saat `busy`, `Installing` tidak punya tombol (`:316,320`), dan `LifecycleResumeEffect` (`:269-270`) hanya menangani `NeedsPermission`. Di layar kunci 426 jalan keluarnya cuma force stop. Perbaikan: simpan intent konfirmasi dan jalankan lagi saat resume (atau tampilkan tombol "Lanjutkan instal"/"Batal"), plus notifikasi bila app di latar; abandon session saat batal.

**T4 · TINGGI · Bagan Approval tampil dan bisa diedit untuk MANAGER, semua simpan ditolak 403.**
Baris "Bagan Approval" di tab Users digambar tanpa cek peran (`feature/admin/UsersAdmin.kt:142-154`), layar bagan mengizinkan tap node/chip dan memanggil `setApprover` (`feature/admin/ApprovalChart.kt:234,250-254`). Server: `approverId` hanya BoD+ ("Hanya BoD ke atas yang bisa mengatur Bagan Approval.", `src/app/api/workspaces/members/route.ts:402-406,457-460`). iOS menampilkan bagan hanya bila `canManageAttendanceFlags` (`Sources/Views/AdminEditViews.swift:204,235`). Perbaikan: sembunyikan baris bagan (atau jadikan read-only) bila bukan BoD/OAA, sama dengan iOS.

**T5 · TINGGI · Tombol "Kamera" di form pengajuan (izin/sakit) bisa membuat app crash.**
Manifest mendeklarasikan `CAMERA` (`AndroidManifest.xml:7`), jadi `ACTION_IMAGE_CAPTURE` melempar `SecurityException` bila izin kamera belum/tidak diberikan. `feature/attendance/requests/RequestsUi.kt:535-539` memanggil `camera.launch(uri)` tanpa cek izin dan tanpa tangkapan: crash, tepat di jalur izin yang WAJIB foto. Terjadi pada orang yang menolak kamera, mencabutnya di Settings, atau mengajukan sakit sebelum pernah check-in di HP itu. Di chat, tiket dan file tugas peluncurannya dibungkus `runCatching` (`ChatThreadScreen.kt:379`, `TicketsScreen.kt:286`, `TaskDetailScreen.kt:487`), jadi tap diam saja tanpa penjelasan (yang diperbaiki iOS 672314b). Perbaikan: minta izin `CAMERA` dulu, bila ditolak tampilkan kartu "Buka Settings" seperti face check; tes pemindai sumber agar setiap `TakePicture` didahului cek izin.

**T6 · TINGGI · Papan kru bisa menampilkan orang dan Score periode lain di bawah judul periode baru.**
`BoardViewModel.shift()`/`load()` (`feature/attendance/history/BoardUi.kt:128-142`) meluncurkan coroutine baru tiap tap tanpa membatalkan yang lama; jawaban yang datang terakhir menang, sementara judul memakai `s.offset` (`:259`). `load()` juga tidak mengosongkan `rows`, dan grid hanya diganti spinner/error bila `rows` kosong (`:283-285`), jadi saat memuat, dan selamanya bila gagal offline tanpa cache, kolom Score (`BoardModel.kt:44`) tetap angka periode lama di bawah tanggal periode baru. iOS memakai `.task(id:)` yang membatalkan muatan lama dan mengosongkan anggota bila gagal (`AttendanceView.swift:1618,1868-1886`). Perbaikan: simpan `Job` dan batalkan, tandai rows dengan periodenya dan jangan gambar rows periode lain, tampilkan error bila gagal.

**S4 · SEDANG · Salinan tersimpan tampil seperti data live di papan kru, daftar pengajuan dan Reports.**
`history/HistoryApi.kt:127`, `requests/RequestsApi.kt:94`, `ReportsScreen.kt:109,206` mengambil `.value` dari cache dan membuang `savedAtMillis`. iOS menampilkan `OfflineNotice(savedAt:)` (`AttendanceView.swift:1612,1882`). Manager yang offline bisa meninjau angka berjam-jam lalu tanpa tanda.

**S5 · SEDANG · Kunci versi (versionName, dari env server) dan updater (versionCode, dari `current.json`) tidak saling dicek.**
`VersionGate.kt:171-172` vs `ApkUpdater.kt:86,175`; server tidak mencocokkan `NEXUS_ANDROID_LATEST_VERSION` dengan `current.json` (`src/lib/android-app.ts:146-157`). Bila salah satu tidak ikut naik, layar kunci bilang "wajib update" sementara dialog bilang "sudah versi terbaru" (orang terkunci), atau update terpasang tapi kunci tetap. `verify()` juga tidak mengecek versionName/versionCode arsip sama dengan yang diumumkan. Aturan rilis (keduanya naik) mencegahnya bila dijalankan disiplin; tambahkan cek di Android (arsip harus = versi yang diumumkan) dan di skrip terbit.

**S6 · SEDANG · Baris streak di rekap anggota tidak bisa di-tap.**
`feature/people/PeopleScreens.kt:244-253`. iOS (`MemberProfileView.swift:108,404-405`) membuka lembar hari, dan untuk BoD panel Change status. Di Android BoD hanya bisa dari papan kru.

**S7 · SEDANG · Unduhan APK tidak pernah benar-benar dilanjutkan.**
ETag disimpan hanya setelah unduhan selesai (`ApkUpdater.kt:99`), jadi setelah putus `have = 0` (`core/net/ApiClient.kt:138`) dan unduhan 23 MB mulai dari nol. Aman (tidak mungkin menyambung dua build), tapi berat di sinyal buruk.

**S8 · SEDANG · Exception non-ApiError di updater mematikan app.**
`appScope` tanpa `CoroutineExceptionHandler` (`core/AppContainer.kt:48`) dan `run()` hanya menangkap `ApiError`: `IOException`/`SecurityException` di `install()` (`ApkUpdater.kt:141-152`), `sha256()`, atau `toHttpUrl()` pada `downloadUrl` absolut yang rusak (`ApiClient.kt:136`) = crash, dan session PackageInstaller tertinggal terbuka.

**S9 · SEDANG · Pemilih approver di layar user hanya menawarkan Manager ke atas.**
`UsersAdmin.kt:351` (`Roles.tier(it.role) >= 2`); iOS menawarkan semua orang kecuali dirinya (`AdminUserDetailView.swift:85`), server mengizinkan (`workspaces/members/route.ts:453-484`), dan layar bagan Android sendiri tidak memfilter (`ApprovalChart.kt:117-126`).

**R5 · RENDAH ·** Periode papan kru tidak berganti bila layar dibiarkan terbuka melewati 00:00 WIB tanggal 28 (`BoardUi.kt:259-261`; iOS sama).
**R6 · RENDAH ·** Orang di roster tanpa nama/email diberi nama si penonton (`BoardModel.kt:87`, iOS "Unknown").
**R7 · RENDAH ·** Request di rekap anggota tidak bisa di-tap (`PeopleScreens.kt:280-290`); konfirmasi hapus potongan tanpa pengaman tap ganda (`:299-301`).
**R8 · RENDAH ·** OAA melihat "Hapus dari workspace" pada BoD (`UsersAdmin.kt:339-340`, `WorkspaceMembers.kt:133-134`) dan pada barisnya sendiri di Tuning Room, server menolak (`workspaces/members/route.ts:604-610`); BoD bisa mengubah hari libur BoD/OAA lain yang di iOS dikunci (`UsersAdmin.kt:301-309` vs `AdminUserDetailView.swift:364,367`).
**R9 · RENDAH ·** Tab App tanpa label "Web only · tgl" / "Never signed in" (`AdminMore.kt:371-379`).
**R10 · RENDAH ·** Entri audit tanpa coretan nilai lama dan tanpa tautan (`AuditAdmin.kt:168-236`).
**R11 · RENDAH ·** Tenggat grace update tidak disebut di More (`ui/shell/SignedInShell.kt:438-446`).
**R12 · RENDAH ·** Link undangan `invited=1` diabaikan (`core/nav/Router.kt:136`): "Reset password" bukan "Set password".
**R13 · RENDAH ·** Kosmetik: jendela face check tidak mengikuti wajah (`LivenessCaptureScreen.kt:274`), tanpa garis pergantian bulan di papan, sel kosong lebih gelap dari iOS (`BoardUi.kt:233`), "Change status" ditawarkan di hari depan yang sudah punya row (server menolak dengan pesan), key rotasi tanda tangan akan membuat perbandingan `signingCertificateHistory` gagal (`ApkUpdater.kt:195`), sha256 opsional (`:126`).

### Temuan server (bukan blocker APK, tapi mendesak; bukan untuk sesi Android)

Ditemukan saat mencocokkan gating Control Room; bisa dieksploitasi dari klien mana pun (web, curl), app hanya kebetulan tidak mengirim field-nya.
- **KRITIS (server):** `PATCH /api/admin/users/[userId]` (`src/app/api/admin/users/[userId]/route.ts:146-195`) meloloskan MANAGER (`canAccessUserManagement`) lalu menerima `role: "ADMIN"` tanpa cek bahwa pemanggil system admin: Manager bisa menjadikan dirinya ADMIN sistem.
- **KRITIS (server):** route yang sama mengizinkan BoD mengganti nama/email login/sandi siapa pun, termasuk OAA dan system admin (`:157-169`), tanpa cek tingkat target atau workspace; iOS dan Android sama-sama memakai route ini dari kartu Account. Route `workspaces/members/[memberId]/password` sudah punya cek tingkat, tapi tidak dipakai.
- **TINGGI (server):** `DELETE /api/workspaces/members` (`route.ts:591-610`) mengizinkan MANAGER menghapus OAA/Manager/Staff; OAA justru ditolak saat menghapus BoD.
- **SEDANG:** "Delete account" di iOS dan Android selalu gagal 409 karena target masih anggota workspace (`[userId]/route.ts:377-389`).

### Pertanyaan untuk owner

1. **T1 dan PENDING:** keputusan menyebut tombol disembunyikan saat request APPROVED **atau PENDING** menutupi hari ini. Server justru sengaja mengizinkan check-in saat izin masih PENDING (`check-in/route.ts:164-165`) dan `GET today` hanya mengirim `todayRequest` APPROVED (`today/route.ts:59-64`); iOS juga hanya menyembunyikan untuk APPROVED. Android sekarang ikut server + iOS. Tetap begitu, atau PENDING juga menyembunyikan tombol (butuh perubahan server dan iOS)?
2. **Server KRITIS di atas:** siapa yang membereskan (sesi server), dan boleh langsung sebelum APK terbit?

## Audit 28 Sep 2026, 22:12 WIB (HEAD 4b50f89)

Pembanding: iOS `apps/ios` sampai 6144f2c, server + web `the server repo` sampai 02abb38
(read-only). Tidak ada `docs/AUDIT.md` sebelumnya, jadi belum ada temuan lama yang bisa ditutup.

### Build

| Apa | Hasil |
|---|---|
| `assembleRelease testDebugUnitTest` pada **HEAD 4b50f89** (clone bersih) | **OK**, 248 tes JVM, 0 gagal, 0 error |
| Working copy the old Android repo (perubahan sesi lain yang belum di-commit) | **GAGAL** di `compileDebugUnitTestKotlin`: `app/src/test/java/id/znetworks/nexus/feature/tasks/NewTaskFieldsTest.kt:11-14` "Unresolved reference 'filled'" (file untracked + `TaskFields.kt` yang masih dimodifikasi). Masih pekerjaan setengah jadi, bukan HEAD, jadi tidak dihitung KRITIS. Pastikan hijau sebelum commit. |

### Fitur vs iOS / web

| Fitur (UPDATES § / cek) | Android | Bukti |
|---|---|---|
| §1 Presence check tiap jam (50 mnt, ≤45 s, ≤50 m, retry 15 mnt, >1 km dibuang) | sama | `feature/attendance/trail/TrailMachine.kt:142-149` |
| §1 Trail: chip "Presence checks" + titik samar di dalam kantor | sama | `feature/attendance/history/BoardUi.kt:617-632,660` |
| §2 Resume/reconcile (fix basi >2 mnt diabaikan, fix segar pertama langsung dikirim) | sama | `TrailMachine.kt:139` (FRESH_FIX_MS), STATUS B5 |
| Batas luar = radius + max(akurasi, 50 m) | sama untuk kantor record; **beda** soal kantor lain (S2) | `TrailMachine.kt:158-165` |
| §3 Score = min(worked, working)/working + "+N" hijau, working = hari periode − kuota efektif | sama (identik dengan iOS `StreakBoardCard`) | `history/BoardModel.kt:43,56-62`, `BoardUi.kt:394-397` |
| §3 Roster: semua orang dari `roster` di respons history | sama | `BoardModel.kt:75-90`, `HistoryApi.kt:57`, `BoardUi.kt:137,262` |
| §3 Freeze panes + label hari | sama | `BoardUi.kt:315+` |
| §3 BoD "Change status" (termasuk sel tanpa id & hari lalu kosong, tidak hari depan) + Heads up multi-day | sama | `BoardUi.kt:148-167,507-558` |
| §4 Review offsite oleh manager langsung, grant hanya BoD | sama | STATUS B7 |
| §5 Kuota efektif + "4 + 3 extra" + push `dayoff_bonus_granted` → `attendance_reminders` | sama | `AttendanceScreen.kt` Metrics, `strings.xml:409`, `feature/push/Push.kt:162` |
| Extra day off: pesan sukses "They were notified." / "All N were notified." / "N of M notified." | sama (EN); teks ID beda (R3) | `feature/admin/ExtraDayOff.kt:298-299`, `res/values/strings.xml:1309-1311` |
| Tidak ada "Everyone was notified." | sama | grep kosong |
| §6 Liveness wajib di semua selfie absen | sama | hanya `LiveSelfie` dari `liveness/LivenessCaptureScreen.kt:184` yang masuk `AttendanceViewModel.onSelfie`; + AttendanceGuardTest |
| §9 Notifikasi Work session: amber, "Di luar kantor sejak", countdown chronometer, aksi "Ajukan izin" | sama | `trail/WorkTrailService.kt:198-217` |
| §11 Satu tombol, alur di dalam tombol | sama | `feature/attendance/AttendanceButton.kt` |
| §11 Konfeti | tidak ada (benar) | grep "confetti" kosong di seluruh `app/src` |
| §11 "Semua state lain tetap": request yang menutupi hari ini | **beda** (T1) | `AttendanceButton.kt:86-92` |
| Periode 28→27 WIB | sama | `core/time/OfficeTime.kt:13,27-36`; tidak ada `LocalDate.now()`/zona sistem di jalur absensi |
| Antrean offline: owner per user, 401 tidak menghapus, clientId sama live & replay | sama (identik dengan iOS `AttendanceQueue.swift`) | `feature/attendance/AttendanceQueue.kt:105-181,198-224`; `core/AppContainer.kt:109-140` |
| 426 lock (persisted, tap ditahan) | sama | `core/version/VersionGate.kt`, `AttendanceViewModel.kt:281-285`, `AttendanceQueue.kt:155-158` |
| Update APK in-app (sha256, package, sertifikat, versionCode) | ada, tapi pemicunya pakai versionName (T2) | `feature/update/ApkUpdater.kt:84-86,168-177` |
| Tempat check-in per record (away → alamat, di dalam radius → nama kantor) — iOS a0f1de4, server dec5620, web dfdd664 | **tidak ada** (S1) | `AttendanceScreen.kt:435-446` |

### Temuan

Tidak ada temuan KRITIS.

**T1 · TINGGI · Hari yang tertutup request APPROVED masih menampilkan tombol hijau "Check in".**
`AttendanceButtonLogic.mode` (`feature/attendance/AttendanceButton.kt:86-92`) tidak melihat
`today.todayRequest`, jadi di hari cuti/sakit/day off/izin yang sudah disetujui orang tetap bisa menekan
Check in, menjalani face check + GPS, lalu ditolak server 409 dengan kalimat Inggris "Attendance cannot be
recorded because an approved … request already covers today." (`src/app/api/attendance/check-in/route.ts:183-189`).
iOS mengembalikan `nil` untuk tombol dan menampilkan kartu "Your approved request covers today · No
check-in needed" (`Sources/Views/AttendanceView.swift:526` dan `coveredByRequestCard`); UPDATES §11
menyebut state ini harus tetap seperti sebelumnya. Server hanya mengirim `todayRequest` untuk status
APPROVED (`today/route.ts:59-64`). Perbaikan: mode baru (mis. `CoveredByRequest`) saat
`todayRequest != null && !checkedIn && !checkedOut && !forcePending`, kartu yang sama dengan iOS, plus tes di
`AttendanceButtonLogic`.

**T2 · TINGGI · Build baru dengan versionName sama (0.1.6) tidak pernah ditawarkan, dan tidak bisa dipaksa lewat 426.**
Aturannya "versionName tetap 0.1.6, versionCode +1 per APK" (STATUS), tapi:
- "Update available" di Tuning Room muncul hanya jika `policy.latest` > versionName
  (`core/version/VersionGate.kt:171-172`, `ui/shell/SignedInShell.kt:434-441`); 0.1.6 (2) melawan 0.1.6 (3) = tidak ada.
- Lantai 426 di server membandingkan versionName saja (`src/lib/client-version.ts`, `src/lib/version-policy.ts`),
  jadi build 2 yang rusak tidak bisa dikunci demi build 3.
- `ApkUpdater` sendiri membandingkan versionCode dengan benar (`feature/update/ApkUpdater.kt:86`), tapi hanya
  terjangkau dari layar kunci, notice grace, dan baris "Update available" tadi (`feature/update/UpdateFlow.kt:32-39`).
Akibatnya staff Android bertahan di build lama tanpa tahu ada build baru. Perlu keputusan (lihat Pertanyaan);
sisi Android paling tidak butuh pemicu berbasis versionCode (mis. `GET /api/app/android/release` saat launch/foreground
→ baris "Update available" saat `versionCode > running`).

**S1 · SEDANG · Tempat check-in per record belum di-port (iOS a0f1de4, server dec5620, web dfdd664).**
Android tidak membaca `checkInAway` / `checkInLat` / `checkInLng` / `officeLocation.radiusMeters` (tidak ada di
`feature/attendance/AttendanceModels.kt` maupun `history/HistoryApi.kt`). Aturannya per person, bukan per record:
member bebas-lokasi yang check-in DI DALAM radius tetap melihat alamat, bukan nama kantor
(`AttendanceScreen.kt:435-446`). Juga belum ada: baris "Di luar kantor · <alamat>" di sheet hari pada board,
baris tempat di header trail (server `placeLabel`), dan nama tempat di notifikasi Work session. Port
`AttendancePlace.isAway/label` (flag server dulu, fallback jarak > radius; alamat 2 bagian pertama, lalu koordinat
`%.5f`, tidak pernah nama kantor) + tes.

**S2 · SEDANG · HP menilai "di luar kantor" hanya terhadap kantor di record; server terhadap SEMUA kantor aktif.**
`trail/WorkTrail.kt:90` membuat satu `TrailFence` dari kantor record dan `TrailMachine.decisive`
(`TrailMachine.kt:158-165`) hanya memakai itu, sedangkan server `classifyPoint` diberi `officesForRecord` = semua
kantor aktif (`src/lib/attendance-location.ts:104-114`, `attendance-outside.ts:68-93`). Staff yang check-in di kantor A
lalu kerja di kantor B akan mendapat notifikasi lokal "Kamu keluar kantor … Auto check-out offsite jam …", countdown
amber dan GPS presisi tiap ~50 m, padahal server menghitungnya di dalam dan tidak akan auto check-out. iOS sama
(`Sources/WorkTrailPolicy.swift:624`), jadi perbaiki di dua app sekaligus (fence = daftar kantor aktif, dalam = dalam
salah satu).

**S3 · SEDANG · Satu penolakan di kepala antrean memblokir entri berikutnya sampai 5 putaran.**
`AttendanceQueue.flush` menghitung setiap error non-unreachable sebagai percobaan lalu `return STOPPED`
(`feature/attendance/AttendanceQueue.kt:162-165`). Contoh nyata: check-in antre saat NEXUS mati, orang itu lalu
check-in dari web/HP lain → replay dapat 409 "You have already checked in today."; check-out yang antre di belakangnya
tertahan sampai check-in itu gagal 5×, lalu layar bilang tap-nya "ditolak dan dibuang". Untuk check-in, 409
"already checked in" berarti hari itu sudah tercatat: anggap landed (hapus diam-diam, lanjut ke entri berikut). iOS
sama (`Sources/AttendanceQueue.swift:236-238`), jadi ini perbaikan dua platform; jangan ubah semantik clientId.

**R1 · RENDAH · Jam di "Check in 09:02 · tepat waktu" dari jam HP, bukan record.**
`AttendanceViewModel.kt:234` memakai `System.currentTimeMillis()`; iOS memakai `rec.checkInAt` setelah balasan
server (`AttendanceView.swift` Look `.done`). Pakai `outcome.record?.checkInAt / checkOutAt`, jatuh ke jam HP hanya bila kosong.

**R2 · RENDAH · "Selesai hari ini" beda dari iOS.**
Menit kerja dihitung dari selisih check-in→check-out (`AttendanceButton.kt:94-98`); iOS memakai `workedMinutes` server
dulu. Check-out yang masih antre menampilkan "Selesai hari ini" tanpa keterangan; iOS "Check-out saved on this phone".

**R3 · RENDAH · Terjemahan Indonesia pesan extra day off tidak sama dengan iOS.**
`res/values-in/strings.xml:1303-1305`: "Sudah diberi tahu." / "Ke-%1$d orang sudah diberi tahu." / "%1$d dari %2$d diberi tahu.";
iOS 6144f2c: "Yang bersangkutan sudah dikabari." / "Ke-%d orang sudah dikabari." / "%d dari %d dikabari.". Samakan.

**R4 · RENDAH · Entri antrean tanpa owner di-replay untuk siapa pun yang login.**
`AttendanceQueue.kt:142` (`ownerId == null || ownerId == me`) dan `keepOnly` tidak menghapus entri tanpa owner.
Hari ini `enqueue` selalu mengisi owner, jadi hanya entri warisan; sama dengan iOS. Cukup tes yang mengunci bahwa
`enqueue` tanpa sesi tidak mungkin terjadi, atau `keepOnly` ikut membuang entri tanpa owner.

### Pertanyaan untuk owner (keputusan, bukan bug)

1. **Penomoran build Android (T2):** tetap versionName 0.1.6 + versionCode naik, lalu server/app membandingkan
   versionCode untuk "update tersedia" dan lantai 426? Atau versionName ikut naik per APK yang terbit (0.1.6 → 0.1.7 /
   0.1.6.1)? Tanpa salah satu, update in-app dan kunci versi tidak berguna antar build.
2. **Multi-kantor (S2):** benarkah kerja di kantor aktif mana pun = "di dalam" untuk jejak lokasi (seperti server
   sekarang)? Kalau ya, iOS dan Android harus ikut; kalau tidak, server yang harus dipersempit.
3. **Replay 409 "already checked in" (S3):** boleh dianggap sukses dan dibuang diam-diam (tanpa pesan)?
