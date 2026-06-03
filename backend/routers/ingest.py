"""Ingest router — accepts file uploads and processes them through the pipeline."""
from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from models import (
    ConfirmDuplicatesRequest,
    IngestResponse,
    PendingDuplicate,
    Recommendation,
)
from services.document_intelligence import extract_text, extract_text_from_docx
from services.openai_service import process_document
from services.blob_storage import upload_file, generate_upload_sas, download_blob, stage_block, commit_blocks
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


# ---------------------------------------------------------------------------
# Helpers shared by both ingest endpoints
# ---------------------------------------------------------------------------

async def _process_one_file(
    file_bytes: bytes,
    filename: str,
    blob_url: str | None,
    existing_by_key: dict,
) -> tuple[Recommendation | None, PendingDuplicate | None, str | None]:
    """
    Run the full extraction→AI→dedup pipeline for a single file.

    Returns (recommendation, pending_duplicate, error_message).  Exactly one
    of the three will be non-None.
    """
    ext = Path(filename).suffix.lower()
    source_type = ext.lstrip(".").upper()

    try:
        converted_docx_name: str | None = None
        if ext in {".doc", ".docx"}:
            docx_text = extract_text_from_docx(file_bytes)
            if len(docx_text.strip()) >= 100:
                extracted_text = docx_text
                is_ocr_needed = False
                if ext == ".doc":
                    converted_docx_name = Path(filename).stem + ".docx"
            else:
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

        def _bk(rec: Recommendation):
            cust = (rec.customer or "").strip().lower()
            so = (rec.salesOrder or "").strip().lower()
            cert = (rec.certificateDate or "").strip()
            if not cust or not so or not cert:
                return None
            return (cust, so, cert)

        key = _bk(recommendation)
        existing = recommendation_store.get(recommendation.id)
        if existing is None and key:
            existing = existing_by_key.get(key)

        if existing is not None:
            return None, PendingDuplicate(
                existingId=existing.id,
                existingFile=existing.sourceFile,
                existingCustomer=existing.customer,
                existingSalesOrder=existing.salesOrder,
                existingCertificateDate=existing.certificateDate,
                newRecommendation=recommendation,
            ), None

        if key:
            existing_by_key[key] = recommendation
        recommendation_store.add(recommendation)
        return recommendation, None, None

    except Exception as exc:
        logger.exception("Unexpected error processing %s", filename)
        return None, None, f"{filename}: processing failed — {exc}"


# ---------------------------------------------------------------------------
# Chunked upload endpoint (used on Vercel to bypass the 4.5 MB body limit)
# ---------------------------------------------------------------------------

@router.post("/ingest-chunk", status_code=status.HTTP_200_OK)
async def ingest_chunk(
    file: UploadFile = File(...),
    filename: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
):
    """
    Accept one chunk of a larger file upload.

    The browser slices the file into pieces that each fit under Vercel's 4.5 MB
    function body limit and POSTs them here.  Each chunk is staged as an Azure
    Blob block (server-side — no browser-to-Azure CORS required).  When the
    final chunk arrives the blocks are committed and the assembled file is run
    through the full extraction + AI pipeline.
    """
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext}'.")

    chunk_bytes = await file.read()
    if len(chunk_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty chunk received.")

    # Block IDs must be base64-encoded and all have the same length.
    block_id = base64.b64encode(f"{chunk_index:08d}".encode()).decode()

    ok = stage_block(filename, block_id, chunk_bytes)
    if not ok:
        raise HTTPException(
            status_code=503,
            detail="Blob storage unavailable — check AZURE_STORAGE_CONNECTION_STRING.",
        )

    # Intermediate chunk: acknowledge and wait for more.
    if chunk_index < total_chunks - 1:
        return {"staged": True, "chunk_index": chunk_index, "total_chunks": total_chunks}

    # Final chunk: commit all staged blocks into one blob then process.
    all_block_ids = [base64.b64encode(f"{i:08d}".encode()).decode() for i in range(total_chunks)]
    blob_url = commit_blocks(filename, all_block_ids)

    file_bytes = download_blob(filename)
    if file_bytes is None:
        raise HTTPException(status_code=503, detail="Could not download assembled file from blob storage.")

    all_existing = recommendation_store.all()
    existing_by_key: dict = {}
    for r in all_existing:
        cust = (r.customer or "").strip().lower()
        so = (r.salesOrder or "").strip().lower()
        cert = (r.certificateDate or "").strip()
        if cust and so and cert:
            k = (cust, so, cert)
            if k not in existing_by_key:
                existing_by_key[k] = r

    rec, dup, err = await _process_one_file(file_bytes, filename, blob_url, existing_by_key)

    return IngestResponse(
        processed=1 if rec else 0,
        recommendations=[rec] if rec else [],
        pendingDuplicates=[dup] if dup else [],
        errors=[err] if err else [],
    )


# ---------------------------------------------------------------------------
# SAS upload URL endpoint
# ---------------------------------------------------------------------------

@router.get("/upload-sas")
async def get_upload_sas(filename: str):
    """
    Return a short-lived Azure Blob SAS URL that allows the browser to PUT the
    file directly into blob storage — bypassing the Vercel function body limit.
    """
    sas_url = generate_upload_sas(filename)
    if not sas_url:
        raise HTTPException(
            status_code=503,
            detail="Blob storage SAS generation not available. Check AZURE_STORAGE_CONNECTION_STRING.",
        )
    return {"url": sas_url, "blobName": filename}


# ---------------------------------------------------------------------------
# Ingest-from-blob endpoint (used by the frontend after direct SAS upload)
# ---------------------------------------------------------------------------

@router.post("/ingest-from-blob", response_model=IngestResponse, status_code=status.HTTP_200_OK)
async def ingest_from_blob(blob_names: list[str]):
    """
    Process files that have already been uploaded directly to Azure Blob
    Storage (via SAS URL).  Accepts a JSON array of blob names.
    """
    if not blob_names:
        raise HTTPException(status_code=400, detail="No blob names provided.")

    results: list[Recommendation] = []
    errors: list[str] = []
    pending: list[PendingDuplicate] = []

    all_existing = recommendation_store.all()
    existing_by_key: dict = {}
    for r in all_existing:
        cust = (r.customer or "").strip().lower()
        so = (r.salesOrder or "").strip().lower()
        cert = (r.certificateDate or "").strip()
        if cust and so and cert:
            k = (cust, so, cert)
            if k not in existing_by_key:
                existing_by_key[k] = r

    for blob_name in blob_names:
        ext = Path(blob_name).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            errors.append(f"{blob_name}: unsupported file type '{ext}'.")
            continue

        file_bytes = download_blob(blob_name)
        if file_bytes is None:
            errors.append(f"{blob_name}: could not download from blob storage.")
            continue

        blob_url = f"https://blob/{blob_name}"  # approximate; real URL already stored during SAS upload

        rec, dup, err = await _process_one_file(file_bytes, blob_name, blob_url, existing_by_key)
        if err:
            errors.append(err)
        elif dup:
            pending.append(dup)
        elif rec:
            results.append(rec)

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
