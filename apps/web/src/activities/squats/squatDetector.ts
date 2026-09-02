import type { ControllerMotionState } from '@aero/motion-core';
import { LowPass, clamp } from '@aero/motion-core';
import { worldVertical, type DetectorEvent, type ExerciseDetector, type RepRecord } from '../../features/workout/exercise/types';

export const SQUAT_STATES = ['STANDING', 'DESCENDING', 'BOTTOM', 'ASCENDING'] as const;
export type SquatState = (typeof SQUAT_STATES)[number];

export interface SquatOptions {
  /** m/s of the (leaky) vertical velocity proxy needed to start a phase. */
  velocityThreshold: number;
  /** m of displacement proxy required to accept a bottom. */
  minDepth: number;
  /** m that maps to depth = 1 for visuals. */
  fullDepth: number;
  minRepMs: number;
  maxRepMs: number;
  refractoryMs: number;
}

export const DEFAULT_SQUAT_OPTIONS: SquatOptions = {
  velocityThreshold: 0.22,
  minDepth: 0.1,
  fullDepth: 0.4,
  minRepMs: 600,
  maxRepMs: 6000,
  refractoryMs: 300,
};

export function squatOptionsFor(level: 'low' | 'normal' | 'high'): SquatOptions {
  const k = level === 'high' ? 0.75 : level === 'low' ? 1.3 : 1;
  return { ...DEFAULT_SQUAT_OPTIONS, velocityThreshold: DEFAULT_SQUAT_OPTIONS.velocityThreshold * k, minDepth: DEFAULT_SQUAT_OPTIONS.minDepth * k };
}

const G = 9.81;

/**
 * Squat detector. Works on the world-vertical linear acceleration integrated into leaky
 * velocity/displacement proxies (no claim of true position — just enough shape to tell a full
 * squat from a wobble). Counts only STANDING → DESCENDING → BOTTOM → ASCENDING → STANDING.
 */
export class SquatDetector implements ExerciseDetector {
  readonly id = 'squats';
  readonly states = SQUAT_STATES;
  state: SquatState = 'STANDING';
  reps = 0;
  depth = 0;

  private readonly az = new LowPass(4);
  private velocity = 0; // m/s, + up
  private displacement = 0; // m, − down
  private stillFor = 0; // s of near-zero acceleration
  private stateSince = 0;
  private candidateSince: number | null = null;
  private repStart = 0;
  private minDisplacement = 0;
  private lastRepAt = -Infinity;
  private baselinePitch: number | null = null;
  private lastT: number | null = null;

  constructor(private readonly opts: SquatOptions = DEFAULT_SQUAT_OPTIONS) {}

  calibrate(s: ControllerMotionState): void {
    this.baselinePitch = s.orientation.pitch;
    this.velocity = 0;
    this.displacement = 0;
  }

  reset(): void {
    this.state = 'STANDING';
    this.reps = 0;
    this.depth = 0;
    this.velocity = 0;
    this.displacement = 0;
    this.stillFor = 0;
    this.candidateSince = null;
    this.minDisplacement = 0;
    this.lastRepAt = -Infinity;
    this.lastT = null;
    this.az.reset();
  }

  private transition(to: SquatState, at: number): DetectorEvent {
    const from = this.state;
    this.state = to;
    this.stateSince = at;
    this.candidateSince = null;
    return { type: 'state', from, to, at };
  }

