import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { api, type Activity } from '../api';
import { useAuth } from '../auth';
import { EASE_OUT, stagger } from '../components/motion';
import { ErrorNote } from '../components/ui';
import { intlLocale, t } from '../i18n';
import { ordered, type Module } from '../modules';

/** The opening page: a welcome line and the ERP modules as iPhone-style icons. */
export function Home() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [soon, setSoon] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Red badge on Activities: follow-ups due today or overdue.
  const endOfToday = new Date();
  endOfToday.setHours(24, 0, 0, 0);
  const due = useQuery({
    queryKey: ['activities', 'due-badge'],
    queryFn: () => api<Activity[]>(`/activities?scope=mine&state=open&to=${encodeURIComponent(endOfToday.toISOString())}&limit=500`),
    staleTime: 60_000,
  });

  const visible = (m: Module) => m.area === 'all' || can(m.area);
  const saved = ordered(me?.tenant.home_order);
  const modules = (editing ? ordered(editing) : saved).filter(visible);
  const isAdmin = can('admin');

  function move(key: string, to: number) {
    setEditing((cur) => {
      const list = ordered(cur).map((m) => m.key).filter((k) => k !== key);
      list.splice(Math.max(0, Math.min(to, list.length)), 0, key);
      return list;
    });
  }
  async function save(order: string[] | null) {
    setError(null);
    try {
      await api('/tenant', { method: 'PATCH', body: { home_order: order } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      setEditing(null);
    } catch (err) {
      setError(err);
    }
  }
  function open(m: Module) {
    if (editing) return;
    if (m.to) navigate(m.to);
    else setSoon(m.key);
  }
  const indexOf = (key: string) => ordered(editing).findIndex((m) => m.key === key);

  return (
    <div className="home">

      <ErrorNote error={error} />
      <div className={`home-grid ${editing ? 'arranging' : ''}`} role="list">
        {modules.map((m, i) => (
          // Outer layer: glides to the new place when the icons are rearranged.
          <motion.div key={m.key} role="listitem" layout transition={{ layout: { duration: 0.3, ease: EASE_OUT } }}
            className="app-slot">
            <div className={`app-tile ${m.to ? '' : 'planned'} ${dragging === m.key ? 'dragging' : ''} animate-in fade-in zoom-in-75 duration-500 ease-out fill-mode-both`}
              style={stagger(i, 40)}
              draggable={Boolean(editing)}
              onDragStart={(e: DragEvent) => { setDragging(m.key); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e: DragEvent) => { if (editing && dragging && dragging !== m.key) { e.preventDefault(); move(dragging, indexOf(m.key)); } }}
              onDragEnd={() => setDragging(null)}>
              <button type="button" className="app-icon-btn" onClick={() => open(m)}
                aria-label={m.to ? t(m.label) : `${t(m.label)} · ${t('Coming soon')}`}>
                <AppIcon module={m} badge={m.key === 'activities' ? due.data?.length : undefined} />
                <span className="app-label">{t(m.label)}</span>
              </button>
              {!m.to && !editing && <span className="app-soon">{t('Soon')}</span>}
              {editing && (
                <div className="app-move">
                  <button type="button" className="sm ghost" aria-label={t('Move {name} earlier', { name: t(m.label) })}
                    disabled={indexOf(m.key) === 0} onClick={() => move(m.key, indexOf(m.key) - 1)}><ChevronLeft className="ico flip" aria-hidden /></button>
                  <button type="button" className="sm ghost" aria-label={t('Move {name} later', { name: t(m.label) })}
                    onClick={() => move(m.key, indexOf(m.key) + 1)}><ChevronRight className="ico flip" aria-hidden /></button>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {soon && (
        <p className="home-note animate-in fade-in slide-in-from-top-1 duration-300" role="status">
          {t('{name} is planned in a later phase. It will open here once it is built.', { name: t(modules.find((m) => m.key === soon)?.label ?? '') })}
        </p>
      )}

      {isAdmin && (
        <div className="home-actions">
          {editing ? (
            <>
              <span className="small muted">{t('Drag the icons, or use the arrows. The order applies to everyone in the company.')}</span>
              <button className="ghost sm" onClick={() => save(null)}>{t('Default order')}</button>
              <button className="sm" onClick={() => setEditing(null)}>{t('Cancel')}</button>
              <button className="primary sm" onClick={() => save(editing)}>{t('Done')}</button>
            </>
          ) : (
            <button className="ghost sm" onClick={() => { setSoon(null); setEditing(saved.map((m) => m.key)); }}>{t('Arrange icons')}</button>
          )}
        </div>
      )}
    </div>
  );
}

/** One rounded-square icon. The calendar shows today's date, like the iPhone one. */
export function AppIcon({ module: m, badge }: { module: Module; badge?: number }) {
  const today = new Date();
  return (
    <span className={`app-icon app-${m.key}`} style={{ background: `linear-gradient(180deg, ${m.colors[0]}, ${m.colors[1]})` }}>
      {m.key === 'calendar' ? (
        <span className="cal-face" aria-hidden="true">
          <span className="cal-day">{today.toLocaleDateString(intlLocale(), { weekday: 'short' })}</span>
          <span className="cal-date">{today.getDate()}</span>
        </span>
      ) : m.glyph}
      {!!badge && <span className="app-badge animate-in zoom-in-50 duration-300 ease-out fill-mode-both [animation-delay:600ms]" aria-label={t('{n} due', { n: badge })}>{badge > 99 ? '99+' : badge}</span>}
    </span>
  );
}
