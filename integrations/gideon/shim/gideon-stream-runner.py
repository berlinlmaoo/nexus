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
    from the session id, and a one-shot run is a new session every time, so the identical system prompt +
    tool schemas never hit the provider cache across questions. Same scope = same key = cached prefix (10%).
  - Router-miss safety net: an answer that says it cannot / has no tool, from a run that never loaded a
    deferred tool, is retried ONCE with every tool loaded. The first attempt's text is withdrawn with a
    `reset` line; a {"t":"router_miss"} line tells the shim to log it.
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


_STATE: dict = {}


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

    logging.disable(logging.CRITICAL)
    failure = None
    response, result = "", {}
    tools_seen: list = []
    sessions: list = []
    with open(os.devnull, "w", encoding="utf-8") as devnull, redirect_stdout(devnull), redirect_stderr(devnull):
        try:
            if eager or cache_scope:
                _patch_hermes(eager, cache_scope)
            response, result = _run(prompt, args.model, args.provider, toolsets, tools_seen)
            sessions.append(result.get("session_id"))
            # Only when tools were deferred at all, the run never touched the bridge, and the answer reads as "can't".
            if (retry_on_miss and eager and (response or "").strip() and _MISS.search(response)
                    and not (_BRIDGE & set(tools_seen))):
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
