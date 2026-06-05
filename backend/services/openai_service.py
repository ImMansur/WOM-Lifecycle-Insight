"""Azure OpenAI service for structured extraction from CoC documents."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import re
import uuid
import asyncio
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
- equipment: the top-level assembly / product name being certified — e.g.
  "15,000 PSI W.P. CHOKE & KILL MANIFOLD", "WOM TYPE WU 11\" 15K SINGLE GATE VALVE",
  "1-13/16\" 10K MODEL 200M MANUAL GATE VALVE". Look for labels such as
  "ASSEMBLY DESCRIPTION", "EQUIPMENT DESCRIPTION", "PRODUCT DESCRIPTION",
  "ITEM DESCRIPTION", "DESCRIPTION OF GOODS", or the bold title in the cert header.
  This should be the overall assembly name, NOT a component part number.
  Use null only if no assembly-level description exists.
- lineItems: array of objects, one per equipment **line item** on the CoC. Each
  CoC may have one or many line items (a single row on the cert OR rows from
  a Bill-of-Materials table). The relationship between description, part
  number, quantity, and serial number(s) on the SAME row must be preserved.
  Each object must have:
    - "description": the description / product name for this row, or null
    - "partNumber": the part number / model number / WOM item code for this row, or null
    - "qty": integer quantity for this row, or null if not stated
    - "serials": array of serial numbers / lot numbers belonging to THIS specific
      part. If the cert lists "EQUIPMENT SERIAL NO: A-28717" alongside
      "PART NO: M4800 QUANTITY: 1", then A-28717 belongs to M4800.
      Use [] if no serials are listed for this row.
  Scan the entire document top-to-bottom; never stop at the first row.
- partNumbers: array of objects (legacy flat list, used as a fallback when
  lineItems cannot be grouped). Each: { "number", "description", "qty" }.
  You may leave this empty if lineItems is populated.
- serials: array of any serial / lot / heat numbers that could NOT be
  attributed to a specific line item (e.g. reference standards like MR-01-75).
  Per-part serials should go inside lineItems[*].serials, not here.
- certificateDate: ISO date (YYYY-MM-DD) from "Certificate Date" or "Date" field
- testedDate: ISO date (YYYY-MM-DD) from "Test Date" or "Tested Date" field, else null
- textPreview: first ~2000 characters of meaningful document text (a concise excerpt, preserving as much structure as possible)
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


_OPENAI_MAX_RETRIES = int(os.environ.get("OPENAI_MAX_RETRIES", "5"))
_OPENAI_BACKOFF_BASE = float(os.environ.get("OPENAI_BACKOFF_BASE", "1.0"))
_OPENAI_CHUNK_CHARS = int(os.environ.get("OPENAI_CHUNK_CHARS", "25000"))


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

    rec_id = _generate_id(filename, file_bytes)

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

    def _chunk_text(raw_text: str) -> list[str]:
        if len(raw_text) <= _OPENAI_CHUNK_CHARS:
            return [raw_text]

        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        if not lines:
            return [raw_text[:_OPENAI_CHUNK_CHARS]]

        chunks: list[str] = []
        current: list[str] = []
        current_len = 0

        def flush_current() -> None:
            nonlocal current, current_len
            if current:
                chunks.append("\n".join(current))
                current = []
                current_len = 0

        for line in lines:
            line_len = len(line) + 1
            if line_len > _OPENAI_CHUNK_CHARS:
                flush_current()
                for start in range(0, len(line), _OPENAI_CHUNK_CHARS):
                    chunks.append(line[start : start + _OPENAI_CHUNK_CHARS])
                continue

            if current and current_len + line_len > _OPENAI_CHUNK_CHARS:
                flush_current()

            current.append(line)
            current_len += line_len

        flush_current()
        return chunks

    def _parse_openai_json(raw_content: str) -> dict[str, Any]:
        content = raw_content.strip()
        result = _safe_parse_json(content, filename)
        if not result:
            logger.warning("Unable to parse OpenAI JSON output for %s: %s", filename, content[:500])
        return result

    def _merge_chunk_results(partials: list[dict[str, Any]]) -> dict[str, Any]:
        merged: dict[str, Any] = {}
        list_fields = {"lineItems", "partNumbers", "serials"}
        for part in partials:
            for key, value in part.items():
                if key in list_fields:
                    if value is None:
                        continue
                    merged.setdefault(key, [])
                    if isinstance(value, list):
                        merged[key].extend(value)
                    else:
                        merged[key].append(value)
                else:
                    if value is not None and merged.get(key) is None:
                        merged[key] = value
        for key in list_fields:
            if key in merged and isinstance(merged[key], list):
                seen = set()
                unique = []
                for item in merged[key]:
                    identifier = json.dumps(item, sort_keys=True) if isinstance(item, dict) else str(item)
                    if identifier not in seen:
                        seen.add(identifier)
                        unique.append(item)
                merged[key] = unique
        return merged

    def _format_message(chunk_text: str, idx: int, total: int) -> str:
        base = _USER_TEMPLATE.format(filename=filename, text=chunk_text)
        if total > 1:
            return f"Chunk {idx + 1}/{total}\n" + base
        return base

    async def _call_openai_chunk(chunk_text: str, chunk_index: int, chunk_count: int) -> dict[str, Any]:
        user_msg = _format_message(chunk_text, chunk_index, chunk_count)
        last_error: Exception | None = None

        for attempt in range(_OPENAI_MAX_RETRIES):
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
                finish_reason = response.choices[0].finish_reason
                if finish_reason == "length":
                    logger.warning(
                        "OpenAI chunk %d/%d response was truncated for %s. Output may be incomplete JSON.",
                        chunk_index + 1,
                        chunk_count,
                        filename,
                    )
                return _parse_openai_json(raw_json)

            except Exception as exc:
                last_error = exc
                err_text = str(exc).lower()
                if "429" in err_text or "too_many_requests" in err_text or "rate limit" in err_text:
                    backoff = _OPENAI_BACKOFF_BASE * (2 ** attempt) + random.random() * 0.5
                    logger.warning(
                        "OpenAI rate limited on attempt %d/%d for %s; sleeping %.2fs.",
                        attempt + 1,
                        _OPENAI_MAX_RETRIES,
                        filename,
                        backoff,
                    )
                    await asyncio.sleep(backoff)
                    continue
                logger.error("OpenAI extraction failed for %s: %s", filename, exc)
                break

        logger.error(
            "OpenAI extraction failed for %s after %d attempts: %s",
            filename,
            _OPENAI_MAX_RETRIES,
            last_error,
        )
        return {}

    from openai import AzureOpenAI

    client = AzureOpenAI(
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_KEY"],
        api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-02-15-preview"),
    )
    deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1")

    chunks = _chunk_text(extracted_text)
    logger.info("OpenAI text split into %d chunk(s) for %s", len(chunks), filename)
    responses = []
    for idx, chunk_text in enumerate(chunks):
        responses.append(await _call_openai_chunk(chunk_text, idx, len(chunks)))
        if not responses[-1]:
            logger.warning("OpenAI returned no JSON for chunk %d/%d of %s", idx + 1, len(chunks), filename)

    data = _merge_chunk_results(responses)
    lifecycle = _compute_lifecycle_fields(data.get("certificateDate"))
    rec_text, invoice_basis = _build_recommendation_text(rec_id, data, lifecycle)

    raw_confidence = str(data.get("confidence") or "").strip().lower()
    confidence = "High" if raw_confidence == "high" or (
        data.get("customer") and data.get("salesOrder") and data.get("certificateDate")
    ) else "Low"

    raw_priority = str(lifecycle.get("priority") or "Manual review").strip().lower()
    if raw_priority == "high":
        priority = "High"
    elif raw_priority == "low":
        priority = "Low"
    else:
        priority = "Manual review"

    from models import LineItem, PartEntry

    raw_line_items = data.get("lineItems") or []
    line_items: list[LineItem] = []
    for li in raw_line_items:
        if not isinstance(li, dict):
            continue
        raw_qty = li.get("qty")
        try:
            qty = int(raw_qty) if raw_qty is not None else None
        except (TypeError, ValueError):
            qty = None
        raw_serials = li.get("serials") or []
        serials_for_row = [str(s).strip() for s in raw_serials if str(s).strip()]
        line_items.append(LineItem(
            description=str(li.get("description") or "").strip() or None,
            partNumber=str(li.get("partNumber") or "").strip() or None,
            qty=qty,
            serials=serials_for_row,
        ))

    raw_parts = data.get("partNumbers") or []
    part_numbers: list[PartEntry] = []
    for p in raw_parts:
        if isinstance(p, dict):
            raw_qty = p.get("qty")
            try:
                qty = int(raw_qty) if raw_qty is not None else None
            except (TypeError, ValueError):
                qty = None
            part_numbers.append(PartEntry(
                number=str(p.get("number") or "").strip(),
                description=str(p.get("description") or "").strip() or None,
                qty=qty,
            ))
        elif isinstance(p, str) and p.strip():
            part_numbers.append(PartEntry(number=p.strip(), description=None, qty=None))

    serials = [str(s).strip() for s in (data.get("serials") or []) if str(s).strip()]

    if line_items:
        derived_parts = [
            PartEntry(number=li.partNumber, description=li.description, qty=li.qty)
            for li in line_items if li.partNumber
        ]
        seen = {p.number for p in derived_parts if p.number}
        for p in part_numbers:
            if p.number and p.number not in seen:
                derived_parts.append(p)
                seen.add(p.number)
        part_numbers = derived_parts

        seen_s: set[str] = set()
        merged_serials: list[str] = []
        for li in line_items:
            for s in li.serials:
                if s and s not in seen_s:
                    merged_serials.append(s)
                    seen_s.add(s)
        for s in serials:
            if s and s not in seen_s:
                merged_serials.append(s)
                seen_s.add(s)
        serials = merged_serials
    elif part_numbers:
        line_items = [
            LineItem(
                description=p.description,
                partNumber=p.number,
                qty=p.qty,
                serials=[],
            )
            for p in part_numbers
        ]

    recommendation = Recommendation(
        id=rec_id,
        sourceFile=filename,
        sourceType=source_type,
        extractionStatus="OK" if confidence == "High" else "Needs OCR / manual review",
        convertedDocx=None,
        customer=data.get("customer") or None,
        salesOrder=data.get("salesOrder") or None,
        purchaseOrder=data.get("purchaseOrder") or None,
        jobOrProject=data.get("jobOrProject") or None,
        location=data.get("location") or None,
        equipment=data.get("equipment") or None,
        lineItems=line_items,
        partNumbers=part_numbers,
        serials=serials,
        certificateDate=data.get("certificateDate") or None,
        testedDate=data.get("testedDate") or None,
        lifecycleDate=lifecycle.get("lifecycleDate"),
        recertificationDue=lifecycle.get("recertificationDue"),
        ageMonths=lifecycle.get("ageMonths"),
        monthsToRecert=lifecycle.get("monthsToRecert"),
        status=lifecycle.get("status", "Manual review"),
        priority=priority,
        invoiceBasis=invoice_basis,
        recommendation=rec_text,
        confidence=confidence,
        notes=data.get("notes") or None,
        textPreview=(data.get("textPreview") or "")[:2000],
    )

    logger.info(
        "Built recommendation for %s | status=%s | priority=%s | confidence=%s",
        filename,
        recommendation.status,
        recommendation.priority,
        recommendation.confidence,
    )

    return recommendation


def _safe_parse_json(raw: str, filename: str) -> dict[str, Any]:
    """Parse JSON returned by the LLM, recovering from common truncation issues.

    Strategy:
      1. Try a strict ``json.loads``.
      2. If that fails (typically because the response was cut off mid-string
         when ``max_tokens`` was hit), progressively trim trailing bytes until
         a valid prefix parses. We try cutting at the last ``,`` then ``"`` then
         walk back one char at a time, closing any open brackets we tracked.
      3. As a last resort, return ``{}`` so the record is saved as
         "Needs manual review" instead of crashing the whole batch.
    """
    if not raw or not raw.strip():
        return {}

    # 1. Strict parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 2. Truncate trailing junk and close open brackets/braces
    #    Walk the string, tracking string-vs-code state and the open-bracket
    #    stack. When the response was cut off mid-string, the safe move is to
    #    chop everything after the last *complete* key-value pair.
    last_safe_idx = -1  # index where we last saw a balanced ", \" outside a string
    depth_stack: list[str] = []
    in_string = False
    escape = False
    for i, ch in enumerate(raw):
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in "{[":
            depth_stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if depth_stack and depth_stack[-1] == ch:
                depth_stack.pop()
        elif ch == "," and depth_stack:
            # Position just before this comma is a safe truncation point —
            # everything up to here is a complete value inside the current
            # container.
            last_safe_idx = i

    if last_safe_idx > 0:
        repaired = raw[:last_safe_idx] + "".join(reversed(depth_stack))
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            pass

    # 3. Last-ditch regex match on the longest plausible JSON object
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    logger.error(
        "Could not parse OpenAI JSON for %s after recovery attempts (len=%d). "
        "Returning empty extraction.",
        filename, len(raw),
    )
    return {}


def _generate_id(filename: str, file_bytes: bytes | None = None) -> str:
    """Generate a deterministic record ID.

    Format: ``<cleanStem>-<sha256[:8]>``  (e.g. ``A45786-A38244-9f1b3a02``)

    The 8-char content-hash suffix guarantees:
      - identical bytes → identical ID  (true duplicate → safe overwrite)
      - any byte difference → different ID  (no silent overwrite of
        unrelated records that happen to share a filename)
    """
    stem = Path(filename).stem
    clean = re.sub(r"[^A-Za-z0-9\-]", "", stem)[:20] or "doc"
    if file_bytes:
        digest = hashlib.sha256(file_bytes).hexdigest()[:8]
        return f"{clean}-{digest}"
    return clean if clean else uuid.uuid4().hex[:8].upper()


# needed for Path usage in _generate_id
from pathlib import Path  # noqa: E402
