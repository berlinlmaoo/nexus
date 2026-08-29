# iOS Push Notifications

Push untuk bundle `id.znetworks.nexus` mencakup:

- mention terstruktur di chat;
- task yang baru di-assign;
- deadline task H-2, H-1, dan saat/lewat jatuh tempo;
- reminder check-in dan check-out 15 menit sebelum shift efektif setiap orang.

## 1. Apple Developer

Di developer.apple.com, buka Identifiers → `id.znetworks.nexus`, lalu aktifkan **Push
Notifications**. Buat **Keys → Apple Push Notifications service (APNs)** dan unduh file `.p8`.
File hanya bisa diunduh sekali dan tidak boleh dimasukkan ke git.

Catat Key ID. Team ID repo ini adalah `5YR5T42G97`.

## 2. Environment produksi

Isi `.env.production`:

```env
APNS_TEAM_ID=5YR5T42G97
APNS_KEY_ID=9PTCKVB26P
APNS_BUNDLE_ID=id.znetworks.nexus
APNS_PRIVATE_KEY_FILE=/etc/nexus/secrets/AuthKey_9PTCKVB26P.p8
CRON_SECRET=nilai-random-yang-panjang
```

Simpan key di host dan kunci permission-nya. Compose memasangnya read-only sebagai
`/run/secrets/apns.p8`; isi key tidak pernah masuk environment container atau Git.

```sh
sudo install -d -m 700 /etc/nexus/secrets
sudo install -o root -g root -m 600 /tmp/AuthKey_9PTCKVB26P.p8 \
  /etc/nexus/secrets/AuthKey_9PTCKVB26P.p8
sudo rm -f /tmp/AuthKey_9PTCKVB26P.p8
```

## 3. Database dan deploy

Schema menambah `DeviceInstallation`. Jalankan schema sync sesuai prosedur produksi repo ini sebelum
app menerima registrasi token:

```sh
npx prisma db push
docker compose -f docker-compose.prod.yml up -d --build app
```

## 4. Scheduler

Attendance perlu dipanggil setiap menit agar tepat 15 menit sebelum shift. Due check boleh setiap
5-15 menit. Keduanya idempotent untuk tahap reminder yang sama.

```sh
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://nexus.znetworks.id/api/attendance/reminders

curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://nexus.znetworks.id/api/notifications/due-check
```

## 5. Verifikasi

1. Install build langsung dari Xcode. Development signing mendaftarkan token ke APNs sandbox.
2. Izinkan alert, badge, dan sound saat prompt muncul setelah login.
3. Pastikan `DeviceInstallation` bertambah untuk user tersebut.
4. Tag user dari tombol `@` di chat; mengetik teks `@Nama` sendiri tidak dianggap mention.
5. Assign task ke user dan cek push masuk saat app berada di background.
6. TestFlight menggunakan APNs production secara otomatis.

Kalau APNs mengembalikan `BadDeviceToken` atau `Unregistered`, instalasi dinonaktifkan dan akan
aktif lagi ketika app berhasil mendaftarkan token baru.
