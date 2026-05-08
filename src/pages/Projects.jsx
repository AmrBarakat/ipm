import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  formatCurrency, formatDate,
  STATUS_LABELS, STATUS_COLORS,
  PRIORITY_LABELS, PRIORITY_COLORS,
  TYPE_LABELS,
} from '@/lib/constants';
import { Plus, Search, FolderOpen, Filter, Trash2, RefreshCw, CheckSquare, Square, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ALL = 'all';

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState(ALL);
  const [filterType, setFilterType] = useState(ALL);
  const [filterPriority, setFilterPriority] = useState(ALL);
  const [selected, setSelected] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  useEffect(() => {
    base44.entities.Project.list('-updated_date', 200).then(p => {
      setProjects(p);
      setLoading(false);
    });
  }, []);

  const filtered = projects.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      p.name?.toLowerCase().includes(q) ||
      p.code?.toLowerCase().includes(q) ||
      p.client?.toLowerCase().includes(q) ||
      p.location?.toLowerCase().includes(q);
    const matchStatus = filterStatus === ALL || p.status === filterStatus;
    const matchType = filterType === ALL || p.project_type === filterType;
    const matchPriority = filterPriority === ALL || p.priority === filterPriority;
    return matchSearch && matchStatus && matchType && matchPriority;
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id));
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(p => p.id)));
    }
  }

  function toggleOne(id, e) {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} project(s)? This cannot be undone.`)) return;
    setBulkLoading(true);
    await Promise.all([...selected].map(id => base44.entities.Project.delete(id)));
    setProjects(prev => prev.filter(p => !selected.has(p.id)));
    setSelected(new Set());
    setBulkLoading(false);
  }

  async function bulkSetStatus(status) {
    setBulkLoading(true);
    setShowStatusMenu(false);
    await Promise.all([...selected].map(id => base44.entities.Project.update(id, { status })));
    setProjects(prev => prev.map(p => selected.has(p.id) ? { ...p, status } : p));
    setSelected(new Set());
    setBulkLoading(false);
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <FolderOpen className="text-amber-500 w-6 h-6" /> Projects
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} of {projects.length} projects</p>
        </div>
        <Link
          to="/projects/new"
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded text-sm transition"
        >
          <Plus className="w-4 h-4" /> New Project
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, code, client..."
            className="w-full border border-slate-200 rounded pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          >
            <option value={ALL}>All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          >
            <option value={ALL}>All Types</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            className="border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          >
            <option value={ALL}>All Priorities</option>
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <span className="font-semibold text-amber-800">{selected.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            {/* Bulk status update */}
            <div className="relative">
              <button
                onClick={() => setShowStatusMenu(v => !v)}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded text-slate-700 hover:bg-slate-50 font-medium text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Set Status <ChevronDown className="w-3 h-3" />
              </button>
              {showStatusMenu && (
                <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded shadow-lg z-20 py-1">
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <button key={v} onClick={() => bulkSetStatus(v)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700">
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Bulk delete */}
            <button
              onClick={bulkDelete}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white rounded font-medium text-xs disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:text-slate-600 px-2">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden" onClick={() => setShowStatusMenu(false)}>
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No projects match your filters.</p>
            {projects.length === 0 && (
              <Link to="/projects/new" className="mt-4 inline-block px-4 py-2 bg-amber-500 text-slate-900 rounded font-semibold text-sm">
                Create First Project
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                <tr>
                  <th className="pl-4 pr-2 py-3 w-8">
                    <button onClick={toggleAll} className="text-slate-400 hover:text-amber-500">
                      {allFilteredSelected
                        ? <CheckSquare className="w-4 h-4 text-amber-500" />
                        : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Project</th>
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Priority</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Progress</th>
                  <th className="px-4 py-3 text-left">Target Date</th>
                  <th className="px-4 py-3 text-left">Contract Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr
                    key={p.id}
                    className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${selected.has(p.id) ? 'bg-amber-50' : ''}`}
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    <td className="pl-4 pr-2 py-3 w-8" onClick={e => toggleOne(p.id, e)}>
                      {selected.has(p.id)
                        ? <CheckSquare className="w-4 h-4 text-amber-500" />
                        : <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{p.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{p.name}</div>
                      {p.location && <div className="text-xs text-slate-400">{p.location}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.client || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {TYPE_LABELS[p.project_type] || p.project_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PRIORITY_COLORS[p.priority] || 'bg-slate-100 text-slate-600'}`}>
                        {PRIORITY_LABELS[p.priority] || p.priority}
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
                          <div
                            className="bg-amber-500 h-1.5 rounded-full"
                            style={{ width: `${p.progress || 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 w-8 text-right">{p.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(p.target_completion_date)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">
                      {formatCurrency(p.contract_value, p.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}