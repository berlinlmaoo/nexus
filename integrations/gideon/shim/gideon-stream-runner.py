#!/usr/bin/env python3
"""GIDEON streaming runner: one Hermes agent turn, streamed as NDJSON on stdout.

`hermes -z` (oneshot) prints only the final answer and deliberately switches every streaming
callback off. NEXUS wants to show the answer while it is being written, so the shim's /chat-stream
endpoint runs THIS instead: the same AIAgent construction as hermes_cli/oneshot.py::_run_agent, but
with stream_delta_callback and the tool start/complete callbacks wired to stdout lines.

Protocol (one JSON object per line, flushed immediately):
  {"t":"delta","c":"..."}             a piece of answer text
  {"t":"reset"}                       a tool round starts; text streamed so far was interim commentary
  {"t":"tool","phase":"start","id":"..","name":".."}    / phase "done"
  {"t":"final","c":"...","usage":{..}} the authoritative final answer (always sent on success)
  {"t":"error","c":"..."}             the run failed

Usage (prompt on stdin, so it never shows up in `ps`):
  HERMES_HOME=~/.hermes/profiles/<p> python gideon-stream-runner.py --model M --provider P --toolsets nexus,vision

Runs with the Hermes venv's python (it imports Hermes). The toolsets are EXPLICIT: the caller decides
what this agent may touch, not the profile's interactive defaults.

Cost (owner, 18 Oct 2026 — "cheaper per answer, not dumber"):
  - GIDEON_EAGER_TOOLS (comma list): plugin tools the model always sees with their full schema. Every other
    plugin tool stays deferred behind Hermes' tool_search / tool_describe / tool_call bridge, whose
    description lists each one by name, so the model can still load any of them mid-answer.
  - GIDEON_CACHE_SCOPE: one prompt-cache scope for every run of this instance. Hermes derives the cache key
    (and the Codex `session_id` header, which is what that backend actually routes its cache by) from the
    session id, and a one-shot run is a new session every time, so the identical system prompt + tool
    schemas never hit the provider cache across questions. Same scope = cached prefix (10% price).
  - Router-miss safety net: an answer that says it cannot / has no tool, from a run that never loaded a
    deferred tool, is retried ONCE with every tool loaded. The first attempt's text is withdrawn with a
    `reset` line; a {"t":"router_miss"} line tells the shim to log it.

Model 0 (owner, 18 Oct 2026; tier from GIDEON_TIER, set by the shim per run):
  - GIDEON_EAGER_TOOLS_<TIER> (e.g. GIDEON_EAGER_TOOLS_EXPERIMENTAL) is ADDED to GIDEON_EAGER_TOOLS for that tier. The
    local 9B almost never opens tool_search, so booking / deals / legal must be loaded up front; on a local model
    the extra schema costs no credits, only prompt (still far below its 32k window).
  - Announce safety net (GIDEON_ANNOUNCE_RETRY_TIERS, default "experimental"): an answer that only ANNOUNCES the
    lookup or action ("gw cek dulu…", "sebentar", "let me check", a nexus_* name or call syntax in the text) is
    retried ONCE with an instruction to call the tool now. Logged like a router miss, with kind "announce". Same for a
    deal / legal / room question answered "not found" without that domain's own tool (kind "domain").
  - GIDEON_SAMPLING_<TIER> (JSON: temperature, top_p, presence_penalty, frequency_penalty, seed) for that tier's
    requests. Model 0 runs {"temperature":0.6,"top_p":0.95} (Qwen's thinking-mode values; Ollama's default 0.8 made
    up words like "kerjem", "dikongkrongin").
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import threading
from contextlib import redirect_stderr, redirect_stdout

_REAL_STDOUT = sys.stdout
_LOCK = threading.Lock()


def emit(obj: dict) -> None:
    line = json.dumps(obj, ensure_ascii=False)
    with _LOCK:
        try:
            _REAL_STDOUT.write(line + "\n")
            _REAL_STDOUT.flush()
        except Exception:
            pass


# "I can't / there is no tool / no access" — the words of an answer given without the tool it needed.
# Not "not found": an empty search is a real answer.
_MISS = re.compile(
    r"(tidak|nggak|gak|ga|belum) (bisa|dapat) (aku |gw |saya )?(proses|akses|mengakses|membaca|melihat|memesan|booking|membooking)"
    r"|(tidak|nggak|gak|belum) (punya|ada) (akses|tool|alat|fitur)"
    r"|(tool|alat|fitur)[^.\n]{0,60}(tidak|belum|nggak) (tersedia|menyediakan|ada|bisa)"
    r"|tidak menyediakan"
    r"|di luar kemampuan"
    r"|(can't|cannot|can not|unable to) (access|book|read|see|check|process)"
    r"|(don't|do not) have (access|a tool|the tool|tools)"
    r"|(no|not an?) (tool|access) (for|to)"
    r"|not available (in|to) (this|me)",
    re.I,
)
_BRIDGE = {"tool_search", "tool_describe", "tool_call"}
# A question about something only a DEFERRED tool can see (Pipeline, Legal, Room Booking) answered with
# "not found" by a run that never opened the catalog is a miss too: the workspace search cannot see deals,
# legal documents or bookings, so "not found" there means "did not look" (18 Oct 2026, Aphrodite on a deal).
_DEFERRED_DOMAIN = re.compile(r"\b(deal|deals|pipeline|legal|kontrak|contract|nda|pks|spk|mou|ruang|ruangan|room|booking|book|meeting room)\b", re.I)
_NOT_FOUND = re.compile(r"(belum|tidak|nggak|gak|ga) (bisa |dapat )?(memastikan|menemukan|ketemu|ditemukan|teridentifikasi|ada data)|not find|couldn't find|could not find|can't confirm|no (results|match)", re.I)


# "I'll check / one moment / let me look" — an action announced in the answer instead of made (Model 0, 18 Oct
# 2026: "Gw langsung aja nexus_book_room…", "Oke, gw cek task yang lagi open…" and the run ends).
_ANNOUNCE_VERB = re.compile(
    r"\b(gw|gue|gua|aku|saya|kami|kita)\s+(akan\s+|mau\s+|coba\s+|langsung\s+|bakal\s+|lagi\s+|perlu\s+|harus\s+)?(aja\s+)?"
    r"(cek|ngecek|cekin|mengecek|periksa|memeriksa|cari|carikan|nyari|mencari|cariin|lihat|liat|ngeliat|melihat|lihatkan"
    r"|ambil|ambilkan|ambilin|tarik|booking|bookingin|book|pesan|pesankan|pesenin|buat|buatkan|buatin|bikin|bikinin|panggil|jalankan)\b"
    r"|\b(coba|mari|ayo)\s+(kita\s+|gw\s+|saya\s+|aku\s+)?(cek|lihat|liat|cari|periksa)\b"
    r"|\b(tunggu\s+)?sebentar\b|\bbentar\s+ya\b|\bmohon\s+tunggu\b"
    r"|\b(let me|i'll|i will|i'm going to|one moment|hold on|give me a (moment|sec))\b"
    r"|\b(cek|ngecek|mengecek|cari|lihat)\s+(dulu|sekarang|langsung)\b",
    re.I,
)
# A tool written out instead of called: a nexus_* name in prose, or call / tool-code syntax.
_ANNOUNCE_TOOL = re.compile(r"\bnexus_[a-z_]{3,}|<tool_(code|call)>|\btool_call\b|```(tool|json)\s*\n\s*\{\s*\"(name|tool)\"", re.I)
# "If you want, I can check…" is an offer, not an unkept promise.
_OFFER = re.compile(r"\b(kalau|kalo|klo|jika|bila|apabila|if|mau\s+gw|mau\s+saya|mau\s+aku|perlu\s+gw|perlu\s+saya|bisa)\b", re.I)
_PAST = re.compile(r"\b(yang|udah|sudah|telah|tadi|barusan|habis|setelah|sempat)\s+(\w+\s+)?$", re.I)
_MUTATING = re.compile(r"^nexus_(create|update|delete|book|move|cancel|add|propose|resolve)_")


def _announced_not_made(response: str, tools_seen: list) -> bool:
    """True when the final answer reads like a promise to call a tool (rather than a result), Model 0's habit."""
    text = (response or "").strip()
    if not text:
        return False
    if any(_MUTATING.match(t or "") for t in tools_seen):
        return False  # an action was already proposed; a retry could propose it twice
    if _ANNOUNCE_TOOL.search(text):
        return True
    # Only the closing paragraph counts: "Gw cek task telat lo — hasilnya: …" opens with the words and then answers.
    tail = re.split(r"\n\s*\n", text)[-1].strip()[-300:]
    for m in _ANNOUNCE_VERB.finditer(tail):
        start = max(tail.rfind(c, 0, m.start()) for c in ".!?:\n") + 1
        end_candidates = [i for i in (tail.find(c, m.end()) for c in ".!?:\n") if i >= 0]
        end = min(end_candidates) if end_candidates else len(tail)
        sentence_head = tail[start:m.start()]
        # An offer ("kalau mau, gw cek…?"), a lead-in to results ("gw cek: …") or past tense ("yang gw cek tadi").
        if _OFFER.search(sentence_head) or tail[end:end + 1] in ("?", ":") or _PAST.search(sentence_head):
            continue
        return True
    return False


