"""Recommendations router — CRUD for stored recommendations."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, status

from models import Recommendation, RecommendationsResponse, Summary, PatchRecommendation
from store import recommendation_store, action_store

router = APIRouter(prefix="/api", tags=["recommendations"])


@router.get("/recommendations", response_model=RecommendationsResponse)
async def get_recommendations():
    """Return all stored recommendations with a computed summary."""
    recs = recommendation_store.all()

    total = len(recs)
    ok = sum(1 for r in recs if r.extractionStatus == "OK")
    high = sum(1 for r in recs if r.priority == "High")
    needs_ocr = sum(1 for r in recs if r.extractionStatus == "Needs OCR / manual review")

    summary = Summary(
        asOf=date.today().isoformat(),
        filesProcessed=total,
        ok=ok,
        highPriority=high,
        needsOcr=needs_ocr,
    )

    return RecommendationsResponse(recommendations=recs, summary=summary)


@router.delete(
    "/recommendations/{rec_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_recommendation(rec_id: str):
    """Remove a recommendation by ID."""
    removed = recommendation_store.remove(rec_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Recommendation '{rec_id}' not found.")
        
    actions = action_store.all()
    for action in actions:
        if action.linkedRecId == rec_id:
            action_store.remove(action.id)


@router.patch("/recommendations/{rec_id}", response_model=Recommendation)
async def patch_recommendation(rec_id: str, patch: PatchRecommendation):
    """Manually correct extracted fields. Marks record as reviewed (OK / High confidence)."""
    fields = patch.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided.")

    # Serialize nested models (PartEntry list) for Firestore
    if "partNumbers" in fields:
        fields["partNumbers"] = [p.model_dump() for p in (patch.partNumbers or [])]

    # Mark as manually reviewed once admin saves corrections
    fields["extractionStatus"] = "OK"
    fields["confidence"] = "High"

    success = recommendation_store.update(rec_id, fields)
    if not success:
        raise HTTPException(status_code=404, detail=f"Recommendation '{rec_id}' not found.")

    updated = recommendation_store.get(rec_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Could not retrieve updated record.")
    return updated


@router.get("/health")
async def health():
    return {"status": "ok"}
