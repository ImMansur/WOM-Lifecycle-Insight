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


def log_optimization_event(filename: str, original_size: int, compressed_size: int, bypass_di: bool, pages: int) -> None:
    from datetime import datetime, timezone
    import uuid
    from models import CompressionLog
    from store import compression_log_store

    saved_size = original_size - compressed_size if original_size > compressed_size else 0
    
    # 1. Storage savings: hot tier rate $0.03 / GB / month over 3-year standard lifecycle
    gb_saved = saved_size / (1024 * 1024 * 1024)
    storage_savings = round(gb_saved * 0.03 * 36, 6)

    # 2. Azure Document Intelligence savings:
    # If bypassed entirely (DOC/DOCX): pages * $0.01
    # If PDF original_size > 4MB but compressed <= 4MB, we avoided Standard tier.
    # Standard Tier charges $0.01 per page.
    # Otherwise, efficiency/bandwidth savings = $0.005 per MB compressed.
    di_savings = 0.0
    if bypass_di:
        di_savings = round(pages * 0.01, 4)
    elif original_size > 4 * 1024 * 1024 and compressed_size <= 4 * 1024 * 1024:
        # Avoided standard tier upgrade
        di_savings = round(pages * 0.01, 4)
    else:
        # Bandwidth & processing resource savings
        mb_saved = saved_size / (1024 * 1024)
        di_savings = round(mb_saved * 0.005, 4)

    total_savings = round(storage_savings + di_savings, 4)

    log_entry = CompressionLog(
        id=str(uuid.uuid4()),
        filename=filename,
        originalSize=original_size,
        compressedSize=compressed_size,
        savedSize=saved_size,
        bypassDi=bypass_di,
        pages=pages,
        storageSavings=storage_savings,
        diSavings=di_savings,
        totalSavings=total_savings,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
    compression_log_store.add(log_entry)


ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}
MAX_FILE_SIZE_MB = 10
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024


