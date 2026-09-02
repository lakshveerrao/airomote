import { CalibrationState, StatusFlag, encodeMotionPacket, type MotionPacket, type Vec3 } from '@aero/protocol';
import { decodePacket } from '@aero/protocol';
import { DEG } from './filters';
import type { ControllerId } from './types';

/**
 * Synthetic packet generation shared by tests and the developer-mode simulator.
 * Produces physically plausible accelerometer + gyro streams for a given orientation path.
 */
export interface SynthOptions {
  controllerId: ControllerId;
  rateHz?: number;
  noiseAccelG?: number;
  noiseGyroDps?: number;
  battery?: number | null;
  startTimestamp?: number;
  startSequence?: number;
  calibrated?: boolean;
}

export interface SynthFrame {
  /** Orientation in degrees at this instant. */
  pitch: number;
  roll: number;
  yawRate?: number; // deg/s
  /** Extra linear acceleration in body frame (g), on top of gravity. */
  linear?: Vec3;
}

export class PacketSynth {
  private timestamp: number;
  private sequence: number;
  private prev: SynthFrame | null = null;
  private rng = mulberry32(1234);
  readonly rateHz: number;

  constructor(private readonly opts: SynthOptions) {
    this.rateHz = opts.rateHz ?? 100;
    this.timestamp = opts.startTimestamp ?? 1000;
    this.sequence = opts.startSequence ?? 0;
  }

  /** Produce the next decoded MotionPacket for the given orientation frame. */
  next(frame: SynthFrame, hostTime?: number): MotionPacket {
    const dt = 1 / this.rateHz;
    const prev = this.prev ?? frame;
    const pitchRate = (frame.pitch - prev.pitch) / dt;
    const rollRate = (frame.roll - prev.roll) / dt;
    const yawRate = frame.yawRate ?? 0;
    this.prev = frame;

    const p = frame.pitch * DEG;
    const r = frame.roll * DEG;
    const gravity: Vec3 = { x: Math.sin(p), y: Math.cos(p) * Math.sin(r), z: Math.cos(p) * Math.cos(r) };
    const lin = frame.linear ?? { x: 0, y: 0, z: 0 };
    const na = this.opts.noiseAccelG ?? 0.01;
    const ng = this.opts.noiseGyroDps ?? 0.8;
    const accel = {
      x: gravity.x + lin.x + this.noise(na),
      y: gravity.y + lin.y + this.noise(na),
      z: gravity.z + lin.z + this.noise(na),
    };
    // body convention: pitchRate = -gyro.y, rollRate = gyro.x, yawRate = gyro.z
    const gyro = { x: rollRate + this.noise(ng), y: -pitchRate + this.noise(ng), z: yawRate + this.noise(ng) };

    const calibrated = this.opts.calibrated ?? true;
    const bytes = encodeMotionPacket({
      deviceId: this.opts.controllerId,
      sequence: this.sequence,
      timestamp: this.timestamp,
      status: StatusFlag.SENSOR_OK | (calibrated ? StatusFlag.CALIBRATED : 0),
      calibrationState: calibrated ? CalibrationState.READY : CalibrationState.SAMPLING,
      accel,
      gyro,
      pitch: frame.pitch,
      roll: frame.roll,
      battery: this.opts.battery ?? 80,
    });
    this.sequence = (this.sequence + 1) & 0xffff;
    this.timestamp += Math.round(dt * 1000);
    const decoded = decodePacket(bytes, hostTime ?? this.timestamp);
    if (!decoded.ok || decoded.packet.type !== 1) throw new Error('synth produced invalid packet');
    return decoded.packet;
  }

  /** Same as next() but returns the encoded bytes (for transport-level tests / simulator). */
  nextBytes(frame: SynthFrame): Uint8Array {
    const pkt = this.next(frame);
    return encodeMotionPacket({
      deviceId: pkt.deviceId,
      sequence: pkt.sequence,
      timestamp: pkt.timestamp,
      status: pkt.status,
      calibrationState: pkt.calibrationState,
      accel: pkt.accel,
      gyro: pkt.gyro,
      pitch: pkt.pitch,
      roll: pkt.roll,
      battery: pkt.battery,
    });
  }

  private noise(scale: number): number {
    // approx gaussian
    return (this.rng() + this.rng() + this.rng() - 1.5) * scale;
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Helper: N frames holding one pose still. */
export function stillFrames(n: number, pitch = 0, roll = 0): SynthFrame[] {
  return Array.from({ length: n }, () => ({ pitch, roll }));
}

/** Helper: smooth half-cosine transition between two poses over n frames. */
export function sweepFrames(n: number, from: SynthFrame, to: SynthFrame): SynthFrame[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (1 - Math.cos((Math.PI * (i + 1)) / n)) / 2;
    return {
      pitch: from.pitch + (to.pitch - from.pitch) * t,
      roll: from.roll + (to.roll - from.roll) * t,
      yawRate: (from.yawRate ?? 0) + ((to.yawRate ?? 0) - (from.yawRate ?? 0)) * t,
    };
  });
}

/** A drumstick strike: quick nose-down whip, hard stop, return. */
export function strikeFrames(peakDps = 500, rateHz = 100): SynthFrame[] {
  const frames: SynthFrame[] = [];
  const downFrames = Math.max(3, Math.round(rateHz * 0.08));
  let pitch = 10;
  for (let i = 0; i < downFrames; i++) {
    pitch -= peakDps / rateHz;
    frames.push({ pitch, roll: 0 });
  }
  // impact: abrupt stop with a deceleration spike
  frames.push({ pitch, roll: 0, linear: { x: 0, y: 0, z: 1.6 } });
  frames.push({ pitch, roll: 0, linear: { x: 0, y: 0, z: -0.3 } });
  // return slower
  const upFrames = Math.round(rateHz * 0.2);
  for (let i = 0; i < upFrames; i++) {
    pitch += (10 - pitch) * 0.25;
    frames.push({ pitch, roll: 0 });
  }
  return frames;
}
