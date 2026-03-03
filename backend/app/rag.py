"""
FinGuard AI — RAG Pipeline v2
Article-aware chunking, metadata filtering, multilingual embeddings,
multilingual cross-encoder reranking, BM25 hybrid search.
"""

from __future__ import annotations

import os
import re
import uuid
import math
import time
import logging
from typing import Any, Optional
from pathlib import Path
from collections import Counter

import chromadb
from chromadb.utils import embedding_functions
from huggingface_hub import snapshot_download
from sentence_transformers import (
    CrossEncoder,
    SentenceTransformer,
    export_dynamic_quantized_onnx_model,
)
from pypdf import PdfReader

from app.config import get_settings

logger = logging.getLogger(__name__)

# ─── Globals (initialized lazily) ────────────────────────────────────

_chroma_client: Optional[chromadb.PersistentClient] = None
_collection: Optional[chromadb.Collection] = None
_reranker: Optional[CrossEncoder] = None
_embedding_fn: Optional[Any] = None
_embedding_runtime: dict[str, Any] = {}
_reranker_runtime: dict[str, Any] = {}

# BM25 in-memory index (rebuilt on startup / after ingestion)
_bm25_corpus: list[dict] = []  # [{"id": ..., "text": ..., "source": ..., "page": ...}]
_bm25_idf: dict[str, float] = {}
_bm25_k1 = 1.5
_bm25_b = 0.75
_bm25_avgdl = 0.0
_VALID_EMBEDDING_BACKENDS = {"torch", "onnx", "onnx-int8"}
_VALID_RERANKER_BACKENDS = {"torch", "onnx", "onnx-int8"}
_VALID_QUANT_CONFIGS = {"arm64", "avx2", "avx512", "avx512_vnni"}


def _validate_backend(raw_backend: str, valid_backends: set[str], fallback: str, label: str) -> str:
    backend = raw_backend.lower().strip()
    if backend not in valid_backends:
        logger.warning(
            f"Unknown {label} backend '{raw_backend}'. Falling back to '{fallback}'."
        )
        return fallback
    return backend


def _validate_quantization(raw_quant: str) -> str:
    quant = raw_quant.lower().strip()
    if quant not in _VALID_QUANT_CONFIGS:
        logger.warning(
            f"Unknown quantization config '{raw_quant}'. Falling back to 'avx2'."
        )
        return "avx2"
    return quant


def _prepare_local_model_dir(model_name: str, cache_root: str, label: str) -> Path:
    """
    Ensure model files exist under a stable local path.
    This avoids repeated downloads and lets us persist quantized ONNX files.
    """
    safe_name = model_name.replace("/", "__")
    model_dir = Path(cache_root) / safe_name
    model_dir.mkdir(parents=True, exist_ok=True)

    config_file = model_dir / "config.json"
    if not config_file.exists():
        logger.info(f"Downloading {label} snapshot: {model_name} -> {model_dir}")
        snapshot_download(repo_id=model_name, local_dir=str(model_dir))
    return model_dir


def _find_quantized_onnx_file(
    model_dir: Path, quant_config: str, allow_fallback: bool = True
) -> Optional[str]:
    """Return ONNX relative file_name if a quantized model file is present."""
    onnx_dir = model_dir / "onnx"
    preferred_names = [
        f"model_qint8_{quant_config}.onnx",
        f"model_quint8_{quant_config}.onnx",
    ]
    for preferred_name in preferred_names:
        preferred = onnx_dir / preferred_name
        if preferred.exists():
            return f"onnx/{preferred.name}"

    if allow_fallback and onnx_dir.exists():
        candidates = sorted(
            list(onnx_dir.glob("*qint8*.onnx")) + list(onnx_dir.glob("*quint8*.onnx"))
        )
        if len(candidates) > 0:
            return f"onnx/{candidates[0].name}"
    return None


def _find_fp32_onnx_file(model_dir: Path) -> Optional[str]:
    """Return ONNX relative file_name for a non-quantized ONNX model."""
    onnx_dir = model_dir / "onnx"
    default_model = onnx_dir / "model.onnx"
    if default_model.exists():
        return f"onnx/{default_model.name}"

    if onnx_dir.exists():
        candidates: list[Path] = []
        for candidate in sorted(onnx_dir.glob("*.onnx")):
            name = candidate.name.lower()
            if "qint8" in name or "quint8" in name:
                continue
            candidates.append(candidate)
        if len(candidates) > 0:
            return f"onnx/{candidates[0].name}"
    return None


