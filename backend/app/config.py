"""
FinGuard AI — Centralized Configuration
Loads all environment variables via pydantic-settings.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ─── LLM ─────────────────────────────────────────
    cerebras_api_key: str = ""
    cerebras_model: str = "gpt-oss-120b"

    # ─── ChromaDB ────────────────────────────────────
    chroma_persist_dir: str = "/app/data/chromadb"

    # ─── Uploads ─────────────────────────────────────
    upload_dir: str = "/app/data/uploads"

    # ─── CORS ────────────────────────────────────────
    cors_origins: str = "http://localhost:3000"

    # ─── Embedding ───────────────────────────────────
    embedding_model: str = "intfloat/multilingual-e5-small"
    embedding_backend: str = "onnx-int8"  # "torch" | "onnx" | "onnx-int8"
    embedding_quantization: str = "avx2"  # "arm64" | "avx2" | "avx512" | "avx512_vnni"
    embedding_cache_dir: str = "/app/data/embeddings"
    embedding_trust_remote_code: bool = False
    embedding_normalize: bool = True

    # ─── Reranker ────────────────────────────────────
    reranker_model: str = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
    reranker_backend: str = "onnx-int8"  # "torch" | "onnx" | "onnx-int8"
    reranker_quantization: str = "avx2"  # "arm64" | "avx2" | "avx512" | "avx512_vnni"
    reranker_max_length: int = 384
    reranker_cache_dir: str = "/app/data/rerankers"
    reranker_trust_remote_code: bool = False

    # ─── Startup / Warmup ────────────────────────────
    model_warmup_enabled: bool = True

    # ─── RAG Tuning ──────────────────────────────────
    rag_top_k: int = 15          # Prompt-aligned candidate pool for reranker
    rag_rerank_top_n: int = 3    # Prompt-aligned final context size
    chunk_size: int = 1200       # Larger chunks for article-aware
    chunk_overlap: int = 200

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
