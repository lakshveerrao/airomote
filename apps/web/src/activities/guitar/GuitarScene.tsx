/**
 * Guitar activity scene: a live concert stage seen from the crowd.
 *
 *   truss + PAR fixtures → volumetric beams through haze → guitarist centre stage holding the
 *   selected guitar (strings glow on strums, fret dots follow the chord, the strumming hand
 *   follows Controller 2) → drummer and bassist behind → crowd silhouettes in the foreground.
 *
 * Everything is procedural (no assets) so it works offline and loads instantly. The low
 * quality tier drops shadows, half the beams and half the crowd.
 */
import { useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ControllerId } from '@aero/motion-core';
import { CHORD_VOICINGS, type ChordName, type StrumDirection } from '@aero/music-engine';
import { sceneSettings } from '@/features/activity/sceneQuality';
import { useMotionRef } from '@/store/controllers';
import { guitarModel, type GuitarModel, type GuitarModelId } from './guitars';

export interface GuitarSceneApi {
  chord: ChordName;
  /** strum events queued for the scene */
  strums: Array<{ direction: StrumDirection; velocity: number; times: Array<number | null>; at: number; consumed: boolean; seen?: boolean }>;
  muteAt: number;
}

export function createGuitarSceneApi(): GuitarSceneApi {
  return { chord: 'C', strums: [], muteAt: 0 };
}

/* ------------------------------------------------------------------------------------------ */
/* Shared helpers                                                                              */
/* ------------------------------------------------------------------------------------------ */

const ACCENT = '#c98bff';
const STRING_COUNT = 6;
const STRING_SPACING = 0.075;
const STRING_LEN = 3.2;
const STRING_RADII = [0.011, 0.0095, 0.008, 0.0062, 0.005, 0.0042];

/** Radial soft-disc texture used for light halos and haze sheets. */
function useRadialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 256) {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, inner.replace(/,1\)$/, ',0.55)'));
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [inner, outer, size]);
}

/** Sunburst top: centre colour fading to the edge colour, mapped onto the extruded body via its shape-space UVs. */
function useBurstTexture(center: string, edge: string) {
  return useMemo(() => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size * 0.45, size * 0.5, size * 0.05, size * 0.45, size * 0.5, size * 0.62);
    g.addColorStop(0, center);
    g.addColorStop(0.55, center);
    g.addColorStop(1, edge);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    // shape space spans roughly x ∈ [-1.1, 1.1], y ∈ [-0.9, 0.9]
    t.repeat.set(1 / 2.2, 1 / 1.8);
    t.offset.set(0.5, 0.5);
    return t;
  }, [center, edge]);
}

/** A cylinder between two points; `set(from, to)` re-poses it each frame. */
class LimbPose {
  static readonly up = new THREE.Vector3(0, 1, 0);
  static readonly tmpDir = new THREE.Vector3();
  static readonly tmpQ = new THREE.Quaternion();
  static apply(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
    const dir = LimbPose.tmpDir.subVectors(to, from);
    const len = dir.length();
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.copy(LimbPose.tmpQ.setFromUnitVectors(LimbPose.up, dir.normalize()));
    mesh.scale.set(1, len, 1);
  }
}

