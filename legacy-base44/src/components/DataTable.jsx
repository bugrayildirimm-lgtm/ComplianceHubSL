import { cn } from "@/lib/utils";

export default function DataTable({ columns, rows, onRowClick, rowKey = "id", empty, loading }) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-sm bg-slate-100" />
        ))}
      </div>
    );
  }

  if (!rows?.length) return <div>{empty}</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-slate-50/70">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn("whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500", col.headerClassName)}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn("align-top", onRowClick && "rowlink cursor-pointer")}
            >
              {columns.map((col) => (
                <td key={col.key} className={cn("px-3 py-2.5 text-[12.5px] leading-snug text-slate-700", col.className)}>
                  {col.render ? col.render(row) : row[col.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}