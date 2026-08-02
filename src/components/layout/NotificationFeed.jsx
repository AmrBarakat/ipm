import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Bell, Info, AlertTriangle, AlertCircle, CheckCheck, Inbox, Check, Clock, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

const SEV = {
  info:    { dot: 'bg-blue-400',  Icon: Info,          text: 'text-blue-500' },
  warning: { dot: 'bg-amber-400', Icon: AlertTriangle,  text: 'text-amber-500' },
  error:   { dot: 'bg-red-500',   Icon: AlertCircle,    text: 'text-red-500' },
};

// Postpone presets: label → milliseconds from now.
const SNOOZE_PRESETS = [
  { label: '1 hour',  ms: 60 * 60 * 1000 },
  { label: '4 hours', ms: 4 * 60 * 60 * 1000 },
  { label: 'Tomorrow', ms: 24 * 60 * 60 * 1000 },
  { label: '1 week',  ms: 7 * 24 * 60 * 60 * 1000 },
];

function isActive(n, nowIso) {
  if (n.dismissed === true) return false;
  if (n.snooze_until && new Date(n.snooze_until) > new Date(nowIso)) return false;
  return true;
}

export default function NotificationFeed() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [menuForId, setMenuForId] = useState(null);

  const { data: notifications = [] } = useQuery({
    queryKey: ['Notification', 'recent'],
    queryFn: () => base44.entities.Notification.list('-created_date', 50),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 15000,
  });

  // Active feed: not dismissed AND not currently snoozed.
  const nowIso = new Date().toISOString();
  const active = notifications.filter((n) => isActive(n, nowIso));
  const activeUnread = active.filter((n) => !n.is_read);
  const unreadCount = activeUnread.length;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['Notification'] });
  }

  async function markRead(id) {
    try { await base44.entities.Notification.update(id, { is_read: true }); } catch (_) {}
    invalidate();
  }

  // Fix: updateMany({is_read:false}, {$set:{is_read:true}}) silently no-ops
  // because the query field is_read isn't in the schema filter set correctly.
  // Instead, update each unread notification individually via Promise.allSettled.
  async function markAllRead() {
    if (!activeUnread.length) return;
    const results = await Promise.allSettled(
      activeUnread.map((n) => base44.entities.Notification.update(n.id, { is_read: true }))
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      toast.error(`Marked ${activeUnread.length - failed} read (${failed} failed)`);
    }
    invalidate();
  }

  async function snooze(id, ms) {
    setMenuForId(null);
    try {
      await base44.entities.Notification.update(id, {
        snooze_until: new Date(Date.now() + ms).toISOString(),
        is_read: true,
      });
    } catch (_) {}
    invalidate();
  }

  async function dismiss(id) {
    try { await base44.entities.Notification.update(id, { dismissed: true }); } catch (_) {}
    invalidate();
  }

  async function clearAll() {
    if (!active.length) return;
    const results = await Promise.allSettled(
      active.map((n) => base44.entities.Notification.update(n.id, { dismissed: true }))
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      toast.error(`Cleared ${active.length - failed} (${failed} failed)`);
    }
    invalidate();
  }

  function openNotification(n) {
    if (!n.is_read) markRead(n.id);
    const link = n.link;
    setOpen(false);
    if (link) navigate(link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="px-3 py-2 rounded text-sm hover:bg-slate-700 transition relative" aria-label="Notifications">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-96 p-0">
        <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-md">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-amber-500" /> Notifications
            {unreadCount > 0 && <span className="text-xs text-slate-400">· {unreadCount} unread</span>}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-40 flex items-center gap-1"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
            <button
              onClick={clearAll}
              disabled={active.length === 0}
              className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-40 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          </div>
        </div>
        <div className="max-h-[28rem] overflow-y-auto divide-y divide-slate-100">
          {active.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
              <Inbox className="w-8 h-8 opacity-40" />
              No notifications
            </div>
          ) : (
            active.map((n) => {
              const s = SEV[n.severity] || SEV.info;
              const Icon = s.Icon;
              return (
                <div
                  key={n.id}
                  className={`group relative w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-50 transition ${!n.is_read ? 'bg-amber-50/60' : ''}`}
                >
                  <button onClick={() => openNotification(n)} className="flex-1 min-w-0 flex gap-3 text-left">
                    <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${s.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${s.text} shrink-0`} />
                          {n.title}
                        </span>
                        {!n.is_read && <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0 mt-1.5" />}
                      </div>
                      {n.body && <p className="text-xs text-slate-600 mt-1 line-clamp-2">{n.body}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        {n.project_code && <span className="text-[11px] font-mono text-slate-500">{n.project_code}</span>}
                        <span className="text-[10px] text-slate-400">
                          {n.created_date ? formatDistanceToNow(new Date(n.created_date), { addSuffix: true }) : ''}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Per-item actions — visible on row hover */}
                  <div className="flex items-start gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                    {!n.is_read && (
                      <button
                        onClick={() => markRead(n.id)}
                        className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800"
                        title="Mark read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <div className="relative">
                      <button
                        onClick={() => setMenuForId(menuForId === n.id ? null : n.id)}
                        className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800"
                        title="Postpone"
                      >
                        <Clock className="w-3.5 h-3.5" />
                      </button>
                      {menuForId === n.id && (
                        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-md shadow-lg py-1 w-32">
                          {SNOOZE_PRESETS.map((p) => (
                            <button
                              key={p.label}
                              onClick={() => snooze(n.id, p.ms)}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 text-slate-700"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => dismiss(n.id)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800"
                      title="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}