import { useMemo, useState } from "react";
import type { Recommendation } from "@/lib/wom-data";
import { StatusBadge } from "./StatusBadge";
import {
  Building2,
  ChevronRight,
  AlertTriangle,
  FileSearch,
  Loader2,
  Users,
  TrendingUp,
  Search,
  X,
  ShieldAlert,
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface CustomerGroup {
  name: string;
  totalRecords: number;
  equipment: string[];
  salesOrders: string[];
  earliestRecertDue: string | null;
  minMonthsToRecert: number | null;
  highPriorityCount: number;
  overdueCount: number;
  worstStatus: string;
  records: Recommendation[];
}

const STATUS_ORDER = [
  "Expired / overdue",
  "Due soon",
  "Mid-cycle service opportunity",
  "Manual review",
];

function groupCustomers(recs: Recommendation[]): CustomerGroup[] {
  const map = new Map<string, CustomerGroup>();

  for (const r of recs) {
    const key = r.customer?.trim() || "Unknown Customer";
    let g = map.get(key);
    if (!g) {
      g = {
        name: key,
        totalRecords: 0,
        equipment: [],
        salesOrders: [],
        earliestRecertDue: null,
        minMonthsToRecert: null,
        highPriorityCount: 0,
        overdueCount: 0,
        worstStatus: r.status,
        records: [],
      };
      map.set(key, g);
    }

    g.totalRecords++;
    g.records.push(r);

    if (r.equipment && !g.equipment.includes(r.equipment)) g.equipment.push(r.equipment);
    if (r.salesOrder && !g.salesOrders.includes(r.salesOrder)) g.salesOrders.push(r.salesOrder);
    if (r.priority === "High") g.highPriorityCount++;
    if (r.status === "Expired / overdue") g.overdueCount++;

    if (r.monthsToRecert !== null) {
      if (g.minMonthsToRecert === null || r.monthsToRecert < g.minMonthsToRecert) {
        g.minMonthsToRecert = r.monthsToRecert;
        g.earliestRecertDue = r.recertificationDue;
      }
    }
    const ci = STATUS_ORDER.indexOf(g.worstStatus);
    const ni = STATUS_ORDER.indexOf(r.status);
    if (ni !== -1 && (ci === -1 || ni < ci)) g.worstStatus = r.status;
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.highPriorityCount !== b.highPriorityCount)
      return b.highPriorityCount - a.highPriorityCount;
    const am = a.minMonthsToRecert ?? 9999;
    const bm = b.minMonthsToRecert ?? 9999;
    return am - bm;
  });
}

