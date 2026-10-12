#!/usr/bin/env python3
"""Generate the blue-green nginx conf from maintenance/phaethon.conf (deploy/bluegreen/README.md).

    nginx-gen.py --profile dev|prod SRC DST [--dev-host H --dev-port P] [--raw-port N] [--preview-port N]

Routing stays IDENTICAL to phaethon.conf; only these things change:
  * every `http://nexus-app-beta:3000` becomes `http://nexus_app_live` (an upstream defined in
    conf.d/00-bluegreen.conf, rewritten by the deploy script at each switch, then `nginx -s reload`);
  * `root /usr/share/nginx/html;` becomes `root $nexus_live_root;` (html/blue or html/green, same file),
    so the SPA's index.html switches in the same reload as the API;
  * hashed /assets/ that are not in the live build fall back to html/_archive (every build's assets,
    kept for days), so a tab opened before the switch still loads its lazy chunks;
  * a PREVIEW server (copy of the main server, upstream nexus_app_preview + $nexus_preview_root) on
    --preview-port, bound to 127.0.0.1 only: the deploy smoke-tests the idle slot through real nginx
    routing before any user sees it;
  * a RAW listener on --raw-port proxying everything to the live slot (host-side cron/health callers keep
    one stable address whatever the slot: prod 127.0.0.1:3002, dev 127.0.0.1:3102).
VPS profile drops the LAN 443 block. Dev profile additionally applies the dev rewrites (LAN/redirect blocks dropped, dev origin, no HSTS).
"""
import argparse, re, sys

ap = argparse.ArgumentParser()
ap.add_argument("--profile", choices=["dev", "prod", "vps"], required=True)
ap.add_argument("src"); ap.add_argument("dst")
ap.add_argument("--dev-host"); ap.add_argument("--dev-port")
ap.add_argument("--raw-port", type=int, required=True)
ap.add_argument("--preview-port", type=int, required=True)
ap.add_argument("--origin-tag", default=None, help="X-Nexus-Origin value (dev: 'dev')")
a = ap.parse_args()

s = open(a.src).read()

def blocks(text):
    """Yield (start, end) of every top-level `server {` block."""
    i = 0
    while True:
        j = text.find("server {", i)
        if j < 0:
            return
        d = 0; k = j
        while k < len(text):
            if text[k] == "{": d += 1
            elif text[k] == "}":
                d -= 1
                if d == 0:
                    k += 1; break
            k += 1
        yield j, k
        i = k

def rebuild(text, fn):
    out, i = [], 0
    for j, k in list(blocks(text)):
        out.append(text[i:j]); out.append(fn(text[j:k])); i = k
    out.append(text[i:])
    return "".join(out)

if a.profile == "vps":
    # The VPS standby has no LAN certificate: drop the 443 block (what ~/vps-sync.sh always did).
    s = rebuild(s, lambda b: "# (LAN 443 block removed on the VPS)\n" if "listen 443" in b else b)

if a.profile == "dev":
    s = rebuild(s, lambda b: "# (prod-only server block removed for dev)\n" if ("listen 443" in b or "return 302" in b) else b)
    s = s.replace('X-Nexus-Origin "proxmox"', 'X-Nexus-Origin "%s"' % (a.origin_tag or "dev"))
    s = s.replace("proxy_set_header Host $host;", "proxy_set_header Host $http_host;")
    s = s.replace("proxy_set_header X-Forwarded-Host $host;", "proxy_set_header X-Forwarded-Host $http_host;")
    dev_origin = '    "~^[A-Z]+:https://%s:%s$" 0;\n' % (re.escape(a.dev_host), a.dev_port)
    s = s.replace('    "~^(GET|HEAD|OPTIONS):" 0;\n', '    "~^(GET|HEAD|OPTIONS):" 0;\n' + dev_origin, 1)
    s = s.replace("Strict-Transport-Security", "X-Dev-No-HSTS")
    assert dev_origin in s

n_up = s.count("http://nexus-app-beta:3000")
assert n_up >= 5, "expected the app upstream in phaethon.conf"
s = s.replace("http://nexus-app-beta:3000", "http://nexus_app_live")
assert "nexus-app-beta" not in s
n_root = s.count("root /usr/share/nginx/html;")
assert n_root >= 1
s = s.replace("root /usr/share/nginx/html;", "root $nexus_live_root;")

origin = 'add_header X-Nexus-Origin "%s" always;' % ("proxmox" if a.profile in ("prod", "vps") else (a.origin_tag or "dev"))
ARCHIVE = """
    # Blue-green: a hashed asset that is not in the live build (a tab opened before the last switch asks
    # for its old lazy chunk) comes from the archive of every recent build. 404 only if it is truly gone.
    location @nexus_archived_asset {
        root /usr/share/nginx/html/_archive;
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
        %s
    }
""" % origin

def server_fix(b):
    if "root $nexus_live_root;" not in b:
        return b
    if "location /assets/ {" in b:
        b2 = re.sub(r"(location /assets/ \{\s*\n\s*)try_files \$uri =404;", r"\1try_files $uri @nexus_archived_asset;", b, count=1)
        assert b2 != b, "could not patch /assets/ try_files"
        b = b2
    else:
        # LAN block: had no /assets/ location (its `location /` fell back to index.html for a missing chunk).
        b = b.replace("    location / {", """    location /assets/ {
        try_files $uri @nexus_archived_asset;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {""", 1)
    # named location goes right before the closing brace of the server block
    k = b.rstrip().rfind("}")
    return b[:k] + ARCHIVE + b[k:]

s = rebuild(s, server_fix)

# Preview server = the main (default_server) block, pointed at the idle slot.
main = None
for j, k in blocks(s):
    if "default_server" in s[j:k]:
        main = s[j:k]; break
assert main, "no default_server block"
prev = main.replace("listen 3000 default_server;", "listen %d;" % a.preview_port, 1)
assert prev != main
prev = prev.replace("http://nexus_app_live", "http://nexus_app_preview").replace("$nexus_live_root", "$nexus_preview_root")
prev = prev.replace("root /usr/share/nginx/html/_archive;", "root /usr/share/nginx/html/_archive;")
prev = prev.replace("location @nexus_archived_asset", "location @nexus_archived_asset")
prev = prev.replace('X-Nexus-Origin "', 'X-Nexus-Origin "preview-', )

header = "# GENERATED by deploy/bluegreen/nginx-gen.py (profile %s) from maintenance/phaethon.conf — do not edit.\n" % a.profile
header += "# Upstreams nexus_app_live / nexus_app_preview and $nexus_live_root / $nexus_preview_root live in 00-bluegreen.conf.\n"
s = header + s + """

# ── Blue-green PREVIEW (127.0.0.1:%d only): the idle slot behind the same routing, for the deploy smoke test.
%s

# ── Raw listener (127.0.0.1:%d): everything to the LIVE slot. Host-side callers (cron, health checks)
# keep one address whatever slot is live.
server {
    listen %d;
    client_max_body_size 1024m;
    location / {
        proxy_pass http://nexus_app_live;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
""" % (a.preview_port, prev, a.raw_port, a.raw_port)
open(a.dst, "w").write(s)
print("   nginx conf: %d upstream refs, %d roots -> %s" % (n_up, n_root, a.dst))
