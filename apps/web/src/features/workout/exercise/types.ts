import type { ControllerMotionState } from '@aero/motion-core';
import { gravityFromOrientation } from '@aero/motion-core';

/**
 * Workout pipeline: Raw Motion → Exercise Detector → State Machine → Rep Validation → Metrics.
 * Detectors are pure TypeScript (no React, no timers) so they are deterministic and testable.
 */
export interface RepRecord {
  index: number;
  startedAt: number; // host ms
  endedAt: number;
  durationMs: number;
  /** 0..1 normalised range of motion for this rep. */
  depth: number;
  /** 0..1 rough quality (range + tempo sanity). */
  quality: number;
}

export type DetectorEvent =
  | { type: 'state'; from: string; to: string; at: number }
  | { type: 'rep'; rep: RepRecord }
  | { type: 'rejected'; reason: string; at: number };

export interface ExerciseDetector {
  readonly id: string;
  readonly states: readonly string[];
  readonly state: string;
  readonly reps: number;
  /** Live 0..1 range-of-motion proxy for visuals. */
  readonly depth: number;
  /** Feed one motion sample; returns an event when something notable happened. */
  update(s: ControllerMotionState): DetectorEvent | null;
  reset(): void;
  /** Capture the starting pose (standing / top of push-up). */
  calibrate?(s: ControllerMotionState): void;
}

export type Rhythm = 'steady' | 'speeding up' | 'slowing down';

export interface SessionMetrics {
  reps: number;
  durationMs: number;
  avgRepMs: number;
  /** 1 − coefficient of variation of rep durations, clipped to 0..1 (1 with <2 reps). */
  consistency: number;
  /** reps per minute over the session so far. */
  cadence: number;
  rhythm: Rhythm;
  bestStreak: number;
}

/** Upward (world-vertical) component of the gravity-removed acceleration, in g. */
export function worldVertical(s: ControllerMotionState): number {
  const g = gravityFromOrientation(s.orientation); // unit "up" vector expressed in the body frame
  const a = s.linearAccel;
  return a.x * g.x + a.y * g.y + a.z * g.z;
}

/** Angle in degrees between the body-frame gravity vector now and a reference one. */
export function gravityAngleDeg(s: ControllerMotionState, ref: { x: number; y: number; z: number }): number {
  const g = gravityFromOrientation(s.orientation);
  const dot = Math.max(-1, Math.min(1, g.x * ref.x + g.y * ref.y + g.z * ref.z));
  return (Math.acos(dot) * 180) / Math.PI;
}

export class MetricsTracker {
  readonly reps: RepRecord[] = [];
  startedAt: number | null = null;
  private streak = 0;
  private best = 0;
  private lastRepAt: number | null = null;

  start(now: number): void {
    this.startedAt = now;
  }

  addRep(rep: RepRecord): void {
    this.reps.push(rep);
    // a streak = consecutive reps less than 6 s apart
    if (this.lastRepAt !== null && rep.endedAt - this.lastRepAt < 6000) this.streak++;
    else this.streak = 1;
    this.best = Math.max(this.best, this.streak);
    this.lastRepAt = rep.endedAt;
  }

  metrics(now: number): SessionMetrics {
    const durations = this.reps.map((r) => r.durationMs);
    const n = durations.length;
    const avg = n ? durations.reduce((a, b) => a + b, 0) / n : 0;
    let consistency = 1;
    if (n >= 2 && avg > 0) {
      const variance = durations.reduce((a, d) => a + (d - avg) ** 2, 0) / n;
      consistency = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / avg));
    }
    const durationMs = this.startedAt === null ? 0 : Math.max(0, now - this.startedAt);
    const cadence = durationMs > 0 ? (n / durationMs) * 60000 : 0;
    let rhythm: Rhythm = 'steady';
    if (n >= 3) {
      const last = durations[n - 1];
      const prev = durations.slice(0, n - 1).reduce((a, b) => a + b, 0) / (n - 1);
      if (last < prev * 0.8) rhythm = 'speeding up';
      else if (last > prev * 1.25) rhythm = 'slowing down';
    }
    return { reps: n, durationMs, avgRepMs: avg, consistency, cadence, rhythm, bestStreak: this.best };
  }

  reset(): void {
    this.reps.length = 0;
    this.startedAt = null;
    this.streak = 0;
    this.best = 0;
    this.lastRepAt = null;
  }
}
