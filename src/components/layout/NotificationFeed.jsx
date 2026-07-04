import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Bell, Info, AlertTriangle, AlertCircle, CheckCheck, Inbox } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const SEV = {
  info:    { dot: 'bg-blue-400',  Icon: Info,          text: 'text-blue-500' },
  warning: { dot: 'bg-amber-400', Icon: AlertTriangle,  text: 'text-amber-500' },
  error:   { dot: 'bg-red-500',   Icon: AlertCircle,    text: 'text-red-500' },
};

export default function NotificationFeed() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery({
    queryKey: ['Notification', 'recent'],
    queryFn: () => base44.entities.Notification.list('-created_date', 30),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 15000,
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function markRead(id) {
    try { await base44.entities.Notification.update(id, { is_read: true }); } catch (_) {}
    queryClient.invalidateQueries({ queryKey: ['Notification'] });
  }

  async function markAllRead() {
    try {
      await base44.entities.Notification.updateMany({ is_read: false }, { $set: { is_read: true } });
    } catch (_) {}
    queryClient.invalidateQueries({ queryKey: ['Notification'] });
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
      <PopoverContent align="end" className="w-96 p-0">
        <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-md">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-amber-500" /> Notifications
            {unreadCount > 0 && <span className="text-xs text-slate-400">· {unreadCount} unread</span>}
          </span>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-40 flex items-center gap-1"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
        </div>
        <div className="max-h-[28rem] overflow-y-auto divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
              <Inbox className="w-8 h-8 opacity-40" />
              No notifications
            </div>
          ) : (
            notifications.map((n) => {
              const s = SEV[n.severity] || SEV.info;
              const Icon = s.Icon;
              return (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-50 transition ${!n.is_read ? 'bg-amber-50/60' : ''}`}
                >
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
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}