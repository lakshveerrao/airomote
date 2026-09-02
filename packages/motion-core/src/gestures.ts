import { clamp } from './filters';
import type { ControllerMotionState, Direction, GestureEvent, MotionConfig } from './types';

type Emit = (e: GestureEvent) => void;

const mk = (
  s: ControllerMotionState,
  gesture: GestureEvent['gesture'],
  phase: GestureEvent['phase'],
  direction: Direction | null,
  intensity: number,
  peak: number,
  confidence = s.confidence,
): GestureEvent => ({
  controllerId: s.controllerId,
  gesture,
  phase,
  direction,
  intensity: clamp(intensity, 0, 1),
  confidence: clamp(confidence, 0, 1),
  timestamp: s.hostTime,
  peak,
});

/** Signed rotation rates in the body convention (deg/s). */
export const rates = (s: ControllerMotionState) => ({
  pitchRate: -s.gyro.y, // + nose up
  rollRate: s.gyro.x, // + right side down
  yawRate: s.gyro.z, // + turning left
});

export type StrikeState = 'READY' | 'DOWNSTROKE' | 'IMPACT' | 'RECOVERY';

/**
 * Drumstick-style strike: fast nose-down rotation (or downward linear acceleration) followed
 * by a sharp stop. READY → DOWNSTROKE → IMPACT → RECOVERY → READY. Intensity comes from the
 * peak downward angular rate boosted by the deceleration spike. Fast alternating hits are
 * allowed because RECOVERY only requires the stick to slow down, not to return to rest.
 */
export class StrikeDetector {
  state: StrikeState = 'READY';
  private peak = 0;
  private peakJerk = 0;
  private stateSince = 0;
  private startedAt = 0;

  constructor(private readonly cfg: () => MotionConfig) {}

  update(s: ControllerMotionState, emit: Emit): void {
    const c = this.cfg();
    const down = -rates(s).pitchRate + Math.max(0, -s.linearAccel.z) * 250; // combine rotation + linear drop
    const t = s.hostTime;
    switch (this.state) {
      case 'READY':
        if (down > c.strikeStartDps) {
          this.state = 'DOWNSTROKE';
          this.stateSince = t;
          this.startedAt = t;
          this.peak = down;
          this.peakJerk = 0;
          emit(mk(s, 'strike', 'start', 'down', 0, down));
        }
        break;
      case 'DOWNSTROKE': {
        if (down > this.peak) this.peak = down;
        this.peakJerk = Math.max(this.peakJerk, Math.abs(s.jerk));
        const stopped = down < this.peak * 0.45 || down < c.strikeStartDps * 0.5;
        const tooLong = t - this.stateSince > 350;
        if (stopped || Math.abs(s.jerk) > 60) {
          if (this.peak >= c.strikeMinPeakDps) {
            this.state = 'IMPACT';
            const intensity = clamp(
              (this.peak - c.strikeMinPeakDps) / (c.strikeMaxDps - c.strikeMinPeakDps) + this.peakJerk / 600,
              0.08,
              1,
            );
            emit(mk(s, 'strike', 'peak', 'down', intensity, this.peak));
          } else {
            this.state = 'RECOVERY'; // too weak — treat as a wobble
          }
          this.stateSince = t;
        } else if (tooLong) {
          this.state = 'RECOVERY';
          this.stateSince = t;
        }
        break;
      }
      case 'IMPACT':
        // IMPACT lasts one sample; we go straight to RECOVERY so the UI can flash.
        this.state = 'RECOVERY';
        this.stateSince = t;
        break;
      case 'RECOVERY':
        if (t - this.stateSince >= c.strikeRecoveryMs && down < c.strikeStartDps * 0.6) {
          this.state = 'READY';
          emit(mk(s, 'strike', 'end', 'down', 0, this.peak));
        } else if (t - this.stateSince > 400) {
          this.state = 'READY';
        }
        break;
    }
    void this.startedAt;
  }

  reset(): void {
    this.state = 'READY';
    this.peak = 0;
  }
}

/**
 * Directional swing: a rotation about one body axis that exceeds `swingStartDps`, reported on
 * its peak (when it begins to slow down) with the dominant direction. Strums, punches and
 * "swing to select" all consume this.
 */
export class SwingDetector {
  private active: Direction | null = null;
  private peak = 0;
  private since = 0;
  private cooldownUntil = 0;

  constructor(private readonly cfg: () => MotionConfig) {}

  private signals(s: ControllerMotionState): Array<[Direction, number]> {
    const r = rates(s);
    return [
      ['down', -r.pitchRate + Math.max(0, -s.linearAccel.z) * 200],
      ['up', r.pitchRate + Math.max(0, s.linearAccel.z) * 200],
      ['left', r.yawRate + Math.max(0, s.linearAccel.y) * 200],
      ['right', -r.yawRate + Math.max(0, -s.linearAccel.y) * 200],
      ['forward', Math.max(0, s.linearAccel.x) * 300],
      ['back', Math.max(0, -s.linearAccel.x) * 300],
    ];
  }

