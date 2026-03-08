#!/usr/bin/env python3
"""
Benchmark native PDF extractors against the same files.

Usage:
  backend/venv/bin/python scripts/benchmark_pdf_extractors.py
  backend/venv/bin/python scripts/benchmark_pdf_extractors.py test-pdfs/kkvk.pdf
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.pdf_extraction import extract_pdf_text  # noqa: E402

DEFAULT_FILES = [
    ROOT / "test-pdfs" / "kkvk.pdf",
    ROOT / "test-pdfs" / "isg-kanunu.pdf",
    ROOT / "test-pdfs" / "sendiklar-toplu-is-sozlesmesi-kanunu.pdf",
]
EXTRACTORS = ("pypdf", "pymupdf")
ARTICLE_PATTERN = re.compile(r"(?im)^\s*(madde\s+\d+|madde\s*[–-]\s*\d+)")


def summarize_pages(pages: list[dict]) -> dict[str, object]:
    full_text = "\n\n".join(page["text"] for page in pages)
    return {
        "pages_with_text": len(pages),
        "chars": len(full_text),
        "madde_matches": len(ARTICLE_PATTERN.findall(full_text)),
        "first_page_preview": pages[0]["text"][:120].replace("\n", " ") if pages else "",
    }


def benchmark_file(file_path: Path) -> dict[str, object]:
    results: dict[str, dict[str, object]] = {}
    for extractor in EXTRACTORS:
        started = time.perf_counter()
        pages, extractor_used = extract_pdf_text(str(file_path), extractor=extractor)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        results[extractor] = {
            "extractor_used": extractor_used,
            "elapsed_ms": elapsed_ms,
            **summarize_pages(pages),
        }

    pypdf_stats = results["pypdf"]
    pymupdf_stats = results["pymupdf"]

    pypdf_ms = float(pypdf_stats["elapsed_ms"])
    pymupdf_ms = float(pymupdf_stats["elapsed_ms"])
    pypdf_chars = int(pypdf_stats["chars"]) or 1
    pypdf_madde = int(pypdf_stats["madde_matches"])
    pymupdf_madde = int(pymupdf_stats["madde_matches"])

    return {
        "file": file_path.name,
        "pypdf": pypdf_stats,
        "pymupdf": pymupdf_stats,
        "speedup_x": round(pypdf_ms / pymupdf_ms, 2) if pymupdf_ms else None,
        "char_ratio": round(int(pymupdf_stats["chars"]) / pypdf_chars, 4),
        "madde_delta": pymupdf_madde - pypdf_madde,
    }


def main() -> int:
    input_files = [Path(arg).resolve() for arg in sys.argv[1:]] or DEFAULT_FILES
    benchmarks = []

    for file_path in input_files:
        if not file_path.exists():
            raise FileNotFoundError(f"Missing PDF: {file_path}")
        benchmarks.append(benchmark_file(file_path))

    print(json.dumps(benchmarks, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
