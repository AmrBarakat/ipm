import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Search, Plus, Factory, FolderOpen, BarChart2, LayoutDashboard, Users, FileText, Package, CalendarDays } from 'lucide-react';
import NotificationFeed from '@/components/layout/NotificationFeed';

export default function AppHeader() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef(null);
  const searchTimer = useRef(null);
  const navigate = useNavigate();

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearch(false);
    };
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
    const filteredProjects = allProjects.filter(p =>
      p.name?.toLowerCase().includes(ql) ||
      p.code?.toLowerCase().includes(ql) ||
      p.client?.toLowerCase().includes(ql)
    );
    const filteredTasks = allTasks.filter(t => t.title?.toLowerCase().includes(ql));
    const filteredDocs = allDocs.filter(d =>
      d.title?.toLowerCase().includes(ql) ||
      d.reference_number?.toLowerCase().includes(ql) ||
      d.file_name?.toLowerCase().includes(ql)
    );
    const filteredBom = allBom.filter(b =>
      b.description?.toLowerCase().includes(ql) ||
      b.manufacturer_part_number?.toLowerCase().includes(ql) ||
      b.item_code?.toLowerCase().includes(ql)
    );
    setSearchResults({
      projects: filteredProjects.slice(0, 5),
      tasks: filteredTasks.slice(0, 5),
      documents: filteredDocs.slice(0, 5),
      items: filteredBom.slice(0, 5),
    });
    setShowSearch(true);
  }

  return (
    <header className="bg-slate-900 text-white shadow-lg sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 shrink-0">
          <Factory className="text-amber-400 w-7 h-7" />
          <div>
            <div className="text-base font-bold tracking-wide leading-tight">IndustrialPM</div>
            <div className="text-[10px] text-slate-400 leading-tight hidden sm:block">Automation & Energy PM</div>
          </div>
        </Link>

        {/* Global Search */}
        <div className="relative flex-1 max-w-md min-w-[180px]" ref={searchRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={onSearchInput}
            onFocus={() => searchResults && setShowSearch(true)}
            placeholder="Search projects, tasks, documents, items..."
            className="w-full bg-slate-800 border border-slate-700 rounded pl-9 pr-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
            autoComplete="off"
          />
          {showSearch && searchResults && (
            <div className="absolute left-0 right-0 mt-1 bg-white text-slate-800 rounded shadow-lg max-h-96 overflow-y-auto z-50 border border-slate-200">
              {searchResults.projects.length === 0 && searchResults.tasks.length === 0 && searchResults.documents.length === 0 && searchResults.items.length === 0 && (
                <div className="p-4 text-sm text-slate-500 text-center">No results found</div>
              )}
              {searchResults.projects.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-500 bg-slate-50">Projects</div>
                  {searchResults.projects.map(p => (
                    <Link key={p.id} to={`/projects/${p.id}`} onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                      className="block px-3 py-2 hover:bg-amber-50 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="font-mono text-xs text-slate-500">{p.code}</span>
                        <span className="font-semibold text-sm truncate">{p.name}</span>
                      </div>
                      <div className="text-xs text-slate-500 ml-6">{p.client} · {p.status}</div>
                    </Link>
                  ))}
                </>
              )}
              {searchResults.tasks.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-500 bg-slate-50">Tasks</div>
                  {searchResults.tasks.map(t => (
                    <Link key={t.id} to={`/projects/${t.project_id}`} onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                      className="block px-3 py-2 hover:bg-amber-50 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{t.title}</span>
                      </div>
                      <div className="text-xs text-slate-500 ml-1">{t.status} {t.assignee ? `· ${t.assignee}` : ''}</div>
                    </Link>
                  ))}
                </>
              )}
              {searchResults.documents.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-500 bg-slate-50">Documents</div>
                  {searchResults.documents.map(d => (
                    <Link key={d.id} to={`/projects/${d.project_id}`} onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                      className="block px-3 py-2 hover:bg-amber-50 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="font-semibold text-sm truncate">{d.title}</span>
                        {d.reference_number && <span className="font-mono text-xs text-slate-500">#{d.reference_number}</span>}
                      </div>
                      <div className="text-xs text-slate-500 ml-6">{d.category}{d.version ? ` · ${d.version}` : ''}</div>
                    </Link>
                  ))}
                </>
              )}
              {searchResults.items.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-500 bg-slate-50">BOM Items</div>
                  {searchResults.items.map(b => (
                    <Link key={b.id} to={`/projects/${b.project_id}`} onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                      className="block px-3 py-2 hover:bg-amber-50 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <Package className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="font-semibold text-sm truncate">{b.description}</span>
                      </div>
                      <div className="text-xs text-slate-500 ml-6">
                        {b.manufacturer_part_number && <span className="font-mono">{b.manufacturer_part_number}</span>}
                        {b.supplier ? ` · ${b.supplier}` : ''}
                        {b.quantity ? ` · Qty ${b.quantity}` : ''}
                      </div>
                    </Link>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          <Link to="/" className="px-3 py-2 rounded text-sm hover:bg-slate-700 transition hidden md:flex items-center gap-1">
            <LayoutDashboard className="w-4 h-4" /><span>Dashboard</span>
          </Link>
          <Link to="/projects" className="px-3 py-2 rounded text-sm hover:bg-slate-700 transition hidden md:flex items-center gap-1">
            <FolderOpen className="w-4 h-4" /><span>Projects</span>
          </Link>
          <Link to="/calendar" className="px-3 py-2 rounded text-sm hover:bg-slate-700 transition hidden md:flex items-center gap-1">
            <CalendarDays className="w-4 h-4" /><span>Calendar</span>
          </Link>
          <Link to="/reports" className="px-3 py-2 rounded text-sm hover:bg-slate-700 transition hidden md:flex items-center gap-1">
            <BarChart2 className="w-4 h-4" /><span>Reports</span>
          </Link>
          <Link to="/resources" className="px-3 py-2 rounded text-sm hover:bg-slate-700 transition hidden md:flex items-center gap-1">
            <Users className="w-4 h-4" /><span>Resources</span>
          </Link>

          {/* Notifications */}
          <NotificationFeed />

          <Link to="/projects/new"
            className="px-3 py-2 rounded text-sm bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold transition flex items-center gap-1">
            <Plus className="w-4 h-4" /><span className="hidden md:inline">New Project</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}