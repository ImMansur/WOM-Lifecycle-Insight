"""OpenAI-based extractor for Excel-only CoC fields."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_EXTRA_SYSTEM_PROMPT = """
You are an expert data-extraction assistant for an oilfield equipment company.
You receive text from a Certificate of Conformance (CoC) document.
Extract the following fields and return a single JSON object (use null if not found):

- documentType: type of certificate (e.g. "Certificate of Conformance", "Material Test Report", "Inspection Certificate")
- issuer: full name of the company or lab that issued this certificate
- address: issuing company's address (street, city, country)
- phone: issuing company's main phone number
- fax: issuing company's fax number
- serialization: serialization or traceability information (heat numbers, lot numbers, batch numbers as a single string)
- applicableSpecs: applicable standards or specifications (e.g. "API 6A", "ASME B16.5") — comma-separated string
- authorizedSignatory: name of the person who signed/authorized the certificate
- signatoryTitle: job title of the authorized signatory
- totalItems: total number of line items or parts listed on the certificate (integer or null)

RULES:
1. Return ONLY the JSON object, no markdown fences, no explanation.
2. All fields are strings unless noted otherwise.
3. Do not invent data — use null if genuinely absent.
""".strip()


def _build_client():
    from openai import AzureOpenAI
    return AzureOpenAI(
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_KEY"],
        api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-02-15-preview"),
    ), os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1")


def extract_extra_fields_sync(text: str | None) -> dict[str, Any]:
    """Synchronous call to Azure OpenAI to extract extra Excel fields."""
    empty: dict[str, Any] = {
        "documentType": None,
        "issuer": None,
        "address": None,
        "phone": None,
        "fax": None,
        "serialization": None,
        "applicableSpecs": None,
        "authorizedSignatory": None,
        "signatoryTitle": None,
        "totalItems": None,
    }
    if not text:
        return empty

    try:
        client, deployment = _build_client()
        response = client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": _EXTRA_SYSTEM_PROMPT},
                {"role": "user", "content": f"---BEGIN DOCUMENT TEXT---\n{text[:4000]}\n---END DOCUMENT TEXT---"},
            ],
            temperature=0,
            max_tokens=800,
        )
        raw = response.choices[0].message.content or "{}"
        raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        data = json.loads(raw)
        # Merge with empty to ensure all keys present
        return {**empty, **{k: v for k, v in data.items() if k in empty}}
    except Exception as exc:
        logger.warning("Extra-field extraction failed: %s", exc)
        return empty


async def extract_extra_fields(text: str | None) -> dict[str, Any]:
    """Async wrapper — runs the sync call in a thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, extract_extra_fields_sync, text)