  update(s: ControllerMotionState): DetectorEvent | null {
    const t = s.hostTime;
    let dt = this.lastT === null ? 0.01 : (t - this.lastT) / 1000;
    if (!(dt > 0) || dt > 0.25) dt = 0.01;
    this.lastT = t;
    if (this.stateSince === 0) this.stateSince = t;

    // --- signal conditioning ---
    const a = this.az.update(worldVertical(s), dt); // g, + up
    const quiet = Math.abs(a) < 0.035 && s.angularSpeed < 25;
    this.stillFor = quiet ? this.stillFor + dt : 0;
    // leaky integration: slow leak while moving, fast leak once the body is quiet
    const vTau = this.stillFor > 0.25 ? 0.15 : 1.2;
    const dTau = this.stillFor > 0.6 ? 0.5 : 3;
    this.velocity = this.velocity * Math.exp(-dt / vTau) + a * G * dt;
    this.displacement = this.displacement * Math.exp(-dt / dTau) + this.velocity * dt;
    this.displacement = clamp(this.displacement, -1, 1);
    if (s.isStationary && this.stillFor > 0.8) {
      this.velocity = 0;
      if (this.state === 'STANDING') this.displacement = 0;
    }

    const v = this.velocity;
    const d = this.displacement;
    const { velocityThreshold: vThr, minDepth, fullDepth, minRepMs, maxRepMs, refractoryMs } = this.opts;
    const inState = t - this.stateSince;
    if (this.state !== 'STANDING') this.minDisplacement = Math.min(this.minDisplacement, d);
    const range = Math.max(0, -this.minDisplacement);
    this.depth = this.state === 'STANDING' ? clamp(-d / fullDepth, 0, 1) : clamp(Math.max(-d, 0) / fullDepth, 0, 1);

    switch (this.state) {
      case 'STANDING': {
        if (t - this.lastRepAt < refractoryMs) return null;
        if (v < -vThr) {
          if (this.candidateSince === null) this.candidateSince = t;
          else if (t - this.candidateSince >= 120) {
            this.repStart = this.candidateSince;
            this.minDisplacement = d;
            return this.transition('DESCENDING', t);
          }
        } else this.candidateSince = null;
        return null;
      }
      case 'DESCENDING': {
        if (inState > 3000) return this.abort('descent too slow', t);
        if (v > vThr && range < minDepth) return this.abort('bounced before depth', t);
        if (v > -0.05 && inState > 150) {
          if (range >= minDepth) return this.transition('BOTTOM', t);
          if (v > 0.05) return this.abort('too shallow', t);
        }
        return null;
      }
      case 'BOTTOM': {
        if (inState > maxRepMs) return this.abort('held too long', t);
        if (v > vThr) {
          if (this.candidateSince === null) this.candidateSince = t;
          else if (t - this.candidateSince >= 80) return this.transition('ASCENDING', t);
        } else this.candidateSince = null;
        if (v < -vThr && inState > 400) return this.abort('went down again', t);
        return null;
      }
      case 'ASCENDING': {
        if (inState > 3000) return this.abort('ascent too slow', t);
        const recovered = d > this.minDisplacement * 0.45;
        if (v < 0.05 && inState > 150 && recovered) {
          const ev = this.transition('STANDING', t);
          const durationMs = t - this.repStart;
          if (durationMs >= minRepMs && durationMs <= maxRepMs && range >= minDepth) {
            this.reps++;
            this.lastRepAt = t;
            const depth = clamp(range / fullDepth, 0, 1);
            const tempo = clamp(1 - Math.abs(durationMs - 2200) / 4000, 0.3, 1);
            const rep: RepRecord = { index: this.reps, startedAt: this.repStart, endedAt: t, durationMs, depth, quality: clamp(0.5 * depth + 0.5 * tempo, 0, 1) };
            this.minDisplacement = 0;
            return { type: 'rep', rep };
          }
          this.minDisplacement = 0;
          void ev;
          return { type: 'rejected', reason: durationMs < minRepMs ? 'too fast' : 'incomplete', at: t };
        }
        if (v < -vThr && inState > 300) return this.abort('reversed mid-ascent', t);
        return null;
      }
    }
    return null;
  }

  private abort(reason: string, t: number): DetectorEvent {
    this.state = 'STANDING';
    this.stateSince = t;
    this.candidateSince = null;
    this.minDisplacement = 0;
    return { type: 'rejected', reason, at: t };
  }

  get baseline(): number | null {
    return this.baselinePitch;
  }
}