function Limb({ from, to, radius = 0.05, color = '#141216', poseRef }: { from: [number, number, number]; to: [number, number, number]; radius?: number; color?: string; poseRef?: MutableRefObject<THREE.Mesh | null> }) {
  return (
    <mesh
      ref={(m) => {
        if (!m) return;
        if (poseRef) poseRef.current = m;
        LimbPose.apply(m, new THREE.Vector3(...from), new THREE.Vector3(...to));
      }}
      castShadow
    >
      <cylinderGeometry args={[radius, radius * 0.85, 1, 10]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Guitar (selected model)                                                                     */
/* ------------------------------------------------------------------------------------------ */

function bodyShape(id: GuitarModelId): THREE.Shape {
  const s = new THREE.Shape();
  switch (id) {
    case 'lespaul':
      s.moveTo(-0.9, 0);
      s.bezierCurveTo(-0.9, 0.7, -0.3, 0.75, 0.0, 0.5);
      s.bezierCurveTo(0.2, 0.38, 0.5, 0.48, 0.75, 0.42);
      s.bezierCurveTo(0.95, 0.36, 0.95, 0.1, 0.8, 0.1);
      s.lineTo(0.8, -0.12);
      s.bezierCurveTo(1.08, -0.18, 1.02, -0.5, 0.72, -0.44);
      s.bezierCurveTo(0.5, -0.46, 0.25, -0.4, 0.05, -0.5);
      s.bezierCurveTo(-0.3, -0.72, -0.9, -0.7, -0.9, 0);
      break;
    case 'strat':
      s.moveTo(-0.85, 0);
      s.bezierCurveTo(-0.85, 0.62, -0.35, 0.7, -0.05, 0.5);
      s.bezierCurveTo(0.15, 0.4, 0.35, 0.45, 0.55, 0.72);
      s.bezierCurveTo(0.75, 0.92, 0.95, 0.6, 0.72, 0.3);
      s.bezierCurveTo(0.62, 0.18, 0.62, -0.15, 0.72, -0.25);
      s.bezierCurveTo(0.92, -0.5, 0.72, -0.72, 0.5, -0.56);
      s.bezierCurveTo(0.35, -0.42, 0.15, -0.4, -0.05, -0.5);
      s.bezierCurveTo(-0.35, -0.7, -0.85, -0.62, -0.85, 0);
      break;
    case 'sg':
      s.moveTo(-0.8, 0);
      s.bezierCurveTo(-0.8, 0.55, -0.4, 0.6, -0.1, 0.5);
      s.bezierCurveTo(0.1, 0.42, 0.3, 0.42, 0.45, 0.55);
      s.bezierCurveTo(0.65, 0.75, 0.88, 0.72, 0.86, 0.55);
      s.bezierCurveTo(0.85, 0.35, 0.6, 0.2, 0.65, 0.12);
      s.lineTo(0.65, -0.12);
      s.bezierCurveTo(0.6, -0.2, 0.85, -0.35, 0.86, -0.55);
      s.bezierCurveTo(0.88, -0.72, 0.65, -0.75, 0.45, -0.55);
      s.bezierCurveTo(0.3, -0.42, 0.1, -0.42, -0.1, -0.5);
      s.bezierCurveTo(-0.4, -0.6, -0.8, -0.55, -0.8, 0);
      break;
    case 'flyingv':
      s.moveTo(0.72, 0.14);
      s.lineTo(0.55, 0.22);
      s.lineTo(-0.95, 0.8);
      s.lineTo(-1.08, 0.62);
      s.lineTo(-0.3, 0.0);
      s.lineTo(-1.08, -0.62);
      s.lineTo(-0.95, -0.8);
      s.lineTo(0.55, -0.22);
      s.lineTo(0.72, -0.14);
      break;
    default:
      s.moveTo(-0.95, 0);
      s.bezierCurveTo(-0.95, 0.62, -0.55, 0.7, -0.3, 0.55);
      s.bezierCurveTo(-0.15, 0.46, 0.05, 0.42, 0.2, 0.5);
      s.bezierCurveTo(0.55, 0.66, 0.9, 0.5, 0.9, 0);
      s.bezierCurveTo(0.9, -0.5, 0.55, -0.66, 0.2, -0.5);
      s.bezierCurveTo(0.05, -0.42, -0.15, -0.46, -0.3, -0.55);
      s.bezierCurveTo(-0.55, -0.7, -0.95, -0.62, -0.95, 0);
      break;
  }
  s.closePath();
  return s;
}

function GuitarBody({ model }: { model: GuitarModel }) {
  const geom = useMemo(() => {
    const s = bodyShape(model.id);
    if (!model.electric) {
      const hole = new THREE.Path();
      hole.absarc(0.22, 0, 0.2, 0, Math.PI * 2, true);
      s.holes.push(hole);
    }
    const depth = model.electric ? 0.16 : 0.22;
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 40 });
    g.translate(0, 0, -depth);
    return g;
  }, [model.id, model.electric]);
  const burst = useBurstTexture(model.color, model.edge);
  const hw = model.hardware === 'gold' ? '#d9b25a' : '#dfe3ec';
  return (
    <group>
      <mesh geometry={geom} castShadow receiveShadow>
        <meshPhysicalMaterial map={burst} roughness={0.22} metalness={0.05} clearcoat={0.9} clearcoatRoughness={0.15} />
      </mesh>
      {model.electric ? (
        <>
          {/* pickups */}
          {[-0.12, 0.28].map((x, i) => (
            <mesh key={i} position={[x, 0, 0.03]}>
              <boxGeometry args={[0.16, 0.5, 0.05]} />
              <meshStandardMaterial color={model.id === 'strat' ? '#f3efe4' : '#0f0f11'} roughness={0.5} metalness={model.id === 'strat' ? 0 : 0.6} />
            </mesh>
          ))}
          {/* bridge + tailpiece */}
          <mesh position={[-0.5, 0, 0.035]}>
            <boxGeometry args={[0.08, 0.56, 0.05]} />
            <meshStandardMaterial color={hw} metalness={1} roughness={0.25} />
          </mesh>
          {/* knobs */}
          {[
            [-0.55, -0.42],
            [-0.7, -0.3],
            [-0.4, -0.5],
          ].map(([x, y], i) => (
            <mesh key={i} position={[x, y, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.045, 0.05, 0.06, 20]} />
              <meshStandardMaterial color={hw} metalness={1} roughness={0.3} />
            </mesh>
          ))}
          {model.pickguard && model.id !== 'flyingv' && (
            <mesh position={[0.05, -0.28, 0.012]} rotation={[0, 0, 0.15]}>
              <planeGeometry args={[0.7, 0.38]} />
              <meshStandardMaterial color={model.pickguard} roughness={0.45} transparent opacity={0.95} />
            </mesh>
          )}
        </>
      ) : (
        <>
          <mesh position={[0.22, 0, -0.12]}>
            <circleGeometry args={[0.2, 40]} />
            <meshStandardMaterial color="#1a0f08" roughness={1} />
          </mesh>
          <mesh position={[0.22, 0, 0.011]}>
            <ringGeometry args={[0.21, 0.26, 48]} />
            <meshStandardMaterial color="#3b2410" roughness={0.6} />
          </mesh>
          <mesh position={[-0.55, 0, 0.03]}>
            <boxGeometry args={[0.14, 0.62, 0.04]} />
            <meshStandardMaterial color="#2a1a10" roughness={0.6} />
          </mesh>
          <mesh position={[0.02, -0.34, 0.012]} rotation={[0, 0, 0.2]}>
            <circleGeometry args={[0.24, 32]} />
            <meshStandardMaterial color={model.pickguard ?? '#1f1a17'} roughness={0.4} transparent opacity={0.9} />
          </mesh>
        </>
      )}
    </group>
  );
}

function Neck({ model }: { model: GuitarModel }) {
  const frets = useMemo(() => Array.from({ length: 12 }, (_, i) => 0.95 + (i + 1) * 0.17), []);
  const hw = model.hardware === 'gold' ? '#d9b25a' : '#dfe3ec';
  const wood = model.id === 'flyingv' ? '#2a1a12' : '#3a2414';
  return (
    <group>
      <mesh position={[1.95, 0, -0.03]} castShadow>
        <boxGeometry args={[2.1, 0.5, 0.09]} />
        <meshStandardMaterial color={wood} roughness={0.6} />
      </mesh>
      <mesh position={[1.95, 0, 0.02]}>
        <boxGeometry args={[2.1, 0.5, 0.012]} />
        <meshStandardMaterial color="#1b1410" roughness={0.5} />
      </mesh>
      {frets.map((x, i) => (
        <mesh key={i} position={[x, 0, 0.03]}>
          <boxGeometry args={[0.012, 0.5, 0.012]} />
          <meshStandardMaterial color="#d8dbe6" metalness={1} roughness={0.25} />
        </mesh>
      ))}
      {[3, 5, 7, 9].map((f) => (
        <mesh key={f} position={[0.95 + f * 0.17 - 0.085, 0, 0.028]}>
          <circleGeometry args={[0.03, 12]} />
          <meshStandardMaterial color="#e9e2cf" roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[3.0, 0, 0.035]}>
        <boxGeometry args={[0.03, 0.5, 0.03]} />
        <meshStandardMaterial color="#f1ead9" roughness={0.5} />
      </mesh>
      <mesh position={[3.35, 0, -0.03]} rotation={[0, 0, model.electric ? 0.06 : 0]}>
        <boxGeometry args={[0.66, model.id === 'strat' ? 0.5 : 0.56, 0.07]} />
        <meshStandardMaterial color={model.id === 'flyingv' ? '#f2f0ea' : wood} roughness={0.6} />
      </mesh>
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh key={i} position={[3.15 + (i % 3) * 0.18, model.id === 'strat' ? 0.3 : i < 3 ? 0.3 : -0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.12, 16]} />
          <meshStandardMaterial color={hw} metalness={1} roughness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function Strings({ api }: { api: MutableRefObject<GuitarSceneApi> }) {
  const refs = useRef<THREE.Mesh[]>([]);
  const amps = useRef(new Float32Array(STRING_COUNT));
  const phase = useRef(new Float32Array(STRING_COUNT));
  const fretDots = useRef<THREE.Mesh[]>([]);
  useFrame((_, dt) => {
    const a = api.current;
    const now = performance.now();
    for (const s of a.strums) {
      if (s.consumed) continue;
      s.consumed = true;
      for (let i = 0; i < STRING_COUNT; i++) if (s.times[i] !== null) amps.current[i] = 0.6 + s.velocity * 1.0;
    }
    if (now - a.muteAt < 100) for (let i = 0; i < STRING_COUNT; i++) amps.current[i] *= 0.5;
    const voicing = CHORD_VOICINGS[a.chord];
    for (let i = 0; i < STRING_COUNT; i++) {
      amps.current[i] *= Math.exp(-dt * 1.6);
      phase.current[i] += dt * (40 + i * 12);
      const m = refs.current[i];
      if (!m) continue;
      const amp = amps.current[i];
      m.position.z = 0.06 + Math.sin(phase.current[i]) * amp * 0.03;
      m.scale.set(1, 1 + amp * 3.5, 1 + amp * 3.5);
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity = amp * 1.2;
      const dot = fretDots.current[i];
      if (dot) {
        const fret = voicing[i];
        dot.visible = fret !== null && fret > 0;
        if (fret) dot.position.x = 0.95 + fret * 0.17 - 0.085;
      }
    }
  });
  return (
    <group>
      {Array.from({ length: STRING_COUNT }).map((_, i) => {
        const y = (i - 2.5) * STRING_SPACING;
        return (
          <group key={i}>
            <mesh ref={(m) => m && (refs.current[i] = m)} position={[STRING_LEN / 2 - 0.55, y, 0.06]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[STRING_RADII[i], STRING_RADII[i], STRING_LEN, 8]} />
              <meshStandardMaterial color="#e9ecf5" metalness={1} roughness={0.25} emissive={ACCENT} emissiveIntensity={0} />
            </mesh>
            <mesh ref={(m) => m && (fretDots.current[i] = m)} position={[1.5, y, 0.08]}>
              <sphereGeometry args={[0.03, 12, 12]} />
              <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={1.2} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Guitarist                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const GUITAR_POS = new THREE.Vector3(0.05, 1.0, 0.3);
const GUITAR_ROT = new THREE.Euler(0.1, -0.5, 0.62);
const GUITAR_SCALE = 0.3;

function Guitarist({ api, model, strumController, fretController }: { api: MutableRefObject<GuitarSceneApi>; model: GuitarModel; strumController: ControllerId | null; fretController: ControllerId | null }) {
  const strumMotion = useMotionRef(strumController ?? 2);
  const fretMotion = useMotionRef(fretController ?? 1);
  const guitar = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const rightUpper = useRef<THREE.Mesh | null>(null);
  const rightFore = useRef<THREE.Mesh | null>(null);
  const leftUpper = useRef<THREE.Mesh | null>(null);
  const leftFore = useRef<THREE.Mesh | null>(null);
  const hand = useRef<THREE.Mesh>(null!);
  const pick = useRef<THREE.Mesh>(null!);

  const strumY = useRef(0);
  const anim = useRef(0);
  const lastDir = useRef<StrumDirection>('down');
  const flash = useRef(0);
  const nod = useRef(0);
  const nodVel = useRef(0);
  const bob = useRef(0);

  const v = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3() }), []);

  useFrame((state, dt) => {
    const a = api.current;
    const t = state.clock.elapsedTime;
    const s = strumController ? strumMotion.current : null;
    const f = fretController ? fretMotion.current : null;

    // strumming hand: follows the controller pitch, sweeps on strums
    let target = 0;
    if (s && s.connected) target = THREE.MathUtils.clamp(-s.relative.pitch / 40, -1, 1) * 0.32;
    for (const st of a.strums) {
      if (st.seen) continue;
      st.seen = true;
      lastDir.current = st.direction;
      anim.current = 1;
      flash.current = 0.4 + st.velocity;
      nodVel.current -= 2.2 + st.velocity * 3;
      bob.current = Math.max(bob.current, 0.4 + st.velocity * 0.6);
    }
    if (anim.current > 0) {
      const sweep = lastDir.current === 'down' ? 1 - anim.current * 2 : -(1 - anim.current * 2);
      target = -sweep * 0.3;
      anim.current = Math.max(0, anim.current - dt * 6);
    }
    flash.current = Math.max(0, flash.current - dt * 3);
    strumY.current += (target - strumY.current) * Math.min(1, dt * 18);

    // head bang: damped spring + idle groove
    const k = 60;
    const c = 8;
    nodVel.current += (-k * nod.current - c * nodVel.current) * dt;
    nod.current += nodVel.current * dt;
    bob.current = Math.max(0, bob.current - dt * 1.4);
    const groove = Math.sin(t * 2.4) * 0.03 + Math.sin(t * 0.7) * 0.02;
    if (head.current) head.current.rotation.x = nod.current * 0.35 + groove * 2 + 0.12;
    if (body.current) {
      body.current.position.y = -Math.abs(Math.sin(t * 2.4)) * 0.025 - bob.current * 0.04;
      body.current.rotation.z = Math.sin(t * 0.6) * 0.03;
      body.current.rotation.y = Math.sin(t * 0.35) * 0.06;
    }

    // guitar: neck tilts slightly with the fret hand
    if (guitar.current) {
      let roll = 0;
      let pitch = 0;
      if (f && f.connected) {
        roll = THREE.MathUtils.clamp(f.relative.roll / 90, -1, 1) * 0.12;
        pitch = THREE.MathUtils.clamp(f.relative.pitch / 90, -1, 1) * 0.1;
      }
      guitar.current.rotation.set(GUITAR_ROT.x + pitch, GUITAR_ROT.y, GUITAR_ROT.z + roll + Math.sin(t * 0.6) * 0.015);
      guitar.current.updateMatrixWorld();
    }

    // arms follow the guitar in world space
    if (guitar.current && body.current) {
      const strumLocal = v.a.set(-0.25, strumY.current, 0.2);
      const handWorld = guitar.current.localToWorld(strumLocal);
      body.current.worldToLocal(handWorld);
      const shoulderR = v.b.set(0.26, 1.42, 0.05);
      const elbowR = v.c.copy(shoulderR).lerp(handWorld, 0.5).add(v.d.set(0.18, -0.02, 0.12));
      if (rightUpper.current) LimbPose.apply(rightUpper.current, shoulderR, elbowR);
      if (rightFore.current) LimbPose.apply(rightFore.current, elbowR, handWorld);
      hand.current.position.copy(handWorld);
      pick.current.scale.setScalar(1 + flash.current * 0.2);
      (pick.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + flash.current;

      const fretLocal = v.a.set(2.0, 0.05, 0.12);
      const fretWorld = guitar.current.localToWorld(fretLocal);
      body.current.worldToLocal(fretWorld);
      const shoulderL = v.b.set(-0.26, 1.42, 0.05);
      const elbowL = v.c.copy(shoulderL).lerp(fretWorld, 0.45).add(v.d.set(-0.12, -0.12, 0.05));
      if (leftUpper.current) LimbPose.apply(leftUpper.current, shoulderL, elbowL);
      if (leftFore.current) LimbPose.apply(leftFore.current, elbowL, fretWorld);
    }
  });

  const skin = '#5c3a27';
  const cloth = '#1b1a1f';
  const jacket = '#4c4238';
  return (
    <group position={[0, 0, 0.4]}>
      <group ref={body}>
        {/* legs */}
        <mesh position={[-0.13, 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.085, 0.1, 0.9, 12]} />
          <meshStandardMaterial color={cloth} roughness={0.95} />
        </mesh>
        <mesh position={[0.15, 0.45, 0.02]} rotation={[0, 0, -0.08]} castShadow>
          <cylinderGeometry args={[0.085, 0.1, 0.9, 12]} />
          <meshStandardMaterial color={cloth} roughness={0.95} />
        </mesh>
        {/* boots */}
        {[-0.13, 0.17].map((x, i) => (
          <mesh key={i} position={[x, 0.05, 0.05]}>
            <boxGeometry args={[0.16, 0.1, 0.28]} />
            <meshStandardMaterial color="#0d0b0c" roughness={0.8} />
          </mesh>
        ))}
        {/* torso + jacket */}
        <mesh position={[0, 1.15, 0]} castShadow>
          <capsuleGeometry args={[0.2, 0.42, 6, 14]} />
          <meshStandardMaterial color={cloth} roughness={0.9} />
        </mesh>
        <mesh position={[-0.2, 1.17, 0.02]} rotation={[0, 0, 0.05]} castShadow>
          <boxGeometry args={[0.16, 0.6, 0.34]} />
          <meshStandardMaterial color={jacket} roughness={0.95} />
        </mesh>
        <mesh position={[0.2, 1.17, 0.02]} rotation={[0, 0, -0.05]} castShadow>
          <boxGeometry args={[0.16, 0.6, 0.34]} />
          <meshStandardMaterial color={jacket} roughness={0.95} />
        </mesh>
        {/* arms (posed each frame) */}
        <Limb from={[0.26, 1.42, 0.05]} to={[0.45, 1.1, 0.3]} radius={0.055} color={jacket} poseRef={rightUpper} />
        <Limb from={[0.45, 1.1, 0.3]} to={[0.2, 1.0, 0.55]} radius={0.038} color={jacket} poseRef={rightFore} />
        <Limb from={[-0.26, 1.42, 0.05]} to={[-0.5, 1.2, 0.2]} radius={0.055} color={jacket} poseRef={leftUpper} />
        <Limb from={[-0.5, 1.2, 0.2]} to={[-0.6, 1.35, 0.5]} radius={0.038} color={jacket} poseRef={leftFore} />
        <mesh ref={hand}>
          <sphereGeometry args={[0.042, 12, 12]} />
          <meshStandardMaterial color={skin} roughness={0.9} />
        </mesh>
        {/* head + curly hair */}
        <group ref={head} position={[0, 1.66, 0]}>
          <mesh position={[0, 0.12, 0.02]} castShadow>
            <sphereGeometry args={[0.13, 20, 20]} />
            <meshStandardMaterial color={skin} roughness={0.85} />
          </mesh>
          {[
            [0, 0.24, -0.02, 0.15],
            [-0.12, 0.17, 0, 0.11],
            [0.12, 0.17, 0, 0.11],
            [-0.1, 0.05, -0.06, 0.1],
            [0.1, 0.05, -0.06, 0.1],
            [0, 0.1, -0.11, 0.12],
            [-0.15, 0.1, 0.05, 0.08],
            [0.15, 0.1, 0.05, 0.08],
            [-0.06, 0.28, 0.08, 0.08],
            [0.07, 0.28, 0.07, 0.08],
          ].map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]}>
              <sphereGeometry args={[r, 12, 12]} />
              <meshStandardMaterial color="#0d0908" roughness={1} />
            </mesh>
          ))}
        </group>
        {/* strap */}
        <mesh position={[0.02, 1.25, 0.08]} rotation={[0, 0, 0.9]}>
          <boxGeometry args={[0.07, 0.9, 0.02]} />
          <meshStandardMaterial color="#1a1412" roughness={1} />
        </mesh>
        {/* guitar */}
        <group ref={guitar} position={GUITAR_POS} rotation={GUITAR_ROT} scale={GUITAR_SCALE}>
          <GuitarBody model={model} />
          <Neck model={model} />
          <Strings api={api} />
          <mesh ref={pick} position={[-0.25, 0, 0.22]} rotation={[0, 0, Math.PI]}>
            <coneGeometry args={[0.07, 0.14, 3]} />
            <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.7} roughness={0.35} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Band: drummer + bassist                                                                     */
/* ------------------------------------------------------------------------------------------ */

function Drummer({ api }: { api: MutableRefObject<GuitarSceneApi> }) {
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const energy = useRef(0);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const a = api.current;
    const recent = a.strums.length ? performance.now() - a.strums[a.strums.length - 1].at : 1e9;
    energy.current += ((recent < 1500 ? 1 : 0.35) - energy.current) * Math.min(1, dt * 2);
    const e = energy.current;
    armL.current.rotation.x = -0.6 + Math.max(0, Math.sin(t * 8)) * 0.7 * e;
    armR.current.rotation.x = -0.5 + Math.max(0, Math.sin(t * 8 + Math.PI)) * 0.8 * e;
    head.current.rotation.x = Math.sin(t * 4) * 0.08 * e;
  });
  const dark = '#0e0b0c';
  const chrome = '#cfd3dc';
  const gold = '#d9b25a';
  const Cymbal = ({ p, r }: { p: [number, number, number]; r: number }) => (
    <group position={p}>
      <mesh rotation={[0.15, 0, 0.05]}>
        <cylinderGeometry args={[r, r, 0.012, 32]} />
        <meshStandardMaterial color={gold} metalness={1} roughness={0.28} />
      </mesh>
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 1.1, 8]} />
        <meshStandardMaterial color={chrome} metalness={1} roughness={0.3} />
      </mesh>
    </group>
  );
  const Drum = ({ p, r, h, rot = [0, 0, 0] as [number, number, number] }: { p: [number, number, number]; r: number; h: number; rot?: [number, number, number] }) => (
    <group position={p} rotation={rot}>
      <mesh castShadow>
        <cylinderGeometry args={[r, r, h, 28]} />
        <meshStandardMaterial color="#5a1a1e" roughness={0.3} metalness={0.2} />
      </mesh>
      <mesh position={[0, h / 2 + 0.004, 0]}>
        <cylinderGeometry args={[r * 0.97, r * 0.97, 0.008, 28]} />
        <meshStandardMaterial color="#ded8cc" roughness={0.9} />
      </mesh>
    </group>
  );
  return (
    <group position={[1.7, 0, -2.3]}>
      {/* riser */}
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[2.8, 0.3, 2.2]} />
        <meshStandardMaterial color="#141110" roughness={0.9} />
      </mesh>
      <group position={[0, 0.3, 0]}>
        <Drum p={[0, 0.34, 0.35]} r={0.34} h={0.42} rot={[Math.PI / 2, 0, 0]} />
        <Drum p={[-0.42, 0.78, 0.35]} r={0.19} h={0.14} />
        <Drum p={[-0.18, 1.0, -0.05]} r={0.16} h={0.22} rot={[0.35, 0, 0]} />
        <Drum p={[0.2, 1.0, -0.05]} r={0.17} h={0.24} rot={[0.35, 0, 0]} />
        <Drum p={[0.62, 0.62, 0.4]} r={0.21} h={0.34} />
        <Cymbal p={[-0.72, 1.45, -0.15]} r={0.26} />
        <Cymbal p={[0.78, 1.5, -0.2]} r={0.3} />
        <Cymbal p={[-0.7, 1.05, 0.5]} r={0.19} />
        {/* drummer */}
        <group position={[0, 0, -0.6]}>
          <mesh position={[0, 0.85, 0]}>
            <capsuleGeometry args={[0.19, 0.4, 6, 12]} />
            <meshStandardMaterial color={dark} roughness={1} />
          </mesh>
          <group ref={head} position={[0, 1.25, 0]}>
            <mesh>
              <sphereGeometry args={[0.13, 16, 16]} />
              <meshStandardMaterial color={dark} roughness={1} />
            </mesh>
            <mesh position={[0, -0.12, -0.05]}>
              <capsuleGeometry args={[0.12, 0.3, 4, 10]} />
              <meshStandardMaterial color={dark} roughness={1} />
            </mesh>
          </group>
          <group ref={armL} position={[-0.22, 1.1, 0.05]}>
            <mesh position={[0, 0, 0.25]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.045, 0.04, 0.5, 8]} />
              <meshStandardMaterial color={dark} roughness={1} />
            </mesh>
            <mesh position={[0, 0.05, 0.6]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.008, 0.008, 0.4, 6]} />
              <meshStandardMaterial color="#e8dcc0" roughness={0.8} />
            </mesh>
          </group>
          <group ref={armR} position={[0.22, 1.1, 0.05]}>
            <mesh position={[0, 0, 0.25]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.045, 0.04, 0.5, 8]} />
              <meshStandardMaterial color={dark} roughness={1} />
            </mesh>
            <mesh position={[0, 0.05, 0.6]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.008, 0.008, 0.4, 6]} />
              <meshStandardMaterial color="#e8dcc0" roughness={0.8} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

