import { CalibrationState, type Vec3 } from '@aero/protocol';
import type { ControllerId, FactoryTestName } from './types';

/**
 * A physically-motivated model of one controller. The developer-mode simulator UI (and the
 * keyboard) set *targets*; the model produces realistic sensor readings: gravity from the
 * orientation, angular rates from orientation change, transient linear acceleration for
 * strikes/shakes, gyro bias, sensor noise, and a boot-time calibration sequence.
 */
export interface SimSample {
  accel: Vec3;
  gyro: Vec3;
  pitch: number;
  roll: number;
  stationary: boolean;
  calibrationState: CalibrationState;
  calibrationJustFinished: boolean;
  battery: number | null;
  gyroBias: Vec3;
}

type Impulse = { axis: 'x' | 'y' | 'z'; amplitude: number; t: number; duration: number; sign: number };

export class SimulatedController {
  // targets (degrees) set by the UI / keyboard
  targetPitch = 0;
  targetRoll = 0;
  targetYawRate = 0;
  /** responsiveness of the hand following the target (1/s) */
  stiffness = 18;
  noiseAccel = 0.012;
  noiseGyro = 0.9;
  battery: number | null = 84;
  gyroBias: Vec3 = { x: 0.8, y: -1.2, z: 0.4 };
  /** When true, the model wobbles slightly like a real hand. */
  handTremor = true;
  failFactoryTest: FactoryTestName | null = null;
  calibrationState = CalibrationState.NONE;

  private pitch = 0;
  private roll = 0;
  private pitchVel = 0;
  private rollVel = 0;
  private yawRate = 0;
  private impulses: Impulse[] = [];
  private scripted: Array<{ t: number; pitch: number; roll: number }> | null = null;
  private scriptTime = 0;
  private calibT = 0;
  private time = 0;
  private identifyUntil = 0;
  private lastCalibDone = false;

  constructor(public readonly controllerId: ControllerId) {}

  beginCalibration(): void {
    this.calibrationState = CalibrationState.WAITING_STILL;
    this.calibT = 0;
  }

  identify(): void {
    this.identifyUntil = this.time + 1.5;
  }

  get identifying(): boolean {
    return this.time < this.identifyUntil;
  }

  /** Instantly set pose (used by sliders). */
  setPose(pitch: number, roll: number): void {
    this.targetPitch = pitch;
    this.targetRoll = roll;
  }

  /** Perform a drumstick strike: quick nose-down whip + stop impulse. */
  strike(strength = 0.8): void {
    const drop = 30 + 40 * strength;
    const now = this.time;
    this.scripted = [
      { t: now, pitch: this.pitch, roll: this.roll },
      { t: now + 0.06 + 0.04 * (1 - strength), pitch: this.pitch - drop, roll: this.roll },
      { t: now + 0.08 + 0.04 * (1 - strength), pitch: this.pitch - drop, roll: this.roll },
      { t: now + 0.28, pitch: this.pitch, roll: this.roll },
    ];
    this.impulses.push({ axis: 'z', amplitude: 1.2 + 1.5 * strength, t: now + 0.06 + 0.04 * (1 - strength), duration: 0.03, sign: 1 });
  }

  /** Swing in a direction (strum up/down, punch forward…). */
  swing(direction: 'up' | 'down' | 'left' | 'right' | 'forward' | 'back', strength = 0.7): void {
    const now = this.time;
    const amt = 35 + 45 * strength;
    const dur = 0.09 + 0.06 * (1 - strength);
    if (direction === 'down' || direction === 'up') {
      const s = direction === 'down' ? -1 : 1;
      this.scripted = [
        { t: now, pitch: this.pitch, roll: this.roll },
        { t: now + dur, pitch: this.pitch + s * amt, roll: this.roll },
        { t: now + dur + 0.25, pitch: this.pitch, roll: this.roll },
      ];
      this.impulses.push({ axis: 'z', amplitude: 0.5 + strength, t: now, duration: dur, sign: s });
    } else if (direction === 'left' || direction === 'right') {
      const s = direction === 'left' ? 1 : -1;
      this.yawImpulse(s * (250 + 400 * strength), dur);
      this.impulses.push({ axis: 'y', amplitude: 0.5 + strength, t: now, duration: dur, sign: s });
    } else {
      const s = direction === 'forward' ? 1 : -1;
      this.impulses.push({ axis: 'x', amplitude: 0.9 + 1.4 * strength, t: now, duration: dur, sign: s });
      this.impulses.push({ axis: 'x', amplitude: 0.6 + strength, t: now + dur, duration: dur, sign: -s });
    }
  }

  shake(strength = 0.8, cycles = 5): void {
    const now = this.time;
    for (let i = 0; i < cycles * 2; i++) {
      this.impulses.push({ axis: 'x', amplitude: 0.8 + 1.2 * strength, t: now + i * 0.07, duration: 0.06, sign: i % 2 ? -1 : 1 });
    }
  }

  private yawTransient = 0;
  private yawTransientUntil = 0;
  private yawImpulse(rate: number, dur: number): void {
    this.yawTransient = rate;
    this.yawTransientUntil = this.time + dur;
  }

