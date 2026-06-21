#!/usr/bin/env python3
# One-off: re-point existing Buffer draft images from the dead trycloudflare tunnel to the stable
# NEXUS URL. Rate-limit aware: waits for Buffer's 15m window to clear, then edits slowly (~7s apart).
import json, time, urllib.request, urllib.error, os, re

ORG = "6a0aec3f06ef0272e115f1e9"
NEW_BASE = "https://nexus.patsgroup.id/api/files/attachments/social-buffer/centipede-exports/"
LOCAL = "/Users/jagainmacmini1/Documents/nexus/var/uploads/attachments/social-buffer/centipede-exports/"

def token():
    for ln in open("/Users/jagainmacmini1/Documents/nexus/.env.production", encoding="utf-8"):
        if ln.startswith("BUFFER_API_TOKEN="):
            return ln.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no token")

TOK = token()

def gql(q, v=None):
    req = urllib.request.Request(
        "https://api.buffer.com",
        data=json.dumps({"query": q, "variables": v or {}}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOK}"},
        method="POST",
    )
    try:
        return json.loads(urllib.request.urlopen(req, timeout=30).read()), 200
    except urllib.error.HTTPError as e:
        return e.read().decode()[:200], e.code

def log(m):
    print(m, flush=True)

# 1) Wait until the rate-limit window clears.
log("[recover] waiting for Buffer rate-limit to clear...")
for _ in range(40):  # up to ~20 min
    d, code = gql("query { account { id } }")
    if code == 200 and isinstance(d, dict) and d.get("data", {}).get("account"):
        log("[recover] rate-limit clear, starting.")
        break
    time.sleep(30)
else:
    raise SystemExit("[recover] gave up waiting for rate-limit")

# 2) Fetch drafts.
d, code = gql("query($o:OrganizationId!){posts(first:60,input:{organizationId:$o,filter:{status:[draft]}}){edges{node{id shareMode text metadata{__typename ... on InstagramPostMetadata{type}} assets{source}}}}}", {"o": ORG})
nodes = [e["node"] for e in d["data"]["posts"]["edges"]]
log(f"[recover] {len(nodes)} drafts")

ok = skip = fail = 0
for i, n in enumerate(nodes, 1):
    a = n.get("assets") or []
    src = (a[0].get("source") if a else "") or ""
    if "trycloudflare" not in src:
        skip += 1
        continue
    fname = src.rsplit("/", 1)[-1]
    if not os.path.exists(LOCAL + fname):
        log(f"  [{i}] skip (file missing) {fname[:40]}")
        skip += 1
        continue
    newurl = NEW_BASE + fname
    ptype = (n.get("metadata") or {}).get("type") or "post"
    inp = {"id": n["id"], "schedulingType": "automatic", "mode": n["shareMode"] or "addToQueue",
           "saveToDraft": True, "text": n["text"], "metadata": {"instagram": {"type": ptype}},
           "assets": [{"image": {"url": newurl, "thumbnailUrl": newurl}}]}
    for attempt in range(3):
        r, code = gql("mutation($input:EditPostInput!){editPost(input:$input){... on PostActionSuccess{post{id}} ... on MutationError{message}}}", {"input": inp})
        if code == 429:
            log(f"  [{i}] 429, backoff 90s")
            time.sleep(90)
            continue
        ep = r.get("data", {}).get("editPost") if isinstance(r, dict) else None
        if ep and ep.get("post", {}).get("id"):
            ok += 1
        else:
            fail += 1
            log(f"  [{i}] FAIL {json.dumps(r)[:120]}")
        break
    time.sleep(7)

log(f"[recover] DONE: {ok} fixed · {skip} skipped · {fail} failed")
