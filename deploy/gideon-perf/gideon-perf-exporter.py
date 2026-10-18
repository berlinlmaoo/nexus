#!/usr/bin/env python3
"""
GIDEON performance exporter (Control Room > GIDEON > Performance, 18 Oct 2026).

Runs on the machine with the GPU that serves GIDEON Model 0. Every few seconds it reads, locally:
  - nvidia-smi: utilisation, VRAM used/total, temperature, power
  - the local engine (Ollama) GET /api/version (up?) and /api/ps (loaded model, size vs size on the GPU)
  - the meeting transcriber GET /health (busy, queue), when configured
  - the engine's journal since the last run: Model 0 generations (tokens/s) and model loads (seconds)
and POSTs one compact JSON to NEXUS (/api/gideon/perf/ingest, Bearer secret). NEXUS answers with how long to wait:
5 s while somebody has the panel open, 60 s otherwise. Standard library only; one small process.

Configuration (environment, see gideon-perf-exporter.service):
  NEXUS_PERF_URL     ingest URL (required)
  MODEL0_URL         the engine, e.g. http://127.0.0.1:11434 (the "is Model 0 up" check points here)
  WHISPER_URL        the transcriber, optional
  OLLAMA_UNIT        systemd unit whose journal holds the engine log (default ollama)
Secrets come from systemd credentials ($CREDENTIALS_DIRECTORY): `ingest` (the shared secret, raw) and optional
`whisper` (a file with WHISPER_SECRET=...).
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

INGEST_URL = os.environ.get("NEXUS_PERF_URL", "")
MODEL0_URL = os.environ.get("MODEL0_URL", "http://127.0.0.1:11434").rstrip("/")
WHISPER_URL = os.environ.get("WHISPER_URL", "").rstrip("/")
OLLAMA_UNIT = os.environ.get("OLLAMA_UNIT", "ollama")
STATE_DIR = os.environ.get("STATE_DIRECTORY", "/var/lib/gideon-perf")
CRED_DIR = os.environ.get("CREDENTIALS_DIRECTORY", "")
UA = "nexus-gideon-perf/1"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def read_cred(name):
    if not CRED_DIR:
        return ""
    try:
        with open(os.path.join(CRED_DIR, name), encoding="utf-8") as f:
            raw = f.read().strip()
    except OSError:
        return ""
    m = re.search(r"^\s*(?:export\s+)?[A-Z_]*SECRET\s*=\s*['\"]?([^'\"\n]+)", raw, re.M)
    return m.group(1).strip() if m else raw


INGEST_SECRET = read_cred("ingest")
WHISPER_SECRET = read_cred("whisper")


def http_json(url, timeout=3.0, headers=None, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})}, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "null")


def gpu():
    q = "name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit"
    try:
        out = subprocess.run(["nvidia-smi", f"--query-gpu={q}", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5).stdout
    except Exception as e:  # noqa: BLE001
        log("nvidia-smi failed:", e)
        return None
    line = out.strip().splitlines()[0] if out.strip() else ""
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 7:
        return None

    def f(v):
        try:
            return float(v)
        except ValueError:
            return None

    return {"name": parts[0], "util": f(parts[1]), "memUsed": f(parts[2]), "memTotal": f(parts[3]), "temp": f(parts[4]), "power": f(parts[5]), "powerLimit": f(parts[6])}


def engine():
    try:
        http_json(f"{MODEL0_URL}/api/version", timeout=2)
    except Exception:  # noqa: BLE001
        return {"up": False, "models": []}
    models = []
    try:
        for m in (http_json(f"{MODEL0_URL}/api/ps", timeout=3) or {}).get("models", [])[:3]:
            models.append({"name": m.get("name"), "size": m.get("size"), "sizeVram": m.get("size_vram"), "ctx": m.get("context_length"), "expiresAt": m.get("expires_at")})
    except Exception as e:  # noqa: BLE001
        log("engine /api/ps failed:", e)
    return {"up": True, "models": models}


def whisper():
    if not WHISPER_URL or not WHISPER_SECRET:
        return None
    try:
        h = http_json(f"{WHISPER_URL}/health", timeout=3, headers={"Authorization": f"Bearer {WHISPER_SECRET}"})
        return {"up": bool(h.get("ok")), "busy": bool(h.get("busy")), "queued": int(h.get("queued") or 0)}
    except Exception:  # noqa: BLE001
        return {"up": False, "busy": False, "queued": 0}


# ---- engine journal → Model 0 generations and loads ------------------------------------------------------
CURSOR_FILE = os.path.join(STATE_DIR, "cursor")
RE_PROMPT = re.compile(r"task (\d+) \| prompt eval time =\s*([\d.]+) ms /\s*(\d+) tokens .*?([\d.]+) tokens per second")
RE_EVAL = re.compile(r"task (\d+) \|\s+eval time =\s*([\d.]+) ms /\s*(\d+) tokens .*?([\d.]+) tokens per second")
RE_TOTAL = re.compile(r"task (\d+) \|\s+total time =\s*([\d.]+) ms")
RE_LOAD = re.compile(r"llama-server started in ([\d.]+) seconds")
pending_tasks = {}
last_load_at = 0.0


def read_cursor():
    try:
        with open(CURSOR_FILE, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def journal_events():
    """New engine log lines since the saved cursor → (events, new cursor). The cursor is saved by the caller only
    after NEXUS accepted the batch, so a failed post re-reads the same lines (NEXUS stores each `ref` once)."""
    global last_load_at
    cursor = read_cursor()
    cmd = ["journalctl", "-u", OLLAMA_UNIT, "-o", "json", "--no-pager", "-n", "5000"]
    cmd += ["--after-cursor", cursor] if cursor else ["--since", "-15min"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout
    except Exception as e:  # noqa: BLE001
        log("journalctl failed:", e)
        return [], cursor
    events, new_cursor = [], cursor
    for line in out.splitlines():
        try:
            j = json.loads(line)
        except ValueError:
            continue
        new_cursor = j.get("__CURSOR") or new_cursor
        msg = j.get("MESSAGE")
        if not isinstance(msg, str) or ("print_timing" not in msg and "started in" not in msg):
            continue
        ts = int(j.get("__REALTIME_TIMESTAMP", "0")) / 1e6
        at = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + f".{int(ts % 1 * 1000):03d}Z"
        ref = hashlib.sha1((j.get("__CURSOR") or line).encode()).hexdigest()[:24]
        m = RE_PROMPT.search(msg)
        if m:
            pending_tasks[m.group(1)] = {"promptTokens": int(m.group(3)), "promptTps": float(m.group(4))}
            continue
        m = RE_EVAL.search(msg)
        if m:
            pending_tasks.setdefault(m.group(1), {}).update({"outTokens": int(m.group(3)), "evalTps": float(m.group(4))})
            continue
        m = RE_TOTAL.search(msg)
        if m:
            t = pending_tasks.pop(m.group(1), {})
            if "evalTps" in t:
                events.append({"kind": "gen", "ref": ref, "at": at, "totalMs": int(float(m.group(2))), **t})
            continue
        m = RE_LOAD.search(msg)
        if m and ts - last_load_at > 10:  # the engine logs "started in" twice per load
            last_load_at = ts
            events.append({"kind": "load", "ref": ref, "at": at, "loadSec": float(m.group(1))})
    if len(pending_tasks) > 50:
        pending_tasks.clear()
    return events, new_cursor


def save_cursor(c):
    if not c:
        return
    tmp = CURSOR_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(c)
    os.replace(tmp, CURSOR_FILE)


def main():
    if not INGEST_URL or len(INGEST_SECRET) < 24:
        log("NEXUS_PERF_URL or the ingest credential is missing; exiting")
        return 2
    os.makedirs(STATE_DIR, exist_ok=True)
    log(f"gideon-perf exporter: engine {MODEL0_URL}, transcriber {'on' if WHISPER_URL and WHISPER_SECRET else 'off'}")
    wait = 5
    while True:
        started = time.time()
        events, cursor = journal_events()
        body = {"v": 1, "gpu": gpu(), "engine": engine(), "whisper": whisper(), "events": events[:200]}
        try:
            res = http_json(INGEST_URL, timeout=10, data=json.dumps(body).encode(),
                            headers={"Content-Type": "application/json", "Authorization": f"Bearer {INGEST_SECRET}"})
            save_cursor(cursor)
            wait = max(5, min(120, int((res or {}).get("next") or 60)))
        except urllib.error.HTTPError as e:
            log("ingest HTTP", e.code)
            wait = 60 if e.code in (401, 404) else 30
        except Exception as e:  # noqa: BLE001
            log("ingest failed:", e)
            wait = 30
        time.sleep(max(1.0, wait - (time.time() - started)))


if __name__ == "__main__":
    sys.exit(main())
