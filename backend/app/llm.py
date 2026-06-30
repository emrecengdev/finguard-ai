"""
FinGuard AI — Provider-neutral LLM layer with multi-key pooling.

Wraps the official `openai` SDK pointed at any OpenAI-compatible chat
completions endpoint. Provider-neutral: flip LLM_BASE_URL / LLM_API_KEY(S)
/ LLM_MODEL to talk to Cerebras, MiniMax, OpenAI, Groq, Together, etc.

Design notes
------------
* A multi-key client POOL (`_get_clients()`) keeps one `OpenAI()` per API
  key (LLM_API_KEYS, comma-separated) for rate-limit headroom. Each call
  starts at a round-robin index; on a 429 the next key is tried immediately
  (no sleep). Falls back to the single LLM_API_KEY if no list is given.
  Timeouts come from settings; max_retries=0 because we own the retry loop.
* `_call_llm` is non-streaming with full-jitter retry + key rotation.
  Auth (401/403) and bad input (400/422) are FAIL-FAST. 429 rotates keys;
  408/409/5xx and transient connection/timeout back off with jitter.
* `_call_llm_stream` is the streaming primitive. Rotation/retry only before
  the first token; once a token is yielded an error ends the iterator (we
  never splice a second response onto a half-delivered stream).
* No prompt text or API key is ever written to logs.
"""

from __future__ import annotations

import itertools
import logging
import threading
import time
from random import uniform
from typing import Iterator, Optional

import httpx
import openai

from app.config import get_settings

logger = logging.getLogger(__name__)


# ─── Multi-key client pool ───────────────────────────────────────────

_pool_lock = threading.Lock()
_client_pool: list = []
_pool_cache_key: Optional[tuple] = None
_rr_counter = itertools.count()


def _resolve_keys(settings) -> list:
    """Parse LLM_API_KEYS (comma-separated); fall back to LLM_API_KEY."""
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
    global _client_pool, _pool_cache_key
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
            openai.OpenAI(
                api_key=k,
                base_url=settings.llm_base_url,
                timeout=timeout,
                # We own the retry/backoff/rotation loop.
                max_retries=0,
            )
            for k in keys
        ]
        _pool_cache_key = cache_key
        return _client_pool


# ─── Retry policy ────────────────────────────────────────────────────

# 429/408/409 are retryable; 400/401/403/422 fail fast; 5xx retryable.
_RETRYABLE_STATUS_CODES = frozenset({408, 409, 429})
_FAIL_FAST_STATUS_CODES = frozenset({400, 401, 403, 422})


def _is_retryable(exc: BaseException) -> bool:
    """True iff the exception is a transient LLM failure worth retrying."""
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
    """True for 429 / rate-limit / quota errors -> rotate to the next key."""
    status = getattr(exc, "status_code", None)
    if status == 429:
        return True
    msg = str(exc).lower()
    return any(m in msg for m in ("rate limit", "rate_limit", "resourceexhausted", "quota", "too many requests"))


def _full_jitter_sleep(attempt_index: int) -> None:
    """Sleep a uniformly random duration in [0, capped_exponential].

    Called from a worker thread (the graph runs `_call_llm` via
    `run_in_executor`), so a blocking `time.sleep` is fine.
    """
    settings = get_settings()
    cap = settings.llm_retry_cap_seconds
    base = settings.llm_retry_base_seconds
    upper = min(cap, base * (2 ** attempt_index))
    delay = uniform(0.0, upper)
    time.sleep(delay)


# ─── Non-streaming call ──────────────────────────────────────────────


def _llm_extra_body(settings) -> dict:
    """Provider/model-aware request extras.

    MiniMax M3 can DISABLE thinking -> .content is clean (no <think>), ideal
    for the JSON router/guardrail and direct synthesizer answers. MiniMax
    M2.x cannot disable thinking, so we split it into a separate field
    (reasoning_split) to keep .content clean. Other providers -> no extras.
    """
    if settings.llm_provider != "minimax":
        return {}
    if "M3" in (settings.llm_model or "").upper():
        return {"thinking": {"type": "disabled"}}
    return {"reasoning_split": True}


def _call_llm(system_prompt: str, user_prompt: str) -> str:
    """Call chat completions and return the assistant text.

    Multi-key pool: each call starts at a round-robin index; on a 429 the
    next key is tried immediately (no sleep); other transient errors back
    off with full jitter. Auth/validation errors fail fast. Bounded by
    retries + one full rotation over all keys.
    """
    settings = get_settings()
    clients = _get_clients(settings)
    n = len(clients)
    start = next(_rr_counter) % n
    extra = _llm_extra_body(settings)
    max_tries = settings.llm_max_retries + n

    last_error = None
    for i in range(max_tries):
        client = clients[(start + i) % n]
        try:
            response = client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=settings.llm_temperature,
                max_completion_tokens=settings.llm_max_completion_tokens,
                extra_body=extra,
            )
        except Exception as exc:  # noqa: BLE001 — classified + re-raised
            last_error = exc
            status = getattr(exc, "status_code", None)
            logger.warning(
                "LLM call failed (try %d/%d, key#%d, class=%s, status=%s)",
                i + 1, max_tries, (start + i) % n, type(exc).__name__, status,
            )
            if not _is_retryable(exc):
                raise
            if _is_rate_limited(exc):
                continue  # rotate to next key immediately
            if i + 1 >= max_tries:
                raise
            _full_jitter_sleep(i)
            continue

        content = None
        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, TypeError):
            content = None
        if not content or not content.strip():
            raise RuntimeError("LLM returned empty response")
        return content.strip()

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

    Multi-key pool with round-robin start; rotation/retry only BEFORE the
    first token (once tokens are yielded, an error ends the iterator — we
    never splice a second response onto a partial stream). 429 rotates to
    the next key immediately; other transient errors back off with jitter.
    Honors cancel_event between chunks.
    """
    settings = get_settings()
    clients = _get_clients(settings)
    n = len(clients)
    start = next(_rr_counter) % n
    extra = _llm_extra_body(settings)
    max_tries = settings.llm_max_retries + n
    yielded_any = False

    for i in range(max_tries):
        client = clients[(start + i) % n]
        try:
            stream = client.chat.completions.create(
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
            status = getattr(exc, "status_code", None)
            logger.warning(
                "LLM stream open failed (try %d/%d, key#%d, class=%s, status=%s)",
                i + 1, max_tries, (start + i) % n, type(exc).__name__, status,
            )
            if not _is_retryable(exc):
                raise
            if yielded_any or i + 1 >= max_tries:
                raise
            if _is_rate_limited(exc):
                continue  # next key (no sleep)
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
            return
        except Exception as exc:  # noqa: BLE001
            status = getattr(exc, "status_code", None)
            logger.warning(
                "LLM stream iteration failed (try %d/%d, key#%d, class=%s, status=%s, yielded=%s)",
                i + 1, max_tries, (start + i) % n, type(exc).__name__, status, yielded_any,
            )
            if not _is_retryable(exc):
                raise
            if yielded_any or i + 1 >= max_tries:
                raise
            if _is_rate_limited(exc):
                continue
            _full_jitter_sleep(i)
            continue