  update(s: ControllerMotionState, emit: Emit): void {
    const c = this.cfg();
    const t = s.hostTime;
    const sig = this.signals(s);
    let bestDir: Direction = 'down';
    let best = -Infinity;
    for (const [d, v] of sig) {
      if (v > best) {
        best = v;
        bestDir = d;
      }
    }
    if (this.active === null) {
      if (t >= this.cooldownUntil && best > c.swingStartDps) {
        this.active = bestDir;
        this.peak = best;
        this.since = t;
        emit(mk(s, 'swing', 'start', bestDir, 0, best));
      }
      return;
    }
    const cur = sig.find(([d]) => d === this.active)![1];
    if (cur > this.peak) this.peak = cur;
    const decayed = cur < this.peak * 0.5 || cur < c.swingStartDps * 0.5;
    if (decayed || t - this.since > 400) {
      const intensity = clamp((this.peak - c.swingStartDps) / (c.swingMaxDps - c.swingStartDps), 0.05, 1);
      emit(mk(s, 'swing', 'peak', this.active, intensity, this.peak));
      emit(mk(s, 'swing', 'end', this.active, intensity, this.peak));
      this.active = null;
      this.cooldownUntil = t + c.swingRecoveryMs;
    }
  }

  reset(): void {
    this.active = null;
  }
}

/** Shake: repeated sign reversals of a strong linear acceleration within a short window. */
export class ShakeDetector {
  private reversals: number[] = [];
  private lastSign = 0;
  private shaking = false;
  private lastReversal = 0;

  constructor(private readonly cfg: () => MotionConfig) {}

  update(s: ControllerMotionState, emit: Emit): void {
    const c = this.cfg();
    const t = s.hostTime;
    const a = s.linearAccel;
    // dominant axis component
    const comp = Math.abs(a.x) > Math.abs(a.y) ? (Math.abs(a.x) > Math.abs(a.z) ? a.x : a.z) : Math.abs(a.y) > Math.abs(a.z) ? a.y : a.z;
    if (Math.abs(comp) > c.shakeG) {
      const sign = Math.sign(comp);
      if (sign !== this.lastSign && this.lastSign !== 0) {
        this.reversals.push(t);
        this.lastReversal = t;
      }
      this.lastSign = sign;
    }
    this.reversals = this.reversals.filter((r) => t - r <= c.shakeWindowMs);
    const intensity = clamp(s.motionMagnitude / (c.shakeG * 3), 0, 1);
    if (!this.shaking && this.reversals.length >= c.shakeReversals) {
      this.shaking = true;
      emit(mk(s, 'shake', 'start', null, intensity, s.motionMagnitude));
      emit(mk(s, 'shake', 'peak', null, intensity, s.motionMagnitude));
    } else if (this.shaking && (this.reversals.length === 0 || t - this.lastReversal > 400)) {
      this.shaking = false;
      this.reversals = [];
      this.lastSign = 0;
      emit(mk(s, 'shake', 'end', null, 0, 0));
    }
  }

  reset(): void {
    this.reversals = [];
    this.shaking = false;
    this.lastSign = 0;
  }
}

/**
 * Tilt zones with hysteresis on the *relative* orientation. Emits start/end for
 * left/right (roll) and forward/back (pitch) — 'forward' = nose down.
 */
export class TiltDetector {
  private activeRoll: Direction | null = null;
  private activePitch: Direction | null = null;

  constructor(private readonly cfg: () => MotionConfig) {}

  update(s: ControllerMotionState, emit: Emit): void {
    const c = this.cfg();
    const roll = s.relative.roll;
    const pitch = s.relative.pitch;
    this.activeRoll = this.axis(s, emit, roll, this.activeRoll, 'right', 'left', c);
    this.activePitch = this.axis(s, emit, -pitch, this.activePitch, 'forward', 'back', c);
  }

  private axis(
    s: ControllerMotionState,
    emit: Emit,
    value: number,
    active: Direction | null,
    pos: Direction,
    neg: Direction,
    c: MotionConfig,
  ): Direction | null {
    const mag = Math.abs(value);
    const dir: Direction = value >= 0 ? pos : neg;
    const intensity = clamp((mag - c.tiltExitDeg) / (c.tiltMaxDeg - c.tiltExitDeg), 0, 1);
    if (active === null) {
      if (mag >= c.tiltEnterDeg) {
        emit(mk(s, 'tilt', 'start', dir, intensity, value));
        return dir;
      }
      return null;
    }
    if (mag < c.tiltExitDeg || dir !== active) {
      emit(mk(s, 'tilt', 'end', active, 0, value));
      if (dir !== active && mag >= c.tiltEnterDeg) {
        emit(mk(s, 'tilt', 'start', dir, intensity, value));
        return dir;
      }
      return null;
    }
    emit(mk(s, 'tilt', 'peak', active, intensity, value));
    return active;
  }

  reset(): void {
    this.activeRoll = null;
    this.activePitch = null;
  }
}

/** Rotation about the vertical axis (relative yaw) beyond a threshold, with hysteresis. */
export class RotateDetector {
  private active: Direction | null = null;
  constructor(private readonly cfg: () => MotionConfig) {}

  update(s: ControllerMotionState, emit: Emit): void {
    const c = this.cfg();
    const yaw = s.relative.yaw; // + left
    const mag = Math.abs(yaw);
    const dir: Direction = yaw >= 0 ? 'left' : 'right';
    const intensity = clamp((mag - c.rotateExitDeg) / (c.rotateMaxDeg - c.rotateExitDeg), 0, 1);
    if (this.active === null) {
      if (mag >= c.rotateEnterDeg) {
        this.active = dir;
        emit(mk(s, 'rotate', 'start', dir, intensity, yaw));
      }
      return;
    }
    if (mag < c.rotateExitDeg || dir !== this.active) {
      emit(mk(s, 'rotate', 'end', this.active, 0, yaw));
      this.active = null;
      if (dir !== this.active && mag >= c.rotateEnterDeg) {
        this.active = dir;
        emit(mk(s, 'rotate', 'start', dir, intensity, yaw));
      }
      return;
    }
    emit(mk(s, 'rotate', 'peak', this.active, intensity, yaw));
  }

  reset(): void {
    this.active = null;
  }
}
