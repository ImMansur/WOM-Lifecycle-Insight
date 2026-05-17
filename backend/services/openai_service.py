"""Azure OpenAI service for structured extraction from CoC documents."""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any

from models import Recommendation

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """
You are an expert data-extraction assistant for an oilfield equipment company.
You receive raw text extracted from a Certificate of Conformance (CoC) document.
Your task is to extract structured data and return a single JSON object.

Extract the following fields (use null when not found):
- customer: full customer name as printed on the CoC
- salesOrder: W.O.M. sales order number
- purchaseOrder: customer purchase order number
- jobOrProject: rig name, project name, or job reference
- location: physical site, city, country, or geographic location where the equipment is deployed or the work was performed (e.g. "Aberdeen, UK", "Gulf of Mexico", "Stavanger, Norway"). Use null if no location is stated.
- equipment: full equipment description / product name
- partNumbers: array of objects, one per part found ANYWHERE in the document — including tables, BOM lists, line items, and drawing references. Scan the entire document top-to-bottom. Never stop at the first one. Each object must have:
    - "number": the part number / model number / WOM item code (string)
    - "description": the human-readable description of that part as written on the document, or null if not given
    - "qty": integer quantity from the BOM or line item, or null if not stated
- serials: array of ALL serial numbers, lot numbers, heat numbers, assembly serials, and reference standards (e.g. MR-01-75) found anywhere in the document
- certificateDate: ISO date (YYYY-MM-DD) from "Certificate Date" or "Date" field
- testedDate: ISO date (YYYY-MM-DD) from "Test Date" or "Tested Date" field, else null
- textPreview: first ~300 characters of meaningful document text (a concise excerpt)
- confidence: "High" if you extracted customer + salesOrder + certificateDate, else "Low"
- notes: any caveats, document format issues, or special observations (string or null)

RULES:
1. Return ONLY the JSON object, no markdown fences, no explanation.
2. Dates must be YYYY-MM-DD or null.
3. Arrays must be JSON arrays, never comma-separated strings.
4. Do not invent data. If a field is not present, use null or [].
""".strip()

_USER_TEMPLATE = """
Filename: {filename}
---BEGIN DOCUMENT TEXT---
{text}
---END DOCUMENT TEXT---
"""


def _compute_lifecycle_fields(cert_date_str: str | None) -> dict[str, Any]:
    """Compute recertificationDue, ageMonths, monthsToRecert, status, priority."""
    today = date.today()

    if not cert_date_str:
        return {
            "lifecycleDate": None,
            "recertificationDue": None,
            "ageMonths": None,
            "monthsToRecert": None,
            "status": "Manual review",
            "priority": "Manual review",
        }

    try:
        cert_date = date.fromisoformat(cert_date_str)
    except ValueError:
        return {
            "lifecycleDate": cert_date_str,
            "recertificationDue": None,
            "ageMonths": None,
            "monthsToRecert": None,
            "status": "Manual review",
            "priority": "Manual review",
        }

    # 5-year recertification cycle
    recert_date = cert_date.replace(year=cert_date.year + 5)
    age_months = (
        (today.year - cert_date.year) * 12 + (today.month - cert_date.month)
    )
    months_to_recert = (
        (recert_date.year - today.year) * 12 + (recert_date.month - today.month)
    )

    if months_to_recert < 0:
        status = "Expired / overdue"
        priority: str = "High"
    elif months_to_recert <= 12:
        status = "Due within 12 months"
        priority = "High"
    elif months_to_recert <= 24:
        status = "Mid-cycle service opportunity"
        priority = "Low"
    else:
        status = "Within lifecycle"
        priority = "Low"

    return {
        "lifecycleDate": cert_date_str,
        "recertificationDue": recert_date.isoformat(),
        "ageMonths": age_months,
        "monthsToRecert": months_to_recert,
        "status": status,
        "priority": priority,
    }


def _build_recommendation_text(rec_id: str, data: dict[str, Any], lifecycle: dict[str, Any]) -> str:
    equip = data.get("equipment") or "equipment"
    cert = data.get("certificateDate") or "unknown date"
    recert = lifecycle.get("recertificationDue") or "unknown date"
    so = data.get("salesOrder") or rec_id
    po = data.get("purchaseOrder") or ""
    location = data.get("location") or ""
    parts_count = len(data.get("partNumbers") or [])
    serials_count = len(data.get("serials") or [])

    location_clause = f" deployed at {location}" if location else ""

    invoice_basis_parts = []
    if so:
        invoice_basis_parts.append(f"Sales order {so}")
    if po:
        invoice_basis_parts.append(f"PO {po}")
    if parts_count:
        invoice_basis_parts.append(f"{parts_count} part/BOM ref{'s' if parts_count != 1 else ''}")
    if serials_count:
        invoice_basis_parts.append(f"{serials_count} serial/lot ref{'s' if serials_count != 1 else ''}")

    invoice_basis = "; ".join(invoice_basis_parts) if invoice_basis_parts else None

    status = lifecycle.get("status", "")
    if status == "Expired / overdue":
        action = "create recertification and aftermarket sales lead now"
        category = _guess_equipment_category(equip)
        rec_text = (
            f"{category}{location_clause}: {action}. CoC date is {cert} and the 5-year "
            f"recertification date is {recert}. Use extracted customer/order/BOM "
            f"data as the starting point for invoice or quote review."
        )
    elif status == "Due within 12 months":
        rec_text = (
            f"Equipment{location_clause} due for recertification within 12 months. "
            f"CoC date is {cert}, recertification due {recert}. "
            f"Initiate customer outreach now."
        )
    elif status == "Mid-cycle service opportunity":
        rec_text = (
            f"Consider routine inspection or spare-parts conversation"
            f"{' for equipment at ' + location if location else ''}. "
            f"CoC date is {cert} and the 5-year recertification date is {recert}."
        )
    else:
        rec_text = (
            f"Equipment{location_clause} within lifecycle. Next recertification due {recert}. "
            f"Monitor and plan ahead."
        )

    return rec_text, invoice_basis


