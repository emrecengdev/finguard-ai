"""
FinGuard AI — Provider-neutral LLM layer with smart multi-key selection.

Wraps the official `openai` SDK pointed at any OpenAI-compatible chat
completions endpoint. Provider-neutral: flip LLM_BASE_URL / LLM_API_KEY(S)
/ LLM_MODEL to talk to Cerebras, MiniMax, OpenAI, Groq, Together, etc.

Design notes
------------
* A multi-key client POOL (`_get_clients()`) keeps one `OpenAI()` per API
  key (LLM_API_KEYS, comma-separated). SMART SELECTION (`_pick_key`): each
  call chooses the key with the most REMAINING quota (from the provider's
  `x-ratelimit-remaining-*` response headers), excluding keys in a 429
  cooldown, tie-broken by fewest in-flight calls. This beats blind
  round-robin on tight per-key limits (e.g. Cerebras ~5 req/min/key).
* On a 429 the offending key enters a cooldown (Retry-After, default 60s)
  and the next-best key is tried immediately (no sleep). Other transient
  errors back off with full jitter. Auth (401/403) / bad input (400/422)
  fail fast. Timeouts from settings; SDK max_retries=0 (we own retry).
* `_call_llm_stream` rotates/selects only BEFORE the first token; once a
  token is yielded an error ends the iterator (no splicing).
* No prompt text or API key is ever written to logs.
"""

from __future__ import annotations

import itertools
import json
import logging
import threading
import time
from random import uniform
from time import monotonic
from typing import Iterator, Optional

import httpx
import openai

from app.config import get_settings

logger = logging.getLogger(__name__)


# ─── Multi-key client pool + smart selection ─────────────────────────

_pool_lock = threading.Lock()
_state_lock = threading.Lock()
_client_pool: list = []
_pool_cache_key: Optional[tuple] = None
_key_state: list = []  # per-key: {"remaining": float, "cooldown_until": float, "inflight": int}
_rr_counter = itertools.count()

# Header that carries the binding short-window remaining budget. Cerebras
# exposes x-ratelimit-remaining-requests-minute; other providers may differ.
_REMAINING_HEADER = "x-ratelimit-remaining-requests-minute"


def _resolve_keys(settings) -> list:
    raw = getattr(settings, "llm_api_keys", "") or ""
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys and settings.llm_api_key:
        keys = [settings.llm_api_key]
    seen = set()
    out = []
    for k in keys:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _get_clients(settings) -> list:
    """Return a cached list of OpenAI clients (one per API key)."""
    global _client_pool, _pool_cache_key, _key_state
    keys = _resolve_keys(settings)
    if not keys:
        raise ValueError("LLM_API_KEY(s) are not configured")
    cache_key = (settings.llm_base_url, tuple(keys))
    if _pool_cache_key == cache_key and _client_pool:
        return _client_pool
    with _pool_lock:
        if _pool_cache_key == cache_key and _client_pool:
            return _client_pool
        timeout = httpx.Timeout(
            connect=settings.llm_connect_timeout_seconds,
            read=settings.llm_read_timeout_seconds,
            write=settings.llm_write_timeout_seconds,
            pool=settings.llm_pool_timeout_seconds,
        )
        _client_pool = [
            openai.OpenAI(api_key=k, base_url=settings.llm_base_url, timeout=timeout, max_retries=0)
            for k in keys
        ]
        _key_state = [
            {"remaining": float("inf"), "cooldown_until": 0.0, "inflight": 0}
            for _ in keys
        ]
        _pool_cache_key = cache_key
        return _client_pool


def _pick_key(n: int) -> int:
    """Choose the best key index: most remaining quota, not in cooldown,
    fewest in-flight; rotation as the final tiebreak."""
    now = monotonic()
    k = next(_rr_counter)
    with _state_lock:
        avail = [i for i in range(n) if _key_state[i]["cooldown_until"] <= now]
        pool = avail if avail else list(range(n))
        pool.sort(key=lambda i: (-_key_state[i]["remaining"], _key_state[i]["inflight"], (i - k) % n))
        return pool[0]


def _set_remaining(idx: int, headers) -> None:
    try:
        val = headers.get(_REMAINING_HEADER)
        if val is None:
            return
        with _state_lock:
            _key_state[idx]["remaining"] = float(val)
    except Exception:  # noqa: BLE001
        pass


def _decrement_remaining(idx: int, by: float = 1.0) -> None:
    with _state_lock:
        r = _key_state[idx]["remaining"]
        if r != float("inf"):
            _key_state[idx]["remaining"] = max(0.0, r - by)


def _mark_cooldown(idx: int, retry_after: float) -> None:
    with _state_lock:
        _key_state[idx]["cooldown_until"] = monotonic() + max(1.0, float(retry_after or 60.0))
        _key_state[idx]["remaining"] = 0.0


def _bump_inflight(idx: int, delta: int) -> None:
    with _state_lock:
        _key_state[idx]["inflight"] = max(0, _key_state[idx]["inflight"] + delta)


def _retry_after(exc: BaseException) -> float:
    try:
        resp = getattr(exc, "response", None)
        hdrs = getattr(resp, "headers", None)
        if hdrs:
            for key in ("retry-after", "Retry-After"):
                ra = hdrs.get(key)
                if ra:
                    return float(ra)
    except Exception:  # noqa: BLE001
        pass
    return 60.0


# ─── Retry policy ────────────────────────────────────────────────────

_RETRYABLE_STATUS_CODES = frozenset({408, 409, 429})
_FAIL_FAST_STATUS_CODES = frozenset({400, 401, 403, 422})


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (openai.APIConnectionError, openai.APITimeoutError)):
        return True
    if isinstance(exc, openai.APIStatusError):
        status = getattr(exc, "status_code", None)
        if status is None:
            return False
        if status in _FAIL_FAST_STATUS_CODES:
            return False
        if status in _RETRYABLE_STATUS_CODES:
            return True
        return status >= 500
    return False