function Bassist() {
  const g = useRef<THREE.Group>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    g.current.rotation.z = Math.sin(t * 1.2) * 0.05;
    g.current.position.y = -Math.abs(Math.sin(t * 1.2)) * 0.03;
  });
  const dark = '#100d0e';
  return (
    <group position={[-2.3, 0, -0.9]} rotation={[0, 0.35, 0]}>
      <group ref={g}>
        <mesh position={[-0.11, 0.45, 0]}>
          <cylinderGeometry args={[0.08, 0.09, 0.9, 10]} />
          <meshStandardMaterial color={dark} roughness={1} />
        </mesh>
        <mesh position={[0.11, 0.45, 0]}>
          <cylinderGeometry args={[0.08, 0.09, 0.9, 10]} />
          <meshStandardMaterial color={dark} roughness={1} />
        </mesh>
        <mesh position={[0, 1.18, 0]}>
          <capsuleGeometry args={[0.2, 0.45, 6, 12]} />
          <meshStandardMaterial color="#2a2326" roughness={1} />
        </mesh>
        <mesh position={[0, 1.72, 0]}>
          <sphereGeometry args={[0.13, 16, 16]} />
          <meshStandardMaterial color={dark} roughness={1} />
        </mesh>
        <mesh position={[0, 1.8, -0.02]}>
          <sphereGeometry args={[0.15, 12, 12]} />
          <meshStandardMaterial color="#080607" roughness={1} />
        </mesh>
        {/* bass */}
        <group position={[0.05, 1.0, 0.25]} rotation={[0.1, -0.4, 0.55]} scale={0.3}>
          <mesh>
            <capsuleGeometry args={[0.55, 0.6, 4, 16]} />
            <meshStandardMaterial color="#1a1417" roughness={0.4} />
          </mesh>
          <mesh position={[1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[0.36, 2.6, 0.08]} />
            <meshStandardMaterial color="#2a1a12" roughness={0.7} />
          </mesh>
        </group>
      </group>
      {/* mic stand */}
      <group position={[0.6, 0, 0.6]}>
        <mesh position={[0, 0.85, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 1.7, 8]} />
          <meshStandardMaterial color="#9aa0ab" metalness={1} roughness={0.35} />
        </mesh>
        <mesh position={[0, 1.7, -0.15]} rotation={[0.6, 0, 0]}>
          <capsuleGeometry args={[0.03, 0.12, 4, 10]} />
          <meshStandardMaterial color="#2b2b30" metalness={0.8} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Rig: truss, fixtures, beams, haze                                                           */
/* ------------------------------------------------------------------------------------------ */

function Truss({ z, y = 5.2, length = 13 }: { z: number; y?: number; length?: number }) {
  const braces = useMemo(() => {
    const n = Math.floor(length / 0.5);
    return Array.from({ length: n }, (_, i) => ({ x: -length / 2 + 0.25 + i * 0.5, s: i % 2 ? 1 : -1 }));
  }, [length]);
  const mat = <meshStandardMaterial color="#3d4047" metalness={0.85} roughness={0.4} />;
  return (
    <group position={[0, y, z]}>
      {[
        [0, 0.22, 0],
        [0, -0.2, 0.24],
        [0, -0.2, -0.24],
      ].map(([x, yy, zz], i) => (
        <mesh key={i} position={[x, yy, zz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.028, 0.028, length, 8]} />
          {mat}
        </mesh>
      ))}
      {braces.map((b, i) => (
        <group key={i} position={[b.x, 0, 0]}>
          <mesh rotation={[0, 0, b.s * 0.9]} position={[0, 0, 0.24]}>
            <cylinderGeometry args={[0.014, 0.014, 0.55, 6]} />
            {mat}
          </mesh>
          <mesh rotation={[0, 0, -b.s * 0.9]} position={[0, 0, -0.24]}>
            <cylinderGeometry args={[0.014, 0.014, 0.55, 6]} />
            {mat}
          </mesh>
        </group>
      ))}
    </group>
  );
}

const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float along = pow(vUv.y, 1.4);                        // bright at the fixture, fades down the beam
    float rim = abs(dot(normalize(vNormal), normalize(vView)));
    float body = smoothstep(0.0, 0.75, rim);               // soft edges, denser core
    float dust = 0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 2.0) * sin(vUv.x * 30.0 + uTime);
    float a = along * body * dust * uIntensity * 1.8;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

interface BeamSpec {
  x: number;
  z: number;
  color: string;
  /** static aim: rotation around x (forward/back) and z (left/right) */
  rx: number;
  rz: number;
  swayAmp: number;
  swayHz: number;
  phase: number;
  length: number;
  radius: number;
  intensity: number;
}

function Beam({ spec, y, halo }: { spec: BeamSpec; y: number; halo: THREE.Texture }) {
  const g = useRef<THREE.Group>(null!);
  const mat = useRef<THREE.ShaderMaterial>(null!);
  const uniforms = useMemo(() => ({ uColor: { value: new THREE.Color(spec.color) }, uIntensity: { value: spec.intensity }, uTime: { value: 0 } }), [spec.color, spec.intensity]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    g.current.rotation.z = spec.rz + Math.sin(t * spec.swayHz * Math.PI * 2 + spec.phase) * spec.swayAmp;
    g.current.rotation.x = spec.rx + Math.cos(t * spec.swayHz * 0.7 * Math.PI * 2 + spec.phase) * spec.swayAmp * 0.5;
    uniforms.uTime.value = t;
    uniforms.uIntensity.value = spec.intensity * (0.92 + 0.08 * Math.sin(t * 9 + spec.phase));
  });
  return (
    <group position={[spec.x, y, spec.z]} ref={g} rotation={[spec.rx, 0, spec.rz]}>
      {/* fixture */}
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.1, 0.13, 0.26, 16]} />
        <meshStandardMaterial color="#1a1b1f" metalness={0.8} roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.11, 20]} />
        <meshBasicMaterial color={spec.color} />
      </mesh>
      <sprite position={[0, -0.05, 0]} scale={[1.1, 1.1, 1]}>
        <spriteMaterial map={halo} color={spec.color} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      {/* volumetric cone: apex at the fixture, opening downward */}
      <mesh position={[0, -spec.length / 2, 0]}>
        <coneGeometry args={[spec.radius, spec.length, 28, 1, true]} />
        <shaderMaterial ref={mat} vertexShader={BEAM_VERT} fragmentShader={BEAM_FRAG} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

