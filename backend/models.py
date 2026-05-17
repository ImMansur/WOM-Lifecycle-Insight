from __future__ import annotations

from enum import Enum
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class PartEntry(BaseModel):
    number: str
    description: Optional[str] = None
    qty: Optional[int] = None


class Recommendation(BaseModel):
    id: str
    sourceFile: str
    sourceType: Literal["PDF", "DOC", "DOCX"]
    extractionStatus: Literal["OK", "Needs OCR / manual review"]
    convertedDocx: Optional[str] = None
    customer: Optional[str] = None
    salesOrder: Optional[str] = None
    purchaseOrder: Optional[str] = None
    jobOrProject: Optional[str] = None
    location: Optional[str] = None
    equipment: Optional[str] = None
    partNumbers: List[PartEntry] = Field(default_factory=list)
    serials: List[str] = Field(default_factory=list)
    certificateDate: Optional[str] = None
    testedDate: Optional[str] = None
    lifecycleDate: Optional[str] = None
    recertificationDue: Optional[str] = None
    ageMonths: Optional[int] = None
    monthsToRecert: Optional[int] = None
    status: str
    priority: Literal["High", "Low", "Manual review"]
    invoiceBasis: Optional[str] = None
    recommendation: str
    confidence: Literal["High", "Low"]
    notes: Optional[str] = None
    textPreview: Optional[str] = None
    blobUrl: Optional[str] = None


class Summary(BaseModel):
    inputFolder: str = "Uploaded via browser"
    asOf: str
    filesProcessed: int
    ok: int
    highPriority: int
    needsOcr: int


class RecommendationsResponse(BaseModel):
    recommendations: List[Recommendation]
    summary: Summary


class IngestResponse(BaseModel):
    processed: int
    recommendations: List[Recommendation]
    errors: List[str] = Field(default_factory=list)


class PatchRecommendation(BaseModel):
    customer: Optional[str] = None
    salesOrder: Optional[str] = None
    purchaseOrder: Optional[str] = None
    jobOrProject: Optional[str] = None
    location: Optional[str] = None
    equipment: Optional[str] = None
    certificateDate: Optional[str] = None
    serials: Optional[List[str]] = None
    partNumbers: Optional[List[PartEntry]] = None
    notes: Optional[str] = None


# ─── Action Center ────────────────────────────────────────────────────────────

class ActionStatus(str, Enum):
    in_progress = "in_progress"
    closed = "closed"
    failed = "failed"


class ActionComment(BaseModel):
    id: str
    text: str
    author: str
    createdAt: str
    type: Literal["update", "ai_suggestion"] = "update"


class Action(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    status: ActionStatus = ActionStatus.in_progress
    linkedRecId: Optional[str] = None
    comments: List[ActionComment] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class CreateAction(BaseModel):
    title: str
    description: Optional[str] = None
    status: ActionStatus = ActionStatus.in_progress
    linkedRecId: Optional[str] = None


class PatchAction(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[ActionStatus] = None
    linkedRecId: Optional[str] = None


class AddComment(BaseModel):
    text: str
    author: str = "Admin"
