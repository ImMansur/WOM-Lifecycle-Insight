"""PDF compression service to optimize files before OCR and storage."""
from __future__ import annotations

import io
import logging

logger = logging.getLogger(__name__)

def compress_pdf_bytes(file_bytes: bytes, filename: str) -> tuple[bytes, int]:
    """
    Compresses a PDF file in-memory using PyMuPDF (fitz).
    
    Optimizes structure (garbage collection, deflation) and downsamples images
    to a target of 150 DPI with 75% quality to match "Recommended Compression"
    (good quality, good compression) while preserving readability and OCR accuracy.
    
    If compression fails or is not applicable, returns (original bytes, page_count).
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("PyMuPDF (fitz) is not installed. Skipping PDF compression for %s.", filename)
        return file_bytes, 0

    page_count = 0
    try:
        orig_size = len(file_bytes)
        # Open the PDF from the memory stream
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        page_count = len(doc)

        if orig_size < 10 * 1024:  # If < 10KB, don't bother compressing
            doc.close()
            return file_bytes, page_count

        # Verify it has pages and is not empty
        if page_count == 0:
            doc.close()
            return file_bytes, 0

        # Check if the document has images to rewrite
        has_images = False
        for page in doc:
            if len(page.get_images()) > 0:
                has_images = True
                break

        if has_images:
            import os
            enable_advanced = os.environ.get("ENABLE_ADVANCED_PDF_COMPRESSION", "false").lower() == "true"
            if enable_advanced:
                try:
                    # Recompress/downscale images to 150 DPI and 75% quality (iLovePDF "Recommended Compression")
                    doc.rewrite_images(
                        dpi_threshold=150,
                        dpi_target=120,
                        quality=75,
                        lossy=True
                    )
                except Exception as e:
                    logger.warning("Advanced image rewrite failed: %s. Continuing with structural compression.", e)
            else:
                logger.info("Advanced image rewrite is disabled by default to prevent segmentation faults. Using structural compression.")


        # Save to memory buffer with garbage collection and stream compression
        # garbage=3 removes unused objects, deflate=True compresses streams, use_objstms=True optimizes objects
        buffer = io.BytesIO()
        doc.save(
            buffer,
            garbage=3,
            deflate=True,
            use_objstms=True
        )
        compressed_bytes = buffer.getvalue()
        doc.close()

        comp_size = len(compressed_bytes)
        if comp_size < orig_size:
            saved = orig_size - comp_size
            pct = (saved / orig_size) * 100
            logger.info(
                "Compressed PDF %s from %d to %d bytes (saved %d bytes, %.1f%%)",
                filename, orig_size, comp_size, saved, pct
            )
            return compressed_bytes, page_count
        else:
            logger.info("Compressed PDF %s is not smaller than original. Using original.", filename)
            return file_bytes, page_count

    except Exception as exc:
        logger.warning("PDF compression failed for %s: %s. Using original bytes.", filename, exc)
        return file_bytes, page_count
