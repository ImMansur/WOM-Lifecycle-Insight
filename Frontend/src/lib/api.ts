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

// 3.5 MB — safely under Vercel's 4.5 MB function body limit
const CHUNK_SIZE = 3.5 * 1024 * 1024;

/**
 * Upload a single file in chunks through the Vercel backend.
 * Each chunk is staged as an Azure Blob block server-side (no browser→Azure
 * CORS required). On the final chunk the backend assembles and processes the
 * file, returning the normal IngestResponse.
 */
export async function uploadFileInChunks(file: File): Promise<IngestResponse> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, start + CHUNK_SIZE);

    const form = new FormData();
    form.append("file", chunk, file.name);
    form.append("filename", file.name);
    form.append("chunk_index", String(i));
    form.append("total_chunks", String(totalChunks));

    const res = await fetch(`${BASE}/api/ingest-chunk`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ingest failed (${res.status}): ${text}`);
    }

    if (i === totalChunks - 1) {
      return res.json() as Promise<IngestResponse>;
    }
  }

  throw new Error("No response received from final chunk.");
}

export interface UploadSasResponse {
  url: string;
  blobName: string;
}

/**
 * Get a short-lived Azure Blob SAS URL so the browser can PUT the file
 * directly to blob storage, bypassing Vercel's 4.5 MB function body limit.
 */
export async function getUploadSas(filename: string): Promise<UploadSasResponse> {
  const res = await fetch(`${BASE}/api/upload-sas?filename=${encodeURIComponent(filename)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get upload URL (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Tell the backend to process files that are already in Azure Blob Storage.
 * Call this after uploading files via SAS URLs.
 */
export async function ingestFromBlob(blobNames: string[]): Promise<IngestResponse> {
  const res = await fetch(`${BASE}/api/ingest-from-blob`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blobNames),
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

// ─── User Management ──────────────────────────────────────────────────────────

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string;
}

export async function fetchUsers(): Promise<UserProfile[]> {
  const res = await fetch(`${BASE}/api/users`);
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.statusText}`);
  return res.json();
}

export async function createUser(body: {
  email: string;
  password?: string;
  displayName: string;
  role: string;
}): Promise<UserProfile> {
  const res = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create user (${res.status}): ${text}`);
  }
  return res.json();
}

export async function deleteUser(uid: string): Promise<void> {
  const res = await fetch(`${BASE}/api/users/${encodeURIComponent(uid)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete user: ${res.statusText}`);
  }
}

export async function fetchUserRole(uid: string): Promise<{ role: string }> {
  const res = await fetch(`${BASE}/api/users/role/${encodeURIComponent(uid)}`);
  if (!res.ok) throw new Error(`Failed to fetch user role: ${res.statusText}`);
  return res.json();
}
