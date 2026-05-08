import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { BarChart2 } from 'lucide-react';
import ProfitMarginReport from '@/components/portfolio/ProfitMarginReport';

const TABS = [
  { id: 'profit', label: 'Profit & Margin Report' },
];

export default function Reports() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('profit');

  useEffect(() => {
    base44.entities.Project.list('-updated_date', 200).then(p => {
      setProjects(p);
      setLoading(false);
    });
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div>
      <section className="mb-5">
        <h1 className="text-2xl font-bold text-slate-800 mb-1 flex items-center gap-2">
          <BarChart2 className="text-amber-500 w-6 h-6" /> Reports
        </h1>
        <p className="text-sm text-slate-500">Portfolio-level financial reports and analysis.</p>
      </section>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition -mb-px ${
              tab === t.id ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profit' && <ProfitMarginReport projects={projects} />}
    </div>
  );
}