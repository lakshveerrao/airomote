/**
 * Everything around the circuit: round trees or desert flora, rocks, grandstands with a
 * cheering crowd, trackside billboards and flags. All instanced.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TrackModel } from '../game/track';
import { scatterOffTrack, seededRandom } from './geometry';
import type { KartTheme } from './themes';
import { bannerTexture } from './textures';
import { heightAt, curvatureAt } from './world';

const tmpO = new THREE.Object3D();
const tmpC = new THREE.Color();

/* ------------------------------------------------------------------ flora */

export function Flora({ track, theme, density }: { track: TrackModel; theme: KartTheme; density: number }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crownsA = useRef<THREE.InstancedMesh>(null);
  const crownsB = useRef<THREE.InstancedMesh>(null);
  const bushes = useRef<THREE.InstancedMesh>(null);
  const rocks = useRef<THREE.InstancedMesh>(null);
  const cacti = useRef<THREE.InstancedMesh>(null);
  const arms = useRef<THREE.InstancedMesh>(null);
  const spires = useRef<THREE.InstancedMesh>(null);

  const desert = theme.flora === 'desert';
  const data = useMemo(() => {
    const amp = theme.hills.amplitude;
    const trees = desert ? [] : scatterOffTrack(track, Math.round(260 * density), 11, 3, -400).map((t) => ({ ...t, y: heightAt(track, t.x, t.z, amp) }));
    const bush = scatterOffTrack(track, Math.round((desert ? 160 : 120) * density), 29, 1.2, -400).map((t) => ({ ...t, y: heightAt(track, t.x, t.z, amp) }));
    const stones = scatterOffTrack(track, Math.round((desert ? 140 : 40) * density), 23, 1.5, -400).map((t) => ({ ...t, y: heightAt(track, t.x, t.z, amp) }));
    const cactus = desert ? scatterOffTrack(track, Math.round(110 * density), 53, 2.5, -400).map((t) => ({ ...t, y: heightAt(track, t.x, t.z, amp) })) : [];
    const spire = desert ? scatterOffTrack(track, Math.round(46 * density), 67, 14, -400).map((t) => ({ ...t, y: heightAt(track, t.x, t.z, amp) })) : [];
    return { trees, bush, stones, cactus, spire };
  }, [track, theme, density, desert]);

  useEffect(() => {
    const rnd = seededRandom(5);
    const { trees, bush, stones, cactus, spire } = data;
    trees.forEach((t, i) => {
      const s = t.scale * 1.15;
      tmpO.position.set(t.x, t.y + 1.3 * s, t.z);
      tmpO.rotation.set(0, t.rot, 0);
      tmpO.scale.set(s, s, s);
      tmpO.updateMatrix();
      trunks.current!.setMatrixAt(i, tmpO.matrix);
      // two-lobe round crown
      tmpO.position.set(t.x, t.y + 3.1 * s, t.z);
      const c = s * (1 + rnd() * 0.25);
      tmpO.scale.set(c, c * 0.95, c);
      tmpO.updateMatrix();
      crownsA.current!.setMatrixAt(i, tmpO.matrix);
      tmpC.setHSL(0.3 + rnd() * 0.06, 0.55 + rnd() * 0.2, 0.3 + rnd() * 0.12);
      crownsA.current!.setColorAt(i, tmpC);
      tmpO.position.set(t.x + (rnd() - 0.5) * s * 0.8, t.y + 3.9 * s, t.z + (rnd() - 0.5) * s * 0.8);
      const c2 = s * (0.7 + rnd() * 0.25);
      tmpO.scale.set(c2, c2, c2);
      tmpO.updateMatrix();
      crownsB.current!.setMatrixAt(i, tmpO.matrix);
      tmpC.offsetHSL(0, 0, 0.06);
      crownsB.current!.setColorAt(i, tmpC);
    });
    if (trees.length) {
      trunks.current!.instanceMatrix.needsUpdate = true;
      crownsA.current!.instanceMatrix.needsUpdate = true;
      crownsB.current!.instanceMatrix.needsUpdate = true;
      if (crownsA.current!.instanceColor) crownsA.current!.instanceColor.needsUpdate = true;
      if (crownsB.current!.instanceColor) crownsB.current!.instanceColor.needsUpdate = true;
    }
    bush.forEach((b, i) => {
      const s = b.scale * (desert ? 0.7 : 0.9);
      tmpO.position.set(b.x, b.y + 0.45 * s, b.z);
      tmpO.rotation.set(0, b.rot, 0);
      tmpO.scale.set(s * 1.3, s, s * 1.2);
      tmpO.updateMatrix();
      bushes.current!.setMatrixAt(i, tmpO.matrix);
      if (desert) tmpC.setHSL(0.22 + rnd() * 0.06, 0.35, 0.28 + rnd() * 0.1);
      else tmpC.setHSL(0.28 + rnd() * 0.08, 0.6, 0.28 + rnd() * 0.12);
      bushes.current!.setColorAt(i, tmpC);
    });
    bushes.current!.instanceMatrix.needsUpdate = true;
    if (bushes.current!.instanceColor) bushes.current!.instanceColor.needsUpdate = true;
    stones.forEach((r, i) => {
      const s = r.scale * (desert ? 1.6 : 1);
      tmpO.position.set(r.x, r.y + 0.3 * s, r.z);
      tmpO.rotation.set(r.rot, r.rot * 0.7, 0);
      tmpO.scale.set(s, s * 0.7, s);
      tmpO.updateMatrix();
      rocks.current!.setMatrixAt(i, tmpO.matrix);
    });
    rocks.current!.instanceMatrix.needsUpdate = true;
    cactus.forEach((c, i) => {
      const s = c.scale * 1.2;
      tmpO.position.set(c.x, c.y + 1.1 * s, c.z);
      tmpO.rotation.set(0, c.rot, 0);
      tmpO.scale.set(s, s, s);
      tmpO.updateMatrix();
      cacti.current!.setMatrixAt(i, tmpO.matrix);
      tmpO.position.set(c.x + Math.cos(c.rot) * 0.45 * s, c.y + 1.5 * s, c.z + Math.sin(c.rot) * 0.45 * s);
      tmpO.rotation.set(0, c.rot, 0.9);
      tmpO.scale.set(s * 0.6, s * 0.6, s * 0.6);
      tmpO.updateMatrix();
      arms.current!.setMatrixAt(i, tmpO.matrix);
    });
    if (cactus.length) {
      cacti.current!.instanceMatrix.needsUpdate = true;
      arms.current!.instanceMatrix.needsUpdate = true;
    }
    spire.forEach((r, i) => {
      const s = r.scale * 5;
      tmpO.position.set(r.x, r.y + 2.2 * s, r.z);
      tmpO.rotation.set(0, r.rot, 0);
      tmpO.scale.set(s * (0.8 + rnd() * 0.6), s, s * (0.8 + rnd() * 0.6));
      tmpO.updateMatrix();
      spires.current!.setMatrixAt(i, tmpO.matrix);
      tmpC.setHSL(0.05 + rnd() * 0.03, 0.55, 0.36 + rnd() * 0.1);
      spires.current!.setColorAt(i, tmpC);
    });
    if (spire.length) {
      spires.current!.instanceMatrix.needsUpdate = true;
      if (spires.current!.instanceColor) spires.current!.instanceColor.needsUpdate = true;
    }
  }, [data, desert]);

  return (
    <group>
      {!desert && (
        <>
          <instancedMesh ref={trunks} args={[undefined, undefined, data.trees.length]} castShadow frustumCulled={false}>
            <cylinderGeometry args={[0.16, 0.3, 2.8, 7]} />
            <meshStandardMaterial color="#6d4a2e" roughness={1} />
          </instancedMesh>
          <instancedMesh ref={crownsA} args={[undefined, undefined, data.trees.length]} castShadow frustumCulled={false}>
            <icosahedronGeometry args={[1.7, 1]} />
            <meshStandardMaterial roughness={0.9} flatShading />
          </instancedMesh>
          <instancedMesh ref={crownsB} args={[undefined, undefined, data.trees.length]} castShadow frustumCulled={false}>
            <icosahedronGeometry args={[1.3, 1]} />
            <meshStandardMaterial roughness={0.9} flatShading />
          </instancedMesh>
        </>
      )}
      <instancedMesh ref={bushes} args={[undefined, undefined, data.bush.length]} castShadow frustumCulled={false}>
        <icosahedronGeometry args={[0.7, 1]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={rocks} args={[undefined, undefined, data.stones.length]} castShadow receiveShadow frustumCulled={false}>
        <dodecahedronGeometry args={[0.8, 0]} />
        <meshStandardMaterial color={desert ? '#b7693e' : '#8a8f99'} roughness={1} flatShading />
      </instancedMesh>
      {desert && (
        <>
          <instancedMesh ref={cacti} args={[undefined, undefined, data.cactus.length]} castShadow frustumCulled={false}>
            <capsuleGeometry args={[0.28, 1.8, 4, 8]} />
            <meshStandardMaterial color="#4f8a3c" roughness={0.9} />
          </instancedMesh>
          <instancedMesh ref={arms} args={[undefined, undefined, data.cactus.length]} castShadow frustumCulled={false}>
            <capsuleGeometry args={[0.22, 0.9, 4, 8]} />
            <meshStandardMaterial color="#4f8a3c" roughness={0.9} />
          </instancedMesh>
          <instancedMesh ref={spires} args={[undefined, undefined, data.spire.length]} castShadow receiveShadow frustumCulled={false}>
            <cylinderGeometry args={[0.55, 1, 4.4, 6]} />
            <meshStandardMaterial roughness={1} flatShading />
          </instancedMesh>
        </>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ grandstands */

interface StandSpec {
  s: number;
  side: number;
  length: number;
  text: string;
  color: string;
}

function standSpecs(track: TrackModel, theme: KartTheme): StandSpec[] {
  // straights: low curvature for a while; place stands on the outside of the following bend
  const n = track.samples.length;
  const out: StandSpec[] = [];
  const texts = ['AiroMote', theme.banners.text, 'Airo Cup', 'Motion Series'];
  let run = 0;
  let last = -1e9;
  for (let i = 0; i < n; i++) {
    const c = Math.abs(curvatureAt(track, i));
    run = c < 0.004 ? run + 1 : 0;
    const s = track.samples[i].s;
    if (run > 70 && s - last > 90 && out.length < 4) {
      const side = out.length % 2 === 0 ? 1 : -1;
      out.push({ s: s - 20, side, length: 34, text: texts[out.length % texts.length], color: out.length % 2 ? theme.banners.secondary : theme.banners.primary });
      last = s;
      run = 0;
    }
  }
  return out;
}

function Grandstand({ track, spec, theme, crowd }: { track: TrackModel; spec: StandSpec; theme: KartTheme; crowd: number }) {
  const p = track.offsetPoint(spec.s, spec.side * (track.wallDistance + 7));
  const h = track.headingAt(spec.s);
  const banner = useMemo(() => bannerTexture(spec.text, spec.color, '#ffffff', { height: 200 }), [spec.text, spec.color]);
  useEffect(() => () => banner.dispose(), [banner]);
  const people = useRef<THREE.InstancedMesh>(null);
  const seats = useMemo(() => {
    const rnd = seededRandom(spec.s | 0);
    return Array.from({ length: crowd }, (_, i) => {
      const row = i % 6;
      return { x: -spec.length / 2 + 0.6 + (i / crowd) * (spec.length - 1.2) + (rnd() - 0.5) * 0.4, row, phase: rnd() * Math.PI * 2, hue: rnd(), bob: 0.6 + rnd() * 0.8 };
    });
  }, [spec, crowd]);
  useEffect(() => {
    const m = people.current!;
    seats.forEach((s, i) => {
      tmpC.setHSL(s.hue, 0.7, 0.5);
      m.setColorAt(i, tmpC);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [seats]);
  useFrame((state) => {
    const m = people.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    seats.forEach((s, i) => {
      const y = 1.1 + s.row * 0.7 + Math.max(0, Math.sin(t * 3 * s.bob + s.phase)) * 0.25;
      tmpO.position.set(s.x, y, 1.2 + s.row * 0.95);
      tmpO.rotation.set(0, 0, 0);
      tmpO.scale.set(1, 1, 1);
      tmpO.updateMatrix();
      m.setMatrixAt(i, tmpO.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  // stand faces the track: local +z points away from the track, so flip for side
  const face = spec.side > 0 ? Math.PI - h : -h;
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, face, 0]}>
      {/* tiers */}
      {Array.from({ length: 6 }).map((_, r) => (
        <mesh key={r} position={[0, 0.35 + r * 0.7, 1.4 + r * 0.95]} castShadow receiveShadow>
          <boxGeometry args={[spec.length, 0.7, 1.0]} />
          <meshStandardMaterial color={r % 2 ? '#c9ccd4' : '#b8bcc6'} roughness={0.9} />
        </mesh>
      ))}
      {/* back wall + roof */}
      <mesh position={[0, 3.2, 7.2]} castShadow>
        <boxGeometry args={[spec.length + 0.6, 6.4, 0.3]} />
        <meshStandardMaterial color="#e2e4e8" roughness={0.8} />
      </mesh>
      <mesh position={[0, 6.4, 3.6]} rotation={[0.12, 0, 0]} castShadow>
        <boxGeometry args={[spec.length + 1.2, 0.2, 8]} />
        <meshStandardMaterial color="#f4f4f6" roughness={0.7} metalness={0.1} />
      </mesh>
      {[-spec.length / 2, spec.length / 2].map((x, i) => (
        <mesh key={i} position={[x, 3.2, 0.4]}>
          <cylinderGeometry args={[0.12, 0.12, 6.4, 8]} />
          <meshStandardMaterial color="#d8dae0" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      {/* front banner */}
      <mesh position={[0, 0.9, 0.9]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[spec.length - 0.4, 1.4]} />
        <meshStandardMaterial map={banner} roughness={0.6} />
      </mesh>
      {/* crowd */}
      <instancedMesh ref={people} args={[undefined, undefined, crowd]} frustumCulled={false}>
        <capsuleGeometry args={[0.18, 0.35, 3, 6]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </group>
  );
}

export function Grandstands({ track, theme, crowdPerStand }: { track: TrackModel; theme: KartTheme; crowdPerStand: number }) {
  const specs = useMemo(() => standSpecs(track, theme), [track, theme]);
  if (!theme.grandstands) return null;
  return (
    <group>
      {specs.map((s, i) => (
        <Grandstand key={i} track={track} spec={s} theme={theme} crowd={crowdPerStand} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ billboards + flags */

export function Billboards({ track, theme }: { track: TrackModel; theme: KartTheme }) {
  const items = useMemo(() => {
    const texts: Array<[string, string]> = [
      ['AiroMote', theme.banners.primary],
      [theme.banners.text, theme.banners.secondary],
      ['Airo Cup', '#1f9d55'],
      ['Motion Series', '#111318'],
      ['Tilt to steer', theme.banners.primary],
    ];
    const out: Array<{ x: number; z: number; h: number; text: string; color: string }> = [];
    const n = track.samples.length;
    for (let k = 0; k < 9; k++) {
      const s = (k / 9) * track.length + 37;
      const i = Math.round((s / track.length) * n) % n;
      const c = curvatureAt(track, i);
      const side = c > 0.003 ? -1 : c < -0.003 ? 1 : k % 2 ? 1 : -1;
      const p = track.offsetPoint(s, side * (track.wallDistance + 3.2));
      const [text, color] = texts[k % texts.length];
      const h = track.headingAt(s);
      out.push({ x: p.x, z: p.z, h: side > 0 ? -h : Math.PI - h, text, color });
    }
    return out;
  }, [track, theme]);
  const textures = useMemo(() => items.map((it) => bannerTexture(it.text, it.color, '#ffffff', { width: 768, height: 256 })), [items]);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  return (
    <group>
      {items.map((it, i) => (
        <group key={i} position={[it.x, 0, it.z]} rotation={[0, it.h, 0]}>
          {[-3, 3].map((x, j) => (
            <mesh key={j} position={[x, 1.3, 0]} castShadow>
              <boxGeometry args={[0.14, 2.6, 0.14]} />
              <meshStandardMaterial color="#3a3d45" roughness={0.7} />
            </mesh>
          ))}
          <mesh position={[0, 2.2, 0.03]} castShadow>
            <planeGeometry args={[6.4, 2.1]} />
            <meshStandardMaterial map={textures[i]} roughness={0.6} />
          </mesh>
          <mesh position={[0, 2.2, -0.02]}>
            <boxGeometry args={[6.5, 2.2, 0.06]} />
            <meshStandardMaterial color="#2d3038" roughness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Flags({ track, theme }: { track: TrackModel; theme: KartTheme }) {
  const items = useMemo(() => {
    const out: Array<{ x: number; z: number; color: string }> = [];
    for (let s = 12; s < track.length; s += 23) {
      const side = Math.floor(s / 23) % 2 ? 1 : -1;
      const p = track.offsetPoint(s, side * (track.wallDistance + 1.9));
      out.push({ x: p.x, z: p.z, color: Math.floor(s / 23) % 3 === 0 ? theme.banners.secondary : theme.banners.primary });
    }
    return out;
  }, [track, theme]);
  const flags = useRef<THREE.Mesh[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    flags.current.forEach((f, i) => f && (f.rotation.y = Math.sin(t * 2.2 + i) * 0.35 + 0.5));
  });
  return (
    <group>
      {items.map((it, i) => (
        <group key={i} position={[it.x, 0, it.z]}>
          <mesh position={[0, 1.9, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 3.8, 6]} />
            <meshStandardMaterial color="#e8e8ea" roughness={0.6} />
          </mesh>
          <mesh ref={(m) => m && (flags.current[i] = m)} position={[0, 3.35, 0]}>
            <boxGeometry args={[0.04, 0.8, 1.1]} />
            <meshStandardMaterial color={it.color} roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
