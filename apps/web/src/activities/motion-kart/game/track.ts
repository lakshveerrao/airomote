/**
 * Track geometry: a closed Catmull-Rom spline through control points on the XZ plane,
 * re-parameterised by arc length so every consumer (karts, AI, checkpoints, meshes) works in
 * metres along the track (s ∈ [0, length)). Pure TypeScript, no Three.js dependency.
 */
export interface Vec2 {
  x: number;
  z: number;
}

export interface TrackSample {
  s: number; // arc length from start
  x: number;
  z: number;
  tx: number; // unit tangent
  tz: number;
}

export interface NearestResult {
  s: number;
  /** Signed lateral offset in metres: + = left of travel direction. */
  lateral: number;
  distance: number;
  x: number;
  z: number;
}

/** Original coastal circuit: long straight, S-bend, hairpin, sweeping return. Sea lies at −x. */
export const COASTAL_CIRCUIT: Vec2[] = [
  { x: 0, z: 0 },
  { x: 0, z: -60 },
  { x: 6, z: -110 },
  { x: 34, z: -138 },
  { x: 70, z: -128 },
  { x: 78, z: -96 },
  { x: 56, z: -70 },
  { x: 74, z: -38 },
  { x: 110, z: -20 },
  { x: 118, z: 22 },
  { x: 92, z: 52 },
  { x: 58, z: 46 },
  { x: 40, z: 74 },
  { x: 10, z: 66 },
  { x: -6, z: 34 },
];

export class TrackModel {
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly halfWidth: number;
  /** Distance from centre line to the invisible wall (grass strip beyond the asphalt). */
  readonly wallDistance: number;
  private readonly step: number;

  constructor(
    readonly controlPoints: Vec2[] = COASTAL_CIRCUIT,
    readonly width = 9,
    grassWidth = 4,
    resolution = 1200,
  ) {
    this.halfWidth = width / 2;
    this.wallDistance = this.halfWidth + grassWidth;
    // 1. dense uniform-parameter sampling
    const n = controlPoints.length;
    const dense: Vec2[] = [];
    const fine = resolution * 4;
    for (let i = 0; i < fine; i++) dense.push(this.spline((i / fine) * n));
    // 2. cumulative lengths
    const cum: number[] = [0];
    for (let i = 1; i <= fine; i++) {
      const a = dense[i - 1];
      const b = dense[i % fine];
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.length = cum[fine];
    // 3. resample uniformly by arc length
    this.step = this.length / resolution;
    let j = 0;
    for (let i = 0; i < resolution; i++) {
      const target = i * this.step;
      while (j < fine - 1 && cum[j + 1] < target) j++;
      const segLen = cum[j + 1] - cum[j] || 1e-9;
      const f = (target - cum[j]) / segLen;
      const a = dense[j];
      const b = dense[(j + 1) % fine];
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      this.samples.push({ s: target, x, z, tx: 0, tz: 0 });
    }
    // tangents from neighbours (central difference)
    for (let i = 0; i < resolution; i++) {
      const p = this.samples[(i - 1 + resolution) % resolution];
      const q = this.samples[(i + 1) % resolution];
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      this.samples[i].tx = dx / l;
      this.samples[i].tz = dz / l;
    }
  }

  /** Catmull-Rom evaluation at spline parameter u ∈ [0, n). */
  private spline(u: number): Vec2 {
    const n = this.controlPoints.length;
    const i = Math.floor(u) % n;
    const t = u - Math.floor(u);
    const p0 = this.controlPoints[(i - 1 + n) % n];
    const p1 = this.controlPoints[i];
    const p2 = this.controlPoints[(i + 1) % n];
    const p3 = this.controlPoints[(i + 2) % n];
    const t2 = t * t;
    const t3 = t2 * t;
    const c = (a: number, b: number, cc: number, d: number) =>
      0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
    return { x: c(p0.x, p1.x, p2.x, p3.x), z: c(p0.z, p1.z, p2.z, p3.z) };
  }

  wrap(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Forward distance from a to b along the track (0 ≤ d < length). */
  forward(a: number, b: number): number {
    return this.wrap(b - a);
  }

  private lerpSample(s: number): TrackSample {
    const w = this.wrap(s);
    const idx = w / this.step;
    const i0 = Math.floor(idx) % this.samples.length;
    const i1 = (i0 + 1) % this.samples.length;
    const f = idx - Math.floor(idx);
    const a = this.samples[i0];
    const b = this.samples[i1];
    const tx = a.tx + (b.tx - a.tx) * f;
    const tz = a.tz + (b.tz - a.tz) * f;
    const l = Math.hypot(tx, tz) || 1;
    return { s: w, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, tx: tx / l, tz: tz / l };
  }

  pointAt(s: number): Vec2 {
    const p = this.lerpSample(s);
    return { x: p.x, z: p.z };
  }

  tangentAt(s: number): Vec2 {
    const p = this.lerpSample(s);
    return { x: p.tx, z: p.tz };
  }

  /** Left-hand normal (y-up world: left = up × forward). */
  normalAt(s: number): Vec2 {
    const t = this.tangentAt(s);
    return { x: t.z, z: -t.x };
  }

  /** Heading angle (radians) such that forward = (cos h, sin h) in (x, z). */
  headingAt(s: number): number {
    const t = this.tangentAt(s);
    return Math.atan2(t.z, t.x);
  }

  /** Point offset laterally from the centre line (+ = left). */
  offsetPoint(s: number, lateral: number): Vec2 {
    const p = this.lerpSample(s);
    const nx = p.tz;
    const nz = -p.tx;
    return { x: p.x + nx * lateral, z: p.z + nz * lateral };
  }

  /**
   * Nearest point on the centre line. With `hintS` only a window around the hint is searched
   * (fast, and immune to the track passing close to itself elsewhere).
   */
  nearest(x: number, z: number, hintS?: number): NearestResult {
    const n = this.samples.length;
    let best = -1;
    let bestD = Infinity;
    if (hintS !== undefined) {
      const centre = Math.round(this.wrap(hintS) / this.step);
      const window = Math.ceil(40 / this.step); // ±40 m
      for (let k = -window; k <= window; k++) {
        const i = (centre + k + n * 4) % n;
        const p = this.samples[i];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        const p = this.samples[i];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    // refine: project onto the tangent at the best sample
    const p = this.samples[best];
    const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    const s = this.wrap(p.s + Math.max(-this.step, Math.min(this.step, along)));
    const q = this.lerpSample(s);
    const dx = x - q.x;
    const dz = z - q.z;
    const nx = q.tz;
    const nz = -q.tx;
    const lateral = dx * nx + dz * nz;
    return { s, lateral, distance: Math.hypot(dx, dz), x: q.x, z: q.z };
  }
}
