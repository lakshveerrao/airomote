/**
 * Drums scene — a drummer's-eye view from behind the kit, looking out over an arena crowd
 * under a purple/white light rig, in the spirit of the reference photo.
 *
 * The kit, the two sticks and the hit/target logic are unchanged; only the world around them
 * (stage, truss beams, haze, crowd, PA) and the camera framing are new. Fully procedural.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { sceneSettings } from '@/features/activity/sceneQuality';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ControllerId, ControllerMotionState } from '@aero/motion-core';
import type { DrumId } from '@aero/music-engine';
import { useMotionRef } from '@/store/controllers';

export type StickRole = 'stick1' | 'stick2';
export const STICK_COLORS: Record<StickRole, string> = { stick1: '#9b7dff', stick2: '#3ddc97' };

/** Imperative bridge from the activity to the scene (no React state per hit). */
export interface DrumSceneApi {
  target: Record<StickRole, DrumId | null>;
  /** monotonically increasing hit queue consumed by the scene */
  hits: Array<{ drum: DrumId; intensity: number; role: StickRole; t: number }>;
  stickDip: Record<StickRole, number>;
  /** host-time (ms) of the most recent hit — drives crowd/light energy */
  lastHitAt: number;
}

export function createDrumSceneApi(): DrumSceneApi {
  return { target: { stick1: 'snare', stick2: 'tom1' }, hits: [], stickDip: { stick1: 0, stick2: 0 }, lastHitAt: 0 };
}

interface DrumSpec {
  id: DrumId;
  label: string;
  pos: [number, number, number];
  radius: number;
  depth: number;
  kind: 'drum' | 'cymbal' | 'kick';
  tilt?: [number, number, number];
  color: string;
}

export const DRUM_SPECS: DrumSpec[] = [
  { id: 'kick', label: 'Kick', pos: [0.05, 0.42, 0.25], radius: 0.42, depth: 0.42, kind: 'kick', color: '#1c1f2b' },
  { id: 'snare', label: 'Snare', pos: [-0.62, 0.78, 0.62], radius: 0.27, depth: 0.16, kind: 'drum', tilt: [0.08, 0, 0.06], color: '#e6e9f2' },
  { id: 'hihat', label: 'Hi-hat', pos: [-1.22, 1.02, 0.28], radius: 0.28, depth: 0.02, kind: 'cymbal', tilt: [0.12, 0, 0.1], color: '#d9b45c' },
  { id: 'tom1', label: 'Tom 1', pos: [-0.27, 1.12, -0.08], radius: 0.24, depth: 0.22, kind: 'drum', tilt: [0.35, 0, 0.08], color: '#2a2e3d' },
  { id: 'tom2', label: 'Tom 2', pos: [0.32, 1.12, -0.08], radius: 0.26, depth: 0.24, kind: 'drum', tilt: [0.35, 0, -0.08], color: '#2a2e3d' },
  { id: 'floor', label: 'Floor tom', pos: [0.98, 0.7, 0.5], radius: 0.32, depth: 0.34, kind: 'drum', tilt: [0.05, 0, -0.04], color: '#2a2e3d' },
  { id: 'crash', label: 'Crash', pos: [0.98, 1.62, -0.5], radius: 0.36, depth: 0.02, kind: 'cymbal', tilt: [0.38, 0, -0.32], color: '#e0c06a' },
  { id: 'ride', label: 'Ride', pos: [-1.0, 1.55, -0.55], radius: 0.4, depth: 0.02, kind: 'cymbal', tilt: [0.34, 0, 0.3], color: '#d9b45c' },
];

const tmpColor = new THREE.Color();

/* ------------------------------------------------------------------ shared texture */

function useRadialTexture(size = 128) {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [size]);
}

/* ------------------------------------------------------------------ the kit */

