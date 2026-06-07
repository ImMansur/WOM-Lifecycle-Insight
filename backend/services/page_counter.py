"""Document page counting for upload validation."""
from __future__ import annotations

import io
import logging
import re
import zipfile

logger = logging.getLogger(__name__)

_CHARS_PER_PAGE_ESTIMATE = 1500


def count_pdf_pages(file_bytes: bytes) -> int:
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = len(doc)
        doc.close()
        return pages
    except Exception as exc:
        logger.warning("Could not count PDF pages: %s", exc)
        return 0


def _count_docx_page_breaks(file_bytes: bytes) -> int | None:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", errors="ignore")
        breaks = len(re.findall(r'w:type="page"', xml))
        breaks += xml.count("w:lastRenderedPageBreak")
        if breaks > 0:
            return breaks + 1
    except Exception as exc:
        logger.debug("docx page-break scan failed: %s", exc)
    return None


def count_document_pages(file_bytes: bytes, ext: str) -> int:
    """Return estimated or exact page count for supported upload types."""
    ext = ext.lower()
    if ext == ".pdf":
        return count_pdf_pages(file_bytes)

    if ext in {".doc", ".docx"}:
        if file_bytes[:4] == b"PK\x03\x04":
            from_breaks = _count_docx_page_breaks(file_bytes)
            if from_breaks is not None:
                return from_breaks

        from services.document_intelligence import extract_text_from_docx

        text = extract_text_from_docx(file_bytes)
        if not text.strip():
            return 1
        return max(1, (len(text) + _CHARS_PER_PAGE_ESTIMATE - 1) // _CHARS_PER_PAGE_ESTIMATE)

    return 0
