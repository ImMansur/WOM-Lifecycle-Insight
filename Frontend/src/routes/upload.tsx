import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ingestFiles,
  uploadFileInChunks,
  confirmIngestUpdates,
  type IngestResponse,
  type PendingDuplicate,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LoadingScreen } from "@/components/wom/LoadingScreen";
import { NotificationBell } from "@/components/wom/NotificationBell";
import {
  Upload,
  FileText,
  X,
  AlertTriangle,
  CloudUpload,
  CheckCircle2,
  ShieldAlert,
  LogOut,
  User,
  ChevronDown,
  Loader2,
  Zap,
  Wrench,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import { useLayout } from "./__root";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

// UserMenu component moved to __root.tsx layout wrapper

function UploadPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { addNotification } = useNotifications();
  const {
    setIsUploading,
    setUploadProgress,
    setUploadStatus,
    setUploadSubStatus,
  } = useLayout();
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate({ to: "/login" });
      } else if (user.role === "Analysis") {
        navigate({ to: "/dashboard" });
      }
    }
  }, [user, loading, navigate]);
  const [progress, setProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<IngestResponse | null>(null);
  // Duplicate-confirmation popup state
  const [pendingDuplicates, setPendingDuplicates] = useState<PendingDuplicate[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [blockedFiles, setBlockedFiles] = useState<{ name: string; size: number }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (filesToUpload: File[]): Promise<IngestResponse> => {
      const isLocal =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

      const total = filesToUpload.length;
      const combined: IngestResponse = {
        processed: 0,
        recommendations: [],
        pendingDuplicates: [],
        errors: [],
      };

      setUploadProgress(0);

      for (let i = 0; i < total; i++) {
        const file = filesToUpload[i];
        setUploadStatus(`Processing Document ${i + 1} of ${total}`);
        setUploadSubStatus(`Extracting & compressing '${file.name}'...`);

        try {
          let result: IngestResponse;
          if (!isLocal) {
            // Chunked upload for Vercel
            result = await uploadFileInChunks(file);
          } else {
            // Direct upload for local dev
            result = await ingestFiles([file]);
          }

          combined.processed += result.processed;
          combined.recommendations.push(...result.recommendations);
          combined.pendingDuplicates.push(...result.pendingDuplicates);
          combined.errors.push(...result.errors);
        } catch (err: any) {
          combined.errors.push(`${file.name}: processing failed — ${err.message || err}`);
        }

        setUploadProgress(Math.round(((i + 1) / total) * 100));
      }

      return combined;
    },
    onMutate: () => {
      setIsUploading(true);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });

      for (const rec of data.recommendations) {
        const needsReview =
          rec.priority === "Manual review" || rec.extractionStatus !== "OK" || !rec.customer;
        addNotification({
          fileName: rec.sourceFile,
          status: needsReview ? "warning" : "success",
          message: needsReview
            ? "Uploaded successfully · human review needed"
            : "Processed successfully",
        });
      }
      for (const err of data.errors) {
        const colonIdx = err.indexOf(": ");
        const fileName = colonIdx !== -1 ? err.slice(0, colonIdx) : err;
        const message = colonIdx !== -1 ? err.slice(colonIdx + 2) : "Processing failed";
        addNotification({ fileName, status: "error", message });
      }

      // If the backend flagged duplicates, pause here and let the admin decide.
      if (data.pendingDuplicates && data.pendingDuplicates.length > 0) {
        setSavedCount(data.processed);
        setPendingDuplicates(data.pendingDuplicates);
        setIsUploading(false);
        return; // do NOT navigate yet
      }

      setIsUploading(false);
      navigate({ to: "/dashboard", search: { tab: "Home" } });
    },
    onError: (err: Error) => {
      addNotification({
        fileName: files.map((f) => f.name).join(", ") || "Upload",
        status: "error",
        message: `Upload failed · ${err.message}`,
      });
      setIsUploading(false);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: confirmIngestUpdates,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      for (const rec of data.recommendations) {
        addNotification({
          fileName: rec.sourceFile,
          status: "success",
          message: "Replaced existing record",
        });
      }
      setPendingDuplicates([]);
      setSavedCount(0);
      navigate({ to: "/dashboard" });
    },
    onError: (err: Error) => {
      addNotification({ fileName: "Confirm", status: "error", message: err.message });
    },
  });

  const handleReplaceAll = () => {
    const updates = pendingDuplicates.map((d) => ({
      existingId: d.existingId,
      newRecommendation: d.newRecommendation,
    }));
    confirmMutation.mutate(updates);
  };

  const handleCancelDuplicates = () => {
    // Discard the new uploads — nothing gets replaced.
    setPendingDuplicates([]);
    setSavedCount(0);
    navigate({ to: "/dashboard" });
  };



  const addFiles = (incoming: FileList | File[]) => {
    const filtered = Array.from(incoming).filter((f) => /\.(pdf|doc|docx)$/i.test(f.name));
    const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB

    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      const newFiles = filtered.filter((f) => !names.has(f.name));
      if (newFiles.length === 0) return prev;

      let currentSize = prev.reduce((acc, f) => acc + f.size, 0);
      const added: File[] = [];
      const blocked: { name: string; size: number }[] = [];

      for (const f of newFiles) {
        if (currentSize + f.size > MAX_TOTAL_SIZE) {
          blocked.push({ name: f.name, size: f.size });
        } else {
          added.push(f);
          currentSize += f.size;
        }
      }

      if (blocked.length > 0) {
        setBlockedFiles(blocked);
      }

      return [...prev, ...added];
    });
  };

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name));

  const handleProcess = () => {
    if (files.length > 0) {
      mutation.mutate(files);
    }
  };

  if (mutation.isPending) {
    return null;
  }

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center p-8">
      {uploadResult ? (
        <div className="w-full max-w-3xl space-y-8 animate-in fade-in zoom-in-95 duration-500">
          <div className="text-center space-y-4">
            {uploadResult.errors && uploadResult.errors.length > 0 ? (
              <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-amber-500/10 ring-8 ring-amber-500/5 mb-6">
                <AlertTriangle className="size-10 text-amber-500" />
              </div>
            ) : (
              <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-green-500/10 ring-8 ring-green-500/5 mb-6">
                <CheckCircle2 className="size-10 text-green-500" />
              </div>
            )}
            <h1 className="font-display text-4xl font-black tracking-tight">Upload Logs</h1>
            <p className="text-muted-foreground">
              Processed {uploadResult.processed} files. Generated{" "}
              {uploadResult.recommendations?.length || 0} recommendations.
            </p>
          </div>

          <div
            className={`space-y-4 p-6 rounded-3xl border ${uploadResult.errors && uploadResult.errors.length > 0 ? "bg-secondary/30 border-border/40" : "bg-green-500/5 border-green-500/20"}`}
          >
            {uploadResult.errors && uploadResult.errors.length > 0 ? (
              <>
                <h3 className="font-semibold flex items-center gap-2">
                  <ShieldAlert className="size-5 text-destructive" />
                  {uploadResult.errors.length} Warning{uploadResult.errors.length !== 1 ? "s" : ""}
                </h3>
                <div className="max-h-80 overflow-y-auto pr-2 space-y-3">
                  {uploadResult.errors.map((err, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive font-mono"
                    >
                      {err}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <h3 className="font-semibold flex items-center gap-2 text-green-600 dark:text-green-500">
                <CheckCircle2 className="size-5" />
                No warnings. All documents processed successfully!
              </h3>
            )}
          </div>

          <div className="flex justify-center pt-4 gap-4">
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setUploadResult(null);
                setFiles([]);
              }}
              className="font-bold px-8 h-14 rounded-xl text-lg"
            >
              Upload More
            </Button>
            <Button
              size="lg"
              onClick={() => navigate({ to: "/dashboard" })}
              className="bg-primary hover:bg-primary/90 text-white font-bold px-8 h-14 rounded-xl text-lg shadow-xl shadow-primary/20"
            >
              Go to Dashboard
            </Button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-[1600px] grid grid-cols-1 lg:grid-cols-12 gap-8 px-6 py-6 items-start animate-in fade-in zoom-in-95 duration-500">
          {/* Left Column: Upload cockpit */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-2">
              <h1 className="font-display text-3xl font-black tracking-tight text-[#0D1117] md:text-4xl">
                Upload Certificates of Conformance
              </h1>
              <p className="text-sm text-muted-foreground font-medium">
                Supported formats: PDF, DOC, DOCX. Upload certificates to parse and match them
                against rules.
              </p>
            </div>

            {/* Upload Drop Zone Card */}
            <div className="bg-surface/50 border border-border/40 p-6 rounded-3xl backdrop-blur-md shadow-xl">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  addFiles(e.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
                className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all ${
                  dragOver
                    ? "border-primary bg-primary/5 scale-[1.01]"
                    : "border-border/60 bg-background/30 hover:border-primary/50 hover:bg-primary/5 hover:scale-[1.005]"
                }`}
              >
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  ref={inputRef}
                  onChange={(e) => e.target.files && addFiles(e.target.files)}
                />
                <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary shadow-md transition-transform duration-300 hover:scale-105">
                  <Upload className="size-6 text-primary animate-bounce" />
                </div>
                <p className="text-base font-bold text-foreground">Drag & drop files here</p>
                <p className="mt-1.5 text-xs text-muted-foreground font-medium">
                  or click to browse from your computer
                </p>
                <p className="mt-3 text-[10px] text-muted-foreground/60 uppercase tracking-widest font-mono">
                  PDF, DOC, DOCX up to 10MB TOTAL
                </p>
              </div>
            </div>

            {/* Selected Files Card */}
            {files.length > 0 && (
              <div className="space-y-4 bg-surface/50 border border-border/40 p-6 rounded-3xl backdrop-blur-md shadow-xl animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="flex items-center justify-between border-b border-border/30 pb-3">
                  <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary font-bold">
                      {files.length}
                    </span>
                    File{files.length !== 1 ? "s" : ""} Queued
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFiles([])}
                    className="h-8 text-xs font-semibold text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl px-3"
                  >
                    Clear all
                  </Button>
                </div>
                <div className="max-h-60 overflow-y-auto pr-1 space-y-2">
                  {files.map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center justify-between rounded-xl border border-border/60 bg-background/50 px-4 py-3 shadow-sm group hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText className="size-4 shrink-0 text-primary transition-transform group-hover:scale-110" />
                        <span
                          className="truncate text-xs font-semibold text-foreground"
                          title={f.name}
                        >
                          {f.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[10px] font-mono font-medium text-muted-foreground">
                          {(f.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(f.name);
                          }}
                          className="p-1 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error alert */}
            {mutation.isError && (
              <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-xs font-semibold text-destructive shadow-sm">
                <AlertTriangle className="size-4 shrink-0" />
                {(mutation.error as Error).message}
              </div>
            )}

            {/* Action Button */}
            <div className="flex justify-end">
              <Button
                size="lg"
                onClick={handleProcess}
                disabled={files.length === 0 || mutation.isPending}
                className="bg-primary hover:bg-primary/95 text-white font-bold px-8 h-14 rounded-2xl text-base shadow-xl shadow-primary/10 w-full sm:w-auto transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
              >
                <CloudUpload className="mr-2.5 size-5" />
                Process {files.length > 0 ? `${files.length} ` : ""}Document
                {files.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>

          {/* Right Column: Engine Details Panel */}
          <div className="lg:col-span-5 space-y-6 lg:mt-16">
            <div className="bg-surface/50 border border-border/40 p-6 rounded-3xl backdrop-blur-md shadow-xl space-y-5">
              <h3 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
                <Zap className="size-5 text-primary animate-pulse" /> Ingestion Pipeline
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                Each certificate is run through an advanced document classification and
                data-extraction sequence to build a structured equipment history.
              </p>

              <div className="space-y-4">
                {/* Step 1 */}
                <div className="flex gap-4 items-start p-4 rounded-2xl bg-background/40 border border-border/30 hover:border-primary/20 hover:bg-background/80 transition-all">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                    <FileText className="size-4.5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground">1. AI-Powered Extraction</h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                      Retrieve Customer Names, Sales Orders, Purchase Orders, and serial records
                      instantly with Azure AI Document Intelligence.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-4 items-start p-4 rounded-2xl bg-background/40 border border-border/30 hover:border-primary/20 hover:bg-background/80 transition-all">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 shrink-0">
                    <ShieldAlert className="size-4.5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground">
                      2. High Accuracy OCR Engine
                    </h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                      Scanned or flat documents undergo robust Optical Character Recognition to
                      extract text layers and confirm data alignment.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-4 items-start p-4 rounded-2xl bg-background/40 border border-border/30 hover:border-primary/20 hover:bg-background/80 transition-all">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 shrink-0">
                    <Wrench className="size-4.5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground">
                      3. Lifecycle Opportunity Matching
                    </h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                      Verify certificate dates against corporate database rules to compute precise
                      service intervals and prompt upcoming recertifications.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate-confirmation popup — locked: admin MUST click one of the
          two footer buttons. Escape key, outside click, and the X close button
          are all disabled. */}
      <Dialog open={pendingDuplicates.length > 0}>
        <DialogContent
          className="sm:max-w-lg bg-surface border-border [&>button]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-foreground flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              Possible duplicates detected
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              {savedCount > 0 && (
                <span className="block mb-1 text-emerald-600 font-medium">
                  {savedCount} new record{savedCount !== 1 ? "s" : ""} saved.
                </span>
              )}
              {pendingDuplicates.length} uploaded file
              {pendingDuplicates.length !== 1 ? "s match" : " matches"} an existing record (same
              file or same customer + sales order + certificate date). Replace the existing record
              {pendingDuplicates.length !== 1 ? "s" : ""} or cancel the upload.
            </DialogDescription>
          </DialogHeader>

          <ul className="mt-2 max-h-[55vh] divide-y divide-border/30 overflow-y-auto rounded-lg border border-border/40">
            {pendingDuplicates.map((d) => (
              <li key={d.existingId + d.newRecommendation.id} className="p-3 space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Existing record
                  </p>
                  <p className="font-mono text-xs text-foreground truncate" title={d.existingFile}>
                    {d.existingFile}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {d.existingCustomer ?? "—"} · SO {d.existingSalesOrder ?? "—"} ·{" "}
                    {d.existingCertificateDate ?? "—"}
                  </p>
                </div>
                <div className="border-t border-border/30 pt-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    New upload
                  </p>
                  <p
                    className="font-mono text-xs text-foreground truncate"
                    title={d.newRecommendation.sourceFile}
                  >
                    {d.newRecommendation.sourceFile}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {confirmMutation.isError && (
            <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              {(confirmMutation.error as Error).message}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelDuplicates}
              disabled={confirmMutation.isPending}
            >
              Cancel upload
            </Button>
            <Button
              size="sm"
              disabled={confirmMutation.isPending}
              onClick={handleReplaceAll}
              className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold"
            >
              {confirmMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Replacing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 size-4" />
                  Replace existing
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Blocked Files Modal */}
      <Dialog open={blockedFiles.length > 0} onOpenChange={(open) => !open && setBlockedFiles([])}>
        <DialogContent className="sm:max-w-md bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-foreground flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive animate-pulse" />
              Files Exceeded 10MB Limit
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              The following files could not be added because they would exceed the total upload limit of 10 MB:
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 max-h-[40vh] divide-y divide-border/30 overflow-y-auto rounded-lg border border-border/40">
            {blockedFiles.map((f, idx) => (
              <div key={idx} className="flex justify-between items-center p-3 text-xs bg-background/50 hover:bg-background/80 transition-colors">
                <span className="font-mono text-foreground truncate max-w-[260px] font-semibold" title={f.name}>
                  {f.name}
                </span>
                <span className="text-muted-foreground font-mono shrink-0">
                  {(f.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => setBlockedFiles([])}
              className="bg-primary hover:bg-primary/90 text-white font-bold"
            >
              Acknowledge
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
