import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, RAG_COLORS, TYPE_LABELS, STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/constants';
import { TrendingUp, Folder, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

export default function Portfolio() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.Project.list('-updated_date', 100).then(p => {
      setProjects(p);
      setLoading(false);
    });
  }, []);

  const total = projects.length;
  const inProgress = projects.filter(p => p.status === 'in_progress').length;
  const completed = projects.filter(p => p.status === 'completed').length;
  const totalValue = projects.reduce((s, p) => s + (p.contract_value || 0), 0);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div>
      <section className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1 flex items-center gap-2">
          <TrendingUp className="text-amber-500 w-6 h-6" /> Portfolio Dashboard
        </h1>
        <p className="text-sm text-slate-500">All active industrial automation & energy projects at a glance.</p>
      </section>

      {/* KPI cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Projects" value={total} icon={<Folder className="w-6 h-6 text-blue-400" />} color="border-blue-500" />
        <KpiCard label="In Progress" value={inProgress} icon={<Clock className="w-6 h-6 text-amber-400" />} color="border-amber-500" />
        <KpiCard label="Completed" value={completed} icon={<CheckCircle className="w-6 h-6 text-emerald-400" />} color="border-emerald-500" />
        <KpiCard label="Total Value (SAR)" value={formatCurrency(totalValue, 'SAR')} icon={<TrendingUp className="w-6 h-6 text-purple-400" />} color="border-purple-500" />
      </section>

      {/* Projects table */}
      <section className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">All Projects</h2>
          <Link to="/projects" className="text-sm text-amber-600 hover:underline">View full list →</Link>
        </div>
        {projects.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No projects yet.</p>
            <Link to="/projects/new" className="mt-3 inline-block px-4 py-2 bg-amber-500 text-slate-900 rounded font-semibold text-sm">
              Create First Project
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Project</th>
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Progress</th>
                  <th className="px-4 py-3 text-left">Target Date</th>
                  <th className="px-4 py-3 text-left">Value</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => window.location.href = `/projects/${p.id}`}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{p.name}</div>
                      {p.location && <div className="text-xs text-slate-400">{p.location}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.client || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {TYPE_LABELS[p.project_type] || p.project_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_COLORS[p.status] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 w-36">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${p.progress || 0}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 w-8 text-right">{p.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(p.target_completion_date)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{formatCurrency(p.contract_value, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, icon, color }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{value}</div>
        </div>
        {icon}
      </div>
    </div>
  );
}