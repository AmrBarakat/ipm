import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Bell, Search, Plus, Factory, FolderOpen, BarChart2, LayoutDashboard, Users } from 'lucide-react';
import { formatDate } from '@/lib/constants';

export default function AppHeader() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);
  const searchRef = useRef(null);
  const notifRef = useRef(null);
  const searchTimer = useRef(null);
  const navigate = useNavigate();

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearch(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load unread count on mount
  useEffect(() => {
    loadUnreadCount();
  }, []);

  async function loadUnreadCount() {
    try {
      const notifs = await base44.entities.Notification.filter({ is_read: false });
      setUnreadCount(notifs.length);
    } catch {}
  }

  async function loadNotifications() {
    try {
      const notifs = await base44.entities.Notification.list('-created_date', 30);
      setNotifications(notifs);
      setUnreadCount(notifs.filter(n => !n.is_read).length);
    } catch {}
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.is_read);
    await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { is_read: true })));
    loadNotifications();
  }

  async function markRead(id) {
    await base44.entities.Notification.update(id, { is_read: true });
    loadNotifications();
  }

  function onSearchInput(e) {
    const q = e.target.value;
    setSearchQuery(q);
    clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setSearchResults(null); setShowSearch(false); return; }
    searchTimer.current = setTimeout(() => doSearch(q.trim()), 250);
  }

  async function doSearch(q) {
    const ql = q.toLowerCase();
    const [allProjects, allTasks] = await Promise.all([
      base44.entities.Project.list('-updated_date', 200),
      base44.entities.Task.list('-updated_date', 300),
    ]);
    const filteredProjects = allProjects.filter(p =>
      p.name?.toLowerCase().includes(ql) ||
      p.code?.toLowerCase().includes(ql) ||
      p.client?.toLowerCase().includes(ql)
    );
    const filteredTasks = allTasks.filter(t => t.title?.toLowerCase().includes(ql));
    setSearchResults({ projects: filteredProjects.slice(0, 5), tasks: filteredTasks.slice(0, 5) });
    setShowSearch(true);
  }

  const sevIcon = {
    info: 'text-blue-500',
    warning: 'text-amber-500',
    error: 'text-red-500',
  };

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
            placeholder="Search projects, tasks..."
            className="w-full bg-slate-800 border border-slate-700 rounded pl-9 pr-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
            autoComplete="off"
          />
          {showSearch && searchResults && (
            <div className="absolute left-0 right-0 mt-1 bg-white text-slate-800 rounded shadow-lg max-h-96 overflow-y-auto z-50 border border-slate-200">
              {searchResults.projects.length === 0 && searchResults.tasks.length === 0 && (
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
          <Link to="/reports" className="px-3 py-2 rounded text-sm hover:bg-slate-700 transition hidden md:flex items-center gap-1">
            <BarChart2 className="w-4 h-4" /><span>Reports</span>
          </Link>
          <Link to="/resources" className="px-3 py-2 rounded text-sm hover:bg-slate-700 transition hidden md:flex items-center gap-1">
            <Users className="w-4 h-4" /><span>Resources</span>
          </Link>

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => { setShowNotifs(v => !v); if (!showNotifs) loadNotifications(); }}
              className="px-3 py-2 rounded text-sm hover:bg-slate-700 transition relative"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            {showNotifs && (
              <div className="absolute right-0 mt-1 w-96 bg-white text-slate-800 rounded shadow-lg max-h-[32rem] overflow-hidden z-50 border border-slate-200">
                <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                  <span className="font-semibold text-sm flex items-center gap-1">
                    <Bell className="w-4 h-4 text-amber-500" /> Notifications
                  </span>
                  <button onClick={markAllRead} className="text-xs text-slate-600 hover:text-slate-900">Mark all read</button>
                </div>
                <div className="max-h-[28rem] overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 && (
                    <div className="p-6 text-center text-slate-400 text-sm">No notifications</div>
                  )}
                  {notifications.map(n => (
                    <div key={n.id} className={`px-4 py-3 flex gap-3 hover:bg-slate-50 ${!n.is_read ? 'bg-amber-50' : ''}`}>
                      <div className={`mt-0.5 shrink-0 ${sevIcon[n.severity] || sevIcon.info}`}>●</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-sm text-slate-800">{n.title}</span>
                          {!n.is_read && (
                            <button onClick={() => markRead(n.id)} className="text-xs text-slate-400 hover:text-slate-700 shrink-0">✓</button>
                          )}
                        </div>
                        {n.body && <div className="text-xs text-slate-600 mt-0.5">{n.body}</div>}
                        {n.project_code && <div className="text-[11px] text-slate-500 mt-1">{n.project_code}</div>}
                        <div className="text-[10px] text-slate-400 mt-1">{formatDate(n.created_date)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Link to="/projects/new"
            className="px-3 py-2 rounded text-sm bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold transition flex items-center gap-1">
            <Plus className="w-4 h-4" /><span className="hidden md:inline">New Project</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}