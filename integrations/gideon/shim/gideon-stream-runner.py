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
"""
from __future__ import annotations

import argparse
import json
import logging
import os
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


def _run(prompt: str, model: str, provider: str, toolsets: list[str]) -> tuple[str, dict]:
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

    logging.disable(logging.CRITICAL)
    failure = None
    response, result = "", {}
    with open(os.devnull, "w", encoding="utf-8") as devnull, redirect_stdout(devnull), redirect_stderr(devnull):
        try:
            response, result = _run(prompt, args.model, args.provider, toolsets)
        except BaseException as exc:  # noqa: BLE001 - must reach the caller, never die silently
            failure = exc
    if failure is not None:
        emit({"t": "error", "c": f"agent failed: {failure}"[:500]})
        return 1
    response = (response or "").strip()
    if not response:
        emit({"t": "error", "c": "no final response was produced"})
        return 1
    usage = {k: result.get(k) for k in ("input_tokens", "output_tokens", "total_tokens", "api_calls", "model", "provider")}
    emit({"t": "final", "c": response, "usage": usage})
    return 0


if __name__ == "__main__":
    code = main()
    try:
        _REAL_STDOUT.flush()
    finally:
        # Hermes leaves non-daemon threads behind (same reason oneshot hard-exits).
        os._exit(code)
