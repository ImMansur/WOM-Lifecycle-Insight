import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export function LoadingScreen({
  onFinished,
  progressValue,
  title = "WOM",
  subtitle = "Lifecycle",
  statusText = "Initializing Environment",
  subStatusText = "Secure Handshake...",
}: {
  onFinished?: () => void;
  progressValue?: number;
  title?: string;
  subtitle?: string;
  statusText?: string;
  subStatusText?: string;
}) {
  const [internalProgress, setInternalProgress] = useState(0);

  const displayProgress = progressValue !== undefined ? progressValue : internalProgress;

  useEffect(() => {
    if (progressValue !== undefined) {
      if (progressValue >= 100) {
        onFinished?.();
      }
      return;
    }

    const interval = setInterval(() => {
      setInternalProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          onFinished?.();
          return 100;
        }
        return prev + (Math.random() * 20 + 5); // Faster, more consistent progress
      });
    }, 120);

    return () => clearInterval(interval);
  }, [onFinished, progressValue]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background">
      {/* Decorative background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] size-[40%] rounded-full bg-primary/5 blur-[120px] animate-float" />
        <div className="absolute top-[20%] -right-[5%] size-[35%] rounded-full bg-accent/5 blur-[100px] animate-float-delayed" />
        <div className="absolute inset-0 bg-grid opacity-30" />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <div className="relative size-24 mb-8">
          {/* Outer rotating ring */}
          <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          {/* Inner pulsating logo area */}
          <div className="absolute inset-2 rounded-full bg-white shadow-xl flex items-center justify-center p-3 animate-pulse">
            <img src="/logo.png" alt="WOM Logo" className="size-full object-contain" />
          </div>
        </div>

        <div className="w-64">
          <div className="flex justify-between items-end mb-2">
            <div className="leading-tight">
              <div className="font-display text-sm font-black tracking-tight text-accent">
                {title} <span className="text-primary">{subtitle}</span>
              </div>
              <div className="font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                {statusText}
              </div>
            </div>
            <div className="font-mono text-xs font-bold text-primary">
              {Math.min(100, Math.round(displayProgress))}%
            </div>
          </div>

          <div className="h-1 w-full bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${displayProgress}%` }}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 text-muted-foreground/60">
          <Loader2 className="size-3 animate-spin" />
          <span className="font-mono text-[10px] uppercase tracking-widest">{subStatusText}</span>
        </div>
      </div>
    </div>
  );
}