def _get_embedding_fn() -> Any:
    global _embedding_fn, _embedding_runtime
    if _embedding_fn is not None:
        return _embedding_fn

    settings = get_settings()
    backend = _validate_backend(
        raw_backend=settings.embedding_backend,
        valid_backends=_VALID_EMBEDDING_BACKENDS,
        fallback="torch",
        label="embedding",
    )
    quant_config = _validate_quantization(settings.embedding_quantization)
    model_name = settings.embedding_model
    model_dir = _prepare_local_model_dir(
        model_name=model_name,
        cache_root=settings.embedding_cache_dir,
        label="embedding",
    )

    selected_backend = backend
    selected_onnx_file = ""
    embedding_kwargs = {
        "model_name": str(model_dir),
        "device": "cpu",
        "normalize_embeddings": settings.embedding_normalize,
        "trust_remote_code": settings.embedding_trust_remote_code,
    }
    logger.info(f"Loading embedding model: {model_name} (backend={backend})")

    if backend == "torch":
        _embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(**embedding_kwargs)
    else:
        fp32_file = _find_fp32_onnx_file(model_dir)
        if fp32_file is None:
            logger.warning(
                "No ONNX embedding file found under local model dir. Falling back to torch backend."
            )
            selected_backend = "torch"
            _embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(**embedding_kwargs)
        else:
            onnx_file = fp32_file
            if backend == "onnx-int8":
                quantized_file = _find_quantized_onnx_file(
                    model_dir, quant_config, allow_fallback=False
                )
                if quantized_file is None:
                    try:
                        logger.info(
                            "Embedding INT8 file not found. Exporting dynamic quantized ONNX "
                            f"(config={quant_config})..."
                        )
                        onnx_model = SentenceTransformer(
                            str(model_dir),
                            backend="onnx",
                            trust_remote_code=settings.embedding_trust_remote_code,
                            model_kwargs={"file_name": fp32_file},
                        )
                        export_dynamic_quantized_onnx_model(
                            model=onnx_model,
                            quantization_config=quant_config,
                            model_name_or_path=str(model_dir),
                            push_to_hub=False,
                            file_suffix=f"qint8_{quant_config}",
                        )
                        quantized_file = _find_quantized_onnx_file(
                            model_dir, quant_config, allow_fallback=False
                        )
                    except Exception as e:
                        logger.warning(
                            "Embedding INT8 quantization failed. Falling back to ONNX FP32. Error: %s",
                            str(e),
                        )
                if quantized_file is None:
                    quantized_file = _find_quantized_onnx_file(
                        model_dir, quant_config, allow_fallback=True
                    )
                if quantized_file:
                    onnx_file = quantized_file
                    if quant_config not in quantized_file:
                        logger.warning(
                            "Embedding INT8 exact quantization '%s' unavailable; using '%s' fallback.",
                            quant_config,
                            quantized_file,
                        )
                else:
                    selected_backend = "onnx"

            selected_onnx_file = onnx_file
            try:
                _embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
                    **embedding_kwargs,
                    backend="onnx",
                    model_kwargs={"file_name": onnx_file},
                )
            except Exception as e:
                logger.warning(
                    "Embedding ONNX load failed, falling back to torch backend. Error: %s",
                    str(e),
                )
                selected_backend = "torch"
                selected_onnx_file = ""
                _embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(**embedding_kwargs)

    _embedding_runtime = {
        "model": model_name,
        "requested_backend": backend,
        "active_backend": selected_backend,
        "quantization": quant_config if "int8" in backend else "",
        "onnx_file": selected_onnx_file,
        "cache_dir": str(model_dir),
    }
    logger.info(
        "Embedding runtime: requested=%s active=%s onnx=%s",
        _embedding_runtime["requested_backend"],
        _embedding_runtime["active_backend"],
        _embedding_runtime["onnx_file"] or "none",
    )
    return _embedding_fn


