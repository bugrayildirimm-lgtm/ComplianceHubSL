export default function ReviewedSnapshot({ value }) {
  const snapshot = value ? JSON.parse(value) : null;
  if (!snapshot) return <p className="text-xs text-muted-foreground">No reviewed snapshot is stored. Do not approve this item.</p>;
  return <details className="rounded border border-border p-2 text-xs" open>
    <summary className="cursor-pointer font-semibold">Complete submitted version</summary>
    <dl className="mt-2 max-h-96 space-y-2 overflow-auto">{Object.entries(snapshot).map(([key,v])=><div key={key} className="border-t border-border pt-2"><dt className="font-medium">{key.replaceAll('_',' ')}</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{typeof v==='object'?JSON.stringify(v,null,2):String(v ?? 'Not recorded')}</dd></div>)}</dl>
  </details>;
}