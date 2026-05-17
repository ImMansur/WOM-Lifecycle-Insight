"""Azure Blob Storage service — uploads ingested files to the 'ocr' container."""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# Lazily initialised so the app starts even if the env var is missing.
_client = None


def _get_container_client():
    global _client
    if _client is not None:
        return _client

    conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING")
    if not conn_str:
        logger.warning("AZURE_STORAGE_CONNECTION_STRING not set — blob upload disabled.")
        return None

    try:
        from azure.storage.blob import BlobServiceClient
        service = BlobServiceClient.from_connection_string(conn_str)
        _client = service.get_container_client("ocr")
        logger.info("Azure Blob Storage client initialised (container: ocr).")
    except Exception as exc:
        logger.error("Failed to initialise Blob Storage client: %s", exc)
        _client = None

    return _client


def upload_file(file_bytes: bytes, filename: str) -> str | None:
    """
    Upload *file_bytes* to the 'ocr' blob container.

    Returns the blob URL on success, or None if the upload is skipped / fails.
    The blob name is the original filename; existing blobs with the same name
    are overwritten so re-uploads replace stale copies.
    """
    client = _get_container_client()
    if client is None:
        return None

    _MIME = {
        "pdf":  "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc":  "application/msword",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls":  "application/vnd.ms-excel",
    }
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_type = _MIME.get(ext, "application/octet-stream")

    try:
        from azure.storage.blob import ContentSettings
        blob = client.get_blob_client(filename)
        blob.upload_blob(
            file_bytes,
            overwrite=True,
            content_settings=ContentSettings(
                content_type=content_type,
                content_disposition="inline",
            ),
        )
        url = blob.url
        logger.info("Uploaded '%s' to blob storage → %s", filename, url)
        return url
    except Exception as exc:
        logger.error("Blob upload failed for '%s': %s", filename, exc)
        return None
