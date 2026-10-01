import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { dateTime } from '../format';
import { useSave } from '../hooks';

interface Note { id: string; text: string; link: string | null; read_at: string | null; created_at: string }

/** In-app notifications: cover arrangements, transfers… Polls every minute. */
export function Bell() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: Note[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  });
  const markRead = useSave(() => api('/notifications/read', { method: 'POST' }), [['notifications']]);
  const unread = data?.unread ?? 0;
  return (
    <div className="bell">
      <button className="ghost bell-button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); if (!open && unread) markRead.mutate(undefined); }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications" onClick={(e) => e.stopPropagation()}>
          <div className="spread" style={{ marginBottom: 6 }}><strong>Notifications</strong><button className="sm ghost" onClick={() => setOpen(false)}>✕</button></div>
          {!data?.items.length && <div className="empty">Nothing yet.</div>}
          {data?.items.map((n) => (
            <div key={n.id} className={`bell-item ${n.read_at ? '' : 'unread'}`}>
              {n.link ? <Link to={n.link} onClick={() => setOpen(false)}>{n.text}</Link> : n.text}
              <div className="small muted">{dateTime(n.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
