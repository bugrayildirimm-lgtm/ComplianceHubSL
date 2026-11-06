import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-slate-100 text-slate-600 ring-slate-200",
  ink: "bg-slate-900 text-white ring-slate-900",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  accent: "bg-green-50 text-green-800 ring-green-200",
  unknown: "bg-white text-slate-500 ring-dashed ring-slate-300",
};

export default function StatusBadge({ tone = "neutral", children, dot = true, className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONES[tone] || TONES.neutral,
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

export const HEALTH_TONES = {
  "Not configured": "unknown",
  "Awaiting source verification": "warning",
  "Queued": "info",
  "Running": "info",
  "Checked — new or changed": "success",
  "Checked — no change": "success",
  "Failed or blocked": "danger",
  "Partially processed": "warning",
  "Stale or overdue": "danger",
};