"""
FinGuard AI — FastAPI Application
Routes: /health, /upload_pdf, /chat, /documents, /documents/{filename}, /documents/{filename}/file
"""

import os
import json
import logging
import asyncio
import threading
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Security, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import jwt
from typing import Literal, Any

from app.config import get_settings
from app.rag import (
    delete_document,
    get_runtime_optimization_status,
    ingest_pdf,
    list_documents,
)
from app.graph import run_graph, run_graph_stream
from app.runtime import (
    init_runtime,
    shutdown_executors,
    run_rag_blocking,
    get_chat_semaphore,
    warmup_rag_blocking,
)

# ─── Logging ─────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(name)-20s │ %(levelname)-7s │ %(message)s",
)
logger = logging.getLogger("finguard")


# ─── Lifespan ────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    os.makedirs(settings.upload_dir, exist_ok=True)
    os.makedirs(settings.chroma_persist_dir, exist_ok=True)
    os.makedirs(settings.embedding_cache_dir, exist_ok=True)
    os.makedirs(settings.reranker_cache_dir, exist_ok=True)
    logger.info("FinGuard AI Backend starting up...")
    logger.info(
        "  LLM: provider=%s model=%s base_url_host=%s",
        settings.llm_provider,
        settings.llm_model,
        settings.llm_base_url.split("//", 1)[-1].split("/", 1)[0],
    )
    logger.info(f"  ChromaDB: {settings.chroma_persist_dir}")
    logger.info(f"  Uploads: {settings.upload_dir}")
    logger.info(f"  Embedding Cache: {settings.embedding_cache_dir}")
    logger.info(f"  Reranker Cache: {settings.reranker_cache_dir}")
    # Initialise bounded executors + chat semaphore (loop-bound).
    init_runtime()
    get_chat_semaphore()  # bind to the running loop eagerly
    if settings.model_warmup_enabled:
        try:
            logger.info("Starting RAG warmup (embedding + reranker + BM25)...")
            status = await warmup_rag_blocking()
            logger.info(
                "Warmup complete in %.3fs | embedding=%s | reranker=%s | bm25_docs=%s",
                status.get("warmup_seconds", 0.0),
                status.get("embedding", {}).get("active_backend", "unknown"),
                status.get("reranker", {}).get("active_backend", "unknown"),
                status.get("bm25_documents", 0),
            )
        except Exception as e:
            logger.exception(f"Warmup failed: {e}")
    yield
    logger.info("FinGuard AI Backend shutting down.")
    shutdown_executors()


# ─── App ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="FinGuard AI",
    description="Multi-Agent RAG & Tool-Calling system for Banking, HR, and Turkish Labor Law compliance.",
    version="1.0.0",
    lifespan=lifespan,
)

# ─── CORS ────────────────────────────────────────────────────────────

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request/Response Models ────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    locale: Literal["tr", "en"] = "tr"


class ChatResponse(BaseModel):
    response: str
    agent_steps: list[dict]
    guardrail_passed: bool
    sources: list[dict]


class UploadResponse(BaseModel):
    filename: str
    pages: int
    chunks: int
    extraction_mode: str = "native"
    ocr_engine: str = ""
    status: str
    bm25_mode: str | None = None
    embedding_requests: int | None = None
    timings_ms: dict[str, float] | None = None


class DocumentInfo(BaseModel):
    filename: str
    pages: int
    chunks: int


class DeleteResponse(BaseModel):
    filename: str
    deleted_chunks: int
    status: str


# ─── Auth Middleware ───────────────────────────────────────────────────

security = HTTPBearer(auto_error=False)

