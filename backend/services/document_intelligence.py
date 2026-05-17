"""Azure Document Intelligence service for text extraction."""
from __future__ import annotations

import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


async def extract_text(file_bytes: bytes, filename: str) -> tuple[str, bool]:
    """
    Extract raw text from a document using Azure Document Intelligence.

    Returns:
        (extracted_text, is_ocr_needed)
        is_ocr_needed is True when DI returned very little or no text
        (e.g. scanned/image-only PDF).
    """
    from azure.ai.documentintelligence import DocumentIntelligenceClient
    from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
    from azure.core.credentials import AzureKeyCredential

    endpoint = os.environ["DOCUMENT_INTELLIGENCE_ENDPOINT"]
    key = os.environ["DOCUMENT_INTELLIGENCE_KEY"]
    model_id = os.environ.get("DI_MODEL_ID", "prebuilt-layout")

    client = DocumentIntelligenceClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(key),
    )

    try:
        poller = client.begin_analyze_document(
            model_id=model_id,
            body=file_bytes,
            content_type="application/octet-stream",
        )
        result = poller.result()

        lines: list[str] = []
        for page in result.pages or []:
            for line in page.lines or []:
                lines.append(line.content)

        text = "\n".join(lines).strip()
        is_ocr_needed = len(text) < 100

        logger.info("DI extracted %d chars from %s", len(text), filename)
        return text, is_ocr_needed

    except Exception as exc:
        logger.warning("DI extraction failed for %s: %s", filename, exc)
        return "", True


def extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract text from DOCX/DOC bytes using python-docx."""
    import io
    from docx import Document  # type: ignore

    try:
        doc = Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        # Also extract tables
        for table in doc.tables:
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    paragraphs.append("  |  ".join(cells))
        return "\n".join(paragraphs)
    except Exception as exc:
        logger.warning("python-docx extraction failed: %s", exc)
        return ""