def _get_combination_keys(rec: Recommendation) -> set[tuple[str, str, str, str, str]]:
    cust = (rec.customer or "").strip().lower()
    so = (rec.salesOrder or "").strip().lower()
    cert = (rec.certificateDate or "").strip()
    if not cust or not so or not cert:
        return set()

    keys = set()
    # 1. Use lineItems if they exist
    if rec.lineItems:
        for item in rec.lineItems:
            pn = (item.partNumber or "").strip().lower()
            if item.serials:
                for ser in item.serials:
                    s = ser.strip().lower()
                    if pn or s:
                        keys.add((cust, so, cert, pn, s))
            else:
                if pn:
                    keys.add((cust, so, cert, pn, ""))

    # 2. Fall back to flat arrays if no keys were generated from lineItems
    if not keys:
        parts = [p.number.strip().lower() for p in rec.partNumbers if p.number]
        serials = [s.strip().lower() for s in rec.serials if s]
        if parts and serials:
            for p in parts:
                for s in serials:
                    keys.add((cust, so, cert, p, s))
        elif parts:
            for p in parts:
                keys.add((cust, so, cert, p, ""))
        elif serials:
            for s in serials:
                keys.add((cust, so, cert, "", s))

    return keys


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

    all_existing = recommendation_store.all()
    existing_by_combo: dict[tuple[str, str, str, str, str], Recommendation] = {}
    for r in all_existing:
        for combo in _get_combination_keys(r):
            existing_by_combo[combo] = r

    total_batch_size = 0
    for upload in files:
        filename = upload.filename or "unknown"
        ext = Path(filename).suffix.lower()

        if ext not in ALLOWED_EXTENSIONS:
            errors.append(f"{filename}: unsupported file type '{ext}'. Allowed: PDF, DOC, DOCX.")
            continue

        file_bytes = await upload.read()
        original_size = len(file_bytes)
        
        if total_batch_size + original_size > MAX_FILE_SIZE_BYTES:
            errors.append(f"{filename}: total upload size exceeded 10MB limit. Skipping.")
            continue
            
        total_batch_size += original_size
        compressed_size = original_size
        pages = 0
        bypassed = False

        if len(file_bytes) == 0:
            errors.append(f"{filename}: empty file.")
            continue

        # Compress PDF if applicable
        if ext == ".pdf":
            from services.pdf_compressor import compress_pdf_bytes
            file_bytes, pages = compress_pdf_bytes(file_bytes, filename)
            compressed_size = len(file_bytes)

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
                    bypassed = True
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

            if ext == ".pdf":
                log_optimization_event(filename, original_size, compressed_size, bypass_di=False, pages=pages)
            elif bypassed:
                est_pages = max(1, len(extracted_text) // 1500)
                log_optimization_event(filename, original_size, original_size, bypass_di=True, pages=est_pages)


            # Duplicate detection — two cases trigger an admin confirmation popup:
            #   1. Same record ID already exists (re-upload of the *exact same*
            #      file — content hash matched a previous upload).
            #   2. Different ID but any 5-field business combination key (customer +
            #      sales order + certificate date + item + serial) collides with an
            #      existing record.
            existing = recommendation_store.get(recommendation.id)
            new_combos = _get_combination_keys(recommendation)
            if existing is None and new_combos:
                for combo in new_combos:
                    if combo in existing_by_combo:
                        existing = existing_by_combo[combo]
                        break

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
                    "file" if existing.id == recommendation.id else "business key combinations",
                )
                continue

            # Not a duplicate — save now and record the combination keys for in-batch dedupe.
            for combo in new_combos:
                existing_by_combo[combo] = recommendation
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
    existing_by_combo: dict,
) -> tuple[Recommendation | None, PendingDuplicate | None, str | None]:
    """
    Run the full extraction→AI→dedup pipeline for a single file.

    Returns (recommendation, pending_duplicate, error_message).  Exactly one
    of the three will be non-None.
    """
    ext = Path(filename).suffix.lower()
    source_type = ext.lstrip(".").upper()

    original_size = len(file_bytes)
    compressed_size = original_size
    pages = 0
    bypassed = False

    # Compress PDF if applicable
    if ext == ".pdf":
        from services.pdf_compressor import compress_pdf_bytes
        compressed_bytes, pages = compress_pdf_bytes(file_bytes, filename)
        if len(compressed_bytes) < len(file_bytes):
            file_bytes = compressed_bytes
            compressed_size = len(file_bytes)
            # Re-upload compressed version to Blob Storage
            try:
                from services.blob_storage import upload_file
                upload_file(file_bytes, filename)
            except Exception as e:
                logger.warning("Failed to re-upload compressed PDF for %s: %s", filename, e)

    try:
        converted_docx_name: str | None = None
        if ext in {".doc", ".docx"}:
            docx_text = extract_text_from_docx(file_bytes)
            if len(docx_text.strip()) >= 100:
                extracted_text = docx_text
                is_ocr_needed = False
                bypassed = True
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

        if ext == ".pdf":
            log_optimization_event(filename, original_size, compressed_size, bypass_di=False, pages=pages)
        elif bypassed:
            est_pages = max(1, len(extracted_text) // 1500)
            log_optimization_event(filename, original_size, original_size, bypass_di=True, pages=est_pages)


        existing = recommendation_store.get(recommendation.id)
        new_combos = _get_combination_keys(recommendation)
        if existing is None and new_combos:
            for combo in new_combos:
                if combo in existing_by_combo:
                    existing = existing_by_combo[combo]
                    break

        if existing is not None:
            return None, PendingDuplicate(
                existingId=existing.id,
                existingFile=existing.sourceFile,
                existingCustomer=existing.customer,
                existingSalesOrder=existing.salesOrder,
                existingCertificateDate=existing.certificateDate,
                newRecommendation=recommendation,
            ), None

        for combo in new_combos:
            existing_by_combo[combo] = recommendation
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
    existing_by_combo: dict = {}
    for r in all_existing:
        for combo in _get_combination_keys(r):
            existing_by_combo[combo] = r

    rec, dup, err = await _process_one_file(file_bytes, filename, blob_url, existing_by_combo)

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
    existing_by_combo: dict = {}
    for r in all_existing:
        for combo in _get_combination_keys(r):
            existing_by_combo[combo] = r

    total_batch_size = 0
    for blob_name in blob_names:
        ext = Path(blob_name).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            errors.append(f"{blob_name}: unsupported file type '{ext}'.")
            continue

        file_bytes = download_blob(blob_name)
        if file_bytes is None:
            errors.append(f"{blob_name}: could not download from blob storage.")
            continue
            
        original_size = len(file_bytes)
        if total_batch_size + original_size > MAX_FILE_SIZE_BYTES:
            errors.append(f"{blob_name}: total upload size exceeded 10MB limit. Skipping.")
            continue
            
        total_batch_size += original_size

        blob_url = f"https://blob/{blob_name}"  # approximate; real URL already stored during SAS upload

        rec, dup, err = await _process_one_file(file_bytes, blob_name, blob_url, existing_by_combo)
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
