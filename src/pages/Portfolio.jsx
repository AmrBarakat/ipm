import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { TrendingUp, Activity } from 'lucide-react';
import FinancialDashboard from '@/components/portfolio/FinancialDashboard';
import PortfolioHealthTable from '@/components/portfolio/PortfolioHealthTable';




export default function Portfolio() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    base44.entities.Project.list('-updated_date', 200).then((p) => {
      setProjects(p);
      setLoading(false);
    });
  }, []);

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


    </div>);

}