"""
FinGuard AI — Provider-neutral LLM layer.

Wraps the official `openai` SDK pointed at any OpenAI-compatible chat
completions endpoint. The default base URL targets MiniMax
(`https://api.minimax.io/v1`), but the layer is provider-neutral: flip
`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` and it talks to any other
compatible service (OpenAI, Groq, Together, llama.cpp, etc.) without
changing call sites.

Design notes
------------
* A single module-level `_get_llm_client()` keeps one `OpenAI()` instance
  per `(base_url, api_key)` pair so we don't pay reconnect / connection
  pool setup on every chat call. The pool/connect/read/write timeouts
  come from settings, with `max_retries=0` because we own the retry loop.
* `_call_llm` is a non-streaming, bounded call with full-jitter retry.
  Auth errors (401/403), bad input (400/422), and similar are FAIL-FAST
  because retrying them burns the read-timeout budget without any chance
  of success. 429/408/409/5xx and transient connection/timeout errors
  are RETRY-ABLE.
* `_call_llm_stream` is the streaming primitive. It is NOT yet wired into
  graph nodes (that's a separate task); graph.py still uses `_call_llm`.
  The retry contract differs: once any token has been yielded, an error
  terminates the iterator and the caller handles it — we never splice a
  second response onto a half-delivered one.
* No prompt text or API key is ever written to logs.
"""

from __future__ import annotations

import logging
import threading
import time
from random import uniform
from typing import Iterator, Optional

import httpx
import openai

from app.config import get_settings

logger = logging.getLogger(__name__)


# ─── Singleton client cache ──────────────────────────────────────────

_client_lock = threading.Lock()
_client_cache: dict[tuple[str, str], "openai.OpenAI"] = {}


def _get_llm_client() -> "openai.OpenAI":
    """Return a cached OpenAI-compatible client for the active settings.

    The cache key is `(base_url, api_key)` so a key rotation or provider
    switch produces a fresh client without leaking the old one.
    """
    settings = get_settings()

    if not settings.llm_api_key:
        # Never include the key (or any derivation of it) in the message.
        raise ValueError("LLM_API_KEY is not configured")

    key = (settings.llm_base_url, settings.llm_api_key)
    cached = _client_cache.get(key)
    if cached is not None:
        return cached

    with _client_lock:
        cached = _client_cache.get(key)
        if cached is not None:
            return cached

        timeout = httpx.Timeout(
            connect=settings.llm_connect_timeout_seconds,
            read=settings.llm_read_timeout_seconds,
            write=settings.llm_write_timeout_seconds,
            pool=settings.llm_pool_timeout_seconds,
        )
        client = openai.OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=timeout,
            # We own the retry/backoff loop, so disable the SDK's built-in retries.
            max_retries=0,
        )
        _client_cache[key] = client
        return client


# ─── Retry policy ────────────────────────────────────────────────────

# HTTP statuses that are worth retrying. Everything else (including 4xx
# auth/validation errors) is fail-fast because the request is malformed
# or unauthorized and a retry cannot fix that.
_RETRYABLE_STATUS_CODES = frozenset({408, 409, 429})
_FAIL_FAST_STATUS_CODES = frozenset({400, 401, 403, 422})


def _is_retryable(exc: BaseException) -> bool:
    """Return True iff the exception represents a transient LLM failure."""
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
        # 5xx and other unknown server errors are retryable.
        return status >= 500
    return False


def _full_jitter_sleep(attempt_index: int) -> None:
    """Sleep for a uniformly random duration in [0, capped_exponential].

    `attempt_index` is 0-based: 0 for the first retry, 1 for the second, ...
    This function is called from a worker thread (the graph runs
    `_call_llm` inside `asyncio.to_thread`), so a blocking `time.sleep`
    is fine and avoids re-implementing jitter with asyncio.
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

    MiniMax M3 can DISABLE thinking -> .content is clean (no <think>), which
    is ideal for the JSON router/guardrail and direct synthesizer answers.
    MiniMax M2.x cannot disable thinking, so we split it into a separate
    field (reasoning_split) to keep .content clean. Non-MiniMax -> no extras.
    """
    if settings.llm_provider != "minimax":
        return {}
    if "M3" in (settings.llm_model or "").upper():
        return {"thinking": {"type": "disabled"}}
    return {"reasoning_split": True}