_ANNOUNCE_NUDGE = (
    "\n\n[GIDEON runtime note: your previous attempt at this message only announced the lookup or action "
    "(\"{first}\") and ended without calling any tool. Do it now: call the right nexus_* tool in this turn, then answer "
    "from its result. Never write a tool name or call syntax in the reply, and never end with \"I'll check\".]"
)


# Model 0 with these tools loaded up front still answers "not found" from the workspace search alone (18 Oct 2026, L1:
# nine search_workspace calls, never nexus_search_legal_documents). Deals, legal documents and bookings live ONLY
# behind their own tool, so a "not found" without that tool is a miss.
_DOMAIN_TOOLS = (
    (re.compile(r"\b(deal|deals|pipeline)\b", re.I), ("nexus_search_deals",)),
    (re.compile(r"(?<!project )(?<!proyek )\b(legal|kontrak|contract|nda|pks|spk|mou)\b", re.I), ("nexus_search_legal_documents",)),
    (re.compile(r"\b(ruang|ruangan|room|booking|book|meeting room)\b", re.I), ("nexus_list_room_bookings", "nexus_book_room")),
)


_NONE_HERE = re.compile(r"\b(tidak|nggak|ngga|gak|ga|belum) (ada|ketemu|nemu|nemuin|muncul)\b|\bno (such|matching)\b|\bnothing (found|matches)\b", re.I)