def _decode_backend_token(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
) -> dict:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    settings = get_settings()
    try:
        return jwt.decode(
            credentials.credentials,
            settings.api_jwt_secret,
            algorithms=["HS256"],
            audience=settings.api_jwt_audience,
            issuer=settings.api_jwt_issuer,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def verify_jwt_token(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
):
    """
    Verifies the short-lived server-to-server JWT minted by the Next.js proxy.
    """
    payload = _decode_backend_token(credentials)
    if payload.get("sub") != "finguard-frontend":
        raise HTTPException(status_code=403, detail="Invalid token subject")
    return payload


async def verify_upload_token(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
):
    """
    Allows either the internal Next.js proxy token or a short-lived upload token.
    """
    payload = _decode_backend_token(credentials)
    subject = payload.get("sub")
    if subject == "finguard-frontend":
        return payload
    if subject == "finguard-upload" and payload.get("scope") == "upload":
        return payload
    raise HTTPException(status_code=403, detail="Invalid upload token")


def _sanitize_filename(filename: str) -> str:
    candidate = filename.strip()
    if not candidate:
        raise HTTPException(status_code=400, detail="Filename is required.")

    if any(separator in candidate for separator in ("/", "\\")):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    safe_filename = Path(candidate).name
    if safe_filename in {"", ".", ".."} or safe_filename != candidate:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    return safe_filename


async def _persist_upload_file(upload: UploadFile, destination: str, max_bytes: int) -> int:
    total_bytes = 0

    with open(destination, "wb") as output_file:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break

            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"Uploaded file exceeds the {max_bytes} byte limit.",
                )

            output_file.write(chunk)

    return total_bytes


# ─── Routes ──────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "finguard-ai"}


@app.get("/runtime_status")
async def runtime_status(user: dict = Depends(verify_jwt_token)):
    return get_runtime_optimization_status()


@app.post("/upload_pdf", response_model=UploadResponse)
async def upload_pdf(
    file: UploadFile = File(...),
    ocr_pages: str | None = Form(default=None),
    ocr_engine: str = Form(default=""),
    user: dict = Depends(verify_upload_token),
):
    """Upload and ingest a PDF document into the knowledge base."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    settings = get_settings()
    file_path = ""
    safe_filename = _sanitize_filename(file.filename)
    file_path = os.path.join(settings.upload_dir, safe_filename)
    request_started = asyncio.get_running_loop().time()

    try:
        file_size = await _persist_upload_file(
            file,
            file_path,
            settings.max_upload_bytes,
        )
        logger.info(f"Uploaded file saved: {file_path} ({file_size} bytes)")

        extracted_pages: list[dict] | None = None
        extraction_mode = "native"
        normalized_ocr_engine = ""

        if ocr_pages:
            try:
                parsed = json.loads(ocr_pages)
                if not isinstance(parsed, list):
                    raise ValueError("ocr_pages must be a JSON array.")

                extracted_pages = []
                for i, item in enumerate(parsed):
                    if not isinstance(item, dict):
                        continue
                    text = str(item.get("text", "")).strip()
                    if not text:
                        continue
                    page_raw = item.get("page", i + 1)
                    try:
                        page = max(1, int(page_raw))
                    except (TypeError, ValueError):
                        page = i + 1
                    extracted_pages.append({"page": page, "text": text})

                if not extracted_pages:
                    raise ValueError("ocr_pages contains no non-empty page text.")

                extraction_mode = "ocr"
                normalized_ocr_engine = ocr_engine.strip() or "unknown"
                logger.info(
                    "Received OCR payload for %s: %d pages (engine=%s)",
                    safe_filename,
                    len(extracted_pages),
                    normalized_ocr_engine,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid ocr_pages payload: {str(e)}")

        # Ingest into ChromaDB
        result = await run_rag_blocking(
            ingest_pdf,
            file_path,
            safe_filename,
            extracted_pages,
            extraction_mode,
            normalized_ocr_engine,
        )
        request_elapsed_ms = round((asyncio.get_running_loop().time() - request_started) * 1000, 1)
        timings_ms = dict(result.get("timings_ms") or {})
        timings_ms["request_total"] = request_elapsed_ms
        result["timings_ms"] = timings_ms
        logger.info(
            "Upload pipeline complete for %s in %.1fms (chunks=%s, bm25=%s)",
            safe_filename,
            request_elapsed_ms,
            result.get("chunks", 0),
            result.get("bm25_mode", "unknown"),
        )

        return UploadResponse(**result)

    except ValueError as e:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
        raise
    except Exception as e:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")
    finally:
        await file.close()


@app.get("/documents", response_model=list[DocumentInfo])
async def get_documents(user: dict = Depends(verify_jwt_token)):
    """List all ingested documents."""
    try:
        docs = await run_rag_blocking(list_documents)
        return [DocumentInfo(**d) for d in docs]
    except Exception as e:
        logger.error(f"List documents failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/documents/{filename}/file")
async def get_document_file(filename: str, user: dict = Depends(verify_jwt_token)):
    """Stream an uploaded PDF for inline viewing."""
    safe_filename = _sanitize_filename(filename)
    file_path = os.path.join(get_settings().upload_dir, safe_filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Document '{safe_filename}' not found.")

    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=safe_filename,
        content_disposition_type="inline",
    )


@app.delete("/documents/{filename}", response_model=DeleteResponse)
async def remove_document(filename: str, user: dict = Depends(verify_jwt_token)):
    """Delete a document from the knowledge base."""
    try:
        result = await run_rag_blocking(delete_document, filename)
        if result["status"] == "not_found":
            raise HTTPException(status_code=404, detail=f"Document '{filename}' not found.")
        return DeleteResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete document failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, user: dict = Depends(verify_jwt_token)):
    """
    Send a message to the multi-agent pipeline.
    Returns the final response with agent thinking steps and sources.
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    settings = get_settings()
    sem = get_chat_semaphore()
    try:
        try:
            await asyncio.wait_for(sem.acquire(), timeout=settings.chat_queue_timeout_seconds)
        except asyncio.TimeoutError:
            logger.warning(
                "Chat backpressure: 429 for session=%s (queue full)",
                request.session_id,
            )
            raise HTTPException(
                status_code=429,
                detail="Chat backend is at capacity. Please retry shortly.",
                headers={"Retry-After": str(max(1, int(settings.chat_queue_timeout_seconds)))},
            )

        try:
            logger.info(
                "Chat request: '%s...' (session: %s, locale: %s)",
                request.message[:80],
                request.session_id,
                request.locale,
            )

            final_state = await run_graph(request.message, request.locale)

            # Extract sources from RAG context
            sources = []
            for ctx in final_state.get("rag_context", []):
                sources.append({
                    "source": ctx.get("source", ""),
                    "page": ctx.get("page", 0),
                    "rerank_score": ctx.get("rerank_score", 0),
                })

            return ChatResponse(
                response=final_state.get("final_response", "An error occurred."),
                agent_steps=final_state.get("agent_steps", []),
                guardrail_passed=final_state.get("guardrail_passed", False),
                sources=sources,
            )
        finally:
            sem.release()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=f"Agent pipeline failed: {str(e)}")


