import { useState, useEffect, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS, TYPE_LABELS, formatCurrency, formatDate } from '@/lib/constants';
import { ArrowLeft, Pencil, FolderOpen, BarChart2 } from 'lucide-react';
import ProjectPDFExport from '@/components/project-detail/ProjectPDFExport';
import ProgressReportModal from '@/components/project-detail/ProgressReportModal';
import ProjectForm from '@/components/projects/ProjectForm';
import { useTranslation } from '@/hooks/useTranslation';

const TabOverview = lazy(() => import('@/components/project-detail/TabOverview'));
const TabTasks = lazy(() => import('@/components/project-detail/TabTasks'));
const TabMilestones = lazy(() => import('@/components/project-detail/TabMilestones'));
const TabBOM = lazy(() => import('@/components/project-detail/TabBOM'));
const TabFinancials = lazy(() => import('@/components/project-detail/TabFinancials'));
const TabDocuments = lazy(() => import('@/components/project-detail/TabDocuments'));
const TabGantt = lazy(() => import('@/components/project-detail/TabGantt'));
const TabWBS = lazy(() => import('@/components/project-detail/TabWBS'));
const TabNotes = lazy(() => import('@/components/project-detail/TabNotes'));
const TabRisks = lazy(() => import('@/components/project-detail/TabRisks'));
const TabVendors = lazy(() => import('@/components/project-detail/TabVendors'));
const TabDeliverables = lazy(() => import('@/components/project-detail/TabDeliverables'));
const TabProcurement = lazy(() => import('@/components/project-detail/TabProcurement'));
const TabChangeOrders = lazy(() => import('@/components/project-detail/TabChangeOrders'));
const TabAssistant = lazy(() => import('@/components/project-detail/TabAssistant'));

const TabSpinner = () => (
  <div className="flex items-center justify-center py-20">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
  </div>
);

