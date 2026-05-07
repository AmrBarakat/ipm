import { formatDate, formatCurrency } from '@/lib/constants';

export default function TabOverview({ project }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Details card */}
      <div className="bg-white rounded-lg shadow-sm p-5 space-y-3">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide border-b pb-2">Project Details</h3>
        <Row label="Project Manager" value={project.project_manager} />
        <Row label="Start Date" value={formatDate(project.start_date)} />
        <Row label="Target Completion" value={formatDate(project.target_completion_date)} />
        <Row label="Contract Value" value={formatCurrency(project.contract_value, project.currency)} />
        <Row label="Type" value={project.project_type} />
        <Row label="Location" value={project.location} />
        <Row label="Client" value={project.client} />
      </div>

      {/* Description & Scope */}
      <div className="space-y-4">
        {project.description && (
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide border-b pb-2 mb-3">Description</h3>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{project.description}</p>
          </div>
        )}
        {project.scope && (
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide border-b pb-2 mb-3">Scope of Work</h3>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{project.scope}</p>
          </div>
        )}
        {!project.description && !project.scope && (
          <div className="bg-white rounded-lg shadow-sm p-5 text-slate-400 text-sm text-center">
            No description or scope defined. Edit the project to add details.
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value || '—'}</span>
    </div>
  );
}