import type { ControllerMotionState } from '@aero/motion-core';
import { LowPass, clamp, gravityFromOrientation } from '@aero/motion-core';
import { gravityAngleDeg, type DetectorEvent, type ExerciseDetector, type RepRecord } from '../../features/workout/exercise/types';

export const PUSHUP_STATES = ['UP', 'DESCENDING', 'BOTTOM', 'ASCENDING'] as const;
export type PushupState = (typeof PUSHUP_STATES)[number];

export interface PushupOptions {
  /** degrees of upper-arm rotation from the top position that counts as the bottom. */
  bottomAngleDeg: number;
  /** degrees from baseline considered "back at the top". */
  topAngleDeg: number;
  /** degrees that start a descent. */
  startAngleDeg: number;
  minRepMs: number;
  maxRepMs: number;
  refractoryMs: number;
}

export const DEFAULT_PUSHUP_OPTIONS: PushupOptions = {
  bottomAngleDeg: 35,
  topAngleDeg: 12,
  startAngleDeg: 14,
  minRepMs: 600,
  maxRepMs: 8000,
  refractoryMs: 300,
};

export function pushupOptionsFor(level: 'low' | 'normal' | 'high'): PushupOptions {
  const k = level === 'high' ? 0.75 : level === 'low' ? 1.25 : 1;
  return { ...DEFAULT_PUSHUP_OPTIONS, bottomAngleDeg: DEFAULT_PUSHUP_OPTIONS.bottomAngleDeg * k };
}

/**
 * Push-up detector for a controller worn on the upper arm. The arm swings from near-vertical
 * (top) toward horizontal (bottom); we measure the angle between the current gravity vector and
 * the one captured at the top, so the exact strapping direction does not matter.
 */
export class PushupDetector implements ExerciseDetector {
  readonly id = 'pushups';
  readonly states = PUSHUP_STATES;
  state: PushupState = 'UP';
  reps = 0;
  depth = 0;

  private ref: { x: number; y: number; z: number } | null = null;
  private readonly angleLp = new LowPass(6);
  private stateSince = 0;
  private candidateSince: number | null = null;
  private repStart = 0;
  private maxAngle = 0;
  private lastRepAt = -Infinity;
  private lastT: number | null = null;
  /** After a timed-out rep the arm must come back to the top before a new rep can start. */
  private needTop = false;

  constructor(private readonly opts: PushupOptions = DEFAULT_PUSHUP_OPTIONS) {}

  calibrate(s: ControllerMotionState): void {
    this.ref = gravityFromOrientation(s.orientation);
    this.angleLp.reset(0);
  }

  reset(): void {
    this.state = 'UP';
    this.reps = 0;
    this.depth = 0;
    this.ref = null;
    this.candidateSince = null;
    this.maxAngle = 0;
    this.lastRepAt = -Infinity;
    this.lastT = null;
    this.needTop = false;
    this.angleLp.reset();
  }

  private transition(to: PushupState, at: number): DetectorEvent {
    const from = this.state;
    this.state = to;
    this.stateSince = at;
    this.candidateSince = null;
    return { type: 'state', from, to, at };
  }

  private abort(reason: string, t: number): DetectorEvent {
    this.state = 'UP';
    this.stateSince = t;
    this.candidateSince = null;
    this.maxAngle = 0;
    this.needTop = true;
    return { type: 'rejected', reason, at: t };
  }

  update(s: ControllerMotionState): DetectorEvent | null {
    const t = s.hostTime;
    let dt = this.lastT === null ? 0.01 : (t - this.lastT) / 1000;
    if (!(dt > 0) || dt > 0.25) dt = 0.01;
    this.lastT = t;
    if (this.stateSince === 0) this.stateSince = t;
    if (!this.ref) this.calibrate(s); // first sample = top position if nobody calibrated
    const angle = this.angleLp.update(gravityAngleDeg(s, this.ref!), dt);
    const { bottomAngleDeg, topAngleDeg, startAngleDeg, minRepMs, maxRepMs, refractoryMs } = this.opts;
    const inState = t - this.stateSince;
    if (this.state !== 'UP') this.maxAngle = Math.max(this.maxAngle, angle);
    this.depth = clamp(angle / bottomAngleDeg, 0, 1);

    switch (this.state) {
      case 'UP': {
        if (t - this.lastRepAt < refractoryMs) return null;
        if (this.needTop) {
          if (angle <= topAngleDeg) this.needTop = false;
          return null;
        }
        if (angle > startAngleDeg) {
          if (this.candidateSince === null) this.candidateSince = t;
          else if (t - this.candidateSince >= 100) {
            this.repStart = this.candidateSince;
            this.maxAngle = angle;
            return this.transition('DESCENDING', t);
          }
        } else this.candidateSince = null;
        return null;
      }
      case 'DESCENDING': {
        if (inState > 4000) return this.abort('descent too slow', t);
        if (angle >= bottomAngleDeg) return this.transition('BOTTOM', t);
        if (angle < topAngleDeg * 0.7) return this.abort('half rep', t);
        return null;
      }
      case 'BOTTOM': {
        if (inState > maxRepMs) return this.abort('held too long', t);
        if (angle < Math.min(bottomAngleDeg - 8, this.maxAngle - 8)) return this.transition('ASCENDING', t);
        return null;
      }
      case 'ASCENDING': {
        if (inState > 4000) return this.abort('ascent too slow', t);
        if (angle <= topAngleDeg) {
          this.transition('UP', t);
          const durationMs = t - this.repStart;
          const range = this.maxAngle;
          this.maxAngle = 0;
          if (durationMs >= minRepMs && durationMs <= maxRepMs && range >= bottomAngleDeg) {
            this.reps++;
            this.lastRepAt = t;
            const depth = clamp(range / (bottomAngleDeg * 1.6), 0, 1);
            const tempo = clamp(1 - Math.abs(durationMs - 2000) / 5000, 0.3, 1);
            const rep: RepRecord = { index: this.reps, startedAt: this.repStart, endedAt: t, durationMs, depth, quality: clamp(0.5 * depth + 0.5 * tempo, 0, 1) };
            return { type: 'rep', rep };
          }
          return { type: 'rejected', reason: durationMs < minRepMs ? 'too fast' : 'incomplete', at: t };
        }
        if (angle > this.maxAngle - 2 && angle >= bottomAngleDeg && inState > 300) return this.transition('BOTTOM', t);
        return null;
      }
    }
    return null;
  }

  get angleDeg(): number {
    return this.angleLp.value;
  }
}
