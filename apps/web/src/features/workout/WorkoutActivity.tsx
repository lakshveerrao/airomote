import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityDefinition } from '@aero/activity-engine';
import type { ControllerMotionState } from '@aero/motion-core';
import { motionEngine } from '@/core/runtime';
import { useActivitySession } from '@/core/session';
import { ActivityChrome, useActivityFlow } from '@/features/activity/ActivityChrome';
import { Button, Icon, formatDuration } from '@/ui';
import { useHistory } from '@/store/history';
import { WorkoutStage, type FigureMode, type WorkoutVisual } from './WorkoutStage';
import { WorkoutSummary } from './WorkoutSummary';
import { MetricsTracker, type ExerciseDetector, type SessionMetrics } from './exercise/types';
import './workout.css';

const CALIBRATION_MS = 1500;

export interface WorkoutActivityProps {
  definition: ActivityDefinition;
  mode: FigureMode;
  /** Build a detector for the current sensitivity. */
  createDetector: (sensitivity: 'low' | 'normal' | 'high') => ExerciseDetector;
  /** Map detector state → plain words for the HUD. */
  phaseLabel: Record<string, string>;
}

/**
 * Shared full-screen coaching experience for rep-based exercises.
 * Motion for the 'body' role flows straight from the MotionEngine into the exercise detector.
 */
export function WorkoutActivity({ definition, mode, createDetector, phaseLabel }: WorkoutActivityProps) {
  const session = useActivitySession(definition);
  const flow = useActivityFlow(definition, session);
  const bodyId = session.roles.body ?? null;

  const detector = useMemo(() => createDetector(session.sensitivity), [createDetector, session.sensitivity]);
  const metrics = useRef(new MetricsTracker());
  const visual = useRef<WorkoutVisual>({ depth: 0, pulse: 0, running: false });
  const latest = useRef<ControllerMotionState | null>(null);

  const [calibrating, setCalibrating] = useState(false);
  const [calProgress, setCalProgress] = useState(0);
  const [reps, setReps] = useState(0);
  const [phase, setPhase] = useState<string>(detector.states[0]);
  const [live, setLive] = useState<SessionMetrics>(() => metrics.current.metrics(performance.now()));
  const [final, setFinal] = useState<SessionMetrics | null>(null);
  const saved = useRef(false);
  const startedEpoch = useRef(0);

  // ---- session lifecycle ----
  const resetSession = useCallback(() => {
    detector.reset();
    metrics.current.reset();
    setReps(0);
    setPhase(detector.states[0]);
    setFinal(null);
    saved.current = false;
    visual.current.depth = 0;
    visual.current.pulse = 0;
  }, [detector]);

  useEffect(() => {
    if (flow.phase === 'intro') resetSession();
  }, [flow.phase, resetSession]);

  // Start → calibration window → running
  useEffect(() => {
    if (flow.phase !== 'running') {
      visual.current.running = false;
      return;
    }
    if (metrics.current.startedAt !== null) {
      visual.current.running = true; // resumed from pause
      return;
    }
    setCalibrating(true);
    setCalProgress(0);
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / CALIBRATION_MS);
      setCalProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else {
        if (latest.current) detector.calibrate?.(latest.current);
        metrics.current.start(performance.now());
        startedEpoch.current = Date.now();
        setCalibrating(false);
        visual.current.running = true;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flow.phase, detector]);

  // ---- motion → detector ----
  useEffect(() => {
    return motionEngine.on('state', (s) => {
      if (s.controllerId !== bodyId) return;
      latest.current = s;
      if (flow.phase !== 'running' || calibrating || metrics.current.startedAt === null) return;
      const ev = detector.update(s);
      visual.current.depth = detector.depth;
      if (!ev) return;
      if (ev.type === 'state') setPhase(ev.to);
      else if (ev.type === 'rep') {
        metrics.current.addRep(ev.rep);
        setReps(detector.reps);
        setPhase(detector.states[0]);
        visual.current.pulse = 1;
      } else setPhase(detector.states[0]);
    });
  }, [bodyId, detector, flow.phase, calibrating]);

  // ---- timer / live metrics at 4 Hz ----
  useEffect(() => {
    if (flow.phase !== 'running' || calibrating) return;
    const id = window.setInterval(() => setLive(metrics.current.metrics(performance.now())), 250);
    return () => clearInterval(id);
  }, [flow.phase, calibrating]);

  // ---- finish → summary + history (once) ----
  useEffect(() => {
    if (flow.phase !== 'finished' || saved.current) return;
    saved.current = true;
    const m = metrics.current.metrics(performance.now());
    setFinal(m);
    if (metrics.current.startedAt !== null) {
      const endedAt = Date.now();
      useHistory.getState().add({
        activityId: definition.id,
        startedAt: startedEpoch.current || endedAt - m.durationMs,
        endedAt,
        durationMs: m.durationMs,
        summary: { reps: m.reps, avgRepMs: Math.round(m.avgRepMs), consistency: Math.round(m.consistency * 100) / 100, cadence: Math.round(m.cadence * 10) / 10 },
      });
    }
  }, [flow.phase, definition.id]);

  const rhythmText = live.reps < 3 ? 'Find your rhythm' : live.rhythm === 'steady' ? 'Steady rhythm' : live.rhythm === 'speeding up' ? 'Getting faster' : 'Slowing down';
  const waitingForController = bodyId === null || !motionEngine.getState(bodyId).connected;

  return (
    <ActivityChrome
      def={definition}
      session={session}
      flow={flow}
      onRestart={resetSession}
      summary={final ? <WorkoutSummary metrics={final} accent={definition.accent} /> : null}
      hudBottom={
        <div className="whud">
          <div className="whud__reps">
            <span className="hud-label">Reps</span>
            <span className="hud-big" style={{ color: definition.accent }}>{reps}</span>
            <span className="whud__phase glass" style={{ color: definition.accent }}>
              <span className="whud__phase-dot" />
              <span style={{ color: 'var(--text)' }}>{phaseLabel[phase] ?? phase}</span>
            </span>
          </div>
          <div className="whud__right">
            <div className="whud__timer">{formatDuration(live.durationMs)}</div>
            {waitingForController ? <div className="whud__waiting">Waiting for your controller — connect it to start counting.</div> : <div className="whud__rhythm">{rhythmText}</div>}
            <Button variant="primary" size="lg" onClick={flow.finish}>
              <Icon.Flag size={18} /> Finish
            </Button>
          </div>
        </div>
      }
    >
      <WorkoutStage visual={visual} mode={mode} accent={definition.accent} />
      {flow.phase === 'running' && calibrating && (
        <div className="wcal">
          <div className="wcal__card glass">
            <div className="hud-label" style={{ marginBottom: 8 }}>
              Get into position
            </div>
            <div className="wcal__title">Hold still</div>
            <div className="wcal__bar">
              <span style={{ width: `${Math.round(calProgress * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
    </ActivityChrome>
  );
}
