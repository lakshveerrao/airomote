import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { ActivitySessionRecord } from '@aero/activity-engine';
import { activityRegistry } from '@/core/runtime';
import { useHistory } from '@/store/history';
import { BackLink, Button, Icon, formatDuration } from '@/ui';
import './workout.css';

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayTitle(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(ts) === dayKey(today.getTime())) return 'Today';
  if (dayKey(ts) === dayKey(yesterday.getTime())) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function HistoryPage() {
  const sessions = useHistory((s) => s.sessions);
  const remove = useHistory((s) => s.remove);
  const clear = useHistory((s) => s.clear);
  const workouts = useMemo(
    () => sessions.filter((s) => activityRegistry.get(s.activityId)?.category === 'workout').sort((a, b) => b.startedAt - a.startedAt),
    [sessions],
  );
  const groups = useMemo(() => {
    const map = new Map<string, ActivitySessionRecord[]>();
    for (const s of workouts) {
      const k = dayKey(s.startedAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return [...map.values()];
  }, [workouts]);
  const week = useMemo(() => {
    const since = Date.now() - 7 * 86400000;
    const w = workouts.filter((s) => s.startedAt >= since);
    return {
      sessions: w.length,
      reps: w.reduce((a, s) => a + Number(s.summary.reps ?? 0), 0),
      durationMs: w.reduce((a, s) => a + s.durationMs, 0),
    };
  }, [workouts]);

  return (
    <div className="page">
      <BackLink to="/workout" label="Workout" />
      <div className="page-head" style={{ marginTop: 16 }}>
        <div>
          <div className="eyebrow">Workout</div>
          <h1>History</h1>
        </div>
        {workouts.length > 0 && (
          <Button variant="ghost" onClick={() => confirm('Delete all workout history?') && clear()}>
            Clear all
          </Button>
        )}
      </div>

      {workouts.length === 0 ? (
        <div className="empty">
          <h3 style={{ marginBottom: 8 }}>No workouts yet</h3>
          <p style={{ marginBottom: 20 }}>Finish a set of squats or push-ups and it will show up here.</p>
          <Link to="/workout" className="btn btn--primary">
            Start a workout
          </Link>
        </div>
      ) : (
        <>
          <div className="hist-totals">
            <div className="hist-total">
              <div className="hist-total__value">{week.reps}</div>
              <div className="hist-total__label">Reps this week</div>
            </div>
            <div className="hist-total">
              <div className="hist-total__value">{week.sessions}</div>
              <div className="hist-total__label">Sessions this week</div>
            </div>
            <div className="hist-total">
              <div className="hist-total__value">{formatDuration(week.durationMs)}</div>
              <div className="hist-total__label">Active time this week</div>
            </div>
          </div>
          {groups.map((g) => (
            <section key={g[0].startedAt} className="hist-day">
              <div className="hist-day__title">{dayTitle(g[0].startedAt)}</div>
              {g.map((s) => {
                const def = activityRegistry.get(s.activityId);
                const consistency = Number(s.summary.consistency ?? 0);
                return (
                  <div key={s.startedAt} className="hist-row">
                    <span className="hist-row__accent" style={{ background: def?.accent ?? 'var(--workout)' }} />
                    <div>
                      <div className="hist-row__name">{def?.name ?? s.activityId}</div>
                      <div className="hist-row__time">{new Date(s.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
                    </div>
                    <div className="hist-row__stats">
                      <div>
                        <div className="hist-row__stat-value">{s.summary.reps ?? 0}</div>
                        <div className="hist-row__stat-label">Reps</div>
                      </div>
                      <div>
                        <div className="hist-row__stat-value">{formatDuration(s.durationMs)}</div>
                        <div className="hist-row__stat-label">Time</div>
                      </div>
                      <div>
                        <div className="hist-row__stat-value">{Number(s.summary.reps ?? 0) >= 2 ? `${Math.round(consistency * 100)}%` : '—'}</div>
                        <div className="hist-row__stat-label">Steady</div>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" icon className="hist-row__delete" aria-label="Delete session" onClick={() => remove(s.startedAt)}>
                      <Icon.Close size={16} />
                    </Button>
                  </div>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
