# NEXUS Android: audit

Setiap audit ditulis sebagai bagian baru di paling atas. Path kode relatif ke
`app/src/main/java/id/znetworks/nexus/` kecuali disebut lain.

## Audit 28 Sep 2026, 22:12 WIB (HEAD 4b50f89)

Pembanding: iOS `agents:~/nexus-ios` sampai 6144f2c, server + web `nexus-prod:~/nexus` sampai 02abb38
(read-only). Tidak ada `docs/AUDIT.md` sebelumnya, jadi belum ada temuan lama yang bisa ditutup.

### Build

| Apa | Hasil |
|---|---|
| `assembleRelease testDebugUnitTest` pada **HEAD 4b50f89** (clone bersih) | **OK**, 248 tes JVM, 0 gagal, 0 error |
| Working copy `~/nexus-android` (perubahan sesi lain yang belum di-commit) | **GAGAL** di `compileDebugUnitTestKotlin`: `app/src/test/java/id/znetworks/nexus/feature/tasks/NewTaskFieldsTest.kt:11-14` "Unresolved reference 'filled'" (file untracked + `TaskFields.kt` yang masih dimodifikasi). Masih pekerjaan setengah jadi, bukan HEAD, jadi tidak dihitung KRITIS. Pastikan hijau sebelum commit. |

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