def _get_collection() -> chromadb.Collection:
    global _chroma_client, _collection
    if _collection is None:
        settings = get_settings()
        os.makedirs(settings.chroma_persist_dir, exist_ok=True)
        logger.info(f"Initializing ChromaDB at: {settings.chroma_persist_dir}")
        _chroma_client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
        _collection = _chroma_client.get_or_create_collection(
            name="finguard_documents",
            embedding_function=_get_embedding_fn(),
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def _get_reranker() -> CrossEncoder:
    global _reranker, _reranker_runtime
    if _reranker is not None:
        return _reranker

    settings = get_settings()
    backend = _validate_backend(
        raw_backend=settings.reranker_backend,
        valid_backends=_VALID_RERANKER_BACKENDS,
        fallback="torch",
        label="reranker",
    )
    quant_config = _validate_quantization(settings.reranker_quantization)
    model_name = settings.reranker_model
    model_dir = _prepare_local_model_dir(
        model_name=model_name,
        cache_root=settings.reranker_cache_dir,
        label="reranker",
    )

    selected_backend = backend
    selected_onnx_file = ""
    logger.info(f"Loading reranker model: {model_name} (backend={backend})")

    if backend == "torch":
        _reranker = CrossEncoder(
            str(model_dir),
            max_length=settings.reranker_max_length,
            trust_remote_code=settings.reranker_trust_remote_code,
        )
    else:
        fp32_file = _find_fp32_onnx_file(model_dir)
        if fp32_file is None:
            logger.warning(
                "No ONNX reranker file found under local model dir. Falling back to torch backend."
            )
            selected_backend = "torch"
            _reranker = CrossEncoder(
                str(model_dir),
                max_length=settings.reranker_max_length,
                trust_remote_code=settings.reranker_trust_remote_code,
            )
        else:
            onnx_file = fp32_file
            if backend == "onnx-int8":
                quantized_file = _find_quantized_onnx_file(
                    model_dir, quant_config, allow_fallback=False
                )
                if quantized_file is None:
                    try:
                        logger.info(
                            "Reranker INT8 file not found. Exporting dynamic quantized ONNX "
                            f"(config={quant_config})..."
                        )
                        onnx_model = CrossEncoder(
                            str(model_dir),
                            backend="onnx",
                            max_length=settings.reranker_max_length,
                            trust_remote_code=settings.reranker_trust_remote_code,
                            model_kwargs={"file_name": fp32_file},
                        )
                        export_dynamic_quantized_onnx_model(
                            model=onnx_model,
                            quantization_config=quant_config,
                            model_name_or_path=str(model_dir),
                            push_to_hub=False,
                            file_suffix=f"qint8_{quant_config}",
                        )
                        quantized_file = _find_quantized_onnx_file(
                            model_dir, quant_config, allow_fallback=False
                        )
                    except Exception as e:
                        logger.warning(
                            "Reranker INT8 quantization failed. Falling back to ONNX FP32. Error: %s",
                            str(e),
                        )
                if quantized_file is None:
                    quantized_file = _find_quantized_onnx_file(
                        model_dir, quant_config, allow_fallback=True
                    )
                if quantized_file:
                    onnx_file = quantized_file
                    if quant_config not in quantized_file:
                        logger.warning(
                            "Reranker INT8 exact quantization '%s' unavailable; using '%s' fallback.",
                            quant_config,
                            quantized_file,
                        )
                else:
                    selected_backend = "onnx"

            selected_onnx_file = onnx_file
            try:
                _reranker = CrossEncoder(
                    str(model_dir),
                    backend="onnx",
                    max_length=settings.reranker_max_length,
                    trust_remote_code=settings.reranker_trust_remote_code,
                    model_kwargs={"file_name": onnx_file},
                )
            except Exception as e:
                logger.warning(
                    "Reranker ONNX load failed, falling back to torch backend. Error: %s",
                    str(e),
                )
                selected_backend = "torch"
                selected_onnx_file = ""
                _reranker = CrossEncoder(
                    str(model_dir),
                    max_length=settings.reranker_max_length,
                    trust_remote_code=settings.reranker_trust_remote_code,
                )

    _reranker_runtime = {
        "model": model_name,
        "requested_backend": backend,
        "active_backend": selected_backend,
        "quantization": quant_config if "int8" in backend else "",
        "onnx_file": selected_onnx_file,
        "cache_dir": str(model_dir),
    }
    logger.info(
        "Reranker runtime: requested=%s active=%s onnx=%s",
        _reranker_runtime["requested_backend"],
        _reranker_runtime["active_backend"],
        _reranker_runtime["onnx_file"] or "none",
    )
    return _reranker


# ─── BM25 Utilities ──────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    """Simple whitespace + lowercase tokenization for Turkish text."""
    text = re.sub(r"[^\w\sçğıöşüÇĞİÖŞÜ]", " ", text.lower())
    return [t for t in text.split() if len(t) > 1]


def _build_bm25_index():
    """Rebuild BM25 IDF from ChromaDB collection."""
    global _bm25_corpus, _bm25_idf, _bm25_avgdl

    collection = _get_collection()
    if collection.count() == 0:
        _bm25_corpus = []
        _bm25_idf = {}
        _bm25_avgdl = 0.0
        return

    all_data = collection.get(include=["documents", "metadatas"])
    _bm25_corpus = []
    doc_freqs: Counter = Counter()
    total_len = 0

    for i, (doc_text, meta) in enumerate(zip(all_data["documents"], all_data["metadatas"])):
        tokens = _tokenize(doc_text)
        _bm25_corpus.append({
            "id": all_data["ids"][i],
            "text": doc_text,
            "tokens": tokens,
            "source": meta.get("source", "unknown"),
            "page": meta.get("page", 0),
            "article": meta.get("article", ""),
        })
        unique_tokens = set(tokens)
        for t in unique_tokens:
            doc_freqs[t] += 1
        total_len += len(tokens)

    n = len(_bm25_corpus)
    _bm25_avgdl = total_len / n if n > 0 else 1.0

    # IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    _bm25_idf = {}
    for term, df in doc_freqs.items():
        _bm25_idf[term] = math.log((n - df + 0.5) / (df + 0.5) + 1.0)

    logger.info(f"BM25 index built: {n} documents, {len(_bm25_idf)} unique terms")


def _bm25_search(query: str, top_k: int = 25, source_filter: Optional[str] = None) -> list[dict]:
    """BM25 keyword search on in-memory corpus."""
    if not _bm25_corpus:
        return []

    query_tokens = _tokenize(query)
    scores = []

    for doc in _bm25_corpus:
        if source_filter and doc["source"] != source_filter:
            continue

        dl = len(doc["tokens"])
        tf_map: Counter = Counter(doc["tokens"])
        score = 0.0

        for qt in query_tokens:
            if qt not in _bm25_idf:
                continue
            tf = tf_map.get(qt, 0)
            idf = _bm25_idf[qt]
            numerator = tf * (_bm25_k1 + 1)
            denominator = tf + _bm25_k1 * (1 - _bm25_b + _bm25_b * dl / _bm25_avgdl)
            score += idf * (numerator / denominator)

        if score > 0:
            scores.append({
                "content": doc["text"],
                "source": doc["source"],
                "page": doc["page"],
                "article": doc.get("article", ""),
                "bm25_score": round(score, 4),
            })

    scores.sort(key=lambda x: x["bm25_score"], reverse=True)
    return scores[:top_k]


# ─── Article-Aware Chunking ──────────────────────────────────────────

_ARTICLE_PATTERN = re.compile(
    r"(?:^|\n)"
    r"(?:MADDE|Madde|madde)\s*(\d+[\s/]*(?:[A-Za-zÇĞİÖŞÜçğıöşü]*)?)\s*[-–—]",
    re.MULTILINE,
)


def _chunk_by_articles(text: str, max_chunk_size: int = 1200) -> list[dict]:
    """
    Split legal text by article (MADDE) boundaries.
    Falls back to fixed-size chunking for non-article text.
    Returns: [{"text": ..., "article": "MADDE 25"}, ...]
    """
    matches = list(_ARTICLE_PATTERN.finditer(text))

    if not matches:
        # No articles found — fallback to sentence-aware fixed chunking
        return _chunk_text_smart(text, max_chunk_size)

    chunks = []

    # Text before first article
    pre_text = text[:matches[0].start()].strip()
    if pre_text and len(pre_text) > 50:
        for sub in _chunk_text_smart(pre_text, max_chunk_size):
            sub["article"] = "Giriş"
            chunks.append(sub)

    # Each article
    for i, match in enumerate(matches):
        article_num = match.group(1).strip()
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        article_text = text[start:end].strip()

        if len(article_text) <= max_chunk_size:
            chunks.append({
                "text": article_text,
                "article": f"MADDE {article_num}",
            })
        else:
            # Large article — split into paragraphs/sentences
            for sub in _chunk_text_smart(article_text, max_chunk_size):
                sub["article"] = f"MADDE {article_num}"
                chunks.append(sub)

    return chunks


def _chunk_text_smart(text: str, max_chunk_size: int = 1200) -> list[dict]:
    """
    Sentence-aware chunking with overlap.
    Prefers breaking at paragraph or sentence boundaries.
    """
    chunks = []
    # Split by double newline (paragraph) first
    paragraphs = re.split(r"\n{2,}", text)

    current_chunk = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current_chunk) + len(para) + 2 <= max_chunk_size:
            current_chunk = f"{current_chunk}\n\n{para}" if current_chunk else para
        else:
            if current_chunk:
                chunks.append({"text": current_chunk.strip(), "article": ""})
            # If single paragraph is too large, split by sentences
            if len(para) > max_chunk_size:
                sentences = re.split(r"(?<=[.!?;])\s+", para)
                sub_chunk = ""
                for sent in sentences:
                    if len(sub_chunk) + len(sent) + 1 <= max_chunk_size:
                        sub_chunk = f"{sub_chunk} {sent}" if sub_chunk else sent
                    else:
                        if sub_chunk:
                            chunks.append({"text": sub_chunk.strip(), "article": ""})
                        sub_chunk = sent
                if sub_chunk:
                    chunks.append({"text": sub_chunk.strip(), "article": ""})
                current_chunk = ""
            else:
                current_chunk = para

    if current_chunk.strip():
        chunks.append({"text": current_chunk.strip(), "article": ""})

    return chunks


