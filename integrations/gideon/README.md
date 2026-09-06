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
