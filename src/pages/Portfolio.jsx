import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, TYPE_LABELS, STATUS_COLORS, STATUS_LABELS } from '@/lib/constants';
import { TrendingUp, Folder, Clock, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import FinancialDashboard from '@/components/portfolio/FinancialDashboard';

const TABS = [
  { id: 'dashboard', label: 'Financial Dashboard' },
  { id: 'projects',  label: 'Projects List' },
];


export default function Portfolio() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('dashboard');

  useEffect(() => {
    base44.entities.Project.list('-updated_date', 200).then((p) => {
      setProjects(p);
      setLoading(false);
    });
  }, []);

  const total = projects.length;
  const inProgress = projects.filter((p) => p.status === 'in_progress').length;
  const completed = projects.filter((p) => p.status === 'completed').length;
  const totalValue = projects.reduce((s, p) => s + (p.contract_value || 0), 0);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>);


  return (
    <div>
      {/* Header */}
      <section className="mb-5">
        <h1 className="text-2xl font-bold text-slate-800 mb-1 flex items-center gap-2">
          <TrendingUp className="text-amber-500 w-6 h-6" /> Portfolio Dashboard
        </h1>
        <p className="text-sm text-slate-500">All industrial automation & energy projects at a glance.</p>
      </section>

      {/* Top KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <KpiCard label="Total Projects" value={total} icon={<Folder className="w-5 h-5" />} color="border-blue-400" />
        <KpiCard label="In Progress" value={inProgress} icon={<Clock className="w-5 h-5" />} color="border-amber-400" />
        <KpiCard label="Completed" value={completed} icon={<CheckCircle className="w-5 h-5" />} color="border-emerald-400" />
        <KpiCard label="Total Booking" value={formatCurrency(totalValue, 'SAR')} icon={<TrendingUp className="w-5 h-5" />} color="border-purple-400" />
      </section>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map((t) =>
        <button key={t.id} onClick={() => setTab(t.id)}
        className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition -mb-px ${
        tab === t.id ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`
        }>
            {t.label}
          </button>
        )}
      </div>

      {/* Tab Content */}
      {tab === 'dashboard' && <FinancialDashboard projects={projects} />}

      {tab === 'projects' &&
      <section className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">All Projects</h2>
            <Link to="/projects" className="text-sm text-amber-600 hover:underline">View full list →</Link>
          </div>
          {projects.length === 0 ?
        <div className="text-center py-16 text-slate-400">
              <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No projects yet.</p>
              <Link to="/projects/new" className="mt-3 inline-block px-4 py-2 bg-amber-500 text-slate-900 rounded font-semibold text-sm">
                Create First Project
              </Link>
            </div> :

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
                  {projects.map((p) =>
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
              onClick={() => navigate(`/projects/${p.id}`)}>
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
              )}
                </tbody>
              </table>
            </div>
        }
        </section>
      }
    </div>);

}

function KpiCard({ label, value, icon, color }) {
  return null;










}