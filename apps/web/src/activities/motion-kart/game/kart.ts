import type { TrackModel } from './track';

export interface KartInput {
  /** −1 (left) … +1 (right) */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  boost: boolean;
}

export interface KartParams {
  maxSpeed: number; // m/s
  reverseSpeed: number;
  accel: number; // m/s²
  brakeDecel: number;
  drag: number; // quadratic
  rolling: number; // constant
  turnRate: number; // rad/s at full steer, medium speed
  offroadDrag: number; // extra multiplicative slowdown per second
  boostDuration: number;
  boostCooldown: number;
  boostMultiplier: number;
  wallMargin: number;
}

export const DEFAULT_KART: KartParams = {
  maxSpeed: 40,
  reverseSpeed: 8,
  accel: 18,
  brakeDecel: 34,
  drag: 0.008,
  rolling: 1.6,
  turnRate: 2.3,
  offroadDrag: 1.8,
  boostDuration: 1.7,
  boostCooldown: 6,
  boostMultiplier: 1.35,
  wallMargin: 0.4,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Arcade kart model. Forward = (cos heading, sin heading) on the XZ plane; steering right
 * increases heading (y-up, right = up × forward convention used across the game).
 */
export class Kart {
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  steer = 0; // smoothed steering −1..1
  bodyRoll = 0;
  boostTime = 0;
  boostCooldown = 0;
  offRoad = false;
  hitWall = 0; // seconds since wall hit (for FX), Infinity when none
  lateral = 0;
  trackS = 0;
  wheelSpin = 0;

  constructor(
    readonly params: KartParams = DEFAULT_KART,
    public color = '#ff7a45',
  ) {
    this.hitWall = Infinity;
  }

  placeOnTrack(track: TrackModel, s: number, lateral: number): void {
    const p = track.offsetPoint(s, lateral);
    this.x = p.x;
    this.z = p.z;
    this.heading = track.headingAt(s);
    this.trackS = track.wrap(s);
    this.lateral = lateral;
    this.speed = 0;
    this.steer = 0;
    this.boostTime = 0;
    this.boostCooldown = 0;
    this.offRoad = false;
    this.hitWall = Infinity;
  }

  get boosting(): boolean {
    return this.boostTime > 0;
  }

  get boostReady(): boolean {
    return this.boostCooldown <= 0 && this.boostTime <= 0;
  }

  get currentMaxSpeed(): number {
    return this.params.maxSpeed * (this.boosting ? this.params.boostMultiplier : 1);
  }

  step(input: KartInput, dt: number, track: TrackModel): void {
    const p = this.params;
    // steering smoothing (~fast but not twitchy)
    const target = clamp(input.steer, -1, 1);
    this.steer += (target - this.steer) * clamp(dt * 14, 0, 1);

    // boost
    if (input.boost && this.boostReady) {
      this.boostTime = p.boostDuration;
      this.boostCooldown = p.boostCooldown;
    }
    if (this.boostTime > 0) this.boostTime -= dt;
    if (this.boostCooldown > 0) this.boostCooldown -= dt;

    // longitudinal
    const throttle = clamp(input.throttle, 0, 1);
    const brake = clamp(input.brake, 0, 1);
    const max = this.currentMaxSpeed;
    let a = throttle * p.accel * (this.boosting ? 1.8 : 1);
    if (this.boosting && this.speed < max) a += p.accel * 0.8;
    if (brake > 0) {
      if (this.speed > 0.5) a -= brake * p.brakeDecel;
      else if (throttle === 0) a -= brake * p.accel * 0.6; // reverse
    }
    a -= p.drag * this.speed * Math.abs(this.speed);
    if (Math.abs(this.speed) > 0.05 && throttle === 0 && brake === 0) a -= Math.sign(this.speed) * p.rolling;
    this.speed += a * dt;
    if (throttle === 0 && brake === 0 && Math.abs(this.speed) < 0.15) this.speed = 0;
    this.speed = clamp(this.speed, -p.reverseSpeed, max);
    if (this.offRoad) this.speed *= Math.max(0, 1 - p.offroadDrag * dt * (this.speed > 12 ? 1 : 0.4));

    // yaw: no steering at standstill, full at ~12 m/s, then reduced at high speed
    const sp = Math.abs(this.speed);
    const speedFactor = clamp(sp / 12, 0, 1) * (1 - 0.35 * clamp(sp / p.maxSpeed, 0, 1));
    const yawRate = this.steer * p.turnRate * speedFactor * (this.speed < 0 ? -1 : 1);
    this.heading += yawRate * dt;
    this.bodyRoll += (-this.steer * clamp(sp / 20, 0, 1) * 0.12 - this.bodyRoll) * clamp(dt * 8, 0, 1);

    // integrate
    const fx = Math.cos(this.heading);
    const fz = Math.sin(this.heading);
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;
    this.wheelSpin += (this.speed / 0.32) * dt;

    // track relation, off-road, walls
    const near = track.nearest(this.x, this.z, this.trackS);
    this.trackS = near.s;
    this.lateral = near.lateral;
    this.offRoad = Math.abs(near.lateral) > track.halfWidth;
    const wall = track.wallDistance - p.wallMargin;
    if (this.hitWall !== Infinity) this.hitWall += dt;
    if (Math.abs(near.lateral) > wall) {
      const side = Math.sign(near.lateral);
      const q = track.offsetPoint(near.s, side * wall);
      this.x = q.x;
      this.z = q.z;
      this.lateral = side * wall;
      // bounce: lose speed, nudge heading back toward the track direction
      const impact = Math.abs(this.speed) > 6;
      this.speed *= impact ? 0.55 : 0.85;
      const th = track.headingAt(near.s);
      let diff = th - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * 0.35;
      if (impact) this.hitWall = 0;
    }
  }
}