const ORANGE = '#ff8a2a';
const AMBER = '#ffb45a';
const BLUE = '#6cc6ff';
const WHITE = '#f6f0ff';

const BEAMS_BACK: BeamSpec[] = [
  { x: -4.6, z: -3.4, color: ORANGE, rx: 0.55, rz: -0.55, swayAmp: 0.06, swayHz: 0.11, phase: 0.0, length: 9, radius: 1.4, intensity: 0.55 },
  { x: -2.4, z: -3.4, color: AMBER, rx: 0.5, rz: -0.22, swayAmp: 0.05, swayHz: 0.09, phase: 1.1, length: 9, radius: 1.3, intensity: 0.5 },
  { x: -0.6, z: -3.4, color: BLUE, rx: 0.6, rz: 0.08, swayAmp: 0.07, swayHz: 0.13, phase: 2.0, length: 9.5, radius: 1.2, intensity: 0.5 },
  { x: 1.4, z: -3.4, color: ORANGE, rx: 0.5, rz: 0.2, swayAmp: 0.05, swayHz: 0.1, phase: 2.9, length: 9, radius: 1.3, intensity: 0.5 },
  { x: 3.6, z: -3.4, color: AMBER, rx: 0.55, rz: 0.5, swayAmp: 0.06, swayHz: 0.12, phase: 3.7, length: 9, radius: 1.4, intensity: 0.55 },
  { x: 5.4, z: -3.4, color: WHITE, rx: 0.45, rz: 0.75, swayAmp: 0.04, swayHz: 0.08, phase: 4.6, length: 8, radius: 1.0, intensity: 0.35 },
];
const BEAMS_MID: BeamSpec[] = [
  { x: -3.4, z: -1.2, color: BLUE, rx: 0.2, rz: -0.32, swayAmp: 0.05, swayHz: 0.1, phase: 0.6, length: 8, radius: 1.1, intensity: 0.42 },
  { x: 0.4, z: -1.2, color: WHITE, rx: 0.25, rz: 0.0, swayAmp: 0.03, swayHz: 0.07, phase: 1.9, length: 8, radius: 0.9, intensity: 0.3 },
  { x: 3.8, z: -1.2, color: ORANGE, rx: 0.2, rz: 0.36, swayAmp: 0.05, swayHz: 0.11, phase: 3.3, length: 8, radius: 1.1, intensity: 0.42 },
];

