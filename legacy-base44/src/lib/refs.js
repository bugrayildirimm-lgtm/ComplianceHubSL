import { base44 } from "@/api/base44Client";

// Human-readable reference used only where the record is created from the browser.
export async function nextClientRef(entityName, field, prefix, pad = 4) {
  const page = await base44.entities[entityName].list({ sort: "-created_date", limit: 500 });
  const items = page.items || [];
  let max = 0;
  for (const record of items) {
    const value = record?.[field];
    const match = typeof value === "string" ? value.match(/(\d+)\s*$/) : null;
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(pad, "0")}`;
}