import { useMemo, useRef, type MutableRefObject } from 'react';
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
}

export function createDrumSceneApi(): DrumSceneApi {
  return { target: { stick1: 'snare', stick2: 'tom1' }, hits: [], stickDip: { stick1: 0, stick2: 0 } };
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
    // consume hits for this drum
    for (const h of a.hits) {
      if (h.drum !== spec.id || h.t < 0) continue;
      flash.current = Math.min(1, 0.45 + h.intensity);
      wobbleVel.current += (spec.kind === 'cymbal' ? 4.5 : 1.6) * (0.4 + h.intensity);
      h.t = -1;
    }
    flash.current = Math.max(0, flash.current - dt * 4);
    // spring wobble
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
    // targeting rings per stick
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
      {/* target rings (one per stick), lying on the head plane */}
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

/** Expanding ring burst on hit. Pool of 10. */
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
      h.t = -2; // fully consumed
    }
    // drop consumed hits
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
      // keyboard-only: point at the targeted drum
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
    g.visible = controllerId !== null || true;
  });
  const color = STICK_COLORS[role];
  return (
    <group position={[x, 1.28, 1.35]}>
      <group ref={pivot}>
        {/* stick runs from the hand (pivot) forward along -z */}
        <mesh position={[0, 0, -0.4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.012, 0.02, 0.8, 16]} />
          <meshStandardMaterial color="#e8d9b8" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, -0.8]}>
          <sphereGeometry args={[0.022, 16, 16]} />
          <meshStandardMaterial color="#f4ecd8" roughness={0.5} />
        </mesh>
        {/* grip ring in stick colour */}
        <mesh position={[0, 0, -0.06]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.024, 0.024, 0.12, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

function Stage() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[3.2, 64]} />
        <meshStandardMaterial color="#0e1017" roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0.1]}>
        <ringGeometry args={[2.3, 2.34, 96]} />
        <meshBasicMaterial color="#9b7dff" transparent opacity={0.18} />
      </mesh>
      <ambientLight intensity={0.35} />
      <spotLight position={[-2.5, 4.5, 2.5]} angle={0.55} penumbra={0.7} intensity={70} color="#c9b8ff" castShadow shadow-mapSize={[1024, 1024]} />
      <spotLight position={[2.8, 4.2, 2.2]} angle={0.55} penumbra={0.7} intensity={55} color="#a9f5d3" />
      <pointLight position={[0, 1.6, 2.6]} intensity={6} color="#ffffff" />
      <fog attach="fog" args={['#06070a', 5, 10]} />
    </>
  );
}

export function DrumScene({ api, sticks }: { api: MutableRefObject<DrumSceneApi>; sticks: Record<StickRole, ControllerId | null> }) {
  return (
    <Canvas shadows camera={{ position: [0, 2.05, 3.4], fov: 42 }} dpr={[1, 1.75]} gl={{ antialias: true, powerPreference: 'high-performance' }} onCreated={({ camera }) => camera.lookAt(0, 0.95, 0)}>
      <color attach="background" args={['#06070a']} />
      <Stage />
      {DRUM_SPECS.map((s) => (
        <Drum key={s.id} spec={s} api={api} />
      ))}
      <HitBursts api={api} />
      <Stick role="stick1" controllerId={sticks.stick1} api={api} />
      <Stick role="stick2" controllerId={sticks.stick2} api={api} />
    </Canvas>
  );
}
