"""Ingest router — accepts file uploads and processes them through the pipeline."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from models import (
    ConfirmDuplicatesRequest,
    IngestResponse,
    PendingDuplicate,
    Recommendation,
)
from services.document_intelligence import extract_text, extract_text_from_docx
from services.openai_service import process_document
from services.blob_storage import upload_file
from store import recommendation_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ingest"])

ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}
MAX_FILE_SIZE_MB = 200
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
    pending: list[PendingDuplicate] = []

    # Snapshot existing records once; used for business-key dedupe.
    # Key = (normalised customer, normalised salesOrder, certificateDate).
    def _business_key(rec: Recommendation) -> tuple[str, str, str] | None:
        cust = (rec.customer or "").strip().lower()
        so = (rec.salesOrder or "").strip().lower()
        cert = (rec.certificateDate or "").strip()
        if not cust or not so or not cert:
            return None
        return (cust, so, cert)

    all_existing = recommendation_store.all()
    existing_by_key: dict[tuple[str, str, str], Recommendation] = {}
    for r in all_existing:
        k = _business_key(r)
        if k and k not in existing_by_key:
            existing_by_key[k] = r

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

        # Upload original file to Azure Blob Storage and capture the URL
        blob_url = upload_file(file_bytes, filename)

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
            recommendation.blobUrl = blob_url

            # Duplicate detection — two cases trigger an admin confirmation popup:
            #   1. Same record ID already exists (re-upload of the *exact same*
            #      file — content hash matched a previous upload).
            #   2. Different ID but the business key (customer + sales order +
            #      certificate date) collides with an existing record (admin
            #      uploaded a corrected/revised CoC for the same job).
            key = _business_key(recommendation)
            existing = recommendation_store.get(recommendation.id)
            if existing is None and key:
                existing = existing_by_key.get(key)

            if existing is not None:
                pending.append(PendingDuplicate(
                    existingId=existing.id,
                    existingFile=existing.sourceFile,
                    existingCustomer=existing.customer,
                    existingSalesOrder=existing.salesOrder,
                    existingCertificateDate=existing.certificateDate,
                    newRecommendation=recommendation,
                ))
                logger.info(
                    "Pending duplicate: incoming %s collides with existing %s "
                    "(same %s)",
                    recommendation.id,
                    existing.id,
                    "file" if existing.id == recommendation.id else "business key",
                )
                continue

            # Not a duplicate — save now and record the key for in-batch dedupe.
            if key:
                existing_by_key[key] = recommendation
            results.append(recommendation)
            recommendation_store.add(recommendation)

        except Exception as exc:
            logger.exception("Unexpected error processing %s", filename)
            errors.append(f"{filename}: processing failed — {exc}")

    return IngestResponse(
        processed=len(results),
        recommendations=results,
        pendingDuplicates=pending,
        errors=errors,
    )


@router.post(
    "/ingest/confirm",
    response_model=IngestResponse,
    status_code=status.HTTP_200_OK,
)
async def confirm_ingest_duplicates(payload: ConfirmDuplicatesRequest):
    """
    Apply duplicate-resolution decisions returned by ``POST /api/ingest``.

    For each item, the *new* recommendation **replaces** the existing one — the
    existing record's ID is preserved so any linked actions, comments, and
    notifications remain intact.

    Items the admin chose to cancel should simply be omitted from ``updates``.
    """
    applied: list[Recommendation] = []
    errors: list[str] = []

    for item in payload.updates:
        existing = recommendation_store.get(item.existingId)
        if existing is None:
            errors.append(f"{item.existingId}: existing record not found (already deleted?).")
            continue

        # Replace existing record's content but keep its ID
        merged = item.newRecommendation.model_copy(update={"id": item.existingId})
        recommendation_store.add(merged)  # `.add` uses .set() — overwrites by ID
        applied.append(merged)

    return IngestResponse(
        processed=len(applied),
        recommendations=applied,
        pendingDuplicates=[],
        errors=errors,
    )
