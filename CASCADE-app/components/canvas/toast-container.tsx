"use client";

import { useEffect } from "react";
import { X, CheckCircle, AlertTriangle, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import type { Toast } from "@/store/ui-store";

// ---------------------------------------------------------------------------
// Single toast
// ---------------------------------------------------------------------------

const VARIANT_STYLES: Record<NonNullable<Toast["variant"]>, string> = {
  info:    "bg-zinc-800 text-zinc-100 dark:bg-zinc-700",
  success: "bg-green-700 text-white",
  warning: "bg-amber-500 text-white",
  error:   "bg-red-600 text-white",
};

const VARIANT_ICONS: Record<NonNullable<Toast["variant"]>, React.ReactNode> = {
  info:    <Info size={15} className="shrink-0" />,
  success: <CheckCircle size={15} className="shrink-0" />,
  warning: <AlertTriangle size={15} className="shrink-0" />,
  error:   <XCircle size={15} className="shrink-0" />,
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useUiStore((s) => s.dismissToast);
  const variant = toast.variant ?? "info";

  useEffect(() => {
    if (!toast.durationMs) return;
    const t = setTimeout(() => dismissToast(toast.id), toast.durationMs);
    return () => clearTimeout(t);
  }, [toast.id, toast.durationMs, dismissToast]);

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2.5 shadow-lg text-sm max-w-sm",
        VARIANT_STYLES[variant],
      )}
      role="alert"
    >
      {VARIANT_ICONS[variant]}
      <span className="flex-1 leading-snug">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); dismissToast(toast.id); }}
          className="ml-1 shrink-0 rounded bg-white/20 px-2 py-0.5 text-xs font-medium hover:bg-white/30 transition-colors whitespace-nowrap"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => dismissToast(toast.id)}
        className="ml-1 shrink-0 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container — fixed to bottom-right, stacks upward
// ---------------------------------------------------------------------------

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
}
