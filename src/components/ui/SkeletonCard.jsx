export default function SkeletonCard({ count = 6 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex gap-2 mb-3">
            <div className="h-5 w-16 bg-slate-200 rounded animate-pulse" />
            <div className="h-5 w-20 bg-slate-100 rounded animate-pulse" />
            <div className="h-5 w-16 bg-slate-100 rounded animate-pulse" />
          </div>
          <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse mb-2" />
          <div className="h-3 w-1/2 bg-slate-100 rounded animate-pulse mb-4" />
          <div className="h-2 w-full bg-slate-100 rounded-full animate-pulse mb-3" />
          <div className="flex justify-between">
            <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
            <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}