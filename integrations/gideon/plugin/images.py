"""nexus_read_nexus_image (18 Oct 2026): a picture that lives in NEXUS, handed to the vision tool.

NEXUS answers with the picture downscaled to a JPEG, base64 (the same shrink a picture attached in the GIDEON chat
gets). The base64 must never reach the model as text (it would be paid as tokens and is useless as text), so this
handler writes it into the shim's work dir — where the chat's own attached pictures go — and replaces it with the
path and an instruction to open it with vision_analyze. Files older than an hour are swept on every call.
"""
import base64
import json
import os
import secrets
import time

from .client import call_nexus

_WORKDIR = os.path.join(os.path.expanduser("~"), ".hermes", "oracle-workdir")
_PREFIX = "gideon-nexusimg-"
_MAX_BYTES = 8 * 1024 * 1024


def _sweep():
    try:
        now = time.time()
        for f in os.listdir(_WORKDIR):
            if f.startswith(_PREFIX):
                p = os.path.join(_WORKDIR, f)
                if now - os.path.getmtime(p) > 3600:
                    os.unlink(p)
    except OSError:
        pass


def read_nexus_image_handler(args=None, **_kwargs):
    raw = call_nexus("read_nexus_image", args or {})
    try:
        body = json.loads(raw)
    except ValueError:
        return raw
    data = body.get("data") if isinstance(body, dict) else None
    image = data.get("image") if isinstance(data, dict) else None
    if not isinstance(image, dict) or not isinstance(image.get("base64"), str):
        return raw
    try:
        blob = base64.b64decode(image["base64"], validate=True)
    except (ValueError, TypeError):
        return json.dumps({"ok": False, "error": "The picture could not be decoded."})
    if not blob or len(blob) > _MAX_BYTES:
        return json.dumps({"ok": False, "error": "The picture is too big to look at."})
    os.makedirs(_WORKDIR, mode=0o700, exist_ok=True)
    _sweep()
    path = os.path.join(_WORKDIR, f"{_PREFIX}{int(time.time())}-{secrets.token_hex(4)}.jpg")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(blob)
    out = {k: v for k, v in data.items() if k != "image"}
    out["imagePath"] = path
    out["size"] = f"{image.get('width')}x{image.get('height')}"
    out["next"] = f"Call vision_analyze with image_url={path} and the person's question, then answer from what it sees."
    return json.dumps({"ok": True, "data": out}, ensure_ascii=False)
