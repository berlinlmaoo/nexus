#!/usr/bin/env python3
"""Point Kuma's "VPS · NEXUS standby app" monitor at the blue-green nexus-web (RUNBOOK part C, step C1).

Before the VPS migration the monitor checks http://nexus-app-beta:3000/api/health; after it that container is
gone (renamed nexus-app-legacy, later removed), so the monitor must check through nexus-web, which proxies
/api to whichever slot is live. Kuma sits on nexus-app_nexus_internal, same as nexus-web.

Run ON THE VPS with the venv that set Kuma up:
  ~/kuma-venv/bin/python vps-kuma-standby-monitor.py              # dry run: shows current -> intended, changes nothing
  ~/kuma-venv/bin/python vps-kuma-standby-monitor.py --apply      # during C1, right after `vps-bluegreen.sh migrate`
  ~/kuma-venv/bin/python vps-kuma-standby-monitor.py --apply --url http://nexus-app-beta:3000/api/health   # undo
Credentials: ~/.secrets/kuma.json {"username","password"}. Kuma: http://127.0.0.1:3001.
"""
import argparse
import json
import os
import sys

from uptime_kuma_api import UptimeKumaApi

NAME = "VPS · NEXUS standby app"
NEW_URL = "http://nexus-web:3000/api/health"

ap = argparse.ArgumentParser()
ap.add_argument("--apply", action="store_true")
ap.add_argument("--url", default=NEW_URL)
ap.add_argument("--kuma", default="http://127.0.0.1:3001")
a = ap.parse_args()

cred = json.load(open(os.path.expanduser("~/.secrets/kuma.json")))
api = UptimeKumaApi(a.kuma, timeout=30)
try:
    api.login(cred["username"], cred["password"])
    mons = [m for m in api.get_monitors() if m.get("name") == NAME]
    if len(mons) != 1:
        sys.exit(f"STOP: expected exactly one monitor named {NAME!r}, found {len(mons)}")
    m = mons[0]
    print(f"monitor {m['id']} {NAME!r}: type={m.get('type')} keyword={m.get('keyword')!r}")
    print(f"  url now : {m.get('url')}")
    print(f"  url want: {a.url}")
    if m.get("url") == a.url:
        print("  already set — nothing to do")
    elif not a.apply:
        print("  dry run — pass --apply to change it")
    else:
        api.edit_monitor(m["id"], url=a.url)
        after = api.get_monitor(m["id"]).get("url")
        if after != a.url:
            sys.exit(f"STOP: Kuma still reports {after}")
        print(f"  changed: {after}")
finally:
    api.disconnect()
