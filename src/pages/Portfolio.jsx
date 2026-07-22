import { useState } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { TrendingUp, Activity, Package, AlertTriangle } from 'lucide-react';
import FinancialDashboard from '@/components/portfolio/FinancialDashboard';
import PortfolioHealthTable from '@/components/portfolio/PortfolioHealthTable';
import MaterialTrackingReport from '@/components/portfolio/MaterialTrackingReport';




export default function Portfolio() {
  const [view, setView] = useState('dashboard');
  const { data: projects = [], isLoading, isError, refetch } = useEntityList('Project', null, '-updated_date', 200);

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>);

  if (isError) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertTriangle className="w-8 h-8 text-red-400" />
      <p className="text-sm text-red-500">Failed to load projects.</p>
      <button onClick={() => refetch()} className="px-3 py-1.5 text-xs font-semibold border border-red-300 text-red-600 rounded hover:bg-red-50">Retry</button>
    </div>
  );


  return (
    <div>
      {/* Header */}
      <section className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 mb-1 flex items-center gap-2">
              <TrendingUp className="text-amber-500 w-6 h-6" /> Portfolio Dashboard
            </h1>
            <p className="text-sm text-slate-500">All industrial automation & energy projects at a glance.</p>
          </div>
          {/* View toggle */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setView('dashboard')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${view === 'dashboard' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <span className="flex items-center gap-1.5"><Activity className="w-4 h-4" /> Dashboard</span>
            </button>
            <button onClick={() => setView('material')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${view === 'material' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <span className="flex items-center gap-1.5"><Package className="w-4 h-4" /> Material Tracking</span>
            </button>
          </div>
        </div>
      </section>

      {view === 'material' ? (
        <MaterialTrackingReport />
      ) : (
      <>
      {/* High-level health comparison */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="text-amber-500 w-5 h-5" />
          <h2 className="text-lg font-semibold text-slate-700">Portfolio Health</h2>
          <span className="text-sm text-slate-400">— cost variance & milestone progress across active projects</span>
        </div>
        <PortfolioHealthTable projects={projects} />
      </section>

      <FinancialDashboard projects={projects} />
      </>
      )}


    </div>);

}