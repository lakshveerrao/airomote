import type { Vec3 } from '@aero/protocol';
import { RAD, clamp, lerp } from './filters';

/**
 * Body frame convention (firmware remaps chip axes into this frame — see board_config.h):
 *   +X forward (away from the user, along the controller)
 *   +Y left
 *   +Z up
 * Angles (degrees):
 *   pitch  > 0 → front tips UP
 *   roll   > 0 → tilted to the RIGHT (right side down)
 *   yaw    > 0 → turned LEFT (counter-clockwise seen from above), relative to a reference
 * Rates (deg/s) derived from gyro: pitchRate = -gyro.y, rollRate = gyro.x, yawRate = gyro.z.
 */
export interface Orientation {
  pitch: number;
  roll: number;
  yaw: number;
}

export function accelToPitchRoll(a: Vec3): { pitch: number; roll: number } {
  const pitch = Math.atan2(a.x, Math.hypot(a.y, a.z)) * RAD;
  const roll = Math.atan2(a.y, a.z) * RAD;
  return { pitch, roll };
}

export const wrap180 = (deg: number): number => {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

/**
 * Complementary filter: gyro integration for responsiveness, accelerometer for gravity
 * reference. Yaw is gyro-only (MPU6050 has no magnetometer) → relative heading that
 * slowly decays toward zero while stationary to bound drift for zone-based interactions.
 */
export class ComplementaryOrientation {
  pitch = 0;
  roll = 0;
  yaw = 0;
  private initialised = false;

  constructor(
    /** 0.98 = trust gyro heavily; lower = faster accel correction (more jitter under motion). */
    public gyroWeight = 0.98,
    /** How fast yaw relaxes to zero while stationary (deg/s). 0 disables. */
    public yawDecayDps = 2,
  ) {}

  update(accel: Vec3, gyro: Vec3, dt: number, stationary: boolean): Orientation {
    const { pitch: ap, roll: ar } = accelToPitchRoll(accel);
    if (!this.initialised) {
      this.pitch = ap;
      this.roll = ar;
      this.yaw = 0;
      this.initialised = true;
      return this.get();
    }
    const pitchRate = -gyro.y;
    const rollRate = gyro.x;
    const yawRate = gyro.z;

    // When the accel vector is far from 1g the tilt reading is unreliable → trust gyro more.
    const mag = Math.hypot(accel.x, accel.y, accel.z);
    const accelTrust = clamp(1 - Math.abs(mag - 1) * 2, 0, 1);
    const w = lerp(1, this.gyroWeight, accelTrust);

    const gp = this.pitch + pitchRate * dt;
    const gr = this.roll + rollRate * dt;
    this.pitch = w * gp + (1 - w) * ap;
    // roll can wrap when the controller is upside down — blend on the shortest arc
    this.roll = wrap180(gr + (1 - w) * wrap180(ar - gr));

    this.yaw = wrap180(this.yaw + yawRate * dt);
    if (stationary && this.yawDecayDps > 0) {
      const step = this.yawDecayDps * dt;
      if (Math.abs(this.yaw) <= step) this.yaw = 0;
      else this.yaw -= Math.sign(this.yaw) * step;
    }
    return this.get();
  }

  get(): Orientation {
    return { pitch: this.pitch, roll: this.roll, yaw: this.yaw };
  }

  resetYaw(): void {
    this.yaw = 0;
  }

  reset(): void {
    this.initialised = false;
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
  }
}

/** Gravity vector in the body frame implied by the orientation, in g. */
export function gravityFromOrientation(o: Orientation): Vec3 {
  const p = o.pitch / RAD;
  const r = o.roll / RAD;
  return { x: Math.sin(p), y: Math.cos(p) * Math.sin(r), z: Math.cos(p) * Math.cos(r) };
}
