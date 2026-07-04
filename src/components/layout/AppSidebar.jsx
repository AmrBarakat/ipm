import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Search, Plus, Factory, FolderOpen, BarChart2, LayoutDashboard, Users, FileText, Package, CalendarDays, Settings as SettingsIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import NotificationFeed from '@/components/layout/NotificationFeed';

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/projects', icon: FolderOpen, label: 'Projects' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/reports', icon: BarChart2, label: 'Reports' },
  { to: '/resources', icon: Users, label: 'Resources' },
  { to: '/settings', icon: SettingsIcon, label: 'Settings' },
];

export default function AppSidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef(null);
  const searchTimer = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0'); }, [collapsed]);

  useEffect(() => {
    const handler = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearch(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function onSearchInput(e) {
    const q = e.target.value;
    setSearchQuery(q);
    clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setSearchResults(null); setShowSearch(false); return; }
    searchTimer.current = setTimeout(() => doSearch(q.trim()), 250);
  }

  async function doSearch(q) {
    const ql = q.toLowerCase();
    const [allProjects, allTasks, allDocs, allBom] = await Promise.all([
      base44.entities.Project.list('-updated_date', 200),
      base44.entities.Task.list('-updated_date', 300),
      base44.entities.Document.list('-updated_date', 300),
      base44.entities.BOMItem.list('-updated_date', 300),
    ]);
    setSearchResults({
      projects: allProjects.filter(p => p.name?.toLowerCase().includes(ql) || p.code?.toLowerCase().includes(ql) || p.client?.toLowerCase().includes(ql)).slice(0, 5),
      tasks: allTasks.filter(t => t.title?.toLowerCase().includes(ql)).slice(0, 5),
      documents: allDocs.filter(d => d.title?.toLowerCase().includes(ql) || d.reference_number?.toLowerCase().includes(ql) || d.file_name?.toLowerCase().includes(ql)).slice(0, 5),
      items: allBom.filter(b => b.description?.toLowerCase().includes(ql) || b.manufacturer_part_number?.toLowerCase().includes(ql) || b.item_code?.toLowerCase().includes(ql)).slice(0, 5),
    });
    setShowSearch(true);
  }

  function go(to) {
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults(null);
    navigate(to);
  }

  const hasResults = searchResults && (searchResults.projects.length || searchResults.tasks.length || searchResults.documents.length || searchResults.items.length);

  return (
    <aside className={`sticky top-0 h-screen bg-slate-900 text-white shrink-0 flex flex-col transition-all duration-200 z-40 ${collapsed ? 'w-16' : 'w-60'}`}>
      {/* Logo + collapse toggle */}
      <div className="flex items-center gap-2 px-3 h-14 shrink-0 border-b border-slate-800">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <Factory className="text-amber-400 w-7 h-7" />
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-wide">IAM</div>
              <div className="text-[10px] text-slate-400">Industrial Automation Management</div>
            </div>
          )}
        </Link>
        <button onClick={() => setCollapsed(v => !v)}
          className="ml-auto p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition shrink-0"
          title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-3 relative" ref={searchRef}>
        {collapsed ? (
          <button onClick={() => setCollapsed(false)}
            className="w-full flex items-center justify-center px-2 py-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition"
            title="Search">
            <Search className="w-5 h-5" />
          </button>
        ) : (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              value={searchQuery}
              onChange={onSearchInput}
              onFocus={() => searchResults && setShowSearch(true)}
              placeholder="Search…"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
              autoComplete="off"
            />
          </div>
        )}
        {showSearch && searchResults && (
          <div className="absolute top-full left-2 right-2 mt-1 bg-white text-slate-800 rounded-lg shadow-xl max-h-96 overflow-y-auto z-50 border border-slate-200">
            {!hasResults && <div className="p-4 text-sm text-slate-500 text-center">No results found</div>}
            {searchResults.projects.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-500 bg-slate-50">Projects</div>
                {searchResults.projects.map(p => (
                  <button key={p.id} onClick={() => go(`/projects/${p.id}`)} className="w-full text-left block px-3 py-2 hover:bg-amber-50 border-b border-slate-100">
                    <div className="flex items-center gap-2"><FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" /><span className="font-mono text-xs text-slate-500">{p.code}</span><span className="font-semibold text-sm truncate">{p.name}</span></div>
                    <div className="text-xs text-slate-500 ml-6">{p.client} · {p.status}</div>
                  </button>
                ))}
              </>
            )}
            {searchResults.tasks.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-500 bg-slate-50">Tasks</div>
                {searchResults.tasks.map(t => (
                  <button key={t.id} onClick={() => go(`/projects/${t.project_id}`)} className="w-full text-left block px-3 py-2 hover:bg-amber-50 border-b border-slate-100">
                    <span className="font-semibold text-sm truncate">{t.title}</span>
                    <div className="text-xs text-slate-500 ml-1">{t.status} {t.assignee ? `· ${t.assignee}` : ''}</div>
                  </button>
                ))}
              </>
            )}
            {searchResults.documents.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-500 bg-slate-50">Documents</div>
                {searchResults.documents.map(d => (
                  <button key={d.id} onClick={() => go(`/projects/${d.project_id}`)} className="w-full text-left block px-3 py-2 hover:bg-amber-50 border-b border-slate-100">
                    <div className="flex items-center gap-2"><FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="font-semibold text-sm truncate">{d.title}</span>{d.reference_number && <span className="font-mono text-xs text-slate-500">#{d.reference_number}</span>}</div>
                    <div className="text-xs text-slate-500 ml-6">{d.category}{d.version ? ` · ${d.version}` : ''}</div>
                  </button>
                ))}
              </>
            )}
            {searchResults.items.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-500 bg-slate-50">BOM Items</div>
                {searchResults.items.map(b => (
                  <button key={b.id} onClick={() => go(`/projects/${b.project_id}`)} className="w-full text-left block px-3 py-2 hover:bg-amber-50 border-b border-slate-100">
                    <div className="flex items-center gap-2"><Package className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="font-semibold text-sm truncate">{b.description}</span></div>
                    <div className="text-xs text-slate-500 ml-6">{b.manufacturer_part_number && <span className="font-mono">{b.manufacturer_part_number}</span>}{b.supplier ? ` · ${b.supplier}` : ''}{b.quantity ? ` · Qty ${b.quantity}` : ''}</div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="px-2 space-y-1 flex-1 overflow-y-auto">
        {NAV.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end}
            className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${collapsed ? 'justify-center' : ''} ${isActive ? 'bg-amber-500 text-slate-900 font-semibold' : 'text-slate-300 hover:bg-slate-700/60'}`}
            title={collapsed ? item.label : undefined}>
            <item.icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="px-2 py-3 space-y-2 border-t border-slate-800 shrink-0">
        <Link to="/projects/new"
          className={`flex items-center gap-2 ${collapsed ? 'justify-center px-2' : 'px-3'} py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm transition`}
          title={collapsed ? 'New Project' : undefined}>
          <Plus className="w-5 h-5 shrink-0" />
          {!collapsed && <span>New Project</span>}
        </Link>
        <div className={collapsed ? 'flex justify-center' : ''}>
          <NotificationFeed />
        </div>
      </div>
    </aside>
  );
}