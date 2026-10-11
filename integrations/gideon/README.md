# GIDEON — bagian yang hidup di luar repo ini

Salinan berkala dari apa yang benar-benar berjalan di VM `agents`. Bukan sumber yang dieksekusi:
Hermes memuat dari `~/.hermes/` dan `~/gideon/`. Ini ada supaya perubahannya punya riwayat, dan
supaya VM yang di-reset bisa dikembalikan tanpa menebak-nebak.

## Kenapa ini perlu

Dua perbaikan pada 6 September 2026 hanya hidup sebagai file tanpa versi, dan dua-duanya menghasilkan
gejala yang sama: GIDEON tampak rusak padahal cuma salah alamat.

- `NEXUS_BASE_URL` menunjuk ke `http://127.0.0.1:3000` — port itu ditempati **OpenChamber**, bukan
  NEXUS. Setiap panggilan tool dijawab 401 oleh layanan yang keliru.
- `client.py` memakai User-Agent bawaan `urllib`. Cloudflare menolaknya dengan `error code: 1010`,
  sebuah 403 yang tidak pernah sampai ke aplikasi — sehingga tokennya tampak salah padahal benar.

## Peta berkas

| Di sini | Yang dijalankan |
|---|---|
| `plugin/` | `~/.hermes/plugins/nexus/` |
| `shim/codex-oracle-shim.js` | `~/gideon/codex-oracle-shim.js` |
| `shim/gideon-shim.service` | `/etc/systemd/system/gideon-shim.service` |

## Env yang dibutuhkan — NILAINYA TIDAK ADA DI SINI

`~/.hermes/.env` (dibaca Hermes sendiri, bukan oleh unit systemd):

    NEXUS_BASE_URL=https://nexus.znetworks.id
    NEXUS_SERVICE_TOKEN=<rahasia>

`~/gideon/shim.env`:

    ORACLE_LLM_SECRET=<rahasia, sama dengan ORACLE_LLM_SECRET di container NEXUS>

Token dan secret sengaja tidak disalin. Ambil dari server yang berjalan, atau terbitkan ulang.

