import { CalibrationState, StatusFlag, type MotionPacket, type Vec3 } from '@aero/protocol';
import { GyroBiasTracker, RunningStats, Vec3LowPass, clamp, vec3, vlen, vsub } from './filters';
import { RotateDetector, ShakeDetector, StrikeDetector, SwingDetector, TiltDetector } from './gestures';
import { ComplementaryOrientation, gravityFromOrientation, wrap180, type Orientation } from './orientation';
import type { ControllerId, ControllerMotionState, Direction, GestureEvent, MotionConfig } from './types';
import { DEFAULT_MOTION_CONFIG } from './types';

/**
 * Per-controller processing: raw packet → filtered state → gesture events.
 * Deterministic given the packet stream (time comes from packets), so it is fully testable.
 */
export class ControllerProcessor {
  config: MotionConfig;
  private readonly accelLp: Vec3LowPass;
  private readonly gyroLp: Vec3LowPass;
  private readonly orientation = new ComplementaryOrientation();
  private readonly accelStats: RunningStats;
  private readonly gyroStats: RunningStats;
  private readonly bias = new GyroBiasTracker();
  private neutral: Orientation = { pitch: 0, roll: 0, yaw: 0 };
  private neutralSet = false;
  private lastTimestamp: number | null = null;
  private lastMag = 0;
  private velocity: Vec3 = vec3();
  private rateWindow: number[] = [];
  state: ControllerMotionState;

  readonly strike: StrikeDetector;
  readonly swing: SwingDetector;
  readonly shake: ShakeDetector;
  readonly tilt: TiltDetector;
  readonly rotate: RotateDetector;

  constructor(
    public readonly controllerId: ControllerId,
    config: MotionConfig = DEFAULT_MOTION_CONFIG,
  ) {
    this.config = config;
    this.accelLp = new Vec3LowPass(config.accelCutoffHz);
    this.gyroLp = new Vec3LowPass(config.gyroCutoffHz);
    this.accelStats = new RunningStats(config.stationaryWindow);
    this.gyroStats = new RunningStats(config.stationaryWindow);
    const cfg = () => this.config;
    this.strike = new StrikeDetector(cfg);
    this.swing = new SwingDetector(cfg);
    this.shake = new ShakeDetector(cfg);
    this.tilt = new TiltDetector(cfg);
    this.rotate = new RotateDetector(cfg);
    this.state = emptyState(controllerId);
  }

  /** Capture the current orientation as the neutral pose (steering centre, chord centre …). */
  setNeutral(): void {
    this.neutral = { ...this.orientation.get() };
    this.orientation.resetYaw();
    this.neutral.yaw = 0;
    this.neutralSet = true;
  }