/** Multi-LED wash fixture (the dotted discs in the rig). */
function LedPar({ position, color }: { position: [number, number, number]; color: string }) {
  const dots = useMemo(() => {
    const out: [number, number][] = [[0, 0]];
    for (let i = 0; i < 6; i++) out.push([Math.cos((i / 6) * Math.PI * 2) * 0.075, Math.sin((i / 6) * Math.PI * 2) * 0.075]);
    for (let i = 0; i < 12; i++) out.push([Math.cos((i / 12) * Math.PI * 2 + 0.26) * 0.15, Math.sin((i / 12) * Math.PI * 2 + 0.26) * 0.15]);
    return out;
  }, []);
  return (
    <group position={position} rotation={[0.9, 0, 0]}>
      <mesh>
        <cylinderGeometry args={[0.2, 0.22, 0.14, 20]} />
        <meshStandardMaterial color="#17181c" metalness={0.8} roughness={0.5} />
      </mesh>
      {dots.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.075, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.02, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Haze({ count, tex }: { count: number; tex: THREE.Texture }) {
  const refs = useRef<THREE.Mesh[]>([]);
  const sheets = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: -4 + (i % 4) * 2.7 + (i % 2) * 0.8,
        y: 1.6 + (i % 3) * 1.1,
        z: -3.2 + (i % 5) * 1.0,
        w: 6 + (i % 3) * 2,
        h: 4 + (i % 2) * 1.5,
        speed: 0.05 + (i % 3) * 0.03,
        phase: i * 1.7,
        color: i % 3 === 1 ? '#7fb8ff' : '#ff9b5a',
        opacity: 0.11 + (i % 2) * 0.05,
      })),
    [count],
  );
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    sheets.forEach((s, i) => {
      const m = refs.current[i];
      if (!m) return;
      m.position.x = s.x + Math.sin(t * s.speed + s.phase) * 1.4;
      m.position.y = s.y + Math.sin(t * s.speed * 0.6 + s.phase) * 0.3;
      (m.material as THREE.MeshBasicMaterial).opacity = s.opacity * (0.8 + 0.2 * Math.sin(t * 0.3 + s.phase));
    });
  });
  return (
    <group>
      {sheets.map((s, i) => (
        <mesh key={i} ref={(m) => m && (refs.current[i] = m)} position={[s.x, s.y, s.z]}>
          <planeGeometry args={[s.w, s.h]} />
          <meshBasicMaterial map={tex} color={s.color} transparent opacity={s.opacity} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Crowd                                                                                       */
/* ------------------------------------------------------------------------------------------ */

function Crowd({ count, api }: { count: number; api: MutableRefObject<GuitarSceneApi> }) {
  const heads = useRef<THREE.InstancedMesh>(null!);
  const bodies = useRef<THREE.InstancedMesh>(null!);
  const arms = useRef<THREE.InstancedMesh>(null!);
  const hands = useRef<THREE.InstancedMesh>(null!);
  const people = useMemo(() => {
    const rnd = (i: number, k: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: count }, (_, i) => {
      const row = i % 4;
      return {
        x: -5.5 + rnd(i, 1) * 11,
        z: 2.5 + row * 0.42 + rnd(i, 2) * 0.3,
        h: 0.95 + rnd(i, 3) * 0.45, // head height above crowd floor
        bobHz: 1.1 + rnd(i, 4) * 0.5,
        phase: rnd(i, 5) * Math.PI * 2,
        arm: rnd(i, 6) < 0.32,
        armSide: rnd(i, 7) < 0.5 ? -1 : 1,
        scale: 0.85 + rnd(i, 8) * 0.3,
      };
    });
  }, [count]);
  const armPeople = useMemo(() => people.filter((p) => p.arm), [people]);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  const euler = useMemo(() => new THREE.Euler(), []);
  const energy = useRef(0.4);
  const FLOOR = -0.75;
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const a = api.current;
    const last = a.strums.length ? a.strums[a.strums.length - 1].at : 0;
    const recent = performance.now() - last < 2000;
    energy.current += ((recent ? 1 : 0.4) - energy.current) * Math.min(1, dt * 1.5);
    const e = energy.current;
    people.forEach((p, i) => {
      const bob = Math.abs(Math.sin(t * p.bobHz * Math.PI + p.phase)) * 0.09 * e;
      const y = FLOOR + p.h + bob;
      quat.identity();
      pos.set(p.x, y, p.z);
      scl.setScalar(p.scale);
      m4.compose(pos, quat, scl);
      heads.current.setMatrixAt(i, m4);
      pos.set(p.x, y - 0.32 * p.scale, p.z);
      scl.set(p.scale * 1.15, p.scale, p.scale);
      m4.compose(pos, quat, scl);
      bodies.current.setMatrixAt(i, m4);
    });
    armPeople.forEach((p, i) => {
      const bob = Math.abs(Math.sin(t * p.bobHz * Math.PI + p.phase)) * 0.09 * e;
      const wave = Math.sin(t * 2.2 + p.phase) * 0.18;
      const y = FLOOR + p.h + bob;
      const tilt = p.armSide * (0.28 + wave);
      euler.set(0.1, 0, tilt);
      quat.setFromEuler(euler);
      const ax = p.x + p.armSide * 0.22 * p.scale;
      pos.set(ax, y + 0.15 * p.scale, p.z);
      scl.setScalar(p.scale);
      m4.compose(pos, quat, scl);
      arms.current.setMatrixAt(i, m4);
      // hand at the top of the arm
      pos.set(ax - Math.sin(tilt) * 0.37 * p.scale, y + 0.15 * p.scale + Math.cos(tilt) * 0.37 * p.scale, p.z + 0.05);
      m4.compose(pos, quat, scl);
      hands.current.setMatrixAt(i, m4);
    });
    heads.current.instanceMatrix.needsUpdate = true;
    bodies.current.instanceMatrix.needsUpdate = true;
    arms.current.instanceMatrix.needsUpdate = true;
    hands.current.instanceMatrix.needsUpdate = true;
  });
  const silhouette = <meshStandardMaterial color="#070508" roughness={1} />;
  return (
    <group>
      <instancedMesh ref={heads} args={[undefined, undefined, people.length]} frustumCulled={false}>
        <sphereGeometry args={[0.15, 14, 14]} />
        {silhouette}
      </instancedMesh>
      <instancedMesh ref={bodies} args={[undefined, undefined, people.length]} frustumCulled={false}>
        <capsuleGeometry args={[0.24, 0.5, 4, 12]} />
        {silhouette}
      </instancedMesh>
      <instancedMesh ref={arms} args={[undefined, undefined, Math.max(1, armPeople.length)]} frustumCulled={false}>
        <cylinderGeometry args={[0.04, 0.05, 0.7, 8]} />
        {silhouette}
      </instancedMesh>
      <instancedMesh ref={hands} args={[undefined, undefined, Math.max(1, armPeople.length)]} frustumCulled={false}>
        <boxGeometry args={[0.12, 0.16, 0.06]} />
        {silhouette}
      </instancedMesh>
      {/* crowd floor */}
      <mesh position={[0, FLOOR, 5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 12]} />
        <meshStandardMaterial color="#050405" roughness={1} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Stage + camera                                                                              */
/* ------------------------------------------------------------------------------------------ */

function Stage({ shadows }: { shadows: boolean }) {
  return (
    <group>
      <mesh position={[0, 0, -1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <planeGeometry args={[16, 8]} />
        <meshStandardMaterial color="#17120f" roughness={0.55} metalness={0.15} />
      </mesh>
      {/* stage lip */}
      <mesh position={[0, -0.4, 3.0]}>
        <boxGeometry args={[16, 0.8, 0.12]} />
        <meshStandardMaterial color="#0b0908" roughness={1} />
      </mesh>
      {/* backdrop */}
      <mesh position={[0, 3.5, -5]}>
        <planeGeometry args={[20, 9]} />
        <meshStandardMaterial color="#040302" roughness={1} />
      </mesh>
      {/* towers */}
      {[-6.6, 6.6].map((x) => (
        <mesh key={x} position={[x, 2.7, -2.2]}>
          <boxGeometry args={[0.3, 5.6, 0.3]} />
          <meshStandardMaterial color="#2c2e34" metalness={0.8} roughness={0.45} />
        </mesh>
      ))}
      {/* amps + monitors */}
      {[
        [-1.5, -1.8, 0.75, 0.62],
        [2.9, -1.3, 0.7, 0.55],
        [-3.6, -0.4, 0.8, 0.9],
      ].map(([x, z, w, h], i) => (
        <group key={i} position={[x, h / 2, z]}>
          <mesh castShadow={shadows}>
            <boxGeometry args={[w, h, 0.42]} />
            <meshStandardMaterial color="#141214" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0, 0.215]}>
            <planeGeometry args={[w * 0.9, h * 0.8]} />
            <meshStandardMaterial color="#2a2426" roughness={1} />
          </mesh>
          <mesh position={[w * 0.4, h * 0.42, 0.22]}>
            <circleGeometry args={[0.012, 8]} />
            <meshBasicMaterial color="#ff3030" />
          </mesh>
        </group>
      ))}
      {[-0.9, 0.9, 2.2].map((x, i) => (
        <mesh key={i} position={[x, 0.16, 2.1]} rotation={[-0.5, 0, 0]}>
          <boxGeometry args={[0.6, 0.32, 0.4]} />
          <meshStandardMaterial color="#121012" roughness={1} />
        </mesh>
      ))}
      {/* front mic stand */}
      <group position={[0.55, 0, 1.15]}>
        <mesh position={[0, 0.9, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 1.8, 8]} />
          <meshStandardMaterial color="#9aa0ab" metalness={1} roughness={0.35} />
        </mesh>
        <mesh position={[0, 1.78, -0.12]} rotation={[0.5, 0, 0]}>
          <capsuleGeometry args={[0.03, 0.12, 4, 10]} />
          <meshStandardMaterial color="#2b2b30" metalness={0.8} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

function CameraRig() {
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const cam = state.camera;
    cam.position.x = Math.sin(t * 0.18) * 0.12;
    cam.position.y = 1.35 + Math.sin(t * 0.9) * 0.02;
    cam.lookAt(0.1, 1.45 + Math.sin(t * 0.25) * 0.03, -0.6);
  });
  return null;
}

function Rig({ beams, hazeCount }: { beams: BeamSpec[]; hazeCount: number }) {
  const halo = useRadialTexture();
  return (
    <group>
      <Truss z={-3.4} />
      <Truss z={-1.2} />
      <Truss z={1.4} y={5.0} />
      {beams.map((b, i) => (
        <Beam key={i} spec={b} y={5.0} halo={halo} />
      ))}
      {[
        [-5.2, 4.95, -1.2, ORANGE],
        [-1.6, 4.95, -3.4, '#ff5a3a'],
        [2.6, 4.95, -3.4, ORANGE],
        [4.8, 4.95, -1.2, '#ffb060'],
        [-2.2, 4.75, 1.4, BLUE],
        [2.2, 4.75, 1.4, ORANGE],
      ].map(([x, y, z, c], i) => (
        <LedPar key={i} position={[x as number, y as number, z as number]} color={c as string} />
      ))}
      <Haze count={hazeCount} tex={halo} />
      {/* soft washes on the backdrop: warm centre, cool left */}
      <mesh position={[0.5, 2.6, -4.7]}>
        <planeGeometry args={[20, 11]} />
        <meshBasicMaterial map={halo} color="#ff6a1a" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[-4.5, 3.2, -4.6]}>
        <planeGeometry args={[9, 7]} />
        <meshBasicMaterial map={halo} color="#3f8fff" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function GuitarScene({ api, strumController, fretController, model }: { api: MutableRefObject<GuitarSceneApi>; strumController: ControllerId | null; fretController: ControllerId | null; model: GuitarModelId }) {
  const quality = sceneSettings();
  const high = quality.shadows;
  const beams = high ? [...BEAMS_BACK, ...BEAMS_MID] : [BEAMS_BACK[0], BEAMS_BACK[2], BEAMS_BACK[4], BEAMS_MID[1]];
  const m = guitarModel(model);
  return (
    <Canvas shadows={quality.shadows} camera={{ position: [0, 1.35, 5.3], fov: 44, near: 0.1, far: 60 }} dpr={quality.dpr} gl={{ antialias: quality.antialias, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}>
      <color attach="background" args={['#0a0604']} />
      <fogExp2 attach="fog" args={['#22110a', 0.046]} />
      <CameraRig />
      <ambientLight intensity={0.35} color="#ffb27a" />
      <hemisphereLight args={['#ff9a55', '#140a06', 0.5]} />
      {/* warm back light through the haze, blue key from the front-left, dim fill on the player */}
      <spotLight position={[-3, 5, -3]} angle={0.7} penumbra={0.9} intensity={160} color="#ff8f3a" castShadow={high} shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]} />
      <spotLight position={[3.5, 5, -3]} angle={0.7} penumbra={0.9} intensity={140} color="#ffa35a" />
      <spotLight position={[-4, 4.6, 1.5]} angle={0.5} penumbra={0.9} intensity={90} color="#7cc4ff" />
      <pointLight position={[0.8, 2.2, 2.4]} intensity={9} color="#ffd9b0" distance={6} decay={2} />
      <pointLight position={[0.2, 1.2, 1.4]} intensity={4} color={ACCENT} distance={4} decay={2} />

      <Stage shadows={high} />
      <Rig beams={beams} hazeCount={high ? 8 : 4} />
      <Guitarist api={api} model={m} strumController={strumController} fretController={fretController} />
      <Drummer api={api} />
      <Bassist />
      <Crowd count={high ? 72 : 36} api={api} />
    </Canvas>
  );
}
