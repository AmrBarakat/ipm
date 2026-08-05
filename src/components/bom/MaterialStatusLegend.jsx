import { MATERIAL_STATUS, MATERIAL_STATUS_ORDER } from '@/lib/materialStatus';

/**
 * MaterialStatusLegend — six dots with labels, in ladder order.
 */
export default function MaterialStatusLegend({ className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {MATERIAL_STATUS_ORDER.map(key => {
        const s = MATERIAL_STATUS[key];
        return (
          <div key={key} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${s.dot}`} />
            <span className="text-[10px] text-slate-500">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}