# ─── PDF Extraction ──────────────────────────────────────────────────

def extract_pdf_text(file_path: str) -> list[dict]:
    """
    Extract text from PDF, returning per-page data.
    Returns: [{"page": 1, "text": "..."}, ...]
    """
    reader = PdfReader(file_path)
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text and text.strip():
            pages.append({"page": i + 1, "text": text.strip()})
    return pages


def _normalize_extracted_pages(pages: list[dict] | None) -> list[dict]:
    """
    Normalize externally provided per-page OCR text payloads.
    Returns: [{"page": 1, "text": "..."}, ...] with non-empty text only.
    """
    if not pages:
        return []

    normalized: list[dict] = []
    for i, item in enumerate(pages):
        if not isinstance(item, dict):
            continue

        raw_text = item.get("text", "")
        text = str(raw_text).strip() if raw_text is not None else ""
        if not text:
            continue

        raw_page = item.get("page", i + 1)
        try:
            page_num = int(raw_page)
        except (TypeError, ValueError):
            page_num = i + 1
        if page_num < 1:
            page_num = i + 1

        normalized.append({"page": page_num, "text": text})

    normalized.sort(key=lambda p: p["page"])
    return normalized


# ─── Ingest Pipeline ────────────────────────────────────────────────

def ingest_pdf(
    file_path: str,
    filename: str,
    extracted_pages: list[dict] | None = None,
    extraction_mode: str = "native",
    ocr_engine: str = "",
) -> dict:
    """
    Full ingest pipeline with article-aware chunking:
    1. Extract text from PDF pages.
    2. Concatenate full text, then chunk by MADDE boundaries.
    3. Embed and upsert into ChromaDB with rich metadata.
    4. Rebuild BM25 index.
    """
    settings = get_settings()
    collection = _get_collection()

    normalized_external_pages = _normalize_extracted_pages(extracted_pages)
    if normalized_external_pages:
        pages = normalized_external_pages
        extraction_mode = extraction_mode or "ocr"
    else:
        pages = extract_pdf_text(file_path)
        extraction_mode = "native"
        ocr_engine = ""

    if not pages:
        raise ValueError(f"No extractable text found in {filename}")

    # Build full text with page markers for metadata mapping
    page_boundaries = []  # [(start_char, end_char, page_num)]
    full_text = ""
    for p in pages:
        start = len(full_text)
        full_text += p["text"] + "\n\n"
        end = len(full_text)
        page_boundaries.append((start, end, p["page"]))

    # Article-aware chunking on full text
    article_chunks = _chunk_by_articles(full_text, max_chunk_size=settings.chunk_size)

    if not article_chunks:
        raise ValueError(f"No chunks generated from {filename}")

    all_chunks: list[str] = []
    all_metadatas: list[dict] = []
    all_ids: list[str] = []

    for j, chunk_data in enumerate(article_chunks):
        chunk_text = chunk_data["text"]
        article = chunk_data.get("article", "")

        # Find which page this chunk belongs to (by char position in full_text)
        chunk_start = full_text.find(chunk_text[:80])  # first 80 chars
        page_num = 1
        if chunk_start >= 0:
            for (pb_start, pb_end, pn) in page_boundaries:
                if pb_start <= chunk_start < pb_end:
                    page_num = pn
                    break

        chunk_id = f"{filename}::art{article}::c{j}::{uuid.uuid4().hex[:8]}"
        all_chunks.append(chunk_text)
        all_metadatas.append({
            "source": filename,
            "page": page_num,
            "chunk_index": j,
            "article": article,
            "extraction_mode": extraction_mode,
            "ocr_engine": ocr_engine,
        })
        all_ids.append(chunk_id)

    # Batch upsert
    batch_size = 100
    for i in range(0, len(all_chunks), batch_size):
        collection.upsert(
            ids=all_ids[i:i + batch_size],
            documents=all_chunks[i:i + batch_size],
            metadatas=all_metadatas[i:i + batch_size],
        )

    # Rebuild BM25 index
    _build_bm25_index()

    logger.info(
        f"Ingested {len(all_chunks)} chunks from '{filename}' "
        f"({len(pages)} pages, {sum(1 for c in article_chunks if c.get('article'))} articles, "
        f"mode={extraction_mode}{f', ocr={ocr_engine}' if ocr_engine else ''})"
    )

    return {
        "filename": filename,
        "pages": len(pages),
        "chunks": len(all_chunks),
        "articles": sum(1 for c in article_chunks if c.get("article")),
        "extraction_mode": extraction_mode,
        "ocr_engine": ocr_engine,
        "status": "success",
    }


