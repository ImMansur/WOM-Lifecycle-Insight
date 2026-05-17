import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Expired / overdue": "bg-destructive/10 text-destructive border-destructive/20",
    "Mid-cycle service opportunity": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    "Manual review": "bg-muted text-muted-foreground border-border/60",
    "Due soon": "bg-warning/10 text-warning border-warning/20",
  };
  const cls = map[status] ?? "bg-muted text-muted-foreground border-border/60";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider",
        cls,
      )}
    >
      <span className="size-1.5 rounded-full bg-current animate-pulse" />
      {status}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    High: "bg-primary/10 text-primary border-primary/20",
    Low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    "Manual review": "bg-muted text-muted-foreground border-border/60",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider",
        map[priority] ?? "bg-muted text-muted-foreground border-border/60",
      )}
    >
      {priority}
    </span>
  );
}
