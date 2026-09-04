/**
 * World shape shared by terrain, scenery and props: a rolling heightfield that is flattened
 * to zero along the track so the road always sits on level ground.
 */
import type { TrackModel } from '../game/track';

export const WORLD_CENTER = { x: 58, z: -38 };
export const WORLD_SIZE = 760;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Raw hills before flattening (metres). Deterministic, smooth, no external noise lib. */
export function rawHills(x: number, z: number, amplitude: number): number {
  const a = Math.sin(x * 0.0135 + 1.3) * Math.cos(z * 0.0112 - 0.7);
  const b = Math.sin(x * 0.031 + z * 0.017) * 0.45;
  const c = Math.cos(x * 0.0072 - z * 0.0091 + 2.1) * 0.8;
  const d = Math.sin((x + z) * 0.052) * 0.12;
  return (a + b + c + d) * amplitude * 0.45 + amplitude * 0.35;
}

/**
 * Terrain height at (x, z). `distToTrack` is the lateral distance to the centre line; anything
 * within the run-off strip is flat (0) and the hills fade in beyond it.
 */
export function terrainHeight(x: number, z: number, distToTrack: number, track: TrackModel, amplitude: number): number {
  const flat = track.wallDistance + 4;
  const w = smooth(flat, flat + 34, distToTrack);
  const far = 0.35 + 0.65 * smooth(40, 160, distToTrack);
  return rawHills(x, z, amplitude) * w * far;
}

export function heightAt(track: TrackModel, x: number, z: number, amplitude: number): number {
  const near = track.nearest(x, z);
  return terrainHeight(x, z, near.distance, track, amplitude);
}

/** Signed curvature (1/m) at sample index i; + = turning left. */
export function curvatureAt(track: TrackModel, i: number): number {
  const n = track.samples.length;
  const a = track.samples[(i - 2 + n) % n];
  const b = track.samples[(i + 2) % n];
  const cross = a.tx * b.tz - a.tz * b.tx;
  const ang = Math.asin(Math.max(-1, Math.min(1, cross)));
  const ds = (4 * track.length) / n;
  return ang / ds;
}