## Memulihkan

    scp -r plugin/* agents:~/.hermes/plugins/nexus/
    scp shim/codex-oracle-shim.js agents:~/gideon/
    sudo cp shim/gideon-shim.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl restart gideon-shim

Lalu isi kedua file env di atas, dan buktikan jalur tool-nya hidup — bukan sekadar shim-nya:

    python3 -c "import sys; sys.path.insert(0,'/home/debian/.hermes/plugins'); \
      from nexus.client import call_nexus; print(call_nexus('list_projects', {'limit': 1})[:80])"

Harus menjawab `{"ok":true,...}`. Kalau `error code: 1010`, User-Agent-nya hilang lagi. Kalau 401,
`NEXUS_BASE_URL` menunjuk ke layanan yang salah.

## Aturan yang tidak boleh dilanggar

Plugin ini tidak boleh punya tool absensi — bukan sekadar dibatasi role. Semua tool lain aman karena
bertindak SEBAGAI penggunanya dan ditolak di tempat pengguna itu ditolak; tapi seseorang memang boleh
mengabsenkan dirinya sendiri, jadi di situ "bertindak sebagai pengguna" tidak menahan apa pun.

## Status salinan ini (12 Okt 2026)

`plugin/` dan `shim/codex-oracle-shim.js` di sini SUDAH lebih baru daripada yang jalan di prod:

- plugin: `nexus_resolve_ticket` (yang dulu hanya ada di VM) kini ikut tersalin; tool baca baru
  `nexus_get_task`, `nexus_search_docs`, `nexus_get_doc`; `nexus_create_document` aktif lagi; header
  `x-gideon-run` (dari `NEXUS_GIDEON_RUN_ID`); `NEXUS_GIDEON_NO_ATTENDANCE=1` = keempat tool absensi/tiket
  tidak didaftarkan sama sekali.
- shim: `POST /chat-stream` (NDJSON token demi token lewat `gideon-stream-runner.py`), `runId` diteruskan
  ke plugin, `HERMES_PROFILE_HOME`, `GIDEON_DOCS=0`. Tanpa env baru, perilakunya sama seperti sebelumnya.

Prod (`gideon-shim.service`, :8765, `~/.hermes/plugins/nexus/`) BELUM disentuh. Tool baru di atas butuh
server NEXUS yang sudah memuat route-nya; salin ke prod hanya bersamaan dengan rilis server itu.

## GIDEON DEV (12 Okt 2026) — jalur terpisah untuk server dev

Tujuannya: server dev (`https://nexus-prod.tail765d02.ts.net:8443`, container `nexus-dev-*`) punya GIDEON
sendiri yang tidak pernah menyentuh data prod, dan GIDEON prod tidak pernah menyentuh dev.

    nexus-dev-app ──(nexus_dev_internal, tanpa internet)──▶ nexus-dev-gideon-relay (nginx, :8766)
        └─ hanya GET /health, POST /chat, POST /chat-stream ─▶ 192.168.223.116:8766 (VM agents)
    gideon-dev-shim.service (:8766, iptables: hanya 192.168.223.111 = nexus-prod)
        └─ Hermes profil `gideon-dev` (HERMES_HOME=~/.hermes/profiles/gideon-dev)
             .env: NEXUS_BASE_URL=https://nexus-prod.tail765d02.ts.net:8443 (DEV) + token dev
                   NEXUS_GIDEON_NO_ATTENDANCE=1
             plugins/nexus: salinan plugin ini (tanpa tool absensi)
             toolsets: nexus + vision saja (tanpa terminal/file/web/memory/messaging), memory mati
             TANPA gateway (tidak ada Telegram / WhatsApp / api_server)

- Kredensial model: profil `gideon-dev` tidak punya entri openai-codex sendiri, jadi Hermes memakai
  pool global secara read-only (pola yang sama dengan profil `hr-finance`). Pemakaian dev ikut memotong
  kuota yang sama dengan prod — jaga tes tetap sedikit dan kecil.
- Rahasia dev (bukan nilai prod; deploy menolak kalau sama): `~/nexus-dev-data/gideon-dev.env` di
  nexus-prod (`GIDEON_CHAT_URL`, `GIDEON_STREAM_URL`, `ORACLE_LLM_SECRET`, `NEXUS_GIDEON_SERVICE_TOKEN`,
  `NEXUS_GIDEON_NO_ATTENDANCE=1`), `~/gideon-dev/shim.env` dan `~/.hermes/profiles/gideon-dev/.env` di agents.
- Server dev juga menolak tool absensi (`NEXUS_GIDEON_NO_ATTENDANCE=1` di /api/gideon/tools), tidak
  mengirim tiket support dan refleksi check-out ke GIDEON sama sekali.

Pasang ulang (VM agents):

    mkdir -p ~/gideon-dev && scp shim/codex-oracle-shim.js shim/gideon-stream-runner.py shim/gideon-dev-shim.service agents:gideon-dev/
    hermes profile create gideon-dev --no-alias --no-skills     # lalu isi config.yaml/.env seperti di atas
    scp plugin/* agents:.hermes/profiles/gideon-dev/plugins/nexus/
    sudo cp ~/gideon-dev/gideon-dev-shim.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now gideon-dev-shim

Di nexus-prod, `~/deploy-nexus-dev.sh` membuat/menghapus relay dan menambahkan env-nya (bagian "DEV GIDEON");
`~/deploy-nexus-dev.sh gideon` = hanya env + relay + restart app, tanpa build.

MATIKAN (urut dari paling cepat):

    ssh nexus-prod 'docker stop nexus-dev-gideon-relay'                        # putus seketika
    ssh nexus-prod 'touch ~/nexus-dev-data/gideon-dev.off && ~/deploy-nexus-dev.sh gideon'   # permanen: relay dihapus, env dicabut
    ssh agents 'sudo systemctl disable --now gideon-dev-shim'                   # shim dev mati
