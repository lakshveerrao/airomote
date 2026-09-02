import type { Vec3 } from '@aero/protocol';
import type { Orientation } from './orientation';

/** Controller slot: 1 or 2. Activities refer to roles, not slots — see activity-engine. */
export type ControllerId = 1 | 2;

export type Direction = 'up' | 'down' | 'left' | 'right' | 'forward' | 'back';

export interface ControllerMotionState {
  controllerId: ControllerId;
  /** Device timestamp (ms) and host time (ms, performance.now domain). */
  timestamp: number;
  hostTime: number;
  dt: number;
  connected: boolean;
  calibrated: boolean;
  calibrating: boolean;
  battery: number | null;

  accelRaw: Vec3; // g
  accel: Vec3; // g, low-passed
  gyroRaw: Vec3; // deg/s
  gyro: Vec3; // deg/s, bias-corrected + low-passed
  /** Acceleration with the gravity estimate removed (body frame, g). */
  linearAccel: Vec3;
  /** Leaky-integrated linear acceleration (g·s) — a *relative* speed hint, not real velocity. */
  velocityHint: Vec3;

  orientation: Orientation; // absolute pitch/roll, relative yaw
  /** Orientation relative to the neutral pose captured at calibration / "set neutral". */
  relative: Orientation;

  angularSpeed: number; // deg/s
  motionMagnitude: number; // |linearAccel| in g
  jerk: number; // d|linearAccel|/dt (g/s), spike indicator
  isStationary: boolean;
  isSuddenMotion: boolean;
  movementDirection: Direction | null;
  /** 0..1 — how much the pipeline trusts this state (calibration, data rate, sensor saturation). */
  confidence: number;
  packetRateHz: number;
}

export type GestureType = 'strike' | 'swing' | 'shake' | 'tilt' | 'rotate';
export type GesturePhase = 'start' | 'peak' | 'end';

export interface GestureEvent {
  controllerId: ControllerId;
  gesture: GestureType;
  phase: GesturePhase;
  direction: Direction | null;
  /** 0..1 normalised strength (velocity for strikes/swings, angle for tilt). */
  intensity: number;
  /** 0..1 */
  confidence: number;
  timestamp: number; // host ms
  /** Peak signal value in native units (deg/s or g) for diagnostics. */
  peak: number;
}

export interface MotionSensitivity {
  /** Multiplier on thresholds: 'high' sensitivity → lower thresholds. */
  level: 'low' | 'normal' | 'high';
}

export interface MotionConfig {
  accelCutoffHz: number;
  gyroCutoffHz: number;
  /** stationary detection */
  stationaryAccelStd: number; // g
  stationaryGyroStd: number; // deg/s
  stationaryWindow: number; // samples
  /** sudden motion */
  suddenMotionG: number;
  /** strike (deg/s) */
  strikeStartDps: number;
  strikeMinPeakDps: number;
  strikeMaxDps: number; // intensity == 1
  strikeRecoveryMs: number;
  /** swing (deg/s) */
  swingStartDps: number;
  swingMaxDps: number;
  swingRecoveryMs: number;
  /** shake */
  shakeG: number;
  shakeReversals: number;
  shakeWindowMs: number;
  /** tilt (deg) */
  tiltEnterDeg: number;
  tiltExitDeg: number;
  tiltMaxDeg: number;
  /** rotate (yaw deg) */
  rotateEnterDeg: number;
  rotateExitDeg: number;
  rotateMaxDeg: number;
  /** Relative yaw relaxes toward 0 at this rate (deg/s) while stationary; bounds gyro drift. */
  yawDecayDps: number;
}

export const DEFAULT_MOTION_CONFIG: MotionConfig = {
  accelCutoffHz: 25,
  gyroCutoffHz: 40,
  stationaryAccelStd: 0.02,
  stationaryGyroStd: 3,
  stationaryWindow: 50,
  suddenMotionG: 1.2,
  strikeStartDps: 140,
  strikeMinPeakDps: 220,
  strikeMaxDps: 900,
  strikeRecoveryMs: 60,
  swingStartDps: 120,
  swingMaxDps: 700,
  swingRecoveryMs: 80,
  shakeG: 0.6,
  shakeReversals: 4,
  shakeWindowMs: 700,
  tiltEnterDeg: 18,
  tiltExitDeg: 10,
  tiltMaxDeg: 55,
  rotateEnterDeg: 30,
  rotateExitDeg: 18,
  rotateMaxDeg: 90,
  yawDecayDps: 2,
};

export function configForSensitivity(level: MotionSensitivity['level'], base = DEFAULT_MOTION_CONFIG): MotionConfig {
  const k = level === 'high' ? 0.75 : level === 'low' ? 1.35 : 1;
  return {
    ...base,
    strikeStartDps: base.strikeStartDps * k,
    strikeMinPeakDps: base.strikeMinPeakDps * k,
    strikeMaxDps: base.strikeMaxDps * k,
    swingStartDps: base.swingStartDps * k,
    swingMaxDps: base.swingMaxDps * k,
    shakeG: base.shakeG * k,
    tiltEnterDeg: base.tiltEnterDeg * k,
    tiltExitDeg: base.tiltExitDeg * k,
    tiltMaxDeg: base.tiltMaxDeg * k,
    rotateEnterDeg: base.rotateEnterDeg * k,
    rotateExitDeg: base.rotateExitDeg * k,
    rotateMaxDeg: base.rotateMaxDeg * k,
  };
}