def _guess_equipment_category(equipment: str) -> str:
    equip_lower = (equipment or "").lower()
    if any(k in equip_lower for k in ["valve", "gate", "needle"]):
        return "Valve equipment"
    if any(k in equip_lower for k in ["bop", "blowout", "ram", "annular"]):
        return "Pressure control equipment"
    if any(k in equip_lower for k in ["choke", "manifold", "kill"]):
        return "Choke/manifold equipment"
    if any(k in equip_lower for k in ["tubing", "casing", "hanger"]):
        return "Wellhead equipment"
    return "Equipment"


async def process_document(
    file_bytes: bytes,
    filename: str,
    extracted_text: str,
    is_ocr_needed: bool,
    source_type: str,
) -> Recommendation:
    """Call Azure OpenAI to extract structured CoC fields and build a Recommendation."""

    rec_id = _generate_id(filename)

    if is_ocr_needed or not extracted_text.strip():
        return Recommendation(
            id=rec_id,
            sourceFile=filename,
            sourceType=source_type,  # type: ignore[arg-type]
            extractionStatus="Needs OCR / manual review",
            status="Manual review",
            priority="Manual review",
            recommendation="Run OCR or manually review the CoC before creating a sales or recertification lead.",
            confidence="Low",
            notes="No machine-readable text found. Likely a scanned PDF or image-only document.",
        )

    from openai import AzureOpenAI

    client = AzureOpenAI(
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_KEY"],
        api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-02-15-preview"),
    )
    deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1")

    # Truncate text to avoid token limits (~24 000 chars ≈ 6 000 tokens)
    # Larger window ensures full BOM/parts tables are captured
    truncated_text = extracted_text[:24000]

    user_msg = _USER_TEMPLATE.format(filename=filename, text=truncated_text)

    try:
        response = client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
        raw_json = response.choices[0].message.content or "{}"
    except Exception as exc:
        logger.error("OpenAI extraction failed for %s: %s", filename, exc)
        raw_json = "{}"

    try:
        data: dict[str, Any] = json.loads(raw_json)
    except json.JSONDecodeError:
        # Try to pull the first JSON object out of the string
        match = re.search(r"\{.*\}", raw_json, re.DOTALL)
        data = json.loads(match.group()) if match else {}

    lifecycle = _compute_lifecycle_fields(data.get("certificateDate"))
    rec_text, invoice_basis = _build_recommendation_text(rec_id, data, lifecycle)

    # Normalise GPT-returned values to valid Literal values so Pydantic never
    # raises a ValidationError on unexpected casing or wording.
    raw_confidence = str(data.get("confidence") or "Low").strip()
    confidence: str = "High" if raw_confidence.lower() == "high" else "Low"

    raw_priority = str(lifecycle.get("priority") or "Manual review").strip()
    if raw_priority.lower() == "high":
        priority: str = "High"
    elif raw_priority.lower() == "low":
        priority = "Low"
    else:
        priority = "Manual review"

    # Normalise partNumbers → List[PartEntry]
    # GPT may return [{"number": ..., "description": ...}] or ["plain string"]
    from models import PartEntry
    raw_parts = data.get("partNumbers") or []
    part_numbers = []
    for p in raw_parts:
        if isinstance(p, dict):
            raw_qty = p.get("qty")
            try:
                qty = int(raw_qty) if raw_qty is not None else None
            except (TypeError, ValueError):
                qty = None
            part_numbers.append(PartEntry(
                number=str(p.get("number") or "").strip(),
                description=str(p["description"]).strip() if p.get("description") else None,
                qty=qty,
            ))
        elif isinstance(p, str) and p.strip():
            part_numbers.append(PartEntry(number=p.strip(), description=None, qty=None))
    serials = [str(s) for s in (data.get("serials") or [])]

    logger.info(
        "Built recommendation for %s | status=%s | priority=%s | confidence=%s",
        filename, lifecycle["status"], priority, confidence,
    )

    return Recommendation(
        id=rec_id,
        sourceFile=filename,
        sourceType=source_type,  # type: ignore[arg-type]
        extractionStatus="OK",
        customer=data.get("customer") or None,
        salesOrder=data.get("salesOrder") or None,
        purchaseOrder=data.get("purchaseOrder") or None,
        jobOrProject=data.get("jobOrProject") or None,
        location=data.get("location") or None,
        equipment=data.get("equipment") or None,
        partNumbers=part_numbers,
        serials=serials,
        certificateDate=data.get("certificateDate") or None,
        testedDate=data.get("testedDate") or None,
        lifecycleDate=lifecycle["lifecycleDate"],
        recertificationDue=lifecycle["recertificationDue"],
        ageMonths=lifecycle["ageMonths"],
        monthsToRecert=lifecycle["monthsToRecert"],
        status=lifecycle["status"],
        priority=priority,  # type: ignore[arg-type]
        invoiceBasis=invoice_basis,
        recommendation=rec_text,
        confidence=confidence,  # type: ignore[arg-type]
        notes=data.get("notes") or None,
        textPreview=data.get("textPreview") or None,
    )


def _generate_id(filename: str) -> str:
    """Generate an ID from filename or a short UUID."""
    stem = Path(filename).stem
    # Keep alphanumeric + dashes, max 20 chars
    clean = re.sub(r"[^A-Za-z0-9\-]", "", stem)[:20]
    return clean if clean else uuid.uuid4().hex[:8].upper()


# needed for Path usage in _generate_id
from pathlib import Path  # noqa: E402
