"""
nexus-face — counts faces in an attendance selfie.

  POST /detect {"path": "attendance/checkin-....jpg"}   (relative to the uploads root)
    200 {"faces": <int>, "best": <0..1>}
    400 bad request · 404 file missing · 422 not an image · 500 detector error
  GET /health -> {"ok": true}

The uploads root is mounted read-only at UPLOADS_ROOT (default /app/public/uploads, the same path the
app sees). Paths are resolved under it and anything that escapes it is refused.

Detector: OpenCV YuNet. A selfie is scaled so its long side is at most 640 px (YuNet is trained on
faces of roughly that scale and a 4000 px phone photo only costs time). When nothing is found upright,
the photo is tried rotated 90° both ways: a browser upload can lose its EXIF orientation, and a face
lying on its side is still a face — we would rather miss a wall than accuse a person.
"""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

UPLOADS_ROOT = os.path.realpath(os.environ.get("UPLOADS_ROOT", "/app/public/uploads"))
MODEL = os.environ.get("YUNET_MODEL", "/models/yunet.onnx")
# 0.4, not YuNet's usual 0.6-0.9: calibrated on 300 real selfies (29 Sep 2026). At 0.6 a face lit
# red or half hidden by hair came back as "no face"; at 0.4 walls, ceilings and black frames still
# score 0. A missed wall costs nothing, a false "no face" puts a person in front of the BoD.
SCORE = float(os.environ.get("FACE_SCORE_THRESHOLD", "0.4"))
MAX_SIDE = 640
MAX_BODY = 4096

_local = threading.local()
# Memory, not speed, is the limit: a 12 MP selfie decodes to ~36 MB and the first backfill run got
# the container OOM-killed at 768 MB with every request decoding at once. Two at a time, and
# OpenCV's own thread pool off (the cron already sends requests in parallel).
_slots = threading.BoundedSemaphore(int(os.environ.get("FACE_CONCURRENCY", "2")))
cv2.setNumThreads(1)


def detector():
    # FaceDetectorYN is not thread-safe; one per server thread.
    d = getattr(_local, "det", None)
    if d is None:
        d = cv2.FaceDetectorYN.create(MODEL, "", (320, 320), SCORE, 0.3, 5000)
        _local.det = d
    return d


def detect(img: np.ndarray):
    h, w = img.shape[:2]
    scale = min(1.0, MAX_SIDE / float(max(h, w)))
    if scale < 1.0:
        img = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    best_faces, best_score = 0, 0.0
    for rot in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE):
        frame = img if rot is None else cv2.rotate(img, rot)
        fh, fw = frame.shape[:2]
        d = detector()
        d.setInputSize((fw, fh))
        _, faces = d.detect(frame)
        n = 0 if faces is None else len(faces)
        score = 0.0 if faces is None or n == 0 else float(max(f[-1] for f in faces))
        if n > best_faces or (n == best_faces and score > best_score):
            best_faces, best_score = n, score
        if n > 0:
            break
    return best_faces, round(best_score, 4)


def resolve(rel: str):
    if not isinstance(rel, str) or not rel or len(rel) > 512 or "\x00" in rel:
        return None
    p = os.path.realpath(os.path.join(UPLOADS_ROOT, rel.lstrip("/")))
    if p != UPLOADS_ROOT and not p.startswith(UPLOADS_ROOT + os.sep):
        return None
    return p


class Handler(BaseHTTPRequestHandler):
    server_version = "nexus-face/1"

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # errors only; the cron makes hundreds of calls
        pass

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/detect":
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._send(400, {"error": "body required"})
            payload = json.loads(self.rfile.read(length))
            path = resolve(payload.get("path"))
            if path is None:
                return self._send(400, {"error": "bad path"})
            if not os.path.isfile(path):
                return self._send(404, {"error": "file not found"})
            with _slots:
                img = cv2.imread(path, cv2.IMREAD_COLOR)  # applies EXIF orientation
                if img is None:
                    return self._send(422, {"error": "not an image"})
                faces, best = detect(img)
                del img
            return self._send(200, {"faces": faces, "best": best})
        except Exception as e:  # noqa: BLE001 — any failure is "not checked", the cron retries
            print(f"detect failed: {e!r}", flush=True)
            return self._send(500, {"error": "detector error"})


if __name__ == "__main__":
    detector()  # fail at start, not on the first request, if the model is unusable
    print(f"nexus-face on :8080, uploads={UPLOADS_ROOT}, threshold={SCORE}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
