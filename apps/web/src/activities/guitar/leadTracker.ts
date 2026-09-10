/**
 * Natural fret-hand tracking.
 *
 * The fret controller gives two continuous −1..1 axes (FRET_POSITION from pitch,
 * STRING_SELECT from roll). Turning those into a *stable* string + fret needs three things:
 *
 *  1. **Wrap-safe angles.** The real boards are mounted upside down, so a relative angle can
 *     sit near ±180 and wrap. Every angle comparison here goes through `deltaDeg()`, never a
 *     raw subtraction. (The app's `relative` roll/yaw are already wrapped, but the tracker
 *     adds its own centre offset, which can push a value back across the seam.)
 *  2. **Time-based smoothing.** The exponential filter uses the elapsed wall-clock time, not
 *     the packet index, so a controller sending 110 packets/s and one sending 30/s settle to
 *     the same value in the same wall-clock time. `update()` is driven from the render loop;
 *     the action events only move the target.
 *  3. **Hysteresis.** The integer fret/string only changes once the smoothed value has moved
 *     more than half a step *plus* a margin, so the note does not flicker between neighbours.
 *
 * A strum also freezes the tracker for a moment (`freezeMs`): a real down-stroke moves the
 * whole body, and without the freeze the fret hand lurches on every stroke.
 */

/** Wrap-safe signed difference a − b in degrees, always in (−180, 180]. */
export function deltaDeg(a: number, b: number): number {
  // (((x % 360) + 360) % 360) keeps the modulo positive for negative inputs, so this is the
  // usual ((a - b + 540) % 360) - 180 with JavaScript's signed % taken out of the picture.
  const x = a - b + 540;
  return (((x % 360) + 360) % 360) - 180;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export interface LeadTrackerOptions {
  /** Highest fret reachable (0 = open string … maxFret). */
  maxFret: number;
  /** Number of strings. */
  strings: number;
  /** Smoothing time constant in ms (63% of the way to the target). */
  tauMs: number;
  /** Extra travel, in steps, needed to leave the current fret/string. */
  hysteresis: number;
  /** How long the tracker is damped after a strum. */
  freezeMs: number;
  /** How much of the normal response survives the freeze (0 = fully frozen). */
  freezeDamp?: number;
}

export const DEFAULT_LEAD_OPTIONS: LeadTrackerOptions = {
  maxFret: 12,
  strings: 6,
  tauMs: 90,
  hysteresis: 0.32,
  freezeMs: 250,
  freezeDamp: 0.03,
};

export class LeadTracker {
  private readonly o: LeadTrackerOptions;
  private fretTarget: number;
  private stringTarget: number;
  /** Smoothed continuous position along the neck, in frets. */
  fretSmooth: number;
  /** Smoothed continuous string position, 0 = low E. */
  stringSmooth: number;
  /** Latched integer fret (what actually sounds). */
  fret: number;
  /** Latched integer string index (what actually sounds). */
  string: number;
  private last = Number.NaN;
  private freezeUntil = -Infinity;

  constructor(options: Partial<LeadTrackerOptions> = {}) {
    this.o = { ...DEFAULT_LEAD_OPTIONS, ...options };
    this.fretTarget = this.o.maxFret * 0.25;
    this.stringTarget = (this.o.strings - 1) / 2;
    this.fretSmooth = this.fretTarget;
    this.stringSmooth = this.stringTarget;
    this.fret = Math.round(this.fretSmooth);
    this.string = Math.round(this.stringSmooth);
  }

  get options(): LeadTrackerOptions {
    return this.o;
  }

  /** 0..1 position along the neck for the scene (0 = nut). */
  get fretPos(): number {
    return this.o.maxFret > 0 ? clamp(this.fretSmooth / this.o.maxFret, 0, 1) : 0;
  }

  /** Fractional string position for the scene. */
  get stringPos(): number {
    return this.stringSmooth;
  }

  /** Is the tracker currently damped by a recent strum? */
  frozen(now: number): boolean {
    return now < this.freezeUntil;
  }

  /** −1..1 axis from the fret hand's pitch → target fret. −1 = nut. */
  setFretAxis(v: number): void {
    this.fretTarget = ((clamp(v, -1, 1) + 1) / 2) * this.o.maxFret;
  }

  /** −1..1 axis from the fret hand's roll → target string. −1 = low E. */
  setStringAxis(v: number): void {
    this.stringTarget = ((clamp(v, -1, 1) + 1) / 2) * (this.o.strings - 1);
  }

  /**
   * Angle-based entry points: pass the *relative* angle and the centre it should read as
   * neutral. Wrap-safe, so an upside-down board sitting near ±180 behaves like one near 0.
   */
  setFretAngle(relPitchDeg: number, spanDeg: number, centreDeg = 0): void {
    this.setFretAxis(deltaDeg(relPitchDeg, centreDeg) / Math.max(1e-6, spanDeg));
  }

  setStringAngle(relRollDeg: number, spanDeg: number, centreDeg = 0): void {
    this.setStringAxis(deltaDeg(relRollDeg, centreDeg) / Math.max(1e-6, spanDeg));
  }

  /** Keyboard fallback: move the target by whole steps. */
  nudgeFret(steps: number): void {
    this.fretTarget = clamp(Math.round(this.fretTarget) + steps, 0, this.o.maxFret);
  }

  nudgeString(steps: number): void {
    this.stringTarget = clamp(Math.round(this.stringTarget) + steps, 0, this.o.strings - 1);
  }

  /** Called on every strum: damp the tracker so the stroke cannot lurch the fret hand. */
  strummed(now: number): void {
    this.freezeUntil = now + this.o.freezeMs;
  }

  /**
   * Advance the smoothing to wall-clock time `now` (ms) and re-latch the integer note.
   * Safe to call at any rate; only elapsed time matters.
   */
  update(now: number): void {
    const dt = Number.isNaN(this.last) ? 0 : clamp(now - this.last, 0, 250);
    this.last = now;
    let alpha = dt > 0 ? 1 - Math.exp(-dt / Math.max(1, this.o.tauMs)) : 0;
    if (now < this.freezeUntil) alpha *= this.o.freezeDamp ?? 0;
    this.fretSmooth += (clamp(this.fretTarget, 0, this.o.maxFret) - this.fretSmooth) * alpha;
    this.stringSmooth += (clamp(this.stringTarget, 0, this.o.strings - 1) - this.stringSmooth) * alpha;
    if (now < this.freezeUntil) return; // hold the sounding note through the stroke
    this.fret = latch(this.fret, this.fretSmooth, this.o.hysteresis, 0, this.o.maxFret);
    this.string = latch(this.string, this.stringSmooth, this.o.hysteresis, 0, this.o.strings - 1);
  }

  /** Jump straight to the current targets (mode switch, activity restart). */
  settle(now: number): void {
    this.fretSmooth = clamp(this.fretTarget, 0, this.o.maxFret);
    this.stringSmooth = clamp(this.stringTarget, 0, this.o.strings - 1);
    this.fret = Math.round(this.fretSmooth);
    this.string = Math.round(this.stringSmooth);
    this.freezeUntil = -Infinity;
    this.last = now;
  }
}

/** Move `current` to round(value) only once value leaves the [±(0.5 + h)] band around it. */
export function latch(current: number, value: number, hysteresis: number, lo: number, hi: number): number {
  const c = clamp(current, lo, hi);
  if (Math.abs(value - c) <= 0.5 + hysteresis) return c;
  return clamp(Math.round(value), lo, hi);
}
