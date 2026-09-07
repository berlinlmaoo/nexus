import json
import os
import urllib.error
import urllib.request
from typing import Optional


def _base_url() -> str:
    # Default sengaja URL NEXUS yang sebenarnya, BUKAN 127.0.0.1:3000 — port 3000 di VM `agents`
    # itu OpenChamber, bukan NEXUS. Default lama bikin tool-nya diam-diam nembak service yang
    # salah waktu env-nya belum keisi, dan errornya nggak kelihatan seperti salah alamat.
    return os.getenv("NEXUS_BASE_URL", "https://nexus.znetworks.id").rstrip("/")


def _token() -> str:
    return os.getenv("NEXUS_SERVICE_TOKEN", "")


def check_available() -> bool:
    return bool(_base_url() and _token())


def call_nexus(action: str, input_data: Optional[dict]) -> str:
    token = _token()
    if not token:
        return json.dumps(
            {"ok": False, "error": "NEXUS_SERVICE_TOKEN is not configured"},
            ensure_ascii=False,
        )

    payload = json.dumps({"action": action, "input": input_data or {}}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        # Cloudflare sits in front of NEXUS and refuses urllib's default signature with a bare
        # "error code: 1010" — a 403 that never reaches the app, so the token looks wrong when it is
        # not. Any explicit agent passes; this one at least says who is calling.
        "User-Agent": "NEXUS-GIDEON/1.0 (+hermes-plugin)",
    }
    # Per-request actor: the host shim injects the logged-in NEXUS user as NEXUS_GIDEON_ACTOR_EMAIL on
    # each spawn. Forward it so the NEXUS tools act AS that user (role-scoped) instead of the fixed
    # service identity. The server only trusts this header AFTER the service token validates.
    actor = os.getenv("NEXUS_GIDEON_ACTOR_EMAIL", "").strip()
    if actor:
        headers["x-gideon-actor"] = actor
    request = urllib.request.Request(
        f"{_base_url()}/api/gideon/tools",
        data=payload,
        method="POST",
        headers=headers,
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.dumps(json.loads(body), ensure_ascii=False)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = body
        return json.dumps(
            {"ok": False, "status": exc.code, "error": parsed},
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False)