def _is_rate_limited(exc: BaseException) -> bool:
    status = getattr(exc, "status_code", None)
    if status == 429:
        return True
    msg = str(exc).lower()
    return any(m in msg for m in ("rate limit", "rate_limit", "resourceexhausted", "quota", "too many requests"))


def _full_jitter_sleep(attempt_index: int) -> None:
    settings = get_settings()
    cap = settings.llm_retry_cap_seconds
    base = settings.llm_retry_base_seconds
    upper = min(cap, base * (2 ** attempt_index))
    time.sleep(uniform(0.0, upper))


# ─── Non-streaming call ──────────────────────────────────────────────


def _llm_extra_body(settings) -> dict:
    """Provider/model-aware request extras."""
    if settings.llm_provider != "minimax":
        return {}
    if "M3" in (settings.llm_model or "").upper():
        return {"thinking": {"type": "disabled"}}
    return {"reasoning_split": True}


def _call_llm(system_prompt: str, user_prompt: str) -> str:
    """Call chat completions and return the assistant text.

    Smart key selection per attempt; 429 -> cooldown + next key (no sleep);
    other transient -> jitter backoff. Auth/validation fail fast. Bounded by
    retries + one full rotation over all keys.
    """
    settings = get_settings()
    clients = _get_clients(settings)
    n = len(clients)
    extra = _llm_extra_body(settings)
    max_tries = settings.llm_max_retries + n
    last_error = None

    for i in range(max_tries):
        idx = _pick_key(n)
        _bump_inflight(idx, 1)
        try:
            raw = clients[idx].chat.completions.with_raw_response.create(
                model=settings.llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=settings.llm_temperature,
                max_completion_tokens=settings.llm_max_completion_tokens,
                extra_body=extra,
            )
            _set_remaining(idx, raw.headers)
            data = json.loads(raw.text)
            content = (data["choices"][0]["message"]["content"] or "").strip()
            if not content:
                raise RuntimeError("LLM returned empty response")
            return content
        except Exception as exc:  # noqa: BLE001 — classified + re-raised
            last_error = exc
            status = getattr(exc, "status_code", None)
            logger.warning(
                "LLM call failed (try %d/%d, key#%d, class=%s, status=%s)",
                i + 1, max_tries, idx, type(exc).__name__, status,
            )
            if _is_rate_limited(exc):
                _mark_cooldown(idx, _retry_after(exc))
                continue  # next-best key immediately
            if not _is_retryable(exc):
                raise
            if i + 1 >= max_tries:
                raise
            _full_jitter_sleep(i)
            continue
        finally:
            _bump_inflight(idx, -1)

    if last_error is not None:
        raise last_error
    raise RuntimeError("LLM call failed without returning a response")


# ─── Streaming call ──────────────────────────────────────────────────


def _call_llm_stream(
    system_prompt: str,
    user_prompt: str,
    *,
    cancel_event: Optional[threading.Event] = None,
) -> Iterator[str]:
    """Yield assistant tokens from the chat completions endpoint.

    Smart key selection per attempt; rotation/retry only BEFORE the first
    token (after a token, an error ends the iterator). 429 -> cooldown +
    next key. Other transient -> jitter backoff. Honors cancel_event.
    """
    settings = get_settings()
    clients = _get_clients(settings)
    n = len(clients)
    extra = _llm_extra_body(settings)
    max_tries = settings.llm_max_retries + n
    yielded_any = False

    for i in range(max_tries):
        idx = _pick_key(n)
        _bump_inflight(idx, 1)
        try:
            stream = clients[idx].chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=settings.llm_temperature,
                max_completion_tokens=settings.llm_max_completion_tokens,
                stream=True,
                stream_options={"include_usage": True},
                extra_body=extra,
            )
        except Exception as exc:  # noqa: BLE001
            _bump_inflight(idx, -1)
            status = getattr(exc, "status_code", None)
            logger.warning(
                "LLM stream open failed (try %d/%d, key#%d, class=%s, status=%s)",
                i + 1, max_tries, idx, type(exc).__name__, status,
            )
            if _is_rate_limited(exc):
                _mark_cooldown(idx, _retry_after(exc))
                if not yielded_any and i + 1 < max_tries:
                    continue
                raise
            if not _is_retryable(exc):
                raise
            if yielded_any or i + 1 >= max_tries:
                raise
            _full_jitter_sleep(i)
            continue

        try:
            for chunk in stream:
                if cancel_event is not None and cancel_event.is_set():
                    try:
                        stream.close()
                    except Exception:  # noqa: BLE001
                        pass
                    return
                choices = getattr(chunk, "choices", None)
                if not choices:
                    continue
                delta = choices[0].delta
                piece = getattr(delta, "content", None)
                if not piece:
                    continue
                yielded_any = True
                yield piece
            _decrement_remaining(idx, 1.0)  # stream lacks headers; rough update
            return
        except Exception as exc:  # noqa: BLE001
            status = getattr(exc, "status_code", None)
            logger.warning(
                "LLM stream iteration failed (try %d/%d, key#%d, class=%s, status=%s, yielded=%s)",
                i + 1, max_tries, idx, type(exc).__name__, status, yielded_any,
            )
            if not _is_retryable(exc):
                raise
            if yielded_any or i + 1 >= max_tries:
                raise
            if _is_rate_limited(exc):
                _mark_cooldown(idx, _retry_after(exc))
                continue
            _full_jitter_sleep(i)
            continue
        finally:
            _bump_inflight(idx, -1)
