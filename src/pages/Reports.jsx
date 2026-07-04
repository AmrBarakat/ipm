import { useState, useMemo } from 'react';
import { BarChart2, FolderOpen, Building2 } from 'lucide-react';
import { usePortfolioData } from '@/hooks/usePortfolioData';
import { useProjectData } from '@/hooks/useProjectData';
import { PROJECT_BUNDLES, PORTFOLIO_BUNDLES } from '@/components/reports/projectBundles';
import BundleCard from '@/components/reports/BundleCard';
import ProfitMarginReport from '@/components/portfolio/ProfitMarginReport';
import MaterialTrackingReport from '@/components/portfolio/MaterialTrackingReport';
import { formatCurrency } from '@/lib/constants';

export default function Reports() {
  const [mode, setMode] = useState('project'); // 'project' | 'portfolio'
  const [selectedId, setSelectedId] = useState('');
  const port = usePortfolioData();
  const proj = useProjectData(mode === 'project' ? selectedId : null);

  const projects = port.projects;
  const project = useMemo(() => projects.find(p => p.id === selectedId) || null, [projects, selectedId]);

  // Per-project slices derived from the portfolio-wide cached data
  const projectData = useMemo(() => {
    if (!project) return null;
    return {
      project,
      milestones: proj.milestones,
      wbsItems: proj.wbsItems,
      tasks: proj.tasks,
      deliverables: proj.deliverables,
      bomItems: proj.bomItems,
      invoices: port.invoices.filter(i => i.project_id === project.id),
      expenses: port.expenses.filter(e => e.project_id === project.id),
      collections: port.collections.filter(c => c.project_id === project.id),
      pos: port.pos.filter(p => p.project_id === project.id),
      risks: port.risks.filter(r => r.project_id === project.id),
      changeOrders: port.changeOrders.filter(co => co.project_id === project.id),
    };
  }, [project, proj, port]);

  if (port.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <section className="mb-5">
        <h1 className="text-2xl font-bold text-slate-800 mb-1 flex items-center gap-2">
          <BarChart2 className="text-amber-500 w-6 h-6" /> Reports
        </h1>
        <p className="text-sm text-slate-500">All project and portfolio reports, organized by audience.</p>
      </section>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-6">
        {[
          { id: 'project', label: 'Project Reports', icon: <FolderOpen className="w-4 h-4" /> },
          { id: 'portfolio', label: 'Portfolio Reports', icon: <Building2 className="w-4 h-4" /> },
        ].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded text-xs font-bold tracking-wide transition ${
              mode === m.id ? 'bg-amber-500 text-slate-900 shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {mode === 'project' && (
        <div>
          {/* Project selector */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">Select Project</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="w-full md:w-96 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="">— Choose a project —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </div>

          {!selectedId || !project ? (
            <div className="text-center py-20 text-slate-400">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a project to see its report bundles.</p>
            </div>
          ) : proj.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-5 bg-slate-50 rounded-lg px-4 py-3 border border-slate-200">
                <span className="font-mono text-xs text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">{project.code}</span>
                <span className="font-semibold text-slate-800 text-sm">{project.name}</span>
                {project.client && <span className="text-xs text-slate-500">· {project.client}</span>}
                <span className="text-xs text-slate-500 ml-auto">
                  Contract: <span className="font-semibold text-slate-700">{formatCurrency(project.contract_value, project.currency)}</span>
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {PROJECT_BUNDLES.map(b => (
                  <BundleCard key={b.id} bundle={b} data={projectData} subtitle={`${project.code} — ${project.name}`} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'portfolio' && (
        <div className="space-y-8">
          {/* Audience bundles */}
          <div>
            <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide mb-3">Audience Bundles</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {PORTFOLIO_BUNDLES.map(b => (
                <BundleCard key={b.id} bundle={b} data={port} subtitle="Portfolio — All Projects" />
              ))}
            </div>
          </div>

          {/* Existing portfolio reports */}
          <div>
            <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide mb-3">Portfolio Reports</h2>
            <div className="space-y-8">
              <ProfitMarginReport
                projects={projects}
                invoices={port.invoices}
                expenses={port.expenses}
                collections={port.collections}
              />
              <MaterialTrackingReport
                projects={projects}
                pos={port.pos}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}