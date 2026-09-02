import type { Vec3 } from '@aero/protocol';

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vlen = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** First-order low-pass with a time-constant expressed as cutoff frequency (Hz); dt-aware. */
export class LowPass {
  private y: number | null = null;
  constructor(public cutoffHz: number) {}

  update(x: number, dtSeconds: number): number {
    if (this.y === null || !Number.isFinite(this.y)) {
      this.y = x;
      return x;
    }
    const rc = 1 / (2 * Math.PI * this.cutoffHz);
    const alpha = clamp(dtSeconds / (rc + dtSeconds), 0, 1);
    this.y += alpha * (x - this.y);
    return this.y;
  }

  get value(): number {
    return this.y ?? 0;
  }

  reset(v: number | null = null): void {
    this.y = v;
  }
}

export class Vec3LowPass {
  private readonly fx: LowPass;
  private readonly fy: LowPass;
  private readonly fz: LowPass;
  constructor(cutoffHz: number) {
    this.fx = new LowPass(cutoffHz);
    this.fy = new LowPass(cutoffHz);
    this.fz = new LowPass(cutoffHz);
  }
  update(v: Vec3, dt: number): Vec3 {
    return { x: this.fx.update(v.x, dt), y: this.fy.update(v.y, dt), z: this.fz.update(v.z, dt) };
  }
  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

/** Dead zone with re-scaling so output is continuous: |x| <= dz → 0, then ramps 0..1. */
export function applyDeadzone(x: number, deadzone: number, max = 1): number {
  const ax = Math.abs(x);
  if (ax <= deadzone) return 0;
  const scaled = (ax - deadzone) / Math.max(1e-6, max - deadzone);
  return Math.sign(x) * clamp(scaled, 0, 1);
}

/** Boolean output with separate enter/exit thresholds. */
export class Hysteresis {
  state = false;
  constructor(
    public enter: number,
    public exit: number,
  ) {}
  update(x: number): boolean {
    if (!this.state && x >= this.enter) this.state = true;
    else if (this.state && x < this.exit) this.state = false;
    return this.state;
  }
  reset(): void {
    this.state = false;
  }
}

/** Passes an event only if `minIntervalMs` has elapsed since the last accepted event. */
export class Debounce {
  private last = -Infinity;
  constructor(public minIntervalMs: number) {}
  accept(nowMs: number): boolean {
    if (nowMs - this.last < this.minIntervalMs) return false;
    this.last = nowMs;
    return true;
  }
  reset(): void {
    this.last = -Infinity;
  }
}

/** Fixed-window running mean/variance (Welford over a ring buffer). */
export class RunningStats {
  private readonly buf: Float64Array;
  private idx = 0;
  private count = 0;
  private sum = 0;
  private sumSq = 0;
  constructor(public readonly size: number) {
    this.buf = new Float64Array(size);
  }
  push(x: number): void {
    if (this.count === this.size) {
      const old = this.buf[this.idx];
      this.sum -= old;
      this.sumSq -= old * old;
    } else {
      this.count++;
    }
    this.buf[this.idx] = x;
    this.sum += x;
    this.sumSq += x * x;
    this.idx = (this.idx + 1) % this.size;
  }
  get full(): boolean {
    return this.count === this.size;
  }
  get mean(): number {
    return this.count ? this.sum / this.count : 0;
  }
  get variance(): number {
    if (!this.count) return 0;
    const m = this.mean;
    return Math.max(0, this.sumSq / this.count - m * m);
  }
  get stddev(): number {
    return Math.sqrt(this.variance);
  }
  reset(): void {
    this.idx = 0;
    this.count = 0;
    this.sum = 0;
    this.sumSq = 0;
  }
}

/**
 * Host-side gyro bias tracker. The firmware already removes the boot-time bias; this
 * catches slow thermal drift by averaging gyro while the controller is provably still.
 * Never adapts during motion.
 */
export class GyroBiasTracker {
  bias: Vec3 = vec3();
  private acc: Vec3 = vec3();
  private n = 0;
  constructor(
    private readonly minSamples = 100,
    private readonly maxAbsBiasDps = 8,
    private readonly blend = 0.2,
  ) {}
  update(gyroRaw: Vec3, stationary: boolean): void {
    if (!stationary) {
      this.acc = vec3();
      this.n = 0;
      return;
    }
    this.acc.x += gyroRaw.x;
    this.acc.y += gyroRaw.y;
    this.acc.z += gyroRaw.z;
    this.n++;
    if (this.n >= this.minSamples) {
      const est = vscale(this.acc, 1 / this.n);
      if (vlen(est) < this.maxAbsBiasDps) {
        this.bias = {
          x: lerp(this.bias.x, est.x, this.blend),
          y: lerp(this.bias.y, est.y, this.blend),
          z: lerp(this.bias.z, est.z, this.blend),
        };
      }
      this.acc = vec3();
      this.n = 0;
    }
  }
  reset(): void {
    this.bias = vec3();
    this.acc = vec3();
    this.n = 0;
  }
}
