import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export default function FilterBar({ search, onSearch, placeholder = "Search", filters = [], right, className }) {
  return (
    <div className={cn("flex flex-col gap-2 border-b border-border px-3 py-2.5 lg:flex-row lg:items-center", className)}>
      <div className="relative min-w-0 flex-1 lg:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => onSearch?.(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded-sm border border-border bg-white pl-8 pr-2 text-[12.5px] outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <select
            key={filter.key}
            value={filter.value ?? ""}
            onChange={(e) => filter.onChange(e.target.value)}
            className="h-8 rounded-sm border border-border bg-white px-2 text-[12.5px] text-slate-700 outline-none transition-colors focus:border-slate-400"
            aria-label={filter.label}
          >
            <option value="">{filter.label}: all</option>
            {(filter.options || []).map((option) => (
              <option key={option.value ?? option} value={option.value ?? option}>
                {option.label ?? option}
              </option>
            ))}
          </select>
        ))}
      </div>
      {right && <div className="lg:ml-auto">{right}</div>}
    </div>
  );
}