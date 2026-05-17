"""Ingest router — accepts file uploads and processes them through the pipeline."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from models import IngestResponse, Recommendation
from services.document_intelligence import extract_text, extract_text_from_docx
from services.openai_service import process_document
from store import recommendation_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ingest"])

ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}
MAX_FILE_SIZE_MB = 50
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024


@router.post("/ingest", response_model=IngestResponse, status_code=status.HTTP_200_OK)
async def ingest_files(files: List[UploadFile] = File(...)):
    """
    Upload one or more CoC documents (PDF, DOC, DOCX).
    Each file is processed through Document Intelligence + Azure OpenAI
    and the resulting recommendations are returned and stored in memory.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    results: list[Recommendation] = []
    errors: list[str] = []

    for upload in files:
        filename = upload.filename or "unknown"
        ext = Path(filename).suffix.lower()

        if ext not in ALLOWED_EXTENSIONS:
            errors.append(f"{filename}: unsupported file type '{ext}'. Allowed: PDF, DOC, DOCX.")
            continue

        file_bytes = await upload.read()

        if len(file_bytes) > MAX_FILE_SIZE_BYTES:
            errors.append(f"{filename}: file exceeds {MAX_FILE_SIZE_MB} MB limit.")
            continue

        if len(file_bytes) == 0:
            errors.append(f"{filename}: empty file.")
            continue

        source_type = ext.lstrip(".").upper()  # "PDF", "DOC", "DOCX"

        try:
            # For DOC/DOCX try python-docx first (faster, free); fall back to DI
            converted_docx_name: str | None = None
            if ext in {".doc", ".docx"}:
                docx_text = extract_text_from_docx(file_bytes)
                if len(docx_text.strip()) >= 100:
                    extracted_text = docx_text
                    is_ocr_needed = False
                    # Record conversion only for legacy .doc files
                    if ext == ".doc":
                        converted_docx_name = Path(filename).stem + ".docx"
                else:
                    # Fall through to DI (handles DOCX natively, not DOC)
                    extracted_text, is_ocr_needed = await extract_text(file_bytes, filename)
            else:
                extracted_text, is_ocr_needed = await extract_text(file_bytes, filename)

            recommendation = await process_document(
                file_bytes=file_bytes,
                filename=filename,
                extracted_text=extracted_text,
                is_ocr_needed=is_ocr_needed,
                source_type=source_type,
            )
            recommendation.convertedDocx = converted_docx_name
            results.append(recommendation)
            recommendation_store.add(recommendation)

        except Exception as exc:
            logger.exception("Unexpected error processing %s", filename)
            errors.append(f"{filename}: processing failed — {exc}")

    return IngestResponse(
        processed=len(results),
        recommendations=results,
        errors=errors,
    )