# ─── Hybrid Retrieval (Vector + BM25 + Reranking) ───────────────────

def retrieve(
    query: str,
    top_k: Optional[int] = None,
    top_n: Optional[int] = None,
    source_filter: Optional[str] = None,
) -> list[dict]:
    """
    Hybrid RAG retrieval pipeline:
    1. Vector search via ChromaDB (semantic).
    2. BM25 keyword search (lexical).
    3. Reciprocal Rank Fusion (RRF) to merge results.
    4. Cross-encoder reranking on merged candidates.
    5. Return top_n most relevant results.
    """
    settings = get_settings()
    top_k = top_k or settings.rag_top_k
    top_n = top_n or settings.rag_rerank_top_n

    collection = _get_collection()
    reranker = _get_reranker()

    # ── Step 1: Vector search ──
    query_kwargs: dict = {
        "query_texts": [query],
        "n_results": min(top_k, collection.count()) if collection.count() > 0 else top_k,
        "include": ["documents", "metadatas", "distances"],
    }
    if source_filter:
        query_kwargs["where"] = {"source": source_filter}

    vector_results = collection.query(**query_kwargs)

    vector_hits: list[dict] = []
    if vector_results["documents"] and vector_results["documents"][0]:
        for doc, meta, dist in zip(
            vector_results["documents"][0],
            vector_results["metadatas"][0],
            vector_results["distances"][0],
        ):
            vector_hits.append({
                "content": doc,
                "source": meta.get("source", "unknown"),
                "page": meta.get("page", 0),
                "article": meta.get("article", ""),
                "vector_distance": round(float(dist), 4),
            })

    # ── Step 2: BM25 search ──
    if not _bm25_corpus:
        _build_bm25_index()

    bm25_hits = _bm25_search(query, top_k=top_k, source_filter=source_filter)

    # ── Step 3: Reciprocal Rank Fusion ──
    rrf_k = 60  # RRF constant
    content_scores: dict[str, dict] = {}

    for rank, hit in enumerate(vector_hits):
        key = hit["content"][:100]  # Use first 100 chars as dedup key
        if key not in content_scores:
            content_scores[key] = {**hit, "rrf_score": 0.0}
        content_scores[key]["rrf_score"] += 1.0 / (rrf_k + rank + 1)

    for rank, hit in enumerate(bm25_hits):
        key = hit["content"][:100]
        if key not in content_scores:
            content_scores[key] = {
                "content": hit["content"],
                "source": hit["source"],
                "page": hit["page"],
                "article": hit.get("article", ""),
                "vector_distance": 1.0,
                "rrf_score": 0.0,
            }
        content_scores[key]["rrf_score"] += 1.0 / (rrf_k + rank + 1)

    # Sort by RRF score, take top candidates for reranking
    merged = sorted(content_scores.values(), key=lambda x: x["rrf_score"], reverse=True)
    candidates = merged[:top_k]

    if not candidates:
        return []

    # ── Step 4: Cross-encoder reranking ──
    query_doc_pairs = [[query, c["content"]] for c in candidates]
    rerank_scores = reranker.predict(query_doc_pairs)

    scored_results = []
    for i, candidate in enumerate(candidates):
        scored_results.append({
            "content": candidate["content"],
            "source": candidate["source"],
            "page": candidate["page"],
            "article": candidate.get("article", ""),
            "vector_distance": candidate.get("vector_distance", 1.0),
            "rerank_score": round(float(rerank_scores[i]), 4),
            "rrf_score": round(candidate["rrf_score"], 4),
        })

    scored_results.sort(key=lambda x: x["rerank_score"], reverse=True)
    return scored_results[:top_n]