# ─── SSE streaming ──────────────────────────────────────────────────
# A sentinel object that the executor side puts in the per-call queue to
# tell the generator "graph is done, drain and close". We use a unique
# object identity (not a dict) so a payload cannot collide.
_DONE_SENTINEL: Any = object()


def _build_sources(final_state: dict) -> list[dict]:
    sources: list[dict] = []
    for ctx in final_state.get("rag_context", []) or []:
        sources.append({
            "source": ctx.get("source", ""),
            "page": ctx.get("page", 0),
            "rerank_score": ctx.get("rerank_score", 0),
        })
    return sources


@app.post("/chat/stream")
async def chat_stream(
    request_body: ChatRequest,
    request: Request,
    user: dict = Depends(verify_jwt_token),
):
    """
    SSE streaming endpoint for the chat pipeline.

    Architecture:
      * The pipeline runs on the bounded `graph_executor` thread pool.
      * Node progress and token deltas are pushed to an asyncio.Queue
        from the executor thread via `asyncio.run_coroutine_threadsafe`;
        the `.result()` call backpressures the worker when the queue
        is full.
      * `request.is_disconnected()` is awaited between reads so a
        closed client is detected promptly and `cancel_event` flips.
      * The chat semaphore bounds concurrent SSE streams.
    """
    if not request_body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    settings = get_settings()

    async def event_generator():
        sem = get_chat_semaphore()
        acquired = False
        cancel = threading.Event()
        loop = asyncio.get_running_loop()

        try:
            try:
                await asyncio.wait_for(
                    sem.acquire(), timeout=settings.chat_queue_timeout_seconds
                )
                acquired = True
            except asyncio.TimeoutError:
                logger.warning(
                    "Stream backpressure: 429 for session=%s (queue full)",
                    request_body.session_id,
                )
                yield {
                    "event": "error",
                    "data": json.dumps({
                        "detail": "Chat backend is at capacity. Please retry shortly.",
                        "retry_after": max(1, int(settings.chat_queue_timeout_seconds)),
                    }),
                }
                return

            q: asyncio.Queue = asyncio.Queue(maxsize=settings.stream_queue_maxsize)

            def _emit(ev: dict) -> None:
                # Backpressure WITH an escape hatch: block the executor
                # thread while the queue has room, but NEVER hang forever.
                # If the consumer disconnected/stalled, `cancel` is set and
                # we raise so the worker escapes instead of deadlocking on a
                # full queue nobody is draining.
                if cancel.is_set():
                    raise RuntimeError("stream consumer gone")
                try:
                    cfs_fut = asyncio.run_coroutine_threadsafe(q.put(ev), loop)
                    cfs_fut.result(timeout=5.0)
                except (TimeoutError, asyncio.TimeoutError):
                    # Cancel the lingering put so it cannot enqueue a stale
                    # event after we've declared the consumer gone.
                    try:
                        cfs_fut.cancel()
                    except Exception:  # noqa: BLE001
                        pass
                    cancel.set()
                    raise RuntimeError("stream queue stall (consumer not draining)")
                except Exception:
                    cancel.set()
                    raise

            fut = asyncio.ensure_future(
                run_graph_stream(
                    request_body.message,
                    request_body.locale,
                    _emit,
                    cancel,
                )
            )

            # Sentinel the generator will see when the pipeline finishes.
            def _on_done(_):
                if cancel.is_set():
                    return
                cfs_fut = None
                try:
                    cfs_fut = asyncio.run_coroutine_threadsafe(
                        q.put(_DONE_SENTINEL), loop
                    )
                    cfs_fut.result(timeout=5.0)
                except Exception:  # noqa: BLE001
                    if cfs_fut is not None:
                        try:
                            cfs_fut.cancel()
                        except Exception:  # noqa: BLE001
                            pass

            fut.add_done_callback(_on_done)

            final_state: dict | None = None

            while True:
                # Detect client disconnect promptly.
                if await request.is_disconnected():
                    logger.info(
                        "SSE client disconnected; cancelling pipeline (session=%s)",
                        request_body.session_id,
                    )
                    cancel.set()
                    break

                # Wait for next event with a small idle window so we can
                # re-check the disconnect flag and the future.
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    # No event yet. If the future finished without
                    # producing a sentinel (rare race), exit the loop.
                    if fut.done():
                        break
                    continue

                if ev is _DONE_SENTINEL:
                    # Capture final state from the future for the
                    # authoritative 'response' event.
                    try:
                        final_state = fut.result()
                    except Exception as fut_exc:  # noqa: BLE001
                        logger.error(f"Pipeline future failed: {fut_exc}")
                        yield {
                            "event": "error",
                            "data": json.dumps({"detail": str(fut_exc)}),
                        }
                        return
                    break

                # Normal event passthrough.
                yield ev

            # ─── Final 'response' event (authoritative; after guardrail) ───
            if final_state is not None:
                yield {
                    "event": "response",
                    "data": json.dumps({
                        "response": final_state.get("final_response", ""),
                        "guardrail_passed": final_state.get("guardrail_passed", False),
                        "sources": _build_sources(final_state),
                    }),
                }
                yield {"event": "done", "data": "{}"}
            else:
                # Client disconnected before completion; close cleanly.
                yield {
                    "event": "error",
                    "data": json.dumps({"detail": "Client disconnected."}),
                }

        except asyncio.CancelledError:
            cancel.set()
            logger.info("SSE generator cancelled by server (session=%s)", request_body.session_id)
            raise
        except Exception as e:
            logger.error(f"Stream error: {e}")
            try:
                yield {
                    "event": "error",
                    "data": json.dumps({"detail": str(e)}),
                }
            except Exception:  # noqa: BLE001
                pass
        finally:
            cancel.set()
            if acquired:
                try:
                    sem.release()
                except Exception:  # noqa: BLE001
                    pass
            # Cancel the future defensively (in case the loop exited early).
            if 'fut' in locals() and not fut.done():
                fut.cancel()

    return EventSourceResponse(
        event_generator(),
        ping=15,
        send_timeout=30,
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
