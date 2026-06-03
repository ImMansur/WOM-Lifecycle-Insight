import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ingestFiles, confirmIngestUpdates, getUploadSas, ingestFromBlob, type IngestResponse, type PendingDuplicate } from "@/lib/api";
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
import { Upload, FileText, X, AlertTriangle, CloudUpload, CheckCircle2, ShieldAlert, LogOut, User, ChevronDown, Loader2 } from "lucide-react";
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

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const initials = (user.displayName ?? user.email ?? "A")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group flex items-center gap-3 px-3 py-2 rounded-2xl cursor-pointer border border-transparent hover:border-border/40 hover:bg-secondary/60 hover:shadow-sm transition-all focus:outline-none">
          <Avatar className="size-9 border border-border bg-primary/10 transition-transform group-hover:scale-105">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="hidden sm:flex flex-col text-left leading-tight">
            <div className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">{user.displayName ?? "Admin"}</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">{(user as any).role ?? "Fleet Manager"}</div>
          </div>
          <ChevronDown className="hidden sm:block size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-all group-hover:translate-y-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-surface border-border">
        <DropdownMenuLabel>
          <div className="font-semibold text-foreground truncate">{user.displayName ?? "Admin"}</div>
          <div className="text-xs text-muted-foreground font-normal truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-muted-foreground cursor-pointer">
          <User className="size-4" /> Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-destructive cursor-pointer"
          onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UploadPage() {
  const navigate = useNavigate();
  const { addNotification } = useNotifications();
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<IngestResponse | null>(null);
  // Duplicate-confirmation popup state
  const [pendingDuplicates, setPendingDuplicates] = useState<PendingDuplicate[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (filesToUpload: File[]): Promise<IngestResponse> => {
      if (import.meta.env.VITE_USE_SAS_UPLOAD === "true") {
        // Vercel path: browser uploads directly to Azure Blob via SAS,
        // bypassing Vercel's 4.5 MB function body limit entirely.
        const blobNames: string[] = [];
        for (const file of filesToUpload) {
          const { url, blobName } = await getUploadSas(file.name);
          const putRes = await fetch(url, {
            method: "PUT",
            headers: {
              "x-ms-blob-type": "BlockBlob",
              "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
          });
          if (!putRes.ok) {
            throw new Error(`Azure upload failed for ${file.name}: ${putRes.status} ${putRes.statusText}`);
          }
          blobNames.push(blobName);
        }
        return ingestFromBlob(blobNames);
      }

      // Local dev path: POST files directly to the backend (no size limit locally).
      return ingestFiles(filesToUpload);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });

      for (const rec of data.recommendations) {
        const needsReview = rec.priority === "Manual review" || rec.extractionStatus !== "OK" || !rec.customer;
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
        return; // do NOT navigate yet
      }

      navigate({ to: "/dashboard" });
    },
    onError: (err: Error) => {
      addNotification({
        fileName: files.map((f) => f.name).join(", ") || "Upload",
        status: "error",
        message: `Upload failed · ${err.message}`,
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: confirmIngestUpdates,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      for (const rec of data.recommendations) {
        addNotification({ fileName: rec.sourceFile, status: "success", message: "Replaced existing record" });
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

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (mutation.isPending) {
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => {
          const remaining = 99 - prev;
          if (remaining <= 1) return 99;
          return prev + Math.max(1, remaining * 0.1);
        });
      }, 500);
    }
    return () => clearInterval(interval);
  }, [mutation.isPending]);

  const addFiles = (incoming: FileList | File[]) => {
    const filtered = Array.from(incoming).filter((f) =>
      /\.(pdf|doc|docx)$/i.test(f.name)
    );
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...filtered.filter((f) => !names.has(f.name))];
    });
  };

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name));

  const handleProcess = () => {
    if (files.length > 0) {
      mutation.mutate(files);
    }
  };

  if (mutation.isPending) {
    return (
      <LoadingScreen 
        progressValue={progress}
        title="Document"
        subtitle="Intelligence"
        statusText={`Processing ${files.length} document${files.length !== 1 ? 's' : ''}`}
        subStatusText="Extracting Data with AI Engine..."
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20 flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1600px] items-center gap-8 px-6">
          <div className="flex items-center gap-5">
            <div className="relative size-14 shrink-0 overflow-hidden rounded-full border-2 border-primary/20 bg-white shadow-xl shadow-primary/10 transition-all hover:scale-110 hover:shadow-primary/20">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent" />
              <img
                src="/logo.png"
                alt="WOM Logo"
                className="relative z-10 size-full object-contain p-1.5"
              />
            </div>
            <div className="leading-tight">
              <div className="font-display text-lg font-black tracking-tight text-accent">WOM <span className="text-primary">Lifecycle</span></div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/80">
                Worldwide Oilfield Machine
              </div>
            </div>
          </div>

          <nav className="mx-auto hidden items-center gap-1 rounded-full bg-secondary/80 p-1.5 backdrop-blur-sm md:flex">
            <Link to="/dashboard" className="rounded-full px-6 py-2 text-sm font-semibold transition-all text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/upload" className="rounded-full px-6 py-2 text-sm font-semibold transition-all bg-primary text-white shadow-md shadow-primary/20">Upload</Link>
            <Link to="/action-center" className="rounded-full px-6 py-2 text-sm font-semibold transition-all text-muted-foreground hover:text-foreground">Action Center</Link>
            <Link to="/dashboard" search={{ tab: "Lifecycle Rules" }} className="rounded-full px-6 py-2 text-sm font-semibold transition-all text-muted-foreground hover:text-foreground">Lifecycle Rules</Link>
          </nav>

          <div className="ml-auto flex items-center gap-6">
            <div className="hidden sm:flex items-center gap-2">
              <NotificationBell />
            </div>
            <div className="h-8 w-px bg-border/50 hidden sm:block" />
            <div className="flex items-center gap-3">
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-8">
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
                Processed {uploadResult.processed} files. Generated {uploadResult.recommendations?.length || 0} recommendations.
              </p>
            </div>

            <div className={`space-y-4 p-6 rounded-3xl border ${uploadResult.errors && uploadResult.errors.length > 0 ? 'bg-secondary/30 border-border/40' : 'bg-green-500/5 border-green-500/20'}`}>
              {uploadResult.errors && uploadResult.errors.length > 0 ? (
                <>
                  <h3 className="font-semibold flex items-center gap-2">
                    <ShieldAlert className="size-5 text-destructive" />
                    {uploadResult.errors.length} Warning{uploadResult.errors.length !== 1 ? 's' : ''}
                  </h3>
                  <div className="max-h-80 overflow-y-auto pr-2 space-y-3">
                    {uploadResult.errors.map((err, idx) => (
                      <div key={idx} className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive font-mono">
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
                onClick={() => { setUploadResult(null); setFiles([]); }}
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
          <div className="w-full max-w-3xl space-y-8">
            <div className="text-center space-y-4">
              <h1 className="font-display text-4xl font-black tracking-tight">Upload Certificates of Conformance</h1>
              <p className="text-muted-foreground">Supported formats: PDF, DOC, DOCX. Data will be automatically extracted and matched against lifecycle rules.</p>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer rounded-3xl border-2 border-dashed p-12 text-center transition-all ${
                dragOver ? "border-primary bg-primary/5 scale-[1.02]" : "border-border/60 hover:border-primary/50 hover:bg-secondary/20"
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
              <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-2xl bg-secondary shadow-sm">
                <Upload className="size-8 text-primary" />
              </div>
              <p className="text-lg font-bold">Drag & drop files here</p>
              <p className="mt-2 text-sm text-muted-foreground">or click to browse from your computer</p>
            </div>

            {files.length > 0 && (
              <div className="space-y-4 bg-secondary/30 p-6 rounded-3xl border border-border/40">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{files.length} file{files.length !== 1 ? 's' : ''} selected</h3>
                  <Button variant="ghost" size="sm" onClick={() => setFiles([])} className="text-destructive hover:text-destructive hover:bg-destructive/10">Clear all</Button>
                </div>
                <div className="max-h-60 overflow-y-auto pr-2 space-y-2">
                  {files.map((f) => (
                    <div key={f.name} className="flex items-center justify-between rounded-xl border border-border/60 bg-background px-4 py-3 shadow-sm">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText className="size-5 shrink-0 text-primary" />
                        <span className="truncate text-sm font-medium">{f.name}</span>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); removeFile(f.name); }} className="shrink-0 p-1 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors">
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mutation.isError && (
              <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertTriangle className="size-5 shrink-0" />
                {(mutation.error as Error).message}
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button
                size="lg"
                onClick={handleProcess}
                disabled={files.length === 0 || mutation.isPending}
                className="bg-primary hover:bg-primary/90 text-white font-bold px-8 h-14 rounded-xl text-lg shadow-xl shadow-primary/20 w-full sm:w-auto"
              >
                <CloudUpload className="mr-2 size-5" />
                Process {files.length > 0 ? files.length : ''} {files.length === 1 ? 'Document' : 'Documents'}
              </Button>
            </div>
          </div>
        )}
      </main>

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
              {pendingDuplicates.length !== 1 ? "s match" : " matches"} an existing record
              (same file or same customer + sales order + certificate date).
              Replace the existing record{pendingDuplicates.length !== 1 ? "s" : ""} or cancel
              the upload.
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
                    {d.existingCustomer ?? "—"} · SO {d.existingSalesOrder ?? "—"} · {d.existingCertificateDate ?? "—"}
                  </p>
                </div>
                <div className="border-t border-border/30 pt-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    New upload
                  </p>
                  <p className="font-mono text-xs text-foreground truncate" title={d.newRecommendation.sourceFile}>
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
    </div>
  );
}