def _call_llm(system_prompt: str, user_prompt: str) -> str:
    """Call the chat completions endpoint and return the assistant text.

    Bounded by `llm_read_timeout_seconds` per attempt and capped at
    `llm_max_retries` retries. Raises on auth/validation errors
    immediately and on unrecoverable failures after exhausting retries.
    """
    settings = get_settings()
    client = _get_llm_client()

    total_attempts = settings.llm_max_retries + 1
    last_error: Optional[BaseException] = None

    for attempt in range(total_attempts):
        try:
            response = client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=settings.llm_temperature,
                max_completion_tokens=settings.llm_max_completion_tokens,
                # Model-aware reasoning control: M3 disables thinking,
                # M2.x splits it out -> .content stays clean. See _llm_extra_body.
                extra_body=_llm_extra_body(settings),
            )
        except Exception as exc:  # noqa: BLE001 — we classify and re-raise
            last_error = exc
            status = getattr(exc, "status_code", None)
            logger.warning(
                "LLM call failed on attempt %d/%d (class=%s, status=%s)",
                attempt + 1,
                total_attempts,
                type(exc).__name__,
                status,
            )
            if not _is_retryable(exc):
                raise
            if attempt + 1 >= total_attempts:
                # Out of retries; surface the last failure.
                raise
            _full_jitter_sleep(attempt)
            continue

        # Successful response — extract text.
        content = None
        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, TypeError):
            content = None

        if content is None:
            # Defensive: some providers emit empty/None content under
            # safety filters. Don't retry silently; raise so the caller
            # (or the orchestrator's fallback path) can react.
            raise RuntimeError("LLM returned empty response")

        text = content.strip()
        if not text:
            raise RuntimeError("LLM returned empty response")

        return text

    # Loop completed without a return — should be unreachable because the
    # final retry either returns or raises, but stay defensive.
    if last_error is not None:
        raise last_error
    raise RuntimeError("LLM call failed without returning a response")


# ─── Streaming call (primitive; not yet wired into nodes) ────────────


def _call_llm_stream(
    system_prompt: str,
    user_prompt: str,
    *,
    cancel_event: Optional[threading.Event] = None,
) -> Iterator[str]:
    """Yield assistant tokens from the chat completions endpoint.

    Behaviour:
    * Same client/timeout/retry classification as `_call_llm`.
    * `stream=True` + `stream_options={'include_usage': True}`.
    * Honors `cancel_event` between chunks: if set, close the underlying
      stream and return cleanly without raising.
    * Retry policy: only retry if NO token has been yielded yet. Once a
      token has been emitted, an error ends the iterator (we don't splice
      a second response into a half-delivered stream — the caller decides
      whether to surface or discard the partial text).
    * Read timeout bounds the silence between chunks, not the whole call.
    """
    settings = get_settings()
    client = _get_llm_client()

    total_attempts = settings.llm_max_retries + 1
    yielded_any = False

    for attempt in range(total_attempts):
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
                extra_body=_llm_extra_body(settings),
            )
        except Exception as exc:  # noqa: BLE001
            status = getattr(exc, "status_code", None)
            logger.warning(
                "LLM stream open failed on attempt %d/%d (class=%s, status=%s)",
                attempt + 1,
                total_attempts,
                type(exc).__name__,
                status,
            )
            if not _is_retryable(exc):
                raise
            if yielded_any or attempt + 1 >= total_attempts:
                raise
            _full_jitter_sleep(attempt)
            continue

        # Stream is open; iterate chunks until exhausted or cancelled.
        try:
            for chunk in stream:
                if cancel_event is not None and cancel_event.is_set():
                    try:
                        stream.close()
                    except Exception:  # noqa: BLE001
                        pass
                    return

                # Skip chunks that carry no assistant delta (role-only or
                # usage-only chunks that arrive with stream_options).
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
                "LLM stream iteration failed on attempt %d/%d (class=%s, status=%s, yielded=%s)",
                attempt + 1,
                total_attempts,
                type(exc).__name__,
                status,
                yielded_any,
            )
            if not _is_retryable(exc):
                raise
            if yielded_any or attempt + 1 >= total_attempts:
                raise
            _full_jitter_sleep(attempt)
            continue