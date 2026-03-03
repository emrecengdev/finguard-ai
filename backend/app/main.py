"""
FinGuard AI — FastAPI Application
Routes: /health, /upload_pdf, /chat, /documents, /documents/{filename}
"""

import os
import json
import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Query, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import jwt

from app.config import get_settings
from app.rag import (
    delete_document,
    get_runtime_optimization_status,
    ingest_pdf,
    list_documents,
    warmup_runtime,
)
from app.graph import run_graph

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
    logger.info(f"  Model: {settings.cerebras_model}")
    logger.info(f"  ChromaDB: {settings.chroma_persist_dir}")
    logger.info(f"  Uploads: {settings.upload_dir}")
    logger.info(f"  Embedding Cache: {settings.embedding_cache_dir}")
    logger.info(f"  Reranker Cache: {settings.reranker_cache_dir}")
    if settings.model_warmup_enabled:
        try:
            logger.info("Starting RAG warmup (embedding + reranker + BM25)...")
            status = await asyncio.to_thread(warmup_runtime)
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

async def verify_jwt_token(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
    token: str | None = Query(None)
):
    """
    Verifies JWT token. Acceptable via Authorization Bearer header OR ?token= query.
    EventSource (SSE) running in the browser only supports query parameters natively.
    """
    actual_token = token
    if credentials:
        actual_token = credentials.credentials
        
    if not actual_token:
        raise HTTPException(status_code=401, detail="Missing authentication token")
        
    settings = get_settings()
    try:
        payload = jwt.decode(actual_token, settings.api_jwt_secret, algorithms=["HS256"])
        if payload.get("sub") != "finguard-frontend":
            raise HTTPException(status_code=403, detail="Invalid token subject")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ─── Routes ──────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "finguard-ai"}


@app.get("/runtime_status")
async def runtime_status():
    return get_runtime_optimization_status()


@app.post("/upload_pdf", response_model=UploadResponse)
async def upload_pdf(
    file: UploadFile = File(...),
    ocr_pages: str | None = Form(default=None),
    ocr_engine: str = Form(default=""),
):
    """Upload and ingest a PDF document into the knowledge base."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    settings = get_settings()
    file_path = os.path.join(settings.upload_dir, file.filename)

    try:
        # Save the uploaded file
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        logger.info(f"Uploaded file saved: {file_path} ({len(content)} bytes)")

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
                    file.filename,
                    len(extracted_pages),
                    normalized_ocr_engine,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid ocr_pages payload: {str(e)}")

        # Ingest into ChromaDB
        result = await asyncio.to_thread(
            ingest_pdf,
            file_path,
            file.filename,
            extracted_pages,
            extraction_mode,
            normalized_ocr_engine,
        )

        return UploadResponse(**result)

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")


@app.get("/documents", response_model=list[DocumentInfo])
async def get_documents():
    """List all ingested documents."""
    try:
        docs = await asyncio.to_thread(list_documents)
        return [DocumentInfo(**d) for d in docs]
    except Exception as e:
        logger.error(f"List documents failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/documents/{filename}", response_model=DeleteResponse)
async def remove_document(filename: str):
    """Delete a document from the knowledge base."""
    try:
        result = await asyncio.to_thread(delete_document, filename)
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

    try:
        logger.info(f"Chat request: '{request.message[:80]}...' (session: {request.session_id})")

        final_state = await run_graph(request.message)

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

    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=f"Agent pipeline failed: {str(e)}")


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest, user: dict = Depends(verify_jwt_token)):
    """
    SSE streaming endpoint for the chat pipeline.
    Streams agent steps as they execute, then the final response.
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    async def event_generator():
        try:
            # We run the graph and then stream the steps
            # (True streaming would require a custom LangGraph callback handler)
            final_state = await run_graph(request.message)

            # Stream each agent step
            for step in final_state.get("agent_steps", []):
                yield {
                    "event": "agent_step",
                    "data": json.dumps(step),
                }
                await asyncio.sleep(0.1)  # Small delay for UI effect

            # Stream sources
            sources = []
            for ctx in final_state.get("rag_context", []):
                sources.append({
                    "source": ctx.get("source", ""),
                    "page": ctx.get("page", 0),
                    "rerank_score": ctx.get("rerank_score", 0),
                })

            # Final response
            yield {
                "event": "response",
                "data": json.dumps({
                    "response": final_state.get("final_response", ""),
                    "guardrail_passed": final_state.get("guardrail_passed", False),
                    "sources": sources,
                }),
            }

            yield {"event": "done", "data": "{}"}

        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield {
                "event": "error",
                "data": json.dumps({"detail": str(e)}),
            }

    return EventSourceResponse(event_generator())
