import type { SessionMetrics } from './exercise/types';
import { formatDuration } from '@/ui';
import './workout.css';

export function encouragement(m: SessionMetrics): string {
  if (m.reps === 0) return 'No full reps this time. Slow down and go through the whole range.';
  if (m.reps >= 20) return 'Serious set. Strong work.';
  if (m.consistency > 0.85) return 'Beautifully steady tempo.';
  if (m.rhythm === 'slowing down') return 'You slowed toward the end — that is where the strength builds.';
  if (m.reps >= 10) return 'Solid set. Keep the rhythm even next time.';
  return 'Good start. Every counted rep was a full one.';
}

export function WorkoutSummary({ metrics, accent }: { metrics: SessionMetrics; accent: string }) {
  return (
    <div className="wsummary">
      <div className="wsummary__reps" style={{ color: accent }}>
        {metrics.reps}
        <span className="wsummary__reps-label">reps</span>
      </div>
      <div className="wsummary__grid">
        <Stat label="Duration" value={formatDuration(metrics.durationMs)} />
        <Stat label="Avg rep" value={metrics.avgRepMs ? `${(metrics.avgRepMs / 1000).toFixed(1)} s` : '—'} />
        <Stat label="Consistency" value={metrics.reps >= 2 ? `${Math.round(metrics.consistency * 100)}%` : '—'} />
        <Stat label="Best streak" value={metrics.bestStreak ? `${metrics.bestStreak}` : '—'} />
      </div>
      <p className="wsummary__note dim">{encouragement(metrics)}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="wsummary__stat">
      <div className="wsummary__stat-value tabular">{value}</div>
      <div className="wsummary__stat-label">{label}</div>
    </div>
  );
}