const TAB_GROUPS = [
  { id: 'plan',       label: 'PLAN',       tabs: ['overview', 'gantt', 'wbs', 'tasks', 'milestones', 'deliverables'] },
  { id: 'commercial', label: 'COMMERCIAL', tabs: ['bom', 'financials', 'procurement', 'changeOrders', 'vendors'] },
  { id: 'governance', label: 'GOVERNANCE', tabs: ['documents', 'notes', 'risks', 'assistant'] },
];
const DEFAULT_TAB = 'overview';
const DEFAULT_GROUP = 'plan';

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
  const [activeGroup, setActiveGroup] = useState(DEFAULT_GROUP);
  const [lastTabByGroup, setLastTabByGroup] = useState({ [DEFAULT_GROUP]: DEFAULT_TAB });
  const [editing, setEditing] = useState(false);
  const [showProgressReport, setShowProgressReport] = useState(false);
  const [overduePOCount, setOverduePOCount] = useState(0);

  function selectGroup(groupId) {
    setActiveGroup(groupId);
    setActiveTab(lastTabByGroup[groupId] || TAB_GROUPS.find(g => g.id === groupId).tabs[0]);
  }

  function selectTab(tabId) {
    setActiveTab(tabId);
    setLastTabByGroup(prev => ({ ...prev, [activeGroup]: tabId }));
  }

  useEffect(() => { loadProject(); }, [id]);
  useEffect(() => { loadOverduePOs(); }, [id]);

  async function loadOverduePOs() {
    if (!id || id === ':id') return;
    try {
      const pos = await base44.entities.PurchaseOrder.filter({ project_id: id }, '-expected_delivery_date', 500);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const count = pos.filter(po => {
        if (!po.expected_delivery_date) return false;
        if (po.status === 'delivered' || po.status === 'cancelled') return false;
        const d = new Date(po.expected_delivery_date); d.setHours(0, 0, 0, 0);
        return d < today;
      }).length;
      setOverduePOCount(count);
    } catch (_) { setOverduePOCount(0); }
  }

  async function loadProject() {
    if (!id || id === ':id') {
      setLoading(false);
      return;
    }
    setLoading(true);
    const results = await base44.entities.Project.filter({ id });
    setProject(results[0] || null);
    setLoading(false);
  }

  async function handleSaved() {
    setEditing(false);
    await loadProject();
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  if (!project) return (
    <div className="text-center py-20 text-slate-500">{t('projectDetail.notFound')}</div>
  );

  return (
    <div>
      {/* Breadcrumb + header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <Link to="/projects" className="text-slate-400 hover:text-slate-700 mt-1">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{project.code}</span>
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_COLORS[project.status]}`}>
                {STATUS_LABELS[project.status]}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PRIORITY_COLORS[project.priority]}`}>
                {PRIORITY_LABELS[project.priority]}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                {TYPE_LABELS[project.project_type]}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-800 mt-1 flex items-center gap-2">
              <FolderOpen className="text-amber-500 w-5 h-5 shrink-0" />
              {project.name}
            </h1>
            {project.client && (
              <p className="text-sm text-slate-500 mt-0.5">{project.client}{project.location ? ` · ${project.location}` : ''}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right hidden md:block">
            <div className="text-xs text-slate-500">{t('projectDetail.contractValue')}</div>
            <div className="font-bold text-slate-800">{formatCurrency(project.contract_value, project.currency)}</div>
          </div>
          <button
            onClick={() => setShowProgressReport(true)}
            className="flex items-center gap-2 px-4 py-2 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-sm text-amber-700 font-medium transition"
          >
            <BarChart2 className="w-4 h-4" /> {t('projectDetail.progressReport')}
          </button>
          <ProjectPDFExport project={project} />
          <button
            onClick={() => setEditing(v => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded border border-slate-300 hover:bg-slate-100 text-sm text-slate-700 font-medium transition"
          >
            <Pencil className="w-4 h-4" />
            {editing ? t('projectDetail.cancelEdit') : t('projectDetail.editProject')}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
          <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${project.progress || 0}%` }} />
        </div>
        <span className="text-sm font-semibold text-slate-600 w-12 text-right">{project.progress || 0}%</span>
        {project.target_completion_date && (
          <span className="text-xs text-slate-500 hidden sm:block">{t('common.due')} {formatDate(project.target_completion_date)}</span>
        )}
      </div>

      {/* Edit form */}
      {editing && (
        <div className="mb-6">
          <ProjectForm project={project} onSaved={handleSaved} />
        </div>
      )}

      {/* Tabs */}
      {!editing && (
        <>
          <div className="mb-4">
            {/* Group selector */}
            <div className="flex gap-2 mb-3">
              {TAB_GROUPS.map(g => (
                <button
                  key={g.id}
                  onClick={() => selectGroup(g.id)}
                  className={`px-4 py-2 rounded text-xs font-bold tracking-wide transition ${
                    activeGroup === g.id
                      ? 'bg-amber-500 text-slate-900 shadow-sm'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {/* Tabs within the active group */}
            <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
              {TAB_GROUPS.find(g => g.id === activeGroup).tabs.map(tabId => (
                <button
                  key={tabId}
                  onClick={() => selectTab(tabId)}
                  className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition -mb-px ${
                    activeTab === tabId
                      ? 'border-amber-500 text-amber-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {t(`projectDetail.tabs.${tabId}`)}
                    {tabId === 'procurement' && overduePOCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold text-white bg-red-500 rounded-full">{overduePOCount}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Suspense fallback={<TabSpinner />}>
            <div>
            {activeTab === 'overview'   && <TabOverview   project={project} onRefresh={loadProject} />}
            {activeTab === 'gantt'      && <TabGantt      projectId={id} project={project} />}
            {activeTab === 'wbs'        && <TabWBS        projectId={id} project={project} onProgressChange={(p) => setProject(prev => ({ ...prev, progress: p }))} />}
            {activeTab === 'tasks'      && <TabTasks      projectId={id} />}
            {activeTab === 'milestones' && <TabMilestones projectId={id} />}
            {activeTab === 'bom'        && <TabBOM        projectId={id} />}
            {activeTab === 'financials' && <TabFinancials projectId={id} project={project} />}
            {activeTab === 'documents'  && <TabDocuments  projectId={id} project={project} />}
            {activeTab === 'notes'      && <TabNotes      projectId={id} />}
            {activeTab === 'risks'      && <TabRisks      projectId={id} />}
            {activeTab === 'deliverables' && <TabDeliverables projectId={id} />}
            {activeTab === 'vendors'    && <TabVendors    projectId={id} project={project} />}
            {activeTab === 'procurement'  && <TabProcurement  projectId={id} project={project} />}
            {activeTab === 'changeOrders' && <TabChangeOrders projectId={id} project={project} />}
            {activeTab === 'assistant'   && <TabAssistant   projectId={id} project={project} />}
            </div>
          </Suspense>
        </>
      )}
      {showProgressReport && (
        <ProgressReportModal project={project} onClose={() => setShowProgressReport(false)} />
      )}
    </div>
  );
}