import type { Recommendation } from "./wom-data";

const BASE = import.meta.env.VITE_API_URL ?? "";

export interface Summary {
  inputFolder: string;
  asOf: string;
  filesProcessed: number;
  ok: number;
  highPriority: number;
  needsOcr: number;
}

export interface RecommendationsResponse {
  recommendations: Recommendation[];
  summary: Summary;
}

export interface PendingDuplicate {
  existingId: string;
  existingFile: string;
  existingCustomer: string | null;
  existingSalesOrder: string | null;
  existingCertificateDate: string | null;
  newRecommendation: Recommendation;
}

export interface ConfirmDuplicateItem {
  existingId: string;
  newRecommendation: Recommendation;
}

export interface IngestResponse {
  processed: number;
  recommendations: Recommendation[];
  pendingDuplicates: PendingDuplicate[];
  errors: string[];
}

export async function fetchRecommendations(): Promise<RecommendationsResponse> {
  const res = await fetch(`${BASE}/api/recommendations`);
  if (!res.ok) throw new Error(`Failed to fetch recommendations: ${res.statusText}`);
  return res.json();
}

export async function ingestFiles(files: File[]): Promise<IngestResponse> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  const res = await fetch(`${BASE}/api/ingest`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ingest failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function confirmIngestUpdates(
  updates: ConfirmDuplicateItem[],
): Promise<IngestResponse> {
  const res = await fetch(`${BASE}/api/ingest/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Confirm failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function deleteRecommendation(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/recommendations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Delete failed: ${res.statusText}`);
  }
}

export async function deleteMultipleRecommendations(ids: string[]): Promise<{ deleted: number; not_found: string[] }> {
  const res = await fetch(`${BASE}/api/recommendations/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    throw new Error(`Bulk delete failed: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchDocumentUrl(filename: string): Promise<{ url: string; filename: string }> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const needsSas = ext === "docx" || ext === "doc" || ext === "xlsx" || ext === "xls";
  if (needsSas) {
    // Office Online viewer requires a publicly accessible URL — use SAS
    const res = await fetch(`${BASE}/api/documents/${encodeURIComponent(filename)}/url`);
    if (!res.ok) throw new Error(`Could not get document URL: ${res.statusText}`);
    return res.json();
  }
  // PDF and images: proxy through backend so Content-Disposition: inline is enforced
  return { url: `${BASE}/api/documents/${encodeURIComponent(filename)}/view`, filename };
}

export interface RecommendationPatch {
  customer?: string;
  salesOrder?: string;
  purchaseOrder?: string;
  jobOrProject?: string;
  location?: string;
  equipment?: string;
  certificateDate?: string;
  serials?: string[];
  partNumbers?: { number: string; description: string | null; qty: number | null }[];
  notes?: string;
  priority?: "High" | "Low" | "Manual review";
}

export async function updateRecommendation(
  id: string,
  patch: RecommendationPatch,
): Promise<import("./wom-data").Recommendation> {
  const res = await fetch(`${BASE}/api/recommendations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Action Center ────────────────────────────────────────────────────────────

export type ActionStatus = "in_progress" | "closed" | "failed";

export interface ActionComment {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  type: "update" | "ai_suggestion";
}

export interface Action {
  id: string;
  title: string;
  description: string | null;
  status: ActionStatus;
  linkedRecId: string | null;
  comments: ActionComment[];
  createdAt: string;
  updatedAt: string;
}

export async function fetchActions(): Promise<Action[]> {
  const res = await fetch(`${BASE}/api/actions`);
  if (!res.ok) throw new Error(`Failed to fetch actions: ${res.statusText}`);
  return res.json();
}

export async function createAction(body: {
  title: string;
  description?: string;
  status?: ActionStatus;
  linkedRecId?: string;
}): Promise<Action> {
  const res = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create action failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function patchAction(
  id: string,
  patch: { title?: string; description?: string; status?: ActionStatus; linkedRecId?: string },
): Promise<Action> {
  const res = await fetch(`${BASE}/api/actions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Patch action failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function deleteAction(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/actions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Delete action failed: ${res.statusText}`);
  }
}

export async function addComment(
  actionId: string,
  text: string,
  author = "Admin",
): Promise<Action> {
  const res = await fetch(`${BASE}/api/actions/${encodeURIComponent(actionId)}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, author }),
  });
  if (!res.ok) {
    const text2 = await res.text();
    throw new Error(`Add comment failed (${res.status}): ${text2}`);
  }
  return res.json();
}

export async function deleteComment(actionId: string, commentId: string): Promise<Action> {
  const res = await fetch(
    `${BASE}/api/actions/${encodeURIComponent(actionId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete comment failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function suggestNextSteps(actionId: string): Promise<Action> {
  const res = await fetch(
    `${BASE}/api/actions/${encodeURIComponent(actionId)}/suggest`,
    { method: "POST" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Suggest failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

export async function exportToExcel(recIds: string[]): Promise<void> {
  const res = await fetch(`${BASE}/api/export/excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rec_ids: recIds }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Export failed (${res.status}): ${text}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wom-records-${today}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