  process(p: MotionPacket, emit: (e: GestureEvent) => void): ControllerMotionState {
    // --- timing ---
    let dt = this.lastTimestamp === null ? 0.01 : (p.timestamp - this.lastTimestamp) / 1000;
    if (!(dt > 0) || dt > 0.25) dt = 0.01; // reboot / wrap / long gap: don't integrate the gap
    this.lastTimestamp = p.timestamp;
    this.rateWindow.push(p.receivedAt);
    while (this.rateWindow.length && p.receivedAt - this.rateWindow[0] > 1000) this.rateWindow.shift();

    // --- stationarity (on raw signals, before bias so we never chase our own correction) ---
    this.accelStats.push(vlen(p.accel));
    this.gyroStats.push(vlen(p.gyro));
    const deviceStationary = (p.status & StatusFlag.STATIONARY) !== 0;
    const isStationary =
      this.accelStats.full &&
      this.accelStats.stddev < this.config.stationaryAccelStd &&
      this.gyroStats.stddev < this.config.stationaryGyroStd &&
      this.gyroStats.mean < this.config.stationaryGyroStd * 3;
    this.bias.update(p.gyro, isStationary || deviceStationary);

    // --- filtering ---
    const gyroCorrected = vsub(p.gyro, this.bias.bias);
    const accel = this.accelLp.update(p.accel, dt);
    const gyro = this.gyroLp.update(gyroCorrected, dt);

    // --- orientation & gravity removal ---
    this.orientation.yawDecayDps = this.config.yawDecayDps;
    const orientation = this.orientation.update(accel, gyro, dt, isStationary);
    if (!this.neutralSet && this.accelStats.full && isStationary) this.setNeutral();
    const gravity = gravityFromOrientation(orientation);
    const linearAccel = vsub(accel, gravity);
    const motionMagnitude = vlen(linearAccel);
    const jerk = (motionMagnitude - this.lastMag) / dt;
    this.lastMag = motionMagnitude;

    // --- leaky velocity hint (decays quickly; never claims to be position) ---
    const decay = Math.exp(-dt / 0.15);
    this.velocity = {
      x: this.velocity.x * decay + linearAccel.x * dt,
      y: this.velocity.y * decay + linearAccel.y * dt,
      z: this.velocity.z * decay + linearAccel.z * dt,
    };
    if (isStationary) this.velocity = vec3();

    const relative: Orientation = {
      pitch: orientation.pitch - this.neutral.pitch,
      roll: wrap180(orientation.roll - this.neutral.roll),
      yaw: wrap180(orientation.yaw - this.neutral.yaw),
    };

    const calibrated = (p.status & StatusFlag.CALIBRATED) !== 0 || p.calibrationState === CalibrationState.READY;
    const calibrating =
      p.calibrationState === CalibrationState.SAMPLING || p.calibrationState === CalibrationState.WAITING_STILL;
    const packetRateHz = this.rateWindow.length;
    const saturated = vlen(p.accel) > 7.5 || vlen(p.gyro) > 1900;
    const confidence = clamp(
      (calibrated ? 1 : 0.6) * clamp(packetRateHz / 60, 0.3, 1) * (saturated ? 0.5 : 1) * (this.neutralSet ? 1 : 0.8),
      0,
      1,
    );

    this.state = {
      controllerId: this.controllerId,
      timestamp: p.timestamp,
      hostTime: p.receivedAt,
      dt,
      connected: true,
      calibrated,
      calibrating,
      battery: p.battery,
      accelRaw: p.accel,
      accel,
      gyroRaw: p.gyro,
      gyro,
      linearAccel,
      velocityHint: this.velocity,
      orientation,
      relative,
      angularSpeed: vlen(gyro),
      motionMagnitude,
      jerk,
      isStationary,
      isSuddenMotion: motionMagnitude > this.config.suddenMotionG,
      movementDirection: dominantDirection(linearAccel, 0.25),
      confidence,
      packetRateHz,
    };

    // --- gestures ---
    const s = this.state;
    this.strike.update(s, emit);
    this.swing.update(s, emit);
    this.shake.update(s, emit);
    this.tilt.update(s, emit);
    this.rotate.update(s, emit);
    return s;
  }

  markDisconnected(): void {
    this.state = { ...this.state, connected: false, confidence: 0, packetRateHz: 0 };
    this.lastTimestamp = null;
    this.rateWindow = [];
    this.accelLp.reset();
    this.gyroLp.reset();
    this.accelStats.reset();
    this.gyroStats.reset();
    this.strike.reset();
    this.swing.reset();
    this.shake.reset();
    this.tilt.reset();
    this.rotate.reset();
  }

  get gyroBias(): Vec3 {
    return this.bias.bias;
  }

  get hasNeutral(): boolean {
    return this.neutralSet;
  }
}

export function dominantDirection(a: Vec3, minG: number): Direction | null {
  const ax = Math.abs(a.x);
  const ay = Math.abs(a.y);
  const az = Math.abs(a.z);
  const m = Math.max(ax, ay, az);
  if (m < minG) return null;
  if (m === ax) return a.x > 0 ? 'forward' : 'back';
  if (m === ay) return a.y > 0 ? 'left' : 'right';
  return a.z > 0 ? 'up' : 'down';
}

export function emptyState(controllerId: ControllerId): ControllerMotionState {
  const o = { pitch: 0, roll: 0, yaw: 0 };
  return {
    controllerId,
    timestamp: 0,
    hostTime: 0,
    dt: 0.01,
    connected: false,
    calibrated: false,
    calibrating: false,
    battery: null,
    accelRaw: vec3(0, 0, 1),
    accel: vec3(0, 0, 1),
    gyroRaw: vec3(),
    gyro: vec3(),
    linearAccel: vec3(),
    velocityHint: vec3(),
    orientation: { ...o },
    relative: { ...o },
    angularSpeed: 0,
    motionMagnitude: 0,
    jerk: 0,
    isStationary: true,
    isSuddenMotion: false,
    movementDirection: null,
    confidence: 0,
    packetRateHz: 0,
  };
}