def _domain_tool_skipped(question: str, response: str, tools_seen: list):
    """The tool a deal / legal / room question needed, when the run never called it and answered "not found"."""
    if not (_NOT_FOUND.search(response or "") or _NONE_HERE.search(response or "")):
        return None
    for pattern, tools in _DOMAIN_TOOLS:
        if pattern.search(question) and not (set(tools) & set(tools_seen)):
            return tools[0]
    return None


_DOMAIN_NUDGE = (
    "\n\n[GIDEON runtime note: your previous attempt answered \"not found\" without calling {tool}. That data is ONLY "
    "reachable through {tool} (the workspace search cannot see it). Call {tool} now, then answer from its result.]"
)


def _question(prompt: str) -> str:
    """The person's own message: what NEXUS puts after the last "Pesan terbaru dari <name>:" / "Pesan dari"."""
    for marker in ("Pesan terbaru dari ", "Pesan dari "):
        i = prompt.rfind(marker)
        if i >= 0:
            j = prompt.find(":", i)
            return prompt[j + 1:] if j >= 0 else prompt[i:]
    return prompt[-600:]


def _patch_hermes(eager: set, cache_scope: str) -> None:
    """Tool deferral and the prompt-cache scope, for this process only (Hermes itself is untouched)."""
    import tools.tool_search as ts

    original_core = ts._core_tool_names

    def core_names():
        names = original_core()
        if _STATE.get("eager_all"):
            # The retry: every plugin tool of this session counts as core, so nothing defers.
            from tools.registry import registry
            return names | frozenset(e.name for e in registry._snapshot_entries())
        return names | frozenset(eager)

    ts._core_tool_names = core_names
    if cache_scope:
        import agent.chat_completion_helpers as cch
        cch._prompt_cache_scope_for_agent = lambda _agent: cache_scope
        # The ChatGPT Codex backend routes its prompt cache by the `session_id` HEADER, not by prompt_cache_key
        # (measured 18 Oct 2026: same key + per-run session_id = 0 cached; same session_id = 6272 of 6448 cached on
        # the next run). Requests are store=false and carry their whole input, so the header only picks the cache.
        import agent.transports.codex as cx
        build = cx.ResponsesApiTransport.build_kwargs

        def build_kwargs(self, *a, **k):
            kw = build(self, *a, **k)
            headers = kw.get("extra_headers")
            if isinstance(headers, dict) and "session_id" in headers:
                headers["session_id"] = cache_scope
            return kw

        cx.ResponsesApiTransport.build_kwargs = build_kwargs


_STATE: dict = {}


