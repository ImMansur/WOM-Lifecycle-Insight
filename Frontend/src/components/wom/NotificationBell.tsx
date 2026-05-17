import { useState } from "react";
import { Bell, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNotifications } from "@/lib/notifications-context";
import { cn } from "@/lib/utils";

function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v && unreadCount > 0) {
      setTimeout(markAllRead, 600);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-full p-2 text-muted-foreground hover:text-primary transition-colors hover:bg-muted/50 focus:outline-none"
          aria-label="Notifications"
        >
          <Bell
            className={cn(
              "size-5 transition-all",
              unreadCount > 0 && "text-primary"
            )}
          />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[380px] p-0 border-border/60 shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[min(560px,80vh)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-primary" />
            <span className="font-bold text-sm text-foreground">Notifications</span>
            {notifications.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {notifications.length}
              </span>
            )}
          </div>
          {notifications.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="size-3" /> Clear all
            </button>
          )}
        </div>

        {/* List */}
        <div className="overflow-y-auto divide-y divide-border/30">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Bell className="size-10 text-muted-foreground/20" />
              <p className="text-sm font-semibold text-muted-foreground">No notifications yet</p>
              <p className="text-xs text-muted-foreground/50">
                Upload files to see results here
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "flex gap-3 px-4 py-3 transition-colors hover:bg-muted/30",
                  !n.read && "bg-primary/[0.03]"
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                    n.status === "success" ? "bg-emerald-500/10" : "bg-red-500/10"
                  )}
                >
                  {n.status === "success" ? (
                    <CheckCircle2 className="size-4 text-emerald-500" />
                  ) : (
                    <XCircle className="size-4 text-red-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{n.fileName}</p>
                  <p
                    className={cn(
                      "text-xs mt-0.5 leading-snug",
                      n.status === "success" ? "text-emerald-600" : "text-red-500"
                    )}
                  >
                    {n.message}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">
                    {formatRelative(n.timestamp)}
                  </p>
                </div>

                {!n.read && (
                  <span className="mt-2 size-2 shrink-0 self-start rounded-full bg-primary" />
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
