"""
FinGuard AI — Runtime executors and concurrency primitives.

Provides:
* `graph_executor` / `rag_executor` — bounded ThreadPoolExecutors sized from
  settings, used to offload blocking LangGraph and RAG work off the asyncio
  loop.
* `chat_semaphore` — bounded asyncio.Semaphore that limits in-flight chat
  requests; bound to the running loop during FastAPI lifespan startup.
* `init_runtime()` / `shutdown_executors()` — lifecycle hooks called from
  the FastAPI lifespan context.
* `run_graph_blocking()` / `submit_graph()` — async helpers that dispatch
  callable + args to `graph_executor`.
* `run_rag_blocking()` — async helper that dispatches callable + args to
  `rag_executor`.

The chat semaphore is loop-bound because `asyncio.Semaphore` is bound to
the loop on which it was created. We expose a `get_chat_semaphore()` accessor
that lazily creates it on first access from inside the event loop, which
keeps `import app.runtime` safe from non-loop contexts (tests, scripts).
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Awaitable, Callable, Optional

from app.config import get_settings

logger = logging.getLogger(__name__)


# ─── Executors ────────────────────────────────────────────────────────
# Module-level; re-initialised by `init_runtime()` at FastAPI startup so
# size knobs from settings are honoured on every boot.

graph_executor: Optional[ThreadPoolExecutor] = None
rag_executor: Optional[ThreadPoolExecutor] = None

# Loop-bound chat semaphore. Lazily created on first access from a running
# event loop. See `get_chat_semaphore()`.
_chat_semaphore: Optional[asyncio.Semaphore] = None
_chat_semaphore_loop: Optional[asyncio.AbstractEventLoop] = None


def init_runtime() -> None:
    """Create the bounded thread pools used to offload blocking work.

    Safe to call multiple times: existing executors are shutdown before
    being replaced. Idempotent under FastAPI lifespan startup.
    """
    global graph_executor, rag_executor

    settings = get_settings()

    if graph_executor is not None:
        graph_executor.shutdown(wait=False)
    graph_executor = ThreadPoolExecutor(
        max_workers=max(1, settings.graph_thread_workers),
        thread_name_prefix="graph-worker",
    )

    if rag_executor is not None:
        rag_executor.shutdown(wait=False)
    rag_executor = ThreadPoolExecutor(
        max_workers=max(1, settings.rag_thread_workers),
        thread_name_prefix="rag-worker",
    )

    logger.info(
        "Runtime executors ready: graph_workers=%d rag_workers=%d chat_concurrency=%d",
        settings.graph_thread_workers,
        settings.rag_thread_workers,
        settings.chat_max_concurrency,
    )


def shutdown_executors() -> None:
    """Shutdown both executors. Called from FastAPI lifespan teardown."""
    global graph_executor, rag_executor

    if graph_executor is not None:
        graph_executor.shutdown(wait=True)
        graph_executor = None
    if rag_executor is not None:
        rag_executor.shutdown(wait=True)
        rag_executor = None
    logger.info("Runtime executors shut down.")


# ─── Chat semaphore ───────────────────────────────────────────────────


def get_chat_semaphore() -> asyncio.Semaphore:
    """Return the chat semaphore, creating it on first call from a loop.

    The semaphore is bound to the currently running event loop. If a request
    arrives on a different loop (e.g. tests) we rebuild it transparently.
    """
    global _chat_semaphore, _chat_semaphore_loop

    loop = asyncio.get_event_loop()
    if _chat_semaphore is None or _chat_semaphore_loop is not loop:
        settings = get_settings()
        _chat_semaphore = asyncio.Semaphore(max(1, settings.chat_max_concurrency))
        _chat_semaphore_loop = loop
    return _chat_semaphore


def reset_chat_semaphore() -> None:
    """Drop the current semaphore. Mainly for tests / forced refresh."""
    global _chat_semaphore, _chat_semaphore_loop
    _chat_semaphore = None
    _chat_semaphore_loop = None


# ─── Async dispatch helpers ──────────────────────────────────────────


async def run_graph_blocking(
    func: Callable[..., Any], *args: Any
) -> Any:
    """Run a synchronous callable on `graph_executor` and await the result."""
    if graph_executor is None:
        # Defensive: if lifespan was skipped (e.g. unit tests), create a
        # default executor so callers don't deadlock.
        init_runtime()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(graph_executor, func, *args)


def submit_graph(
    func: Callable[..., Any], *args: Any
) -> Awaitable[Any]:
    """Schedule a graph callable on `graph_executor`; return an awaitable.

    Equivalent to `run_graph_blocking` but returns the future directly so
    callers can hold a reference for cancellation.
    """
    if graph_executor is None:
        init_runtime()
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(graph_executor, func, *args)


async def run_rag_blocking(
    func: Callable[..., Any], *args: Any
) -> Any:
    """Run a synchronous callable on `rag_executor` and await the result."""
    if rag_executor is None:
        init_runtime()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(rag_executor, func, *args)


async def warmup_rag_blocking() -> Any:
    """Warm up embedding/reranker/BM25 inside the rag executor."""
    # Imported lazily to avoid a circular import (rag imports config; runtime
    # imports config; warmup_runtime lives in rag).
    from app.rag import warmup_runtime

    return await run_rag_blocking(warmup_runtime)