def _patch_sampling(sampling: dict) -> None:
    """Per-tier sampling (GIDEON_SAMPLING_<TIER>, JSON, e.g. {"temperature":0.6,"top_p":0.95}) on every chat-completions
    request of this process. Model 0 only (Ollama's OpenAI endpoint takes temperature/top_p/presence_penalty/
    frequency_penalty/seed); the hosted tiers use another transport and never set it."""
    import agent.transports.chat_completions as cc
    build = cc.ChatCompletionsTransport.build_kwargs

    def build_kwargs(self, *a, **k):
        kw = build(self, *a, **k)
        if isinstance(kw, dict):
            kw.update(sampling)
        return kw

    cc.ChatCompletionsTransport.build_kwargs = build_kwargs


def _run(prompt: str, model: str, provider: str, toolsets: list[str], tools_seen: list) -> tuple[str, dict]:
    # Imported here so HERMES_HOME (set by the caller) is in place before Hermes reads anything.
    from gateway.session_context import declare_stateless_channel
    from hermes_cli.config import load_config
    from hermes_cli.fallback_config import get_fallback_chain
    from hermes_cli.oneshot import (
        _close_agent,
        _create_session_db_for_oneshot,
        _oneshot_clarify_callback,
        _resolve_model_and_provider,
    )
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from run_agent import AIAgent

    # Same non-interactive contract as oneshot: nobody can answer an approval prompt.
    os.environ["HERMES_YOLO_MODE"] = "1"
    os.environ["HERMES_ACCEPT_HOOKS"] = "1"
    declare_stateless_channel()

    cfg = load_config()
    choice = _resolve_model_and_provider(cfg, model, provider)
    runtime = resolve_runtime_provider(
        requested=choice.provider,
        target_model=choice.model or None,
        explicit_base_url=choice.base_url,
        explicit_api_key=choice.api_key,
    )

    def on_delta(text):
        if text is None:
            emit({"t": "reset"})
        elif text:
            emit({"t": "delta", "c": text})

    def on_tool_start(call_id=None, name=None, *_args, **_kw):
        tools_seen.append(str(name or ""))
        emit({"t": "tool", "phase": "start", "id": str(call_id or ""), "name": str(name or "")})

    def on_tool_done(call_id=None, name=None, *_args, **_kw):
        emit({"t": "tool", "phase": "done", "id": str(call_id or ""), "name": str(name or "")})

    session_db = _create_session_db_for_oneshot()
    agent = None
    try:
        agent = AIAgent(
            api_key=runtime.get("api_key"),
            base_url=runtime.get("base_url"),
            provider=runtime.get("provider"),
            requested_provider=runtime.get("requested_provider"),
            api_mode=runtime.get("api_mode"),
            model=choice.model,
            enabled_toolsets=toolsets,
            quiet_mode=True,
            platform="cli",
            session_db=session_db,
            credential_pool=runtime.get("credential_pool"),
            fallback_model=get_fallback_chain(cfg) or None,
            clarify_callback=_oneshot_clarify_callback,
            stream_delta_callback=on_delta,
            tool_start_callback=on_tool_start,
            tool_complete_callback=on_tool_done,
        )
        agent.suppress_status_output = True
        # Re-assert after construction: some init paths reset display callbacks.
        agent.stream_delta_callback = on_delta
        agent.tool_start_callback = on_tool_start
        agent.tool_complete_callback = on_tool_done
        result = agent.run_conversation(prompt)
        # The session row this run wrote in state.db (credits, 18 Oct 2026): the shim reads its usage there.
        if isinstance(result, dict) and not result.get("session_id"):
            result["session_id"] = getattr(agent, "session_id", None)
        return (result.get("final_response") or "", result)
    finally:
        _close_agent(agent, session_db)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--provider", required=True)
    ap.add_argument("--toolsets", default="nexus")
    args = ap.parse_args()
    # The profile's .env (HERMES_HOME/.env) carries NEXUS_BASE_URL / NEXUS_SERVICE_TOKEN for the plugin.
    # `hermes` loads it in hermes_cli/main.py; this runner bypasses main, so it loads it the same way.
    from hermes_cli.env_loader import load_hermes_dotenv
    load_hermes_dotenv()
    prompt = sys.stdin.read()
    if not prompt.strip():
        emit({"t": "error", "c": "empty prompt"})
        return 2
    toolsets = [t.strip() for t in args.toolsets.split(",") if t.strip()]
    eager = {t.strip() for t in os.getenv("GIDEON_EAGER_TOOLS", "").split(",") if t.strip()}
    cache_scope = os.getenv("GIDEON_CACHE_SCOPE", "").strip()
    retry_on_miss = os.getenv("GIDEON_ROUTER_RETRY", "1") != "0"
    tier = os.getenv("GIDEON_TIER", "").strip().lower()
    tier_eager = os.getenv(f"GIDEON_EAGER_TOOLS_{tier.upper()}") if re.fullmatch(r"[a-z0-9_]{1,20}", tier) else None
    if tier_eager is not None:
        # Added to the shared list, so a tool someone makes eager for every tier reaches this one too.
        eager |= {t.strip() for t in tier_eager.split(",") if t.strip()}
    announce_tiers = {t.strip() for t in os.getenv("GIDEON_ANNOUNCE_RETRY_TIERS", "experimental").split(",") if t.strip()}
    sampling = {}
    if tier:
        try:
            raw = os.getenv(f"GIDEON_SAMPLING_{tier.upper()}", "") if re.fullmatch(r"[a-z0-9_]{1,20}", tier) else ""
            allowed = {"temperature", "top_p", "presence_penalty", "frequency_penalty", "seed"}
            sampling = {k: v for k, v in (json.loads(raw) if raw else {}).items() if k in allowed and isinstance(v, (int, float))}
        except Exception:
            sampling = {}

    logging.disable(logging.CRITICAL)
    failure = None
    response, result = "", {}
    tools_seen: list = []
    sessions: list = []
    with open(os.devnull, "w", encoding="utf-8") as devnull, redirect_stdout(devnull), redirect_stderr(devnull):
        try:
            if eager or cache_scope:
                _patch_hermes(eager, cache_scope)
            if sampling:
                _patch_sampling(sampling)
            response, result = _run(prompt, args.model, args.provider, toolsets, tools_seen)
            sessions.append(result.get("session_id"))
            # Only when tools were deferred at all, the run never touched the bridge, and the answer reads as "can't".
            missed = bool((response or "").strip()) and (
                _MISS.search(response) or (_DEFERRED_DOMAIN.search(_question(prompt)) and _NOT_FOUND.search(response)))
            if retry_on_miss and eager and missed and not (_BRIDGE & set(tools_seen)):
                emit({"t": "router_miss", "first": response.strip()[:300], "tools": [t for t in tools_seen if t][:20]})
                emit({"t": "reset"})
                _STATE["eager_all"] = True
                import model_tools
                model_tools._clear_tool_defs_cache()
                first_result = result
                response, result = _run(prompt, args.model, args.provider, toolsets, tools_seen)
                sessions.append(result.get("session_id"))
                for k in ("input_tokens", "output_tokens", "total_tokens", "api_calls", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens"):
                    result[k] = (result.get(k) or 0) + (first_result.get(k) or 0)
            elif tier in announce_tiers and (
                    (skipped := _domain_tool_skipped(_question(prompt), response, tools_seen)) or _announced_not_made(response, tools_seen)):
                first = response.strip()
                emit({"t": "router_miss", "kind": "domain" if skipped else "announce", "first": first[:300], "tools": [t for t in tools_seen if t][:20]})
                emit({"t": "reset"})
                first_result = result
                snippet = re.sub(r"\s+", " ", first)[-160:].replace('"', "'")
                nudge = _DOMAIN_NUDGE.format(tool=skipped) if skipped else _ANNOUNCE_NUDGE.format(first=snippet)
                response, result = _run(prompt + nudge, args.model, args.provider, toolsets, tools_seen)
                sessions.append(result.get("session_id"))
                for k in ("input_tokens", "output_tokens", "total_tokens", "api_calls", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens"):
                    result[k] = (result.get(k) or 0) + (first_result.get(k) or 0)
        except BaseException as exc:  # noqa: BLE001 - must reach the caller, never die silently
            failure = exc
    if failure is not None:
        emit({"t": "error", "c": f"agent failed: {failure}"[:500]})
        return 1
    response = (response or "").strip()
    if not response:
        emit({"t": "error", "c": "no final response was produced"})
        return 1
    # Additive (18 Oct 2026, GIDEON credits): the cache / reasoning buckets and the Hermes session id(s) — two when
    # the router-miss retry ran; the shim bills both. Older NEXUS servers read only total_tokens from here.
    usage = {k: result.get(k) for k in ("input_tokens", "output_tokens", "total_tokens", "api_calls", "model", "provider",
                                        "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "session_id")}
    usage["session_ids"] = [s for s in sessions if s]
    emit({"t": "final", "c": response, "usage": usage})
    return 0


if __name__ == "__main__":
    code = main()
    try:
        _REAL_STDOUT.flush()
    finally:
        # Hermes leaves non-daemon threads behind (same reason oneshot hard-exits).
        os._exit(code)