# ─── Document Management ────────────────────────────────────────────

def list_documents() -> list[dict]:
    """List all uploaded documents based on ChromaDB metadata."""
    collection = _get_collection()
    if collection.count() == 0:
        return []

    all_data = collection.get(include=["metadatas"])
    sources: dict[str, dict] = {}

    for meta in all_data["metadatas"]:
        source = meta.get("source", "unknown")
        if source not in sources:
            sources[source] = {"filename": source, "pages": set(), "chunks": 0, "articles": set()}
        sources[source]["pages"].add(meta.get("page", 0))
        sources[source]["chunks"] += 1
        article = meta.get("article", "")
        if article:
            sources[source]["articles"].add(article)

    return [
        {
            "filename": info["filename"],
            "pages": len(info["pages"]),
            "chunks": info["chunks"],
            "articles": len(info["articles"]),
        }
        for info in sources.values()
    ]


def delete_document(filename: str) -> dict:
    """Delete all chunks belonging to a specific document and rebuild BM25."""
    collection = _get_collection()

    all_data = collection.get(include=["metadatas"])
    ids_to_delete = []

    for i, meta in enumerate(all_data["metadatas"]):
        if meta.get("source") == filename:
            ids_to_delete.append(all_data["ids"][i])

    if ids_to_delete:
        collection.delete(ids=ids_to_delete)
        _build_bm25_index()  # Rebuild after deletion

    return {
        "filename": filename,
        "deleted_chunks": len(ids_to_delete),
        "status": "success" if ids_to_delete else "not_found",
    }