function Drum({ spec, api }: { spec: DrumSpec; api: MutableRefObject<DrumSceneApi> }) {
  const group = useRef<THREE.Group>(null!);
  const flash = useRef(0);
  const wobble = useRef(0);
  const wobbleVel = useRef(0);
  const headMat = useRef<THREE.MeshStandardMaterial>(null!);
  const ring1 = useRef<THREE.Mesh>(null!);
  const ring2 = useRef<THREE.Mesh>(null!);
  const baseColor = useMemo(() => new THREE.Color(spec.kind === 'cymbal' ? spec.color : spec.kind === 'kick' ? '#d6d9e3' : '#eef0f6'), [spec]);

  useFrame((_, dt) => {
    const a = api.current;
    for (const h of a.hits) {
      if (h.drum !== spec.id || h.t < 0) continue;
      flash.current = Math.min(1, 0.45 + h.intensity);
      wobbleVel.current += (spec.kind === 'cymbal' ? 4.5 : 1.6) * (0.4 + h.intensity);
      h.t = -1;
    }
    flash.current = Math.max(0, flash.current - dt * 4);
    wobbleVel.current += -wobble.current * 60 * dt - wobbleVel.current * 5 * dt;
    wobble.current += wobbleVel.current * dt;
    const g = group.current;
    const s = 1 + flash.current * 0.06;
    g.scale.set(s, spec.kind === 'cymbal' ? 1 : 1 - flash.current * 0.05, s);
    g.rotation.x = (spec.tilt?.[0] ?? 0) + wobble.current * 0.5;
    g.rotation.z = (spec.tilt?.[2] ?? 0) + wobble.current * 0.35;
    if (headMat.current) {
      headMat.current.emissive.copy(tmpColor.set('#ffffff'));
      headMat.current.emissiveIntensity = flash.current * 0.9;
      headMat.current.color.copy(baseColor).lerp(tmpColor.set('#ffffff'), flash.current * 0.5);
    }
    const targets: Array<[THREE.Mesh, StickRole]> = [
      [ring1.current, 'stick1'],
      [ring2.current, 'stick2'],
    ];
    for (const [mesh, role] of targets) {
      const on = a.target[role] === spec.id;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const targetOpacity = on ? 0.85 : 0;
      mat.opacity += (targetOpacity - mat.opacity) * Math.min(1, dt * 14);
      mesh.visible = mat.opacity > 0.02;
      const pulse = 1 + Math.sin(performance.now() / 180) * 0.025;
      mesh.scale.setScalar(pulse * (1 + flash.current * 0.08));
    }
  });

  const r = spec.radius;
  const ringR = r + 0.06;
  return (
    <group position={spec.pos}>
      <group ref={group} rotation={spec.tilt ?? [0, 0, 0]}>
        {spec.kind === 'cymbal' ? (
          <>
            <mesh rotation={[0, 0, 0]} castShadow>
              <cylinderGeometry args={[r * 0.15, r, 0.05, 48, 1, false]} />
              <meshStandardMaterial ref={headMat} color={spec.color} metalness={0.95} roughness={0.28} />
            </mesh>
            <mesh position={[0, 0.02, 0]}>
              <cylinderGeometry args={[r * 0.14, r * 0.14, 0.05, 24]} />
              <meshStandardMaterial color="#1a1c24" metalness={0.8} roughness={0.4} />
            </mesh>
          </>
        ) : spec.kind === 'kick' ? (
          <group rotation={[Math.PI / 2, 0, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[r, r, spec.depth, 56, 1, true]} />
              <meshStandardMaterial color={spec.color} metalness={0.35} roughness={0.5} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, -spec.depth / 2 - 0.005, 0]}>
              <circleGeometry args={[r, 56]} />
              <meshStandardMaterial ref={headMat} color="#d6d9e3" roughness={0.75} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, -spec.depth / 2 - 0.006, 0]}>
              <ringGeometry args={[r * 0.2, r * 0.3, 40]} />
              <meshStandardMaterial color="#0b0d12" roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
            {[-spec.depth / 2, spec.depth / 2].map((y, i) => (
              <mesh key={i} position={[0, y, 0]}>
                <torusGeometry args={[r, 0.018, 12, 64]} />
                <meshStandardMaterial color="#c9ccd8" metalness={1} roughness={0.25} />
              </mesh>
            ))}
          </group>
        ) : (
          <>
            <mesh castShadow>
              <cylinderGeometry args={[r, r, spec.depth, 56, 1, true]} />
              <meshStandardMaterial color={spec.color} metalness={0.3} roughness={0.5} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, spec.depth / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[r, 56]} />
              <meshStandardMaterial ref={headMat} color="#eef0f6" roughness={0.7} />
            </mesh>
            {[-spec.depth / 2, spec.depth / 2].map((y, i) => (
              <mesh key={i} position={[0, y, 0]}>
                <torusGeometry args={[r, 0.016, 12, 64]} />
                <meshStandardMaterial color="#c9ccd8" metalness={1} roughness={0.25} />
              </mesh>
            ))}
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i / 8) * Math.PI * 2;
              return (
                <mesh key={`lug${i}`} position={[Math.cos(a) * r, 0, Math.sin(a) * r]}>
                  <boxGeometry args={[0.03, spec.depth * 0.6, 0.03]} />
                  <meshStandardMaterial color="#b9bdcb" metalness={1} roughness={0.3} />
                </mesh>
              );
            })}
          </>
        )}
      </group>
      <mesh ref={ring1} rotation={[-Math.PI / 2 + (spec.tilt?.[0] ?? 0), 0, spec.tilt?.[2] ?? 0]} position={[0, spec.kind === 'kick' ? 0 : spec.depth / 2 + 0.03, spec.kind === 'kick' ? spec.depth / 2 + 0.03 : 0]}>
        <ringGeometry args={[ringR, ringR + 0.045, 64]} />
        <meshBasicMaterial color={STICK_COLORS.stick1} transparent opacity={0} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={ring2} rotation={[-Math.PI / 2 + (spec.tilt?.[0] ?? 0), 0, spec.tilt?.[2] ?? 0]} position={[0, spec.kind === 'kick' ? 0 : spec.depth / 2 + 0.03, spec.kind === 'kick' ? spec.depth / 2 + 0.03 : 0]}>
        <ringGeometry args={[ringR + 0.07, ringR + 0.115, 64]} />
        <meshBasicMaterial color={STICK_COLORS.stick2} transparent opacity={0} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {spec.kind === 'cymbal' && (
        <mesh position={[0, -0.55, 0]}>
          <cylinderGeometry args={[0.015, 0.02, 1.1, 12]} />
          <meshStandardMaterial color="#9a9eab" metalness={1} roughness={0.3} />
        </mesh>
      )}
      {spec.kind === 'drum' && spec.id !== 'snare' && spec.pos[1] > 1 && (
        <mesh position={[0, -0.45, 0.1]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[0.014, 0.018, 0.8, 12]} />
          <meshStandardMaterial color="#9a9eab" metalness={1} roughness={0.3} />
        </mesh>
      )}
      {(spec.id === 'snare' || spec.id === 'floor') && (
        <mesh position={[0, -0.36, 0]}>
          <cylinderGeometry args={[0.015, 0.02, 0.7, 12]} />
          <meshStandardMaterial color="#9a9eab" metalness={1} roughness={0.3} />
        </mesh>
      )}
    </group>
  );
}