export function CustomersTab({
  recommendations,
  isLoading,
  isError,
}: {
  recommendations: Recommendation[];
  isLoading: boolean;
  isError: boolean;
}) {
  const [query, setQuery] = useState("");
  const customers = useMemo(() => groupCustomers(recommendations), [recommendations]);

  const filtered = useMemo(() => {
    if (!query.trim()) return customers;
    const q = query.toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.equipment.some((e) => e.toLowerCase().includes(q)) ||
        c.salesOrders.some((s) => s.toLowerCase().includes(q)),
    );
  }, [customers, query]);

  const totalHighPriority = customers.reduce((s, c) => s + c.highPriorityCount, 0);
  const totalOverdue = customers.reduce((s, c) => s + c.overdueCount, 0);
  const withOverdue = customers.filter((c) => c.overdueCount > 0).length;

  return (
    <div className="flex-1 flex flex-col">
      {/* Page Header */}
      <section className="relative py-12 overflow-hidden">
        <div className="mx-auto max-w-[1600px] px-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-6">
              <Building2 className="size-3" />
              Customer Accounts
            </div>
            <h1 className="font-display text-4xl font-black tracking-tight text-accent md:text-5xl">
              Customer <span className="text-primary italic">Accounts</span>
            </h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground/90 leading-relaxed">
              Customer records derived from certificates of conformance, ranked by recertification
              urgency and outreach opportunity value.
            </p>
          </div>

          {/* Stats */}
          <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Total Accounts",
                value: isLoading ? "—" : customers.length,
                sub: "Unique customers",
                icon: <Users className="size-5" />,
                tone: "default",
              },
              {
                label: "High-Priority Accts",
                value: isLoading ? "—" : customers.filter((c) => c.highPriorityCount > 0).length,
                sub: `${totalHighPriority} high-priority CoCs`,
                icon: <TrendingUp className="size-5" />,
                tone: "primary",
              },
              {
                label: "Accounts w/ Overdue",
                value: isLoading ? "—" : withOverdue,
                sub: `${totalOverdue} overdue CoCs`,
                icon: <ShieldAlert className="size-5" />,
                tone: "destructive",
              },
              {
                label: "Avg CoCs / Customer",
                value:
                  isLoading || customers.length === 0
                    ? "—"
                    : (recommendations.length / customers.length).toFixed(1),
                sub: "Certificates per account",
                icon: <Building2 className="size-5" />,
                tone: "default",
              },
            ].map(({ label, value, sub, icon, tone }) => {
              const valueCls =
                tone === "primary"
                  ? "text-primary"
                  : tone === "destructive"
                    ? "text-destructive"
                    : "text-foreground";
              return (
                <div
                  key={label}
                  className="group relative overflow-hidden rounded-2xl border border-border/50 bg-background/30 p-5 backdrop-blur-md transition-all hover:bg-background/50 hover:border-primary/20"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
                      {label}
                    </span>
                    <span className={valueCls}>{icon}</span>
                  </div>
                  <div className={`font-display text-3xl font-bold ${valueCls}`}>{value}</div>
                  {sub && (
                    <div className="mt-1.5 text-xs text-muted-foreground/70 font-medium">{sub}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <section className="border-y border-border/30 bg-background/50 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-6 py-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customer, equipment, sales order…"
              className="border-border/50 bg-background/20 pl-9 text-sm focus:bg-background/40 transition-colors"
            />
          </div>
          {query && (
            <button
              onClick={() => setQuery("")}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
              Clear
            </button>
          )}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {filtered.length} of {customers.length} accounts
          </span>
        </div>
      </section>

      {/* Table */}
      <section className="flex-1 mx-auto w-full max-w-[1600px] px-6 py-8">
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/20 backdrop-blur-md shadow-xl">
          <div className="grid grid-cols-[2fr_1.2fr_0.8fr_0.8fr_0.8fr_140px_24px] gap-4 border-b border-border/50 bg-foreground/[0.02] px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            <div>Customer</div>
            <div>Equipment</div>
            <div>CoCs</div>
            <div>High Priority</div>
            <div>Overdue</div>
            <div>Urgency Status</div>
            <div />
          </div>

          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-4 py-24">
              <Loader2 className="size-10 animate-spin text-primary/50" />
              <p className="text-sm text-muted-foreground">Loading customer accounts…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <div className="size-16 rounded-full bg-destructive/10 grid place-items-center">
                <AlertTriangle className="size-8 text-destructive/70" />
              </div>
              <p className="text-base font-semibold text-foreground">
                Could not load customer data
              </p>
              <p className="text-sm text-muted-foreground">
                Check that the backend server is running.
              </p>
            </div>
          )}

          {!isLoading && !isError && customers.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <div className="size-16 rounded-full bg-foreground/[0.03] grid place-items-center">
                <FileSearch className="size-8 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">No customer records found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ingest certificates of conformance on the Recommendations tab to populate customer
                  accounts.
                </p>
              </div>
            </div>
          )}

          {!isLoading && !isError && customers.length > 0 && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <FileSearch className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No customers match your search.</p>
            </div>
          )}

          <div className="divide-y divide-border/30">
            {filtered.map((c) => {
              const overdue = c.worstStatus === "Expired / overdue";
              return (
                <div
                  key={c.name}
                  className="group grid w-full grid-cols-[2fr_1.2fr_0.8fr_0.8fr_0.8fr_140px_24px] items-center gap-4 px-6 py-5 hover:bg-foreground/[0.03] transition-all cursor-default"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="size-9 rounded-xl bg-accent/10 grid place-items-center shrink-0 group-hover:bg-accent/15 transition-colors">
                      <Building2 className="size-4 text-accent" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{c.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        {c.salesOrders.length > 0
                          ? `SO: ${c.salesOrders.slice(0, 2).join(", ")}${c.salesOrders.length > 2 ? ` +${c.salesOrders.length - 2}` : ""}`
                          : "No sales orders"}
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0">
                    {c.equipment.length === 0 ? (
                      <span className="text-muted-foreground text-sm">—</span>
                    ) : (
                      <>
                        <div className="text-sm text-foreground truncate">{c.equipment[0]}</div>
                        {c.equipment.length > 1 && (
                          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                            +{c.equipment.length - 1} more
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="font-display text-xl font-bold text-foreground">
                    {c.totalRecords}
                  </div>

                  <div>
                    {c.highPriorityCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-bold text-primary">
                        {c.highPriorityCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </div>

                  <div>
                    {c.overdueCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-mono text-[11px] font-bold text-destructive">
                        {c.overdueCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </div>

                  <div>
                    <StatusBadge status={c.worstStatus} />
                  </div>

                  <ChevronRight className="size-4 text-muted-foreground/40 transition group-hover:translate-x-1 group-hover:text-primary" />
                </div>
              );
            })}
          </div>
        </div>

        {!isLoading && !isError && customers.length > 0 && (
          <div className="mt-6 flex items-center justify-between gap-4 text-xs text-muted-foreground border-t border-border/30 pt-6">
            <span>
              <span className="font-bold text-foreground">{customers.length}</span> customer
              accounts across{" "}
              <span className="font-bold text-foreground">{recommendations.length}</span>{" "}
              certificates
            </span>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-60">
              WOM_Customers · v1.0.0
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
