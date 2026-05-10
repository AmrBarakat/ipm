import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS, TYPE_LABELS, formatCurrency, formatDate } from '@/lib/constants';
import { ArrowLeft, Pencil, FolderOpen } from 'lucide-react';
import ProjectPDFExport from '@/components/project-detail/ProjectPDFExport';
import ProjectForm from '@/components/projects/ProjectForm';
import TabOverview from '@/components/project-detail/TabOverview';
import TabTasks from '@/components/project-detail/TabTasks';
import TabMilestones from '@/components/project-detail/TabMilestones';
import TabBOM from '@/components/project-detail/TabBOM';
import TabFinancials from '@/components/project-detail/TabFinancials';
import TabDocuments from '@/components/project-detail/TabDocuments';
import TabGantt from '@/components/project-detail/TabGantt';
import TabWBS from '@/components/project-detail/TabWBS';
import TabNotes from '@/components/project-detail/TabNotes';
import TabRisks from '@/components/project-detail/TabRisks';
import TabVendors from '@/components/project-detail/TabVendors';
import TabDeliverables from '@/components/project-detail/TabDeliverables';

const TABS = [
  { id: 'overview',      label: 'Overview'       },
  { id: 'gantt',         label: 'Gantt'          },
  { id: 'wbs',           label: 'WBS'            },
  { id: 'tasks',         label: 'Tasks'          },
  { id: 'milestones',    label: 'Milestones'     },
  { id: 'deliverables',  label: 'Deliverables'   },
  { id: 'bom',           label: 'BOM'            },
  { id: 'financials',    label: 'Financials'     },
  { id: 'documents',     label: 'Documents'      },
  { id: 'notes',         label: 'Notes'          },
  { id: 'risks',         label: 'Risks'          },
  { id: 'vendors',       label: 'Vendors & POs'  },
];

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [editing, setEditing] = useState(false);

  useEffect(() => { loadProject(); }, [id]);

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
    <div className="text-center py-20 text-slate-500">Project not found.</div>
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
            <div className="text-xs text-slate-500">Contract Value</div>
            <div className="font-bold text-slate-800">{formatCurrency(project.contract_value, project.currency)}</div>
          </div>
          <ProjectPDFExport project={project} />
          <button
            onClick={() => setEditing(v => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded border border-slate-300 hover:bg-slate-100 text-sm text-slate-700 font-medium transition"
          >
            <Pencil className="w-4 h-4" />
            {editing ? 'Cancel Edit' : 'Edit Project'}
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
          <span className="text-xs text-slate-500 hidden sm:block">Due {formatDate(project.target_completion_date)}</span>
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
          <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition -mb-px ${
                  activeTab === t.id
                    ? 'border-amber-500 text-amber-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div>
            {activeTab === 'overview'   && <TabOverview   project={project} onRefresh={loadProject} />}
            {activeTab === 'gantt'      && <TabGantt      projectId={id} project={project} />}
            {activeTab === 'wbs'        && <TabWBS        projectId={id} onProgressChange={(p) => setProject(prev => ({ ...prev, progress: p }))} />}
            {activeTab === 'tasks'      && <TabTasks      projectId={id} />}
            {activeTab === 'milestones' && <TabMilestones projectId={id} />}
            {activeTab === 'bom'        && <TabBOM        projectId={id} />}
            {activeTab === 'financials' && <TabFinancials projectId={id} project={project} />}
            {activeTab === 'documents'  && <TabDocuments  projectId={id} />}
            {activeTab === 'notes'      && <TabNotes      projectId={id} />}
            {activeTab === 'risks'      && <TabRisks      projectId={id} />}
            {activeTab === 'deliverables' && <TabDeliverables projectId={id} />}
            {activeTab === 'vendors'    && <TabVendors    projectId={id} project={project} />}
          </div>
        </>
      )}
    </div>
  );
}