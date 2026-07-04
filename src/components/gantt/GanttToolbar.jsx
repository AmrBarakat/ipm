import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Maximize2, Minimize2, Calendar, Crosshair, Image, FileText, Sheet, Loader2, Link2, AlertTriangle, ChevronsDownUp, ChevronsUpDown, Wand2 } from 'lucide-react';
import { TIME_SCALES } from './ganttUtils';

export default function GanttToolbar({
  scaleKey, setScaleKey,
  onPan, onFit, onToday, onJumpStart,
  onExpandAll, onCollapseAll,
  showDeps, setShowDeps, showCritical, setShowCritical,
  criticalCount, projectDuration, projectFinish,
  fullscreen, toggleFullscreen,
  onExportPNG, onExportPDF, onExportExcel, exporting,
  onEstimate, onOptimize
}) {
  const fmtFinish = projectFinish ? projectFinish.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Time scale */}
        <div className="flex items-center border border-slate-200 rounded overflow-hidden text-xs">
          <button onClick={() => setScaleKey((prev) => {
            const idx = TIME_SCALES.findIndex((s) => s.key === prev);
            return TIME_SCALES[Math.min(TIME_SCALES.length - 1, idx + 1)].key;
          })} className="px-2 py-1.5 hover:bg-slate-100 border-r border-slate-200" title="Zoom out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          {TIME_SCALES.map((s) =>
          <button key={s.key} onClick={() => setScaleKey(s.key)}
          className={`px-3 py-1.5 font-medium border-r border-slate-200 last:border-0 transition ${scaleKey === s.key ? 'bg-amber-500 text-slate-900' : 'hover:bg-slate-100 text-slate-600'}`}>
              {s.label}
            </button>
          )}
          <button onClick={() => setScaleKey((prev) => {
            const idx = TIME_SCALES.findIndex((s) => s.key === prev);
            return TIME_SCALES[Math.max(0, idx - 1)].key;
          })} className="px-2 py-1.5 hover:bg-slate-100" title="Zoom in">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Pan */}
        <div className="flex items-center border border-slate-200 rounded overflow-hidden">
          <button onClick={() => onPan(-14)} className="p-1.5 hover:bg-slate-100 border-r border-slate-200" title="Pan left"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => onPan(14)} className="p-1.5 hover:bg-slate-100" title="Pan right"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <button onClick={onFit} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium" title="Fit whole project">
          <Crosshair className="w-3.5 h-3.5" /> Fit
        </button>
        <button onClick={onToday} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium" title="Jump to today">
          <Calendar className="w-3.5 h-3.5" /> Today
        </button>
        <button onClick={onJumpStart} className="px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium" title="Jump to project start">
          Start
        </button>
        <div className="flex items-center border border-slate-200 rounded overflow-hidden">
          <button onClick={onExpandAll} className="flex items-center gap-1 px-2.5 py-1.5 text-xs hover:bg-slate-100 text-slate-600 font-medium border-r border-slate-200" title="Expand all branches">
            <ChevronsUpDown className="w-3.5 h-3.5" /> Expand all
          </button>
          <button onClick={onCollapseAll} className="flex items-center gap-1 px-2.5 py-1.5 text-xs hover:bg-slate-100 text-slate-600 font-medium" title="Collapse all branches">
            <ChevronsDownUp className="w-3.5 h-3.5" /> Collapse all
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showDeps} onChange={(e) => setShowDeps(e.target.checked)} className="accent-slate-500" />
          <Link2 className="w-3.5 h-3.5" /> Deps
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showCritical} onChange={(e) => setShowCritical(e.target.checked)} className="accent-rose-500" />
          <span className="text-rose-600 font-medium flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Critical ({criticalCount})
          </span>
        </label>
        <div className="flex items-center border border-amber-300 rounded overflow-hidden">
          

          
          <button onClick={onOptimize} className="flex items-center gap-1 px-2.5 py-1.5 text-xs hover:bg-amber-50 text-amber-700 font-medium" title="AI: optimize schedule (delays & dependencies)">
            <Wand2 className="w-3.5 h-3.5" /> AI: Optimize
          </button>
        </div>
        <div className="flex items-center border border-slate-200 rounded overflow-hidden">
          <button onClick={onExportPNG} disabled={exporting} className="flex items-center gap-1 px-2.5 py-1.5 text-xs hover:bg-slate-100 text-slate-600 border-r border-slate-200 disabled:opacity-50" title="Export PNG">
            {exporting === 'png' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Image className="w-3.5 h-3.5" />} PNG
          </button>
          <button onClick={onExportPDF} disabled={exporting} className="flex items-center gap-1 px-2.5 py-1.5 text-xs hover:bg-slate-100 text-slate-600 border-r border-slate-200 disabled:opacity-50" title="Export PDF">
            {exporting === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} PDF
          </button>
          <button onClick={onExportExcel} className="flex items-center gap-1 px-2.5 py-1.5 text-xs hover:bg-slate-100 text-emerald-600 disabled:opacity-50" title="Export Excel">
            <Sheet className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
        <button onClick={toggleFullscreen} className="p-1.5 border border-slate-200 rounded hover:bg-slate-100 text-slate-600" title={fullscreen ? 'Exit fullscreen' : 'Expand fullscreen'}>
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {projectDuration > 0 &&
      <div className="w-full text-xs text-slate-500 flex flex-wrap gap-4 items-center">
          <span>Project duration: <strong className="text-slate-700">{projectDuration} days</strong></span>
          <span>CPM finish: <strong className="text-slate-700">{fmtFinish}</strong></span>
          {criticalCount > 0 && <span className="text-rose-500">{criticalCount} tasks on critical path</span>}
        </div>
      }
    </div>);

}