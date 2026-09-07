#!/usr/bin/env bash
# Pemanggil cron NEXUS. Pindahan dari launchd di Mac mini (2026-08-25).
#
# Semua job cuma nembak satu endpoint POST dengan Bearer CRON_SECRET, jadi empat skrip terpisah di
# Mac digabung jadi satu di sini — endpoint-nya jadi argumen. Rahasianya dibaca dari berkas, bukan
# ditanam di unit systemd, supaya nggak ikut kebaca lewat `systemctl cat` atau journal.
set -u
ENDPOINT="${1:?endpoint wajib diisi}"
SECRET_FILE="$HOME/nexus/cron/cron-secret.txt"
LOG="$HOME/nexus/cron/cron.log"
[ -f "$SECRET_FILE" ] || exit 0
SECRET="$(cat "$SECRET_FILE")"

# 127.0.0.1:3002 = backend NEXUS di VM ini (port yang sama seperti di Mac, sengaja dipertahankan
# biar endpoint dan skrip lama tetap cocok).
CODE=$(curl -s -o /tmp/nexus-cron-out -w %{http_code} -m 120 -X POST \
  "http://127.0.0.1:3002/api/${ENDPOINT}" \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  --data "{}")
printf "[%s] %s -> HTTP %s %s\n" "$(date "+%F %T %Z")" "$ENDPOINT" "$CODE" "$(head -c 200 /tmp/nexus-cron-out)" >> "$LOG"