function HitBursts({ api }: { api: MutableRefObject<DrumSceneApi> }) {
  const pool = useRef<Array<{ mesh: THREE.Mesh | null; age: number; life: number; scale: number }>>(
    Array.from({ length: 10 }, () => ({ mesh: null, age: 99, life: 0.5, scale: 1 })),
  );
  const specById = useMemo(() => new Map(DRUM_SPECS.map((s) => [s.id, s])), []);
  useFrame((_, dt) => {
    for (const h of api.current.hits) {
      if (h.t === -2) continue;
      const spec = specById.get(h.drum);
      const slot = pool.current.find((p) => p.age >= p.life) ?? pool.current[0];
      if (spec && slot.mesh) {
        slot.age = 0;
        slot.life = 0.35 + h.intensity * 0.3;
        slot.scale = spec.radius * (1.1 + h.intensity * 0.8);
        slot.mesh.position.set(spec.pos[0], spec.pos[1] + (spec.kind === 'kick' ? 0 : spec.depth / 2 + 0.05), spec.pos[2] + (spec.kind === 'kick' ? spec.depth / 2 + 0.05 : 0));
        slot.mesh.rotation.set(spec.kind === 'kick' ? 0 : -Math.PI / 2 + (spec.tilt?.[0] ?? 0), 0, spec.tilt?.[2] ?? 0);
        (slot.mesh.material as THREE.MeshBasicMaterial).color.set(STICK_COLORS[h.role]);
      }
      api.current.lastHitAt = performance.now();
      h.t = -2;
    }
    const a = api.current;
    if (a.hits.length && a.hits.every((h) => h.t === -2)) a.hits.length = 0;
    for (const p of pool.current) {
      if (!p.mesh) continue;
      p.age += dt;
      const k = Math.min(1, p.age / p.life);
      p.mesh.visible = k < 1;
      const s = p.scale * (0.6 + k * 1.2);
      p.mesh.scale.setScalar(s);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
    }
  });
  return (
    <>
      {pool.current.map((p, i) => (
        <mesh key={i} ref={(m) => (p.mesh = m)} visible={false}>
          <ringGeometry args={[0.92, 1, 64]} />
          <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

function Stick({ role, controllerId, api }: { role: StickRole; controllerId: ControllerId | null; api: MutableRefObject<DrumSceneApi> }) {
  const motion = useMotionRef(controllerId ?? 1);
  const pivot = useRef<THREE.Group>(null!);
  const smooth = useRef({ pitch: 0, yaw: 0 });
  const dip = useRef(0);
  const x = role === 'stick1' ? -0.42 : 0.42;
  useFrame((_, dt) => {
    const a = api.current;
    const s: ControllerMotionState | null = controllerId ? motion.current : null;
    let pitch = 0;
    let yaw = 0;
    if (s && s.connected) {
      pitch = THREE.MathUtils.clamp(s.relative.pitch, -70, 70);
      yaw = THREE.MathUtils.clamp(s.relative.yaw, -80, 80);
    } else {
      const t = DRUM_SPECS.find((d) => d.id === a.target[role]);
      if (t) {
        yaw = -Math.atan2(t.pos[0] - x, 1.4 - t.pos[2]) * (180 / Math.PI);
        pitch = (t.pos[1] - 1.25) * 40;
      }
    }
    const k = Math.min(1, dt * 22);
    smooth.current.pitch += (pitch - smooth.current.pitch) * k;
    smooth.current.yaw += (yaw - smooth.current.yaw) * k;
    dip.current += (a.stickDip[role] - dip.current) * Math.min(1, dt * 30);
    a.stickDip[role] *= Math.exp(-dt * 10);
    const g = pivot.current;
    g.rotation.x = THREE.MathUtils.degToRad(smooth.current.pitch) - dip.current * 0.7;
    g.rotation.y = THREE.MathUtils.degToRad(smooth.current.yaw);
  });
  const color = STICK_COLORS[role];
  const skin = '#caa07a';
  return (
    <group position={[x, 1.28, 1.35]}>
      <group ref={pivot}>
        {/* forearm behind the hand, toward the camera (drummer's own arms) */}
        <mesh position={[0, 0.02, 0.5]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <capsuleGeometry args={[0.075, 0.7, 4, 10]} />
          <meshStandardMaterial color={skin} roughness={0.8} />
        </mesh>
        {/* fist */}
        <mesh position={[0, 0, 0.06]}>
          <sphereGeometry args={[0.085, 14, 12]} />
          <meshStandardMaterial color={skin} roughness={0.8} />
        </mesh>
        {/* stick forward along -z */}
        <mesh position={[0, 0, -0.4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.012, 0.02, 0.8, 16]} />
          <meshStandardMaterial color="#e8d9b8" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, -0.8]}>
          <sphereGeometry args={[0.022, 16, 16]} />
          <meshStandardMaterial color="#f4ecd8" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0, -0.06]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.024, 0.024, 0.12, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ arena: beams */

const BEAM_VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }
`;
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uI; uniform float uTime;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){
    float along = pow(vUv.y, 1.35);
    float rim = abs(dot(normalize(vN), normalize(vV)));
    float body = smoothstep(0.0, 0.72, rim);
    float dust = 0.85 + 0.15*sin(vUv.y*46.0 - uTime*2.2)*sin(vUv.x*28.0+uTime);
    float a = along*body*dust*uI*1.7;
    gl_FragColor = vec4(uColor*a, a);
  }
`;

interface BeamSpec { x: number; z: number; color: string; rx: number; rz: number; sway: number; hz: number; phase: number; len: number; rad: number; i: number; }

function Beam({ spec, y, halo, api }: { spec: BeamSpec; y: number; halo: THREE.Texture; api: MutableRefObject<DrumSceneApi> }) {
  const g = useRef<THREE.Group>(null!);
  const uniforms = useMemo(() => ({ uColor: { value: new THREE.Color(spec.color) }, uI: { value: spec.i }, uTime: { value: 0 } }), [spec.color, spec.i]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    g.current.rotation.z = spec.rz + Math.sin(t * spec.hz * Math.PI * 2 + spec.phase) * spec.sway;
    g.current.rotation.x = spec.rx + Math.cos(t * spec.hz * 0.7 * Math.PI * 2 + spec.phase) * spec.sway * 0.5;
    const beat = Math.max(0, 1 - (performance.now() - api.current.lastHitAt) / 260);
    uniforms.uTime.value = t;
    uniforms.uI.value = spec.i * (0.9 + 0.1 * Math.sin(t * 9 + spec.phase) + beat * 0.5);
  });
  return (
    <group position={[spec.x, y, spec.z]} ref={g} rotation={[spec.rx, 0, spec.rz]}>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.09, 0.12, 0.22, 14]} />
        <meshStandardMaterial color="#141319" metalness={0.8} roughness={0.5} />
      </mesh>
      <sprite position={[0, -0.04, 0]} scale={[0.9, 0.9, 1]}>
        <spriteMaterial map={halo} color={spec.color} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </sprite>
      <mesh position={[0, -spec.len / 2, 0]}>
        <coneGeometry args={[spec.rad, spec.len, 26, 1, true]} />
        <shaderMaterial vertexShader={BEAM_VERT} fragmentShader={BEAM_FRAG} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

function Truss({ z, y = 7, len = 30 }: { z: number; y?: number; len?: number }) {
  const braces = useMemo(() => Array.from({ length: Math.floor(len / 0.6) }, (_, i) => -len / 2 + 0.3 + i * 0.6), [len]);
  const mat = <meshStandardMaterial color="#26282f" metalness={0.85} roughness={0.45} />;
  return (
    <group position={[0, y, z]}>
      {[0.2, -0.18, -0.18].map((yy, i) => (
        <mesh key={i} position={[0, yy, i === 2 ? 0.22 : i === 1 ? -0.22 : 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.03, len, 8]} />
          {mat}
        </mesh>
      ))}
      {braces.map((x, i) => (
        <mesh key={i} position={[x, 0, 0]} rotation={[0, 0, i % 2 ? 0.8 : -0.8]}>
          <cylinderGeometry args={[0.014, 0.014, 0.5, 6]} />
          {mat}
        </mesh>
      ))}
    </group>
  );
}

const PURPLE = '#8a63ff';
const MAGENTA = '#c060ff';
const WHITE = '#f0ecff';
const CYAN = '#7cc4ff';

const BEAMS: BeamSpec[] = [
  { x: -8, z: -7, color: PURPLE, rx: 0.5, rz: -0.6, sway: 0.07, hz: 0.11, phase: 0, len: 13, rad: 1.7, i: 0.5 },
  { x: -4.5, z: -8, color: MAGENTA, rx: 0.42, rz: -0.28, sway: 0.06, hz: 0.09, phase: 1.1, len: 13, rad: 1.5, i: 0.45 },
  { x: -1.5, z: -8.5, color: WHITE, rx: 0.5, rz: -0.05, sway: 0.08, hz: 0.13, phase: 2.0, len: 14, rad: 1.2, i: 0.4 },
  { x: 1.5, z: -8.5, color: CYAN, rx: 0.5, rz: 0.05, sway: 0.08, hz: 0.12, phase: 2.7, len: 14, rad: 1.2, i: 0.4 },
  { x: 4.5, z: -8, color: MAGENTA, rx: 0.42, rz: 0.28, sway: 0.06, hz: 0.1, phase: 3.6, len: 13, rad: 1.5, i: 0.45 },
  { x: 8, z: -7, color: PURPLE, rx: 0.5, rz: 0.6, sway: 0.07, hz: 0.12, phase: 4.5, len: 13, rad: 1.7, i: 0.5 },
  { x: -6, z: -4.5, color: WHITE, rx: 0.2, rz: -0.4, sway: 0.05, hz: 0.1, phase: 0.7, len: 11, rad: 1.1, i: 0.32 },
  { x: 6, z: -4.5, color: PURPLE, rx: 0.2, rz: 0.4, sway: 0.05, hz: 0.11, phase: 3.1, len: 11, rad: 1.1, i: 0.32 },
];

function Rig({ halo, api, count }: { halo: THREE.Texture; api: MutableRefObject<DrumSceneApi>; count: number }) {
  return (
    <group>
      <Truss z={-4.5} y={6.6} />
      <Truss z={-8} y={7} />
      {BEAMS.slice(0, count).map((b, i) => (
        <Beam key={i} spec={b} y={b.z < -6 ? 7 : 6.6} halo={halo} api={api} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ arena: haze */

function Haze({ tex, count }: { tex: THREE.Texture; count: number }) {
  const refs = useRef<THREE.Mesh[]>([]);
  const sheets = useMemo(
    () => Array.from({ length: count }, (_, i) => ({ x: -6 + (i % 4) * 3.5, y: 1.6 + (i % 3) * 1.4, z: -3 - (i % 4) * 1.6, w: 8 + (i % 3) * 3, h: 5 + (i % 2) * 2, speed: 0.05 + (i % 3) * 0.03, phase: i * 1.7, color: i % 2 ? '#9b7dff' : '#7cc4ff', op: 0.05 + (i % 2) * 0.03 })),
    [count],
  );
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    sheets.forEach((s, i) => {
      const m = refs.current[i];
      if (!m) return;
      m.position.x = s.x + Math.sin(t * s.speed + s.phase) * 1.4;
      (m.material as THREE.MeshBasicMaterial).opacity = s.op * (0.8 + 0.2 * Math.sin(t * 0.3 + s.phase));
    });
  });
  return (
    <group>
      {sheets.map((s, i) => (
        <mesh key={i} ref={(m) => m && (refs.current[i] = m)} position={[s.x, s.y, s.z]}>
          <planeGeometry args={[s.w, s.h]} />
          <meshBasicMaterial map={tex} color={s.color} transparent opacity={s.op} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ arena: crowd */

function Crowd({ count, api, halo }: { count: number; api: MutableRefObject<DrumSceneApi>; halo: THREE.Texture }) {
  const heads = useRef<THREE.InstancedMesh>(null!);
  const bodies = useRef<THREE.InstancedMesh>(null!);
  const arms = useRef<THREE.InstancedMesh>(null!);
  const phones = useRef<THREE.InstancedMesh>(null!);
  const people = useMemo(() => {
    const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    return Array.from({ length: count }, (_, i) => {
      const row = i % 11;
      return {
        x: -18 + rnd(i, 1) * 36,
        z: -7.8 - row * 1.5 - rnd(i, 2) * 1.1,
        h: 1.0 + rnd(i, 3) * 0.55,
        hz: 1.0 + rnd(i, 4) * 0.6,
        phase: rnd(i, 5) * Math.PI * 2,
        arm: rnd(i, 6) < 0.4,
        side: rnd(i, 7) < 0.5 ? -1 : 1,
        scale: 0.9 + rnd(i, 8) * 0.4,
        phone: rnd(i, 9) < 0.32,
      };
    });
  }, [count]);
  const armPeople = useMemo(() => people.filter((p) => p.arm), [people]);
  const phonePeople = useMemo(() => people.filter((p) => p.phone), [people]);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  const eul = useMemo(() => new THREE.Euler(), []);
  const energy = useRef(0.4);
  const FLOOR = -1.7;
  useEffect(() => {
    const tmp = new THREE.Color();
    phonePeople.forEach((_, i) => { tmp.setHSL(0.08 + (i % 5) * 0.02, 0.2, 0.9); phones.current.setColorAt(i, tmp); });
    if (phones.current.instanceColor) phones.current.instanceColor.needsUpdate = true;
  }, [phonePeople]);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const beat = Math.max(0, 1 - (performance.now() - api.current.lastHitAt) / 500);
    energy.current += ((0.45 + beat * 0.55) - energy.current) * Math.min(1, dt * 3);
    const e = energy.current;
    people.forEach((p, i) => {
      const bob = Math.abs(Math.sin(t * p.hz * Math.PI + p.phase)) * 0.11 * e;
      const y = FLOOR + p.h + bob;
      q.identity(); pos.set(p.x, y, p.z); scl.setScalar(p.scale); m4.compose(pos, q, scl); heads.current.setMatrixAt(i, m4);
      pos.set(p.x, y - 0.34 * p.scale, p.z); scl.set(p.scale * 1.1, p.scale, p.scale); m4.compose(pos, q, scl); bodies.current.setMatrixAt(i, m4);
    });
    armPeople.forEach((p, i) => {
      const bob = Math.abs(Math.sin(t * p.hz * Math.PI + p.phase)) * 0.11 * e;
      const wave = Math.sin(t * 2.4 + p.phase) * 0.2;
      const y = FLOOR + p.h + bob;
      const tilt = p.side * (0.3 + wave);
      eul.set(0.1, 0, tilt); q.setFromEuler(eul);
      const ax = p.x + p.side * 0.22 * p.scale;
      pos.set(ax, y + 0.16 * p.scale, p.z); scl.setScalar(p.scale); m4.compose(pos, q, scl); arms.current.setMatrixAt(i, m4);
    });
    phonePeople.forEach((p, i) => {
      const bob = Math.abs(Math.sin(t * p.hz * Math.PI + p.phase)) * 0.11 * e;
      const sway = Math.sin(t * 1.6 + p.phase) * 0.5;
      pos.set(p.x + sway, FLOOR + p.h + 0.7 * p.scale + bob, p.z); q.identity(); scl.setScalar(0.5 + beat * 0.2); m4.compose(pos, q, scl);
      phones.current.setMatrixAt(i, m4);
    });
    heads.current.instanceMatrix.needsUpdate = true;
    bodies.current.instanceMatrix.needsUpdate = true;
    arms.current.instanceMatrix.needsUpdate = true;
    phones.current.instanceMatrix.needsUpdate = true;
  });
  const sil = <meshStandardMaterial color="#0a0810" roughness={1} />;
  return (
    <group>
      <instancedMesh ref={heads} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.16, 12, 12]} />{sil}
      </instancedMesh>
      <instancedMesh ref={bodies} args={[undefined, undefined, count]} frustumCulled={false}>
        <capsuleGeometry args={[0.24, 0.5, 4, 10]} />{sil}
      </instancedMesh>
      <instancedMesh ref={arms} args={[undefined, undefined, Math.max(1, armPeople.length)]} frustumCulled={false}>
        <cylinderGeometry args={[0.045, 0.05, 0.8, 7]} />{sil}
      </instancedMesh>
      <instancedMesh ref={phones} args={[undefined, undefined, Math.max(1, phonePeople.length)]} frustumCulled={false} renderOrder={4}>
        <planeGeometry args={[0.16, 0.16]} />
        <meshBasicMaterial map={halo} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------ arena: stage + PA */

function Arena({ high, halo }: { high: boolean; halo: THREE.Texture }) {
  return (
    <group>
      {/* stage floor: extends forward under the drummer toward the crowd */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -3]} receiveShadow={high}>
        <planeGeometry args={[24, 16]} />
        <meshStandardMaterial color="#0c0b12" roughness={0.5} metalness={0.25} />
      </mesh>
      {/* riser the kit sits on */}
      <mesh position={[0, 0.06, 0.1]} receiveShadow={high}>
        <boxGeometry args={[4.6, 0.12, 3.4]} />
        <meshStandardMaterial color="#111019" roughness={0.7} metalness={0.1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.13, 0.1]}>
        <ringGeometry args={[2.15, 2.2, 96]} />
        <meshBasicMaterial color={PURPLE} transparent opacity={0.4} toneMapped={false} />
      </mesh>
      {/* stage front edge line */}
      <mesh position={[0, 0.05, -7.4]}>
        <boxGeometry args={[24, 0.1, 0.15]} />
        <meshStandardMaterial color={PURPLE} emissive={PURPLE} emissiveIntensity={0.6} />
      </mesh>
      {/* PA stacks left/right */}
      {[-6.4, 6.4].map((x, i) => (
        <group key={i} position={[x, 0, -5]}>
          {[0, 1, 2, 3].map((r) => (
            <mesh key={r} position={[0, 0.7 + r * 1.05, 0]} castShadow={high}>
              <boxGeometry args={[1.5, 1.0, 1.1]} />
              <meshStandardMaterial color="#0d0d12" roughness={0.85} />
            </mesh>
          ))}
          {[0, 1, 2, 3].map((r) => (
            <mesh key={`c${r}`} position={[0, 0.7 + r * 1.05, 0.56]}>
              <circleGeometry args={[0.32, 20]} />
              <meshStandardMaterial color="#1a1a22" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
      {/* crowd-area haze glow so the audience reads against the dark (soft-edged) */}
      <mesh position={[0, 1.0, -12]} scale={[26, 8, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={halo} color="#3a1c66" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* back video wall glow */}
      <mesh position={[0, 5.5, -13]}>
        <planeGeometry args={[36, 10]} />
        <meshBasicMaterial color="#160b2a" />
      </mesh>
    </group>
  );
}

function StageLights({ high, shadowSize }: { high: boolean; shadowSize: number }) {
  return (
    <>
      <ambientLight intensity={0.32} color="#b9a8ff" />
      <hemisphereLight args={['#8a63ff', '#0a0810', 0.5]} />
      <spotLight position={[-4, 7, -3]} angle={0.6} penumbra={0.85} intensity={130} color="#a98bff" castShadow={high} shadow-mapSize={[shadowSize, shadowSize]} />
      <spotLight position={[4, 7, -3]} angle={0.6} penumbra={0.85} intensity={110} color="#7cc4ff" />
      <spotLight position={[0, 6, 3.5]} angle={0.5} penumbra={0.9} intensity={70} color="#fff0ff" />
      <pointLight position={[0, 2.4, 1.6]} intensity={7} color="#ffffff" distance={7} decay={2} />
      <pointLight position={[0, 1.4, 0.2]} intensity={3} color={PURPLE} distance={5} decay={2} />
    </>
  );
}

/* ------------------------------------------------------------------ root */

export function DrumScene({ api, sticks }: { api: MutableRefObject<DrumSceneApi>; sticks: Record<StickRole, ControllerId | null> }) {
  const quality = sceneSettings();
  const high = quality.shadows;
  const halo = useRadialTexture(128);
  return (
    <Canvas
      shadows={quality.shadows}
      camera={{ position: [0, 2.5, 3.6], fov: 48, near: 0.3, far: 80 }}
      dpr={quality.dpr}
      gl={{ antialias: quality.antialias, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onCreated={({ camera }) => camera.lookAt(0, 1.45, -6)}
    >
      <color attach="background" args={['#07060d']} />
      <fogExp2 attach="fog" args={['#0e0820', 0.03]} />
      <StageLights high={high} shadowSize={quality.shadowMapSize} />
      <Arena high={high} halo={halo} />
      <Rig halo={halo} api={api} count={high ? 8 : 5} />
      <Haze tex={halo} count={high ? 7 : 3} />
      <Crowd count={high ? 150 : 70} api={api} halo={halo} />
      {DRUM_SPECS.map((s) => (
        <Drum key={s.id} spec={s} api={api} />
      ))}
      <HitBursts api={api} />
      <Stick role="stick1" controllerId={sticks.stick1} api={api} />
      <Stick role="stick2" controllerId={sticks.stick2} api={api} />
    </Canvas>
  );
}
