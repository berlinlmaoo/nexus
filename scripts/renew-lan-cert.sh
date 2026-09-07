#!/bin/sh
# Perpanjang sertifikat lan.nexus.znetworks.id dan muat ulang nginx.
#
# Sengaja lewat container: certbot tidak terpasang di host, dan menjalankannya
# begini berarti tidak butuh sudo sama sekali — docker sudah bisa dipakai user
# debian. Kredensial Cloudflare dipasang read-only dan tidak pernah dicetak.
#
# --dns-cloudflare dipilih, bukan HTTP-01: nama ini menunjuk ke IP privat, jadi
# Lets Encrypt tidak akan pernah bisa menjangkaunya dari internet untuk verifikasi.
set -u
LOG=/home/debian/certs-log/renew-cron.log
echo "=== $(date -Is) mulai" >> "$LOG"

docker run --rm \
  -v /home/debian/certs:/etc/letsencrypt \
  -v /home/debian/certs-work:/var/lib/letsencrypt \
  -v /home/debian/certs-log:/var/log/letsencrypt \
  -v /home/debian/.secrets/cloudflare.ini:/cf.ini:ro \
  certbot/dns-cloudflare renew \
  --dns-cloudflare --dns-cloudflare-credentials /cf.ini \
  --dns-cloudflare-propagation-seconds 30 \
  --non-interactive >> "$LOG" 2>&1
rc=$?

# Muat ulang HANYA kalau certbot sukses. Reload dengan sertifikat setengah jadi
# akan menjatuhkan situs publik juga — server block-nya satu file.
if [ "$rc" = "0" ]; then
  docker exec nexus-web nginx -s reload >> "$LOG" 2>&1 \
    && echo "$(date -Is) nginx dimuat ulang" >> "$LOG"
else
  echo "$(date -Is) certbot GAGAL (rc=$rc) — nginx TIDAK disentuh" >> "$LOG"
fi
exit $rc
