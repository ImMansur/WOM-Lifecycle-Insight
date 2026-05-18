import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recommendation } from "@/lib/wom-data";
import { fetchRecommendations, ingestFiles, deleteRecommendation, fetchActions, exportToExcel } from "@/lib/api";
import type { Action } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StatusBadge, PriorityChip } from "@/components/wom/StatusBadge";
import { RecommendationDetail } from "@/components/wom/RecommendationDetail";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudUpload,
  FileSearch,
  FileText,
  Filter,
  Loader2,
  Package,
  Search,
  ShieldAlert,
  TrendingUp,
  Upload,
  Users,
  Wrench,
  X,
  Zap,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Trash2,
  LogOut,
  User,
  Settings,
  Bell,
  MessageSquare,
  MapPin,
  FileDown,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationBell } from "@/components/wom/NotificationBell";
import { useAuth } from "@/lib/auth-context";
import { LifecycleRulesTab } from "@/components/wom/LifecycleRulesTab";
import {
  FilterBar,
  MetricCard,
  ChartsSection,
  type TimeFilter,
  type PriorityFilter,
} from "@/components/wom/HomeTab";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string | undefined) ?? "Home",
    q: (search.q as string | undefined) ?? "",
    filter: (search.filter as FilterKey | undefined) ?? "all" as FilterKey,
    time: (search.time as string | undefined) ?? "all",
    priority: (search.priority as string | undefined) ?? "all",
    clients: (search.clients as string | undefined) ?? "",
    locations: (search.locations as string | undefined) ?? "",
    parts: (search.parts as string | undefined) ?? "",
  }),
  component: Dashboard,
});

// ─── Upload Dialog ────────────────────────────────────────────────────────────

function UploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ingestFiles,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      setFiles([]);
      onOpenChange(false);
      if (data.errors.length > 0) {
        console.warn("Ingest warnings:", data.errors);
      }
    },
  });

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-surface border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-lg text-foreground">
            Ingest Documents
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Upload PDF, DOC, or DOCX certificates of conformance. Each file is
            processed through Document Intelligence and the AI Extraction Engine.
          </DialogDescription>
        </DialogHeader>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`mt-2 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 transition-colors ${dragOver
            ? "border-primary bg-primary/5"
            : "border-border/60 bg-background/20 hover:border-primary/50 hover:bg-primary/5"
            }`}
        >
          <CloudUpload className="size-10 text-muted-foreground/50" />
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              Drop files here or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, DOC, DOCX — up to 50 MB each</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <ul className="mt-3 max-h-48 divide-y divide-border/30 overflow-y-auto rounded-lg border border-border/40">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-3 px-3 py-2.5">
                <FileText className="size-4 shrink-0 text-primary/60" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {f.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(f.name); }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Error banner */}
        {mutation.isError && (
          <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            {(mutation.error as Error).message}
          </div>
        )}

        {/* Partial errors from API */}
        {mutation.isSuccess && mutation.data.errors.length > 0 && (
          <div className="mt-2 space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-warning">
            {mutation.data.errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { onOpenChange(false); setFiles([]); }}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={files.length === 0 || mutation.isPending}
            onClick={() => mutation.mutate(files)}
            className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <Upload className="mr-2 size-4" />
                Process {files.length} file{files.length !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UserMenu() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  if (!user) return null;

  const initials = (user.displayName || "WOM Administrator")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

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
            <div className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">{user.displayName || "Admin"}</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">{user.role || "Fleet Manager"}</div>
          </div>
          <ChevronDown className="hidden sm:block size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-all group-hover:translate-y-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-surface border-border">
        <DropdownMenuLabel>
          <div className="font-semibold text-foreground truncate">{user.displayName || "Admin"}</div>
          <div className="text-xs text-muted-foreground font-normal truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer">
          <User className="mr-2 h-4 w-4" />
          <span>Profile Details</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive cursor-pointer"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Secure Logout</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Confidence score ────────────────────────────────────────────────────────

function getConfidenceScore(r: { confidence: string; extractionStatus: string; customer: string | null; equipment: string | null; recertificationDue: string | null; salesOrder: string | null; purchaseOrder: string | null; certificateDate: string | null; location: string | null }): number {
  const keyFields = [r.customer, r.equipment, r.recertificationDue, r.salesOrder ?? r.purchaseOrder, r.certificateDate, r.location];
  const missingCount = keyFields.filter((f) => !f).length;
  const base = r.confidence === "High" ? 90 : 65;
  const ocrPenalty = r.extractionStatus !== "OK" ? 20 : 0;
  const fieldPenalty = missingCount * 2;
  return Math.max(5, Math.min(100, base - ocrPenalty - fieldPenalty));
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [lastRefreshed, setLastRefreshed] = useState(() => new Date());
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<"priority" | "customer" | "recertDue" | "status" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ── All filter state lives in the URL ─────────────────────────────────────
  const activeTab = search.tab;
  const filter = search.filter as FilterKey;
  const query = search.q;
  const recTimeFilter = search.time as TimeFilter;
  const recPriorityFilter = search.priority as PriorityFilter;
  const recClients = search.clients ? search.clients.split("|") : [] as string[];
  const recLocations = search.locations ? search.locations.split("|") : [] as string[];
  const recParts = search.parts ? search.parts.split("|") : [] as string[];

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({ to: "/dashboard", search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });

  const setActiveTab = (v: string) => setSearch({ tab: v });
  const setFilter = (v: FilterKey) => setSearch({ filter: v });
  const setQuery = (v: string) => setSearch({ q: v });
  const setRecTimeFilter = (v: TimeFilter) => setSearch({ time: v });
  const setRecPriorityFilter = (v: PriorityFilter) => setSearch({ priority: v });
  const setRecClients = (v: string[]) => setSearch({ clients: v.join("|") });
  const setRecLocations = (v: string[]) => setSearch({ locations: v.join("|") });
  const setRecParts = (v: string[]) => setSearch({ parts: v.join("|") });

  const qc = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: deleteRecommendation,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      qc.invalidateQueries({ queryKey: ["actions"] });
      setDeleteId(null);
    },
  });

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
    }
  }, [user, loading, navigate]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["recommendations"],
    queryFn: fetchRecommendations,
    refetchInterval: 30_000,
  });

  const { data: actions = [] } = useQuery<Action[]>({
    queryKey: ["actions"],
    queryFn: fetchActions,
    refetchInterval: 30_000,
  });

  function getLinkedAction(recId: string) {
    return actions.find((a) => a.linkedRecId === recId);
  }

  const handleRefresh = () => {
    refetch();
    setLastRefreshed(new Date());
  };

  const recommendations = data?.recommendations ?? [];
  const summary = data?.summary ?? {
    inputFolder: "—",
    asOf: new Date().toISOString().slice(0, 10),
    filesProcessed: 0,
    ok: 0,
    highPriority: 0,
    needsOcr: 0,
  };

  // ── Filtered by FilterBar only → drives KPI cards + charts ──────────────
  const filtered = useMemo(() => {
    return recommendations.filter((r) => {
      // Advanced filters (FilterBar)
      if (recTimeFilter === "overdue") {
        if (r.monthsToRecert === null || r.monthsToRecert >= 0) return false;
      } else if (recTimeFilter === "3m") {
        if (r.monthsToRecert === null || r.monthsToRecert > 3 || r.monthsToRecert < 0) return false;
      } else if (recTimeFilter === "6m") {
        if (r.monthsToRecert === null || r.monthsToRecert > 6 || r.monthsToRecert < 0) return false;
      } else if (recTimeFilter === "12m") {
        if (r.monthsToRecert === null || r.monthsToRecert > 12 || r.monthsToRecert < 0) return false;
      }
      if (recPriorityFilter !== "all" && r.priority !== recPriorityFilter) return false;
      if (recClients.length > 0 && !recClients.includes(r.customer ?? "")) return false;
      if (recLocations.length > 0 && !recLocations.includes(r.location ?? "")) return false;
      if (recParts.length > 0 && !r.partNumbers.some((p) => recParts.includes(p.number))) return false;
      return true;
    });
  }, [recommendations, recTimeFilter, recPriorityFilter, recClients, recLocations, recParts]);

  // ── Table rows: filtered + text search → drives the records table only ───
  const tableRows = useMemo(() => {
    if (!query) return filtered;
    const q = query.toLowerCase();
    return filtered.filter((r) => {
      const hay = [
        r.customer,
        r.equipment,
        r.salesOrder,
        r.purchaseOrder,
        r.sourceFile,
        ...r.partNumbers.map((p) => p.number),
        ...r.serials,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filtered, query]);

  // ── Sort + paginate ───────────────────────────────────────────────────────
  const PAGE_SIZE = 50;

  const sortedRows = useMemo(() => {
    if (!sortKey) return tableRows;
    return [...tableRows].sort((a, b) => {
      let av = "", bv = "";
      if (sortKey === "priority") {
        const order = { "High": 0, "Manual review": 1, "Low": 2 };
        const ai = order[a.priority as keyof typeof order] ?? 9;
        const bi = order[b.priority as keyof typeof order] ?? 9;
        return sortDir === "asc" ? ai - bi : bi - ai;
      }
      if (sortKey === "customer") { av = a.customer ?? ""; bv = b.customer ?? ""; }
      else if (sortKey === "recertDue") { av = a.recertificationDue ?? "9999-12-31"; bv = b.recertificationDue ?? "9999-12-31"; }
      else if (sortKey === "status") { av = a.status; bv = b.status; }
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [tableRows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pagedRows = useMemo(() => sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sortedRows, page]);

  // Reset to page 0 whenever filters or search change
  useEffect(() => { setPage(0); }, [query, recTimeFilter, recPriorityFilter, recClients.join(), recLocations.join(), recParts.join()]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function SortIcon({ col }: { col: typeof sortKey }) {
    if (sortKey !== col) return <ChevronDown className="size-3 opacity-20" />;
    return sortDir === "asc"
      ? <ChevronUp className="size-3 text-primary" />
      : <ChevronDown className="size-3 text-primary" />;
  }

  function ExportButton({ ids }: { ids: string[] }) {
    const [loading, setLoading] = useState(false);
    async function handleExport() {
      if (!ids.length) return;
      setLoading(true);
      try {
        await exportToExcel(ids);
      } catch (err) {
        console.error("Export failed", err);
      } finally {
        setLoading(false);
      }
    }
    return (
      <Button
        onClick={handleExport}
        disabled={loading || !ids.length}
        variant="outline"
        size="sm"
        className="h-11 gap-2 rounded-xl border-border/40 bg-secondary/30 px-4 text-sm font-semibold text-foreground hover:bg-secondary/60 transition-all"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileDown className="size-4" />
        )}
        Export Excel {ids.length > 0 && <span className="text-muted-foreground">({ids.length})</span>}
      </Button>
    );
  }


  const recClientOptions = useMemo(
    () => [...new Set(recommendations.map((r) => r.customer).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [recommendations]
  );
  const recLocationOptions = useMemo(
    () => [...new Set(recommendations.map((r) => r.location).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [recommendations]
  );
  const recPartOptions = useMemo(() => {
    const all = recommendations.flatMap((r) => r.partNumbers.map((p) => p.number));
    return [...new Set(all)].sort((a, b) => a.localeCompare(b));
  }, [recommendations]);

  // ── KPI metrics (from filtered results) ───────────────────────────────────
  const recMetrics = useMemo(() => {
    const total = filtered.length;
    const high = filtered.filter((r) => r.priority === "High").length;
    const overdue = filtered.filter((r) => r.status === "Expired / overdue").length;
    const dueSoon = filtered.filter((r) => r.monthsToRecert !== null && r.monthsToRecert >= 0 && r.monthsToRecert <= 6).length;
    const customers = new Set(filtered.map((r) => r.customer).filter(Boolean)).size;
    const equipment = new Set(filtered.map((r) => r.equipment).filter(Boolean)).size;
    const parts = filtered.reduce((a, r) => a + r.partNumbers.length, 0);
    const highConf = filtered.filter((r) => r.confidence === "High").length;
    const extractionRate = total > 0 ? Math.round((highConf / total) * 100) : 0;
    return { total, high, overdue, dueSoon, customers, equipment, parts, extractionRate };
  }, [filtered]);

  const openDetail = (r: Recommendation) => {
    setSelected(r);
    setOpen(true);
  };

  if (!user && !loading) return null;

  return (
    <div className="relative min-h-screen text-foreground selection:bg-primary/20">
      {/* Fixed Background Layers */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-mesh" />
        <div className="absolute inset-0 bg-grid" />
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Top bar */}
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
            <button
              onClick={() => setActiveTab("Home")}
              className={`rounded-full px-6 py-2 text-sm transition-all font-semibold ${
                activeTab === "Home"
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Home
            </button>
            <a
              href="/upload"
              onClick={(e) => {
                e.preventDefault();
                navigate({ to: "/upload" });
              }}
              className="rounded-full px-6 py-2 text-sm transition-all font-semibold text-muted-foreground hover:text-foreground"
            >
              Upload
            </a>
            <a
              href="/action-center"
              onClick={(e) => {
                e.preventDefault();
                navigate({ to: "/action-center" });
              }}
              className="rounded-full px-6 py-2 text-sm transition-all font-semibold text-muted-foreground hover:text-foreground"
            >
              Action Center
            </a>
            <button
              onClick={() => setActiveTab("Lifecycle Rules")}
              className={`rounded-full px-6 py-2 text-sm transition-all font-semibold ${
                activeTab === "Lifecycle Rules"
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Lifecycle Rules
            </button>
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

        {activeTab === "Home" && (<>

          {/* ── Hero ───────────────────────────────────────────────────── */}
          <section className="relative flex flex-col justify-center min-h-[calc(100vh-320px)] py-12">
            <div className="relative mx-auto w-full max-w-[1600px] px-8">
              <div className="flex flex-col items-start gap-8">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
                  <span className="size-2 rounded-full bg-primary" />
                  Intelligent Document
                </div>
                {/* Title */}
                <h1 className="max-w-5xl font-display text-7xl font-bold leading-[1.05] tracking-tight text-[#0D1117] md:text-8xl">
                  Proactive lifecycle{" "}
                  <br />
                  <span className="text-primary italic font-semibold">
                    recommendations
                  </span>
                </h1>
                {/* Sub */}
                <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground/80 font-medium">
                  Certificates of conformance parsed, structured, and matched against lifecycle rules —
                  convert each opportunity into a quote, recertification job, or customer email.
                </p>
              </div>
            </div>
          </section>

          {/* ── Sticky filter bar ──────────────────────────────────────── */}
          <div className="mx-auto w-full max-w-[1600px] px-8 relative z-20">
            <FilterBar
              timeFilter={recTimeFilter}
              setTimeFilter={setRecTimeFilter}
              priorityFilter={recPriorityFilter}
              setPriorityFilter={setRecPriorityFilter}
              selectedClients={recClients}
              setSelectedClients={setRecClients}
              selectedLocations={recLocations}
              setSelectedLocations={setRecLocations}
              selectedParts={recParts}
              setSelectedParts={setRecParts}
              clientOptions={recClientOptions}
              locationOptions={recLocationOptions}
              partNumberOptions={recPartOptions}
              count={filtered.length}
              total={recommendations.length}
            />
          </div>

          {/* ── Content Section (Solid White) ────────────────────────── */}
          <div className="relative mt-[-3rem] bg-white pb-24 shadow-[0_-40px_80px_rgba(0,0,0,0.02)] pt-32">
            {/* KPI cards */}
            <div className="mx-auto w-full max-w-[1600px] px-8">
              <div className="flex items-center gap-6">
                <div className="h-px flex-1 bg-border/40" />
                <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground/40">Live Intelligence</span>
                <div className="h-px flex-1 bg-border/40" />
              </div>
              <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard icon={<FileText className="size-5" />} label="Total Records" value={isLoading ? "—" : recMetrics.total} sub={`${recommendations.length} total ingested`} tone="default" />
                <MetricCard icon={<ShieldAlert className="size-5" />} label="High Priority" value={isLoading ? "—" : recMetrics.high} sub={recMetrics.total > 0 ? `${Math.round((recMetrics.high / recMetrics.total) * 100)}% of filtered` : "No records"} tone="danger" trend={recMetrics.high > 0 ? "up" : "neutral"} />
                <MetricCard icon={<AlertTriangle className="size-5" />} label="Overdue" value={isLoading ? "—" : recMetrics.overdue} sub="Recertification expired" tone="danger" trend={recMetrics.overdue > 0 ? "up" : "neutral"} />
                <MetricCard icon={<Clock className="size-5" />} label="Due ≤6 Months" value={isLoading ? "—" : recMetrics.dueSoon} sub="Upcoming recertification" tone="warning" trend={recMetrics.dueSoon > 0 ? "up" : "neutral"} />
                <MetricCard icon={<Users className="size-5" />} label="Active Customers" value={isLoading ? "—" : recMetrics.customers} sub="Unique customers on file" tone="default" />
                <MetricCard icon={<Wrench className="size-5" />} label="Equipment Types" value={isLoading ? "—" : recMetrics.equipment} sub="Distinct equipment entries" tone="default" />
                <MetricCard icon={<Package className="size-5" />} label="Part Numbers" value={isLoading ? "—" : recMetrics.parts} sub="Across all certificates" tone="default" />
                <MetricCard icon={<Zap className="size-5" />} label="Extraction Accuracy" value={isLoading ? "—" : `${recMetrics.extractionRate}%`} sub={`${filtered.filter(r => r.confidence === "High").length} high-confidence records`} tone="success" trend={recMetrics.extractionRate >= 80 ? "up" : "neutral"} />
              </div>
            </div>

            {/* ── Charts ─────────────────────────────────────────────────── */}
            <div className="mx-auto w-full max-w-[1600px] px-8 pt-20">
              <div className="mb-10 flex items-center gap-6">
                <div className="h-px flex-1 bg-border/40" />
                <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground/40">Analytics</span>
                <div className="h-px flex-1 bg-border/40" />
              </div>
              <ChartsSection filtered={filtered} />
            </div>

            {/* ── Records toolbar + table ─────────────────────────────────── */}
            <div className="mx-auto w-full max-w-[1600px] px-8 pt-20">
              {/* Divider + label */}
              <div className="mb-10 flex items-center gap-6">
                <div className="h-px flex-1 bg-border/40" />
                <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground/40">Records</span>
                <div className="h-px flex-1 bg-border/40" />
              </div>

              {/* Toolbar */}
              <div className="mb-6 flex flex-wrap items-center gap-4">
                {/* Search */}
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search customer, SO, part…"
                    className="h-11 border-border/40 bg-secondary/30 pl-11 text-sm placeholder:text-muted-foreground/40 focus:bg-background transition-all rounded-xl"
                  />
                </div>

                {/* Record count badge + Export */}
                <div className="ml-auto flex items-center gap-3">
                  <div className="hidden rounded-xl border border-border/40 bg-secondary/20 px-4 py-2 font-display text-sm text-muted-foreground sm:flex items-center gap-2">
                    <span className="font-bold text-foreground">{tableRows.length}</span>
                    <span className="opacity-40">/</span>
                    <span>{recommendations.length} records</span>
                  </div>
                  <ExportButton ids={sortedRows.map((r) => r.id)} />
                </div>
              </div>

              {/* Table container */}
              <div className="overflow-hidden rounded-3xl border border-border/40 bg-white shadow-2xl shadow-black/[0.02]">
                {/* Column headers */}
                <div className="grid grid-cols-[8px_100px_1.5fr_1.4fr_1fr_1fr_130px_120px_48px] items-center gap-4 border-b border-border/30 bg-secondary/30 px-6 py-5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
                  <div />
                  <button onClick={() => toggleSort("priority")} className="flex items-center gap-1 hover:text-foreground transition-colors">Priority <SortIcon col="priority" /></button>
                  <button onClick={() => toggleSort("customer")} className="flex items-center gap-1 hover:text-foreground transition-colors">Customer <SortIcon col="customer" /></button>
                  <div>Equipment</div>
                  <div>SO / PO</div>
                  <button onClick={() => toggleSort("recertDue")} className="flex items-center gap-1 hover:text-foreground transition-colors">Recert. Due <SortIcon col="recertDue" /></button>
                  <button onClick={() => toggleSort("status")} className="flex items-center gap-1 hover:text-foreground transition-colors">Status <SortIcon col="status" /></button>
                  <div>Client Updates</div>
                  <div />
                </div>

                {/* Loading */}
                {isLoading && (
                  <div className="flex flex-col items-center justify-center gap-4 py-28">
                    <div className="relative size-12">
                      <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                      <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">Loading records…</p>
                  </div>
                )}

                {/* Error */}
                {isError && (
                  <div className="flex flex-col items-center justify-center gap-5 py-28 text-center">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-destructive/8 ring-1 ring-destructive/20">
                      <AlertTriangle className="size-7 text-destructive/70" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Could not reach the backend</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Run{" "}
                        <code className="rounded-md bg-foreground/6 px-1.5 py-0.5 font-mono text-xs">
                          uvicorn main:app --reload
                        </code>
                      </p>
                      <p className="mt-2 font-mono text-xs text-destructive/60">{(error as Error).message}</p>
                    </div>
                  </div>
                )}

                {/* Empty — no documents */}
                {!isLoading && !isError && recommendations.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-5 py-28 text-center">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.03] ring-1 ring-border/40">
                      <FileSearch className="size-7 text-muted-foreground/40" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">No documents ingested yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Upload PDF, DOC, or DOCX certificates of conformance to get started.
                      </p>
                    </div>
                    <Button size="sm" onClick={() => navigate({ to: "/upload" })} className="mt-1 bg-accent text-accent-foreground font-bold hover:bg-accent/90">
                      <Upload className="mr-2 size-4" />
                      Upload documents
                    </Button>
                  </div>
                )}

                {/* Empty — no filter match */}
                {!isLoading && !isError && recommendations.length > 0 && tableRows.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-4 py-28 text-center">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.03] ring-1 ring-border/40">
                      <FileSearch className="size-7 text-muted-foreground/40" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">No records match your filters</p>
                      <p className="mt-1 text-sm text-muted-foreground">Try adjusting or clearing filters above.</p>
                    </div>
                  </div>
                )}

                {/* Rows */}
                <div className="divide-y divide-border/25">
                  {pagedRows.map((r) => {
                    const overdue = r.status === "Expired / overdue";
                    const dueSoon = r.monthsToRecert !== null && r.monthsToRecert >= 0 && r.monthsToRecert <= 3;
                    const ocr = r.extractionStatus !== "OK";
                    const accentColor =
                      r.priority === "High" ? "bg-destructive"
                        : r.priority === "Low" ? "bg-emerald-500"
                          : "bg-muted-foreground/30";
                    return (
                      <div
                        key={r.id}
                        onClick={() => openDetail(r)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && openDetail(r)}
                        className="group grid w-full grid-cols-[8px_100px_1.5fr_1.4fr_1fr_1fr_130px_120px_48px] items-center gap-4 px-6 py-5 text-left transition-all duration-200 hover:bg-secondary/20 cursor-pointer"
                      >
                        {/* Priority accent bar */}
                        <div className={`h-10 w-1.5 rounded-full ${accentColor} opacity-60 transition-all group-hover:opacity-100 group-hover:scale-y-110`} />

                        {/* Priority chip */}
                        <div>
                          <PriorityChip priority={r.priority} />
                        </div>

                        {/* Customer */}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[#0D1117] transition-colors group-hover:text-primary">
                            {r.customer ?? <span className="italic font-normal text-muted-foreground">Pending OCR</span>}
                          </div>
                          <div className="mt-1 truncate text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wide flex items-center gap-1.5">
                            {r.location && <MapPin className="size-3" />}
                            {r.location ? r.location : (r.jobOrProject ?? r.sourceFile)}
                          </div>
                        </div>

                        {/* Equipment + parts */}
                        <div className="min-w-0">
                          <div className="truncate text-sm text-foreground">
                            {r.equipment ?? <span className="text-muted-foreground">—</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.partNumbers.slice(0, 2).map((p) => (
                              <span key={p.number} className="rounded-md border border-border/50 bg-secondary/40 px-1.5 py-px font-mono text-[9px] text-muted-foreground">
                                {p.number}
                              </span>
                            ))}
                            {r.partNumbers.length > 2 && (
                              <span className="font-mono text-[9px] text-muted-foreground/50">+{r.partNumbers.length - 2}</span>
                            )}
                          </div>
                        </div>

                        {/* SO / PO */}
                        <div className="font-mono text-xs">
                          <div className="font-medium text-foreground">{r.salesOrder ?? "—"}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground/60">{r.purchaseOrder ?? "—"}</div>
                        </div>

                        {/* Recert date */}
                        <div className="font-mono text-xs">
                          <div className={overdue ? "font-bold text-destructive" : dueSoon ? "font-bold text-warning" : "font-medium text-foreground"}>
                            {r.recertificationDue ?? "—"}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                            {r.monthsToRecert !== null
                              ? r.monthsToRecert < 0 ? `${Math.abs(r.monthsToRecert)} mo overdue`
                                : `in ${r.monthsToRecert} mo`
                              : "—"}
                          </div>
                        </div>

                        {/* Status */}
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={r.status} />
                          {(() => {
                            const score = getConfidenceScore(r);
                            const color = score >= 80 ? "text-emerald-500" : score >= 60 ? "text-orange-400" : "text-red-400";
                            const bar   = score >= 80 ? "bg-emerald-500"   : score >= 60 ? "bg-orange-400"   : "bg-red-400";
                            const label = ocr ? " · OCR" : ` · ${r.confidence}`;
                            return (
                              <div className="flex items-center gap-1.5 mt-0.5" title={`Confidence: ${score}% — ${r.confidence}${ocr ? " (OCR document)" : ""}`}>
                                <span className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-wide">Conf.</span>
                                <div className="h-1 w-10 rounded-full bg-border/40 overflow-hidden">
                                  <div className={cn("h-full rounded-full", bar)} style={{ width: `${score}%` }} />
                                </div>
                                <span className={cn("font-mono text-[9px] font-bold", color)}>{score}%{label}</span>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Updates */}
                        {(() => {
                          const linked = getLinkedAction(r.id);
                          if (!linked) return <div className="text-[10px] text-muted-foreground/30 italic">—</div>;
                          const meta: Record<string, { label: string; dot: string; badge: string }> = {
                            in_progress: { label: "In Progress", dot: "bg-orange-500", badge: "text-orange-600 bg-orange-500/10 border-orange-500/25" },
                            closed: { label: "Closed", dot: "bg-emerald-500", badge: "text-emerald-600 bg-emerald-500/10 border-emerald-500/25" },
                            failed: { label: "Failed", dot: "bg-red-500", badge: "text-red-600 bg-red-500/10 border-red-500/25" },
                          };
                          const m = meta[linked.status];
                          return (
                            <div className="flex flex-col gap-1.5">
                              {m && (
                                <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9px] font-bold ${m.badge}`}>
                                  <span className={`size-1.5 rounded-full ${m.dot}`} />{m.label}
                                </span>
                              )}
                              {(() => { const n = linked.comments.filter((c) => c.type !== "ai_suggestion").length; return n > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                                  <MessageSquare className="size-3" />
                                  {n} comment{n !== 1 ? "s" : ""}
                                </span>
                              ) : null; })()}
                            </div>
                          );
                        })()}

                        {/* Actions */}
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }}
                            className="rounded-lg p-1.5 text-muted-foreground/30 opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                          <ChevronRight className="size-4 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:text-primary/50" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer / Pagination */}
              {!isLoading && !isError && (
                <div className="mt-8 flex flex-col gap-4 border-t border-border/25 pt-6 pb-12">
                  {/* Record count + rule info */}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-4">
                      <span>
                        Showing{" "}
                        <span className="font-bold text-foreground">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedRows.length)}</span>
                        {" "}of{" "}
                        <span className="font-bold text-foreground">{sortedRows.length}</span>
                        {sortedRows.length !== recommendations.length && (
                          <span className="text-muted-foreground/50"> (filtered from {recommendations.length})</span>
                        )}
                      </span>
                      <span className="size-1 rounded-full bg-border/60" />
                      <span>Rule: <span className="font-mono font-bold text-primary">60-month recertification</span></span>
                      <span className="size-1 rounded-full bg-border/60" />
                      <span className="font-mono text-[10px] opacity-60">as of {summary.asOf}</span>
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-40">WOM Lifecycle · v1.0</div>
                  </div>

                  {/* Page controls */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => setPage(0)}
                        disabled={page === 0}
                        className="flex size-8 items-center justify-center rounded-lg border border-border/40 bg-secondary/40 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                        title="First page"
                      >
                        <ChevronsLeft className="size-3.5" />
                      </button>
                      <button
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="flex size-8 items-center justify-center rounded-lg border border-border/40 bg-secondary/40 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Previous page"
                      >
                        <ChevronDown className="size-3.5 rotate-90" />
                      </button>

                      {/* Page number pills */}
                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i)
                          .filter((i) => i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 2)
                          .reduce<(number | "…")[]>((acc, i, idx, arr) => {
                            if (idx > 0 && (i as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                            acc.push(i);
                            return acc;
                          }, [])
                          .map((item, idx) =>
                            item === "…" ? (
                              <span key={`ellipsis-${idx}`} className="px-1 text-xs text-muted-foreground/40">…</span>
                            ) : (
                              <button
                                key={item}
                                onClick={() => setPage(item as number)}
                                className={`flex size-8 items-center justify-center rounded-lg text-xs font-bold transition-all ${
                                  page === item
                                    ? "bg-primary text-white shadow-md shadow-primary/20"
                                    : "border border-border/40 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                }`}
                              >
                                {(item as number) + 1}
                              </button>
                            )
                          )}
                      </div>

                      <button
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={page === totalPages - 1}
                        className="flex size-8 items-center justify-center rounded-lg border border-border/40 bg-secondary/40 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Next page"
                      >
                        <ChevronDown className="size-3.5 -rotate-90" />
                      </button>
                      <button
                        onClick={() => setPage(totalPages - 1)}
                        disabled={page === totalPages - 1}
                        className="flex size-8 items-center justify-center rounded-lg border border-border/40 bg-secondary/40 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Last page"
                      >
                        <ChevronsRight className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>)}
        {activeTab === "Lifecycle Rules" && <LifecycleRulesTab />}
      </div>

      <RecommendationDetail rec={selected} open={open} onOpenChange={setOpen} linkedAction={selected ? getLinkedAction(selected.id) : null} />


      {/* Delete confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={(v) => { if (!v && !deleteMutation.isPending) setDeleteId(null); }}>
        <DialogContent className="sm:max-w-sm bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-4" /> Delete record?
            </DialogTitle>
            <DialogDescription>
              This will permanently remove this recommendation <strong>and any linked action</strong> from the database. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setDeleteId(null)} disabled={deleteMutation.isPending}>Cancel</Button>
            <Button
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? <><Loader2 className="mr-2 size-3.5 animate-spin" />Deleting…</> : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "primary" | "success" | "warning";
}) {
  const toneCls =
    tone === "primary"
      ? "text-primary"
      : tone === "success"
        ? "text-success"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/50 bg-background/30 p-6 transition-all hover:bg-background/50 hover:border-amber/30 hover:shadow-2xl hover:shadow-amber/5 backdrop-blur-md">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
          {label}
        </div>
        <div className={`size-8 rounded-lg bg-foreground/[0.03] grid place-items-center ${toneCls}`}>
          {icon}
        </div>
      </div>
      <div className={`mt-4 font-display text-4xl font-bold tracking-tight ${toneCls}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-2 text-xs font-medium text-muted-foreground/70">
          {hint}
        </div>
      )}
    </div>
  );
}
