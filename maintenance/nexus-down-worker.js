/**
 * NEXUS DOWN — Cloudflare Worker di depan nexus.znetworks.id.
 *
 * Kalau tunnel ke kantor putus, Cloudflare sendiri menjawab "Error 1033 Cloudflare Tunnel error"
 * — halaman putih berbahasa Inggris yang menyuruh pengunjung "try again in a few minutes" dan
 * pemilik "ensure that cloudflared is running". Staff yang cuma mau absen tidak butuh keduanya.
 *
 * Worker ini meneruskan SEMUA permintaan ke origin apa adanya (WebSocket, Range, upload
 * bongkahan, cache — tidak disentuh). Hanya saat origin tidak terjangkau ia mengganti jawabannya:
 *   • permintaan halaman (Accept: text/html)  → halaman NEXUS DOWN bernama & berlogo, HTTP 503,
 *     memeriksa /api/health tiap 20 detik dan memuat ulang sendiri begitu NEXUS kembali;
 *   • permintaan API / aplikasi                → JSON {down:true} dengan status ASLI (530/502/…),
 *     karena aplikasi iOS memutuskan "simpan di HP" dari kode status itu (APIClient.meansOriginUnreachable)
 *     dan mengubahnya akan mematikan mode offline.
 *
 * Pasang: Workers & Pages → Create → Start with Hello World → Edit code → tempel file ini →
 * Deploy → Settings → Domains & Routes → Add route: nexus.znetworks.id/* (zone znetworks.id).
 * Free plan: 100.000 permintaan/hari; NEXUS ±16.000/hari (log nginx 16 Sep 2026).
 */

const UNREACHABLE = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

export default {
  async fetch(request) {
    let res;
    try {
      res = await fetch(request);
    } catch (e) {
      res = null;
    }
    // Origin menjawab sendiri (termasuk 4xx/5xx-nya) → teruskan tanpa diubah.
    if (res && !UNREACHABLE.has(res.status)) return res;
    // 503 dari origin bisa jadi maintenance yang disengaja (nginx maintenance.html) — kalau
    // badannya bukan halaman Cloudflare, biarkan.
    if (res && res.status === 503 && !(res.headers.get("server") || "").toLowerCase().includes("cloudflare")) return res;

    const url = new URL(request.url);
    const accept = request.headers.get("accept") || "";
    const wantsPage = request.method === "GET" && accept.includes("text/html") && !url.pathname.startsWith("/api/");
    const status = res ? res.status : 530;

    if (!wantsPage) {
      return new Response(JSON.stringify({ error: "NEXUS is down", code: "NEXUS_DOWN", down: true }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-nexus-down": "1" },
      });
    }
    return new Response(PAGE, {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "60", "x-nexus-down": "1" },
    });
  },
};

const ICON = "data:image/png;base64,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";

const PAGE = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>NEXUS DOWN</title>
<link rel="icon" href="${ICON}">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center; padding: 24px;
    background: #0d1017; color: #e8eaef;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, Roboto, sans-serif;
    background-image: radial-gradient(60% 50% at 50% 0%, rgba(123,104,238,.25), transparent 70%);
  }
  main { max-width: 440px; width: 100%; text-align: center; }
  img { width: 88px; height: 88px; border-radius: 22px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
  .wm { margin: 18px 0 6px; font-size: 13px; font-weight: 700; letter-spacing: .28em; color: #a6b0bd; }
  h1 { margin: 0; font-size: clamp(40px, 12vw, 64px); font-weight: 900; letter-spacing: -.02em; line-height: 1; }
  h1 span { color: #ff7f50; }
  p { margin: 18px 0 0; font-size: 15px; line-height: 1.55; color: #c3c9d3; }
  .tip { margin-top: 14px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.05);
         border: 1px solid rgba(255,255,255,.08); font-size: 13.5px; color: #a6b0bd; text-align: left; }
  .tip b { color: #e8eaef; }
  .st { margin-top: 22px; font-size: 12px; color: #6f7886; font-variant-numeric: tabular-nums; }
  .st .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff7f50; margin-right: 6px;
             animation: blink 1.6s infinite; vertical-align: 0; }
  @keyframes blink { 50% { opacity: .25; } }
  @media (prefers-reduced-motion: reduce) { .st .dot { animation: none; } }
</style>
</head>
<body>
<main>
  <img src="${ICON}" alt="">
  <div class="wm">Z NETWORKS</div>
  <h1>NEXUS <span>DOWN</span></h1>
  <p>Server kantor lagi nggak bisa dijangkau. Biasanya karena internet kantor putus, dan biasanya pulih sendiri.</p>
  <div class="tip"><b>Mau absen?</b> Pakai aplikasi NEXUS di HP. Absen tetap tersimpan di HP dengan jam saat kamu menekan tombol, dan terkirim sendiri begitu NEXUS kembali.</div>
  <div class="st"><span class="dot"></span><span id="s">Mengecek lagi otomatis…</span></div>
</main>
<script>
  var n = 0;
  function tick() {
    n++;
    fetch("/api/health", { cache: "no-store" }).then(function (r) {
      if (r.ok && !r.headers.get("x-nexus-down")) { document.getElementById("s").textContent = "NEXUS kembali. Memuat ulang…"; location.reload(); return; }
      throw 0;
    }).catch(function () {
      var t = new Date();
      document.getElementById("s").textContent = "Masih down · dicek " + t.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " · coba ke-" + n;
      setTimeout(tick, 20000);
    });
  }
  setTimeout(tick, 5000);
</script>
</body>
</html>`;
