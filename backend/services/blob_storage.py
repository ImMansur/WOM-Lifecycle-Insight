"""Azure Blob Storage service — uploads ingested files to the 'ocr' container."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

logger = logging.getLogger(__name__)


def _parse_connection_string(conn_str: str) -> dict[str, str]:
    """Parse an Azure Storage connection string into a key→value dict."""
    result: dict[str, str] = {}
    for part in conn_str.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            result[k] = v
    return result

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


def generate_upload_sas(filename: str) -> str | None:
    """
    Generate a short-lived (15 min) SAS URL that allows the browser to PUT a
    file directly into the 'ocr' container — bypassing the Vercel 4.5 MB body
    limit entirely.

    Returns the full SAS URL on success, or None if blob storage is not
    configured or the token cannot be generated.
    """
    conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING")
    if not conn_str:
        return None

    try:
        from azure.storage.blob import generate_blob_sas, BlobSasPermissions

        params = _parse_connection_string(conn_str)
        account_name = params.get("AccountName")
        account_key = params.get("AccountKey")
        if not account_name or not account_key:
            logger.error("Cannot generate SAS: AccountName/AccountKey missing from connection string.")
            return None

        sas_token = generate_blob_sas(
            account_name=account_name,
            container_name="ocr",
            blob_name=filename,
            account_key=account_key,
            permission=BlobSasPermissions(write=True, create=True),
            expiry=datetime.now(timezone.utc) + timedelta(minutes=15),
        )

        url = f"https://{account_name}.blob.core.windows.net/ocr/{quote(filename, safe='')}?{sas_token}"
        logger.info("Generated SAS upload URL for '%s'", filename)
        return url
    except Exception as exc:
        logger.error("Failed to generate SAS URL for '%s': %s", filename, exc)
        return None


def download_blob(filename: str) -> bytes | None:
    """
    Download *filename* from the 'ocr' container and return its raw bytes.

    Returns None if blob storage is not configured or the download fails.
    """
    client = _get_container_client()
    if client is None:
        return None

    try:
        blob = client.get_blob_client(filename)
        data = blob.download_blob()
        file_bytes = data.readall()
        logger.info("Downloaded '%s' from blob storage (%d bytes)", filename, len(file_bytes))
        return file_bytes
    except Exception as exc:
        logger.error("Blob download failed for '%s': %s", filename, exc)
        return None


def stage_block(filename: str, block_id: str, chunk_bytes: bytes) -> bool:
    """
    Stage a single block for a block blob upload.

    *block_id* must be a base64-encoded string.  All blocks for a given blob
    must have the same encoded length.  Use ``commit_blocks`` once all blocks
    have been staged to assemble the final blob.
    """
    client = _get_container_client()
    if client is None:
        return False
    try:
        blob = client.get_blob_client(filename)
        blob.stage_block(block_id, chunk_bytes, length=len(chunk_bytes))
        logger.info("Staged block '%s' for '%s' (%d bytes)", block_id, filename, len(chunk_bytes))
        return True
    except Exception as exc:
        logger.error("Failed to stage block for '%s': %s", filename, exc)
        return False


def commit_blocks(filename: str, block_ids: list[str]) -> str | None:
    """
    Commit a previously staged list of blocks into the final blob.

    Returns the blob URL on success, or None on failure.
    """
    client = _get_container_client()
    if client is None:
        return None
    try:
        from azure.storage.blob import BlobBlock
        blob = client.get_blob_client(filename)
        blob.commit_block_list([BlobBlock(block_id=bid) for bid in block_ids])
        logger.info("Committed %d blocks → '%s'", len(block_ids), filename)
        return blob.url
    except Exception as exc:
        logger.error("Failed to commit blocks for '%s': %s", filename, exc)
        return None
