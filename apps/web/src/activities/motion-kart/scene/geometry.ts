import * as THREE from 'three';
import type { TrackModel } from '../game/track';

/** Builds a ribbon mesh along the track between lateral offsets [a, b] (metres, + = left). */
export function ribbonGeometry(
  track: TrackModel,
  a: number,
  b: number,
  y: number,
  opts: { every?: number; dashOn?: number; dashPeriod?: number; colorFn?: (i: number) => [number, number, number]; include?: (i: number) => boolean; uvScale?: number } = {},
): THREE.BufferGeometry {
  const every = opts.every ?? 1;
  const samples = track.samples;
  const n = samples.length;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const useColor = !!opts.colorFn;
  let quad = 0;
  for (let i = 0; i < n; i += every) {
    const inDash = opts.dashPeriod ? i % opts.dashPeriod < (opts.dashOn ?? opts.dashPeriod / 2) : true;
    if (!inDash) continue;
    if (opts.include && !opts.include(i)) continue;
    const s0 = samples[i];
    const s1 = samples[(i + every) % n];
    const pts = [s0, s1];
    for (const p of pts) {
      const nx = p.tz;
      const nz = -p.tx;
      positions.push(p.x + nx * a, y, p.z + nz * a, p.x + nx * b, y, p.z + nz * b);
      const v = p.s / (opts.uvScale ?? (b - a || 1));
      uvs.push(0, v, 1, v);
      if (useColor) {
        const c = opts.colorFn!(i);
        colors.push(...c, ...c);
      }
    }
    const base = quad * 4;
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    quad++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (useColor) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Scatter {
  x: number;
  z: number;
  scale: number;
  rot: number;
}

/** Scatter points in the world bounds that stay clear of the track and out of the sea. */
export function scatterOffTrack(track: TrackModel, count: number, seed: number, minClearance: number, minX = -14): Scatter[] {
  const rnd = seededRandom(seed);
  const out: Scatter[] = [];
  let tries = 0;
  while (out.length < count && tries < count * 40) {
    tries++;
    const x = -40 + rnd() * 200;
    const z = -190 + rnd() * 300;
    if (x < minX) continue;
    const near = track.nearest(x, z);
    if (Math.abs(near.lateral) < track.wallDistance + minClearance) continue;
    out.push({ x, z, scale: 0.7 + rnd() * 0.8, rot: rnd() * Math.PI * 2 });
  }
  return out;
}