def get_runtime_optimization_status() -> dict:
    """Return runtime model/backend/cache status for diagnostics."""
    collection_count = _collection.count() if _collection is not None else 0
    return {
        "embedding": dict(_embedding_runtime),
        "reranker": dict(_reranker_runtime),
        "collection_count": collection_count,
        "bm25_documents": len(_bm25_corpus),
    }


def warmup_runtime() -> dict:
    """
    Warm up embedding, reranker, and BM25 at startup.
    This front-loads one-time costs so first user query is faster.
    """
    start = time.perf_counter()
    collection = _get_collection()
    collection_count = collection.count()

    embedding_fn = _get_embedding_fn()
    reranker = _get_reranker()

    # Warm ONNX sessions and tokenizer paths.
    _ = embedding_fn(
        [
            "query: kıdem tazminatı hesaplama koşulları",
            "query: annual leave entitlement policy",
        ]
    )
    _ = reranker.predict(
        [
            [
                "kıdem tazminatı hangi hallerde doğar",
                "İş sözleşmesinin mevzuata uygun feshi halinde kıdem tazminatı doğabilir.",
            ],
            [
                "annual leave right",
                "Employees may accrue annual leave based on years of service.",
            ],
        ]
    )

    if collection_count > 0 and not _bm25_corpus:
        _build_bm25_index()

    elapsed = round(time.perf_counter() - start, 3)
    status = get_runtime_optimization_status()
    status["warmup_seconds"] = elapsed
    return status
