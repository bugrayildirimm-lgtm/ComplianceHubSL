import { cn } from "@/lib/utils";

export default function EmptyState({ icon: Icon, title, description, action, className, tone = "neutral" }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <div
          className={cn(
            "mb-3 flex h-10 w-10 items-center justify-center rounded-md border",
            tone === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-border bg-slate-50 text-slate-400"
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="text-[14px] font-medium text-slate-900">{title}</div>
      {description && (
        <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}