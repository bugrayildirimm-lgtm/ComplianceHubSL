import { cn } from "@/lib/utils";

export default function SectionCard({ title, description, actions, children, className, bodyClassName, footer }) {
  return (
    <section className={cn("panel flex flex-col", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("flex-1", bodyClassName)}>{children}</div>
      {footer && <div className="border-t border-border bg-slate-50/60 px-4 py-2.5">{footer}</div>}
    </section>
  );
}