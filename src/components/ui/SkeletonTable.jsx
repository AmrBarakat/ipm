export default function SkeletonTable({ columns = 5, rows = 6 }) {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-100">
      {/* Header row */}
      <div className="bg-slate-50 border-b border-slate-100 px-4 py-3 flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="h-3 bg-slate-200 rounded animate-pulse flex-1" />
        ))}
      </div>
      {/* Body rows */}
      <div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="border-t border-slate-100 px-4 py-3.5 flex gap-4">
            {Array.from({ length: columns }).map((_, c) => (
              <div key={c} className="h-3 bg-slate-100 rounded animate-pulse flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}