  /** Advance the model by dt seconds and produce a sample. */
  step(dt: number): SimSample {
    this.time += dt;
    // --- scripted motion (strikes/swings) overrides targets while active ---
    let tp = this.targetPitch;
    let tr = this.targetRoll;
    let k = this.stiffness;
    if (this.scripted) {
      const s = this.scripted;
      const t = this.time;
      if (t >= s[s.length - 1].t) {
        this.scripted = null;
      } else {
        for (let i = 0; i < s.length - 1; i++) {
          if (t >= s[i].t && t < s[i + 1].t) {
            const f = (t - s[i].t) / Math.max(1e-3, s[i + 1].t - s[i].t);
            tp = s[i].pitch + (s[i + 1].pitch - s[i].pitch) * f;
            tr = s[i].roll + (s[i + 1].roll - s[i].roll) * f;
            k = 60;
            break;
          }
        }
      }
    }
    void this.scriptTime;
    // critically-damped-ish second order follow
    const prevPitch = this.pitch;
    const prevRoll = this.roll;
    this.pitchVel += (k * (tp - this.pitch) - 2 * Math.sqrt(k) * this.pitchVel) * dt;
    this.rollVel += (k * (tr - this.roll) - 2 * Math.sqrt(k) * this.rollVel) * dt;
    this.pitch += this.pitchVel * dt;
    this.roll += this.rollVel * dt;
    if (this.handTremor) {
      this.pitch += Math.sin(this.time * 7.3) * 0.02;
      this.roll += Math.cos(this.time * 5.1) * 0.02;
    }
    const pitchRate = (this.pitch - prevPitch) / dt;
    const rollRate = (this.roll - prevRoll) / dt;
    this.yawRate = this.time < this.yawTransientUntil ? this.yawTransient : this.targetYawRate;

    // gravity in body frame
    const p = (this.pitch * Math.PI) / 180;
    const r = (this.roll * Math.PI) / 180;
    const gravity: Vec3 = { x: Math.sin(p), y: Math.cos(p) * Math.sin(r), z: Math.cos(p) * Math.cos(r) };
    // linear impulses
    const lin: Vec3 = { x: 0, y: 0, z: 0 };
    this.impulses = this.impulses.filter((imp) => this.time < imp.t + imp.duration);
    for (const imp of this.impulses) {
      if (this.time >= imp.t) {
        const f = (this.time - imp.t) / imp.duration;
        lin[imp.axis] += imp.sign * imp.amplitude * Math.sin(Math.PI * f);
      }
    }
    const n = (s: number) => (Math.random() + Math.random() + Math.random() - 1.5) * s;
    const accel = { x: gravity.x + lin.x + n(this.noiseAccel), y: gravity.y + lin.y + n(this.noiseAccel), z: gravity.z + lin.z + n(this.noiseAccel) };
    const rawGyro = { x: rollRate + this.gyroBias.x, y: -pitchRate + this.gyroBias.y, z: this.yawRate + this.gyroBias.z };

    // --- firmware-like calibration sequence ---
    const moving = Math.abs(pitchRate) > 4 || Math.abs(rollRate) > 4 || Math.abs(this.yawRate) > 4 || Math.hypot(lin.x, lin.y, lin.z) > 0.08;
    let justFinished = false;
    if (this.calibrationState === CalibrationState.WAITING_STILL) {
      if (moving) this.calibT = 0;
      else this.calibT += dt;
      if (this.calibT > 0.5) {
        this.calibrationState = CalibrationState.SAMPLING;
        this.calibT = 0;
      }
    } else if (this.calibrationState === CalibrationState.SAMPLING) {
      if (moving) {
        this.calibrationState = CalibrationState.WAITING_STILL;
        this.calibT = 0;
      } else {
        this.calibT += dt;
        if (this.calibT > 1.6) {
          this.calibrationState = CalibrationState.READY;
          justFinished = true;
          this.lastCalibDone = true;
        }
      }
    }
    // firmware removes bias once calibrated
    const gyro =
      this.calibrationState === CalibrationState.READY
        ? { x: rawGyro.x - this.gyroBias.x + n(this.noiseGyro), y: rawGyro.y - this.gyroBias.y + n(this.noiseGyro), z: rawGyro.z - this.gyroBias.z + n(this.noiseGyro) }
        : { x: rawGyro.x + n(this.noiseGyro), y: rawGyro.y + n(this.noiseGyro), z: rawGyro.z + n(this.noiseGyro) };

    if (this.battery !== null && Math.random() < dt / 600) this.battery = Math.max(0, this.battery - 1);
    void this.lastCalibDone;
    return {
      accel,
      gyro,
      pitch: this.pitch,
      roll: this.roll,
      stationary: !moving,
      calibrationState: this.calibrationState,
      calibrationJustFinished: justFinished,
      battery: this.battery,
      gyroBias: this.gyroBias,
    };
  }

  get pose(): { pitch: number; roll: number; yawRate: number } {
    return { pitch: this.pitch, roll: this.roll, yawRate: this.yawRate };
  }
}
