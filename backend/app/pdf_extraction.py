"""
PDF text extraction helpers with safe extractor fallback.
"""

from __future__ import annotations

import logging

from pypdf import PdfReader

try:
    import pymupdf
except ImportError:
    pymupdf = None

logger = logging.getLogger(__name__)

_VALID_PDF_EXTRACTORS = {"auto", "pypdf", "pymupdf"}


def resolve_pdf_extractor(raw_extractor: str) -> str:
    extractor = raw_extractor.lower().strip()
    if extractor not in _VALID_PDF_EXTRACTORS:
        logger.warning(
            "Unknown PDF extractor '%s'. Falling back to 'auto'.",
            raw_extractor,
        )
        extractor = "auto"

    if extractor == "auto":
        return "pymupdf" if pymupdf is not None else "pypdf"

    if extractor == "pymupdf" and pymupdf is None:
        logger.warning("PyMuPDF is not installed. Falling back to 'pypdf'.")
        return "pypdf"

    return extractor


def extract_pdf_text_with_pypdf(file_path: str) -> list[dict]:
    reader = PdfReader(file_path)
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text and text.strip():
            pages.append({"page": i + 1, "text": text.strip()})
    return pages


def extract_pdf_text_with_pymupdf(file_path: str) -> list[dict]:
    if pymupdf is None:
        raise RuntimeError("PyMuPDF is not installed.")

    pages = []
    with pymupdf.open(file_path) as document:
        for i, page in enumerate(document):
            text = page.get_text("text")
            if text and text.strip():
                pages.append({"page": i + 1, "text": text.strip()})
    return pages


def extract_pdf_text(
    file_path: str,
    extractor: str | None = None,
    default_extractor: str = "auto",
) -> tuple[list[dict], str]:
    resolved_extractor = resolve_pdf_extractor(extractor or default_extractor)

    if resolved_extractor == "pymupdf":
        return extract_pdf_text_with_pymupdf(file_path), resolved_extractor

    return extract_pdf_text_with_pypdf(file_path), resolved_extractor
