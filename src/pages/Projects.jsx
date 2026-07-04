import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useEntityList, useEntityMutation, useEntityInfiniteList } from '@/hooks/useEntity';
import {
  formatCurrency, formatDate,
  STATUS_LABELS, STATUS_COLORS,
  PRIORITY_LABELS, PRIORITY_COLORS,
  TYPE_LABELS,
} from '@/lib/constants';
import { Plus, Search, FolderOpen, Filter, Trash2, RefreshCw, CheckSquare, Square, ChevronDown, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ProjectSummaryWidget from '@/components/projects/ProjectSummaryWidget';
import { useTranslation } from '@/hooks/useTranslation';
import SkeletonCard from '@/components/ui/SkeletonCard';

const ALL = 'all';
const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;

export default function Projects() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const projectMutation = useEntityMutation('Project');

  // Portfolio-wide summary (unfiltered) — kept as a single cached fetch for the widget.
  const { data: summaryProjects = [] } = useEntityList('Project', null, '-updated_date', 5000);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState(ALL);
  const [filterType, setFilterType] = useState(ALL);
  const [filterPriority, setFilterPriority] = useState(ALL);
  const [selected, setSelected] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  // Debounce the text search so we don't query on every keystroke
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Reset selection when the active query changes so stale ids don't linger
  useEffect(() => {
    setSelected(new Set());
  }, [debouncedSearch, filterStatus, filterType, filterPriority]);

  // Build the server-side filter from the debounced search + active filters
  const filterObj = (() => {
    const f = {};
    if (filterStatus !== ALL) f.status = filterStatus;
    if (filterType !== ALL) f.project_type = filterType;
    if (filterPriority !== ALL) f.priority = filterPriority;
    if (debouncedSearch) {
      f.$or = [
        { name: { $regex: debouncedSearch, $options: 'i' } },
        { code: { $regex: debouncedSearch, $options: 'i' } },
        { client: { $regex: debouncedSearch, $options: 'i' } },
        { location: { $regex: debouncedSearch, $options: 'i' } },
      ];
    }
    return f;
  })();

  const {
    items: projects,
    isLoading: loading,
    isFetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useEntityInfiniteList('Project', filterObj, '-updated_date', PAGE_SIZE);

  const allFilteredSelected = projects.length > 0 && projects.every(p => selected.has(p.id));
  const someSelected = selected.size > 0;
  const noFiltersActive = !debouncedSearch && filterStatus === ALL && filterType === ALL && filterPriority === ALL;

  function toggleAll() {
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(projects.map(p => p.id)));
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
    if (!confirm(t('projects.deleteConfirm', { n: selected.size }))) return;
    setBulkLoading(true);
    try {
      await Promise.all([...selected].map(id => projectMutation.mutateAsync({ action: 'delete', id })));
      setSelected(new Set());
    } finally {
      setBulkLoading(false);
    }
  }

  async function bulkSetStatus(status) {
    setBulkLoading(true);
    setShowStatusMenu(false);
    try {
      await Promise.all([...selected].map(id => projectMutation.mutateAsync({ action: 'update', id, data: { status } })));
      setSelected(new Set());
    } finally {
      setBulkLoading(false);
    }
  }

  if (loading) return (
    <div className="space-y-6">
      <div className="h-8 w-56 bg-slate-200 rounded animate-pulse" />
      <SkeletonCard count={6} />
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <FolderOpen className="text-amber-500 w-6 h-6" /> {t('projects.title')}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {projects.length} {t('projects.countLabel')}
            {hasNextPage && <span className="text-slate-400"> · more available</span>}
            {isFetching && !isFetchingNextPage && <span className="text-slate-400"> · updating…</span>}
          </p>
        </div>
        <Link
          to="/projects/new"
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded text-sm transition"
        >
          <Plus className="w-4 h-4" /> {t('projects.newProject')}
        </Link>
      </div>

      {/* Summary Widget */}
      <ProjectSummaryWidget projects={summaryProjects} />

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={t('projects.searchPlaceholder')}
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
            <option value={ALL}>{t('projects.allStatuses')}</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          >
            <option value={ALL}>{t('projects.allTypes')}</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            className="border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          >
            <option value={ALL}>{t('projects.allPriorities')}</option>
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <span className="font-semibold text-amber-800">{selected.size} {t('projects.selected')}</span>
          <div className="flex items-center gap-2 ml-auto">
            {/* Bulk status update */}
            <div className="relative">
              <button
                onClick={() => setShowStatusMenu(v => !v)}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded text-slate-700 hover:bg-slate-50 font-medium text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" /> {t('projects.setStatus')} <ChevronDown className="w-3 h-3" />
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
              <Trash2 className="w-3.5 h-3.5" /> {t('common.delete')}
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:text-slate-600 px-2">
              {t('common.clear')}
            </button>
          </div>
        </div>
      )}

      {/* Cards Grid */}
      <div onClick={() => setShowStatusMenu(false)}>
        {projects.length === 0 ? (
          <div className="text-center py-16 text-slate-400 bg-white rounded-lg shadow-sm">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t('projects.noMatch')}</p>
            {noFiltersActive && (
              <Link to="/projects/new" className="mt-4 inline-block px-4 py-2 bg-amber-500 text-slate-900 rounded font-semibold text-sm">
                {t('projects.createFirst')}
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {projects.map(p => (
                <div
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className={`bg-white rounded-xl shadow-sm border hover:shadow-md hover:border-amber-300 transition cursor-pointer relative ${selected.has(p.id) ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}
                >
                  {/* Select checkbox */}
                  <div className="absolute top-3 right-3" onClick={e => toggleOne(p.id, e)}>
                    {selected.has(p.id)
                      ? <CheckSquare className="w-4 h-4 text-amber-500" />
                      : <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />}
                  </div>

                  <div className="p-5">
                    {/* Code + badges */}
                    <div className="flex items-center gap-2 flex-wrap mb-2 pr-6">
                      <span className="font-mono text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{p.code}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_COLORS[p.status] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PRIORITY_COLORS[p.priority] || 'bg-slate-100 text-slate-600'}`}>
                        {PRIORITY_LABELS[p.priority] || p.priority}
                      </span>
                    </div>

                    {/* Name */}
                    <h3 className="font-bold text-slate-800 text-base leading-snug mb-0.5">{p.name}</h3>
                    {p.client && <p className="text-sm text-slate-500 mb-1">{p.client}{p.location ? ` · ${p.location}` : ''}</p>}

                    {/* Type */}
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500">
                      {TYPE_LABELS[p.project_type] || p.project_type}
                    </span>

                    {/* Progress bar */}
                    <div className="mt-4">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-slate-400">{t('common.progress')}</span>
                        <span className="text-xs font-semibold text-slate-600">{p.progress || 0}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-amber-500 h-2 rounded-full transition-all"
                          style={{ width: `${p.progress || 0}%` }}
                        />
                      </div>
                    </div>

                    {/* Footer row */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <div>
                        {p.target_completion_date && (
                          <span>{t('common.due')} {formatDate(p.target_completion_date)}</span>
                        )}
                      </div>
                      <div className="font-semibold text-slate-700 text-sm">
                        {formatCurrency(p.contract_value, p.currency)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Load more */}
            {hasNextPage && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="flex items-center gap-2 px-5 py-2 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  {isFetchingNextPage ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                  ) : (
                    <><ChevronDown className="w-4 h-4" /> Load more</>
                  )}
                </button>
              </div>
            )}
            {!hasNextPage && projects.length >= PAGE_SIZE && (
              <div className="text-center text-xs text-slate-400 mt-5">End of results</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}