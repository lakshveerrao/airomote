/**
 * The circuit itself: textured road, red/white kerbs on the bends, edge lines, verge,
 * start/finish checker and gantry, barriers along the run-off.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Race } from '../game/race';
import type { TrackModel } from '../game/track';
import { ribbonGeometry } from './geometry';
import type { KartTheme } from './themes';
import { bannerTexture, checkerTexture, roadTexture, stripeTexture } from './textures';
import { curvatureAt } from './world';

const tmpO = new THREE.Object3D();
const KERB_CURVATURE = 0.011; // 1/m → bends tighter than ~90 m radius get kerbs

export function Road({ track, theme }: { track: TrackModel; theme: KartTheme }) {
  const built = useMemo(() => {
    const hw = track.halfWidth;
    const n = track.samples.length;
    const curv = new Float32Array(n);
    for (let i = 0; i < n; i++) curv[i] = curvatureAt(track, i);
    // widen kerb zones a little so they start before the apex
    const kerbL = (i: number) => {
      for (let k = -14; k <= 14; k++) if (curv[(i + k + n) % n] > KERB_CURVATURE) return true;
      return false;
    };
    const kerbR = (i: number) => {
      for (let k = -14; k <= 14; k++) if (curv[(i + k + n) % n] < -KERB_CURVATURE) return true;
      return false;
    };
    const a = new THREE.Color(theme.road.kerbA);
    const b = new THREE.Color(theme.road.kerbB);
    const stripe = (i: number): [number, number, number] => (Math.floor(i / 8) % 2 === 0 ? [a.r, a.g, a.b] : [b.r, b.g, b.b]);
    const road = ribbonGeometry(track, -hw - 0.15, hw + 0.15, 0.02, { every: 2, uvScale: 6 });
    const verge = ribbonGeometry(track, -hw - 1.6, hw + 1.6, 0.008, { every: 3 });
    // kerbs sit on the *outside* of a bend (left bend → right kerb) and the inside apex
    const kerbOuterL = ribbonGeometry(track, hw - 0.05, hw + 0.75, 0.05, { every: 2, colorFn: stripe, include: kerbR });
    const kerbOuterR = ribbonGeometry(track, -hw - 0.75, -hw + 0.05, 0.05, { every: 2, colorFn: stripe, include: kerbL });
    const kerbInnerL = ribbonGeometry(track, hw - 0.05, hw + 0.45, 0.04, { every: 2, colorFn: stripe, include: kerbL });
    const kerbInnerR = ribbonGeometry(track, -hw - 0.45, -hw + 0.05, 0.04, { every: 2, colorFn: stripe, include: kerbR });
    const lineL = ribbonGeometry(track, hw - 0.32, hw - 0.12, 0.03, { every: 2 });
    const lineR = ribbonGeometry(track, -hw + 0.12, -hw + 0.32, 0.03, { every: 2 });
    // start/finish checker: 3 m long, 10 squares across
    const step = track.length / n;
    const rows = Math.max(2, Math.round(3 / step));
    const cols = 10;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r < rows; r++) {
      const s0 = track.samples[(r - Math.floor(rows / 2) + n) % n];
      const s1 = track.samples[(r - Math.floor(rows / 2) + 1 + n) % n];
      for (let c = 0; c < cols; c++) {
        const ea = -hw + (c / cols) * 2 * hw;
        const eb = -hw + ((c + 1) / cols) * 2 * hw;
        const shade = (r + c) % 2 === 0 ? 0.95 : 0.06;
        for (const p of [s0, s1]) {
          const nx = p.tz;
          const nz = -p.tx;
          pos.push(p.x + nx * ea, 0.04, p.z + nz * ea, p.x + nx * eb, 0.04, p.z + nz * eb);
          col.push(shade, shade, shade, shade, shade, shade);
        }
        const base = (r * cols + c) * 4;
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const checker = new THREE.BufferGeometry();
    checker.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    checker.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    checker.setIndex(idx);
    checker.computeVertexNormals();
    // braking marks before tight bends
    const marks = ribbonGeometry(track, -0.9, -0.5, 0.032, { every: 2, include: (i) => curv[(i + 40) % n] > KERB_CURVATURE * 1.4 && i % 3 !== 0 });
    const marks2 = ribbonGeometry(track, 0.5, 0.9, 0.032, { every: 2, include: (i) => curv[(i + 40) % n] < -KERB_CURVATURE * 1.4 && i % 3 !== 0 });
    const tex = roadTexture(theme.road.base, theme.road.speck, theme.road.dirt);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return { road, verge, kerbOuterL, kerbOuterR, kerbInnerL, kerbInnerR, lineL, lineR, checker, marks, marks2, tex };
  }, [track, theme]);
  useEffect(
    () => () => {
      Object.values(built).forEach((g) => g.dispose());
    },
    [built],
  );
  const kerbMat = <meshStandardMaterial vertexColors roughness={0.75} />;
  return (
    <group>
      <mesh geometry={built.verge} receiveShadow>
        <meshStandardMaterial color={theme.road.verge} roughness={1} />
      </mesh>
      <mesh geometry={built.road} receiveShadow>
        <meshStandardMaterial map={built.tex} color="#ffffff" roughness={theme.road.dirt ? 1 : 0.9} metalness={0} />
      </mesh>
      <mesh geometry={built.kerbOuterL}>{kerbMat}</mesh>
      <mesh geometry={built.kerbOuterR}>{kerbMat}</mesh>
      <mesh geometry={built.kerbInnerL}>{kerbMat}</mesh>
      <mesh geometry={built.kerbInnerR}>{kerbMat}</mesh>
      {!theme.road.dirt && (
        <>
          <mesh geometry={built.lineL}>
            <meshStandardMaterial color={theme.road.line} roughness={0.7} />
          </mesh>
          <mesh geometry={built.lineR}>
            <meshStandardMaterial color={theme.road.line} roughness={0.7} />
          </mesh>
        </>
      )}
      <mesh geometry={built.marks}>
        <meshStandardMaterial color="#1a1a1c" transparent opacity={0.35} roughness={1} />
      </mesh>
      <mesh geometry={built.marks2}>
        <meshStandardMaterial color="#1a1a1c" transparent opacity={0.35} roughness={1} />
      </mesh>
      <mesh geometry={built.checker}>
        <meshStandardMaterial vertexColors roughness={0.7} />
      </mesh>
    </group>
  );
}

/** Barriers along both run-off edges: white fence with rails, tyre walls, or canyon rocks. */
export function Barriers({ track, theme }: { track: TrackModel; theme: KartTheme }) {
  const posts = useRef<THREE.InstancedMesh>(null);
  const rails = useRef<THREE.InstancedMesh>(null);
  const rocks = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: Array<{ x: number; z: number; h: number; side: number; s: number }> = [];
    const spacing = theme.barrier === 'rocks' ? 4.5 : 5;
    for (let s = 0; s < track.length - spacing / 2; s += spacing) {
      for (const side of [1, -1]) {
        const p = track.offsetPoint(s, side * (track.wallDistance + 0.5));
        out.push({ x: p.x, z: p.z, h: track.headingAt(s), side, s });
      }
    }
    return out;
  }, [track, theme.barrier]);
  useEffect(() => {
    if (theme.barrier === 'rocks') {
      const m = rocks.current!;
      items.forEach((it, i) => {
        const sc = 0.9 + ((i * 7919) % 11) / 11;
        tmpO.position.set(it.x, 0.55 * sc, it.z);
        tmpO.rotation.set(0.2 * ((i % 3) - 1), it.h + i, 0);
        tmpO.scale.set(sc * 1.4, sc, sc * 1.1);
        tmpO.updateMatrix();
        m.setMatrixAt(i, tmpO.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      return;
    }
    const p = posts.current!;
    const r = rails.current!;
    items.forEach((it, i) => {
      tmpO.position.set(it.x, 0.55, it.z);
      tmpO.rotation.set(0, -it.h, 0);
      tmpO.scale.set(1, 1, 1);
      tmpO.updateMatrix();
      p.setMatrixAt(i, tmpO.matrix);
      // rail segment to the next post on the same side
      const next = track.offsetPoint(it.s + 5, it.side * (track.wallDistance + 0.5));
      const dx = next.x - it.x;
      const dz = next.z - it.z;
      const len = Math.hypot(dx, dz);
      tmpO.position.set(it.x + dx / 2, 0.85, it.z + dz / 2);
      tmpO.rotation.set(0, -Math.atan2(dz, dx), 0);
      tmpO.scale.set(len, 1, 1);
      tmpO.updateMatrix();
      r.setMatrixAt(i, tmpO.matrix);
    });
    p.instanceMatrix.needsUpdate = true;
    r.instanceMatrix.needsUpdate = true;
  }, [items, theme.barrier, track]);
  if (theme.barrier === 'rocks') {
    return (
      <instancedMesh ref={rocks} args={[undefined, undefined, items.length]} castShadow receiveShadow frustumCulled={false}>
        <dodecahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial color="#b4643a" roughness={1} flatShading />
      </instancedMesh>
    );
  }
  return (
    <group>
      <instancedMesh ref={posts} args={[undefined, undefined, items.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[0.12, 1.1, 0.12]} />
        <meshStandardMaterial color="#f2f2ee" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={rails} args={[undefined, undefined, items.length]} frustumCulled={false}>
        <boxGeometry args={[1, 0.08, 0.06]} />
        <meshStandardMaterial color="#f2f2ee" roughness={0.8} />
      </instancedMesh>
    </group>
  );
}

/** Tyre-wall stacks on the outside of the tight bends (meadow) — stripes like the reference kerbs. */
export function TyreWalls({ track, theme }: { track: TrackModel; theme: KartTheme }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tex = useMemo(() => stripeTexture(theme.road.kerbA, theme.road.kerbB), [theme]);
  const items = useMemo(() => {
    const n = track.samples.length;
    const out: Array<{ x: number; z: number; h: number }> = [];
    for (let i = 0; i < n; i += 6) {
      const c = curvatureAt(track, i);
      if (Math.abs(c) < 0.016) continue;
      const side = c > 0 ? -1 : 1; // outside of the bend
      const p = track.offsetPoint(track.samples[i].s, side * (track.wallDistance + 1.4));
      out.push({ x: p.x, z: p.z, h: track.headingAt(track.samples[i].s) });
    }
    return out;
  }, [track]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach((it, i) => {
      tmpO.position.set(it.x, 0.45, it.z);
      tmpO.rotation.set(0, -it.h, 0);
      tmpO.scale.set(1, 1, 1);
      tmpO.updateMatrix();
      m.setMatrixAt(i, tmpO.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [items]);
  useEffect(() => () => tex.dispose(), [tex]);
  if (!items.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow frustumCulled={false}>
      <boxGeometry args={[1.9, 0.9, 0.8]} />
      <meshStandardMaterial map={tex} roughness={0.9} />
    </instancedMesh>
  );
}

export function Gantry({ track, theme, accent }: { track: TrackModel; theme: KartTheme; accent: string }) {
  const p = track.pointAt(0);
  const h = track.headingAt(0);
  const w = track.halfWidth + 2.2;
  const checker = useMemo(() => checkerTexture(16, 2), []);
  const banner = useMemo(() => bannerTexture(theme.banners.text, theme.banners.primary, '#ffffff', { sub: 'start · finish', stripe: theme.banners.secondary }), [theme]);
  useEffect(
    () => () => {
      checker.dispose();
      banner.dispose();
    },
    [checker, banner],
  );
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, -h, 0]}>
      {[w, -w].map((z, i) => (
        <group key={i} position={[0, 0, z]}>
          <mesh position={[0, 3.2, 0]} castShadow>
            <boxGeometry args={[0.5, 6.4, 0.5]} />
            <meshStandardMaterial color="#e6e7ea" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.25, 0]}>
            <boxGeometry args={[1.2, 0.5, 1.2]} />
            <meshStandardMaterial color="#2a2c33" roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* checkered beam */}
      <mesh position={[0, 6.2, 0]} castShadow>
        <boxGeometry args={[0.7, 0.55, w * 2 + 0.5]} />
        <meshStandardMaterial map={checker} roughness={0.6} />
      </mesh>
      {/* banner board facing oncoming karts (they travel +heading, so the board faces −x locally) */}
      <mesh position={[-0.42, 7.3, 0]} rotation={[0, -Math.PI / 2, 0]} castShadow>
        <planeGeometry args={[w * 2 - 0.5, 1.7]} />
        <meshStandardMaterial map={banner} roughness={0.6} />
      </mesh>
      <mesh position={[-0.35, 7.3, 0]}>
        <boxGeometry args={[0.1, 1.8, w * 2 - 0.4]} />
        <meshStandardMaterial color="#2d3038" roughness={0.8} />
      </mesh>
      {/* start lights */}
      {[-1.2, -0.6, 0, 0.6, 1.2].map((z, i) => (
        <mesh key={i} position={[-0.4, 5.5, z]}>
          <sphereGeometry args={[0.14, 10, 8]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export function CheckpointArches({ race }: { race: Race }) {
  const items = useMemo(() => race.checkpointS.slice(1).map((s) => ({ p: race.track.pointAt(s), h: race.track.headingAt(s) })), [race]);
  const w = race.track.halfWidth + 1.0;
  return (
    <group>
      {items.map((it, i) => (
        <group key={i} position={[it.p.x, 0, it.p.z]} rotation={[0, -it.h, 0]}>
          {[w, -w].map((z, j) => (
            <mesh key={j} position={[0, 1.2, z]}>
              <boxGeometry args={[0.14, 2.4, 0.14]} />
              <meshStandardMaterial color="#6ea8ff" emissive="#6ea8ff" emissiveIntensity={0.4} transparent opacity={0.4} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
