import { useMemo, useRef, type MutableRefObject } from 'react';
import { sceneSettings } from '@/features/activity/sceneQuality';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ControllerId } from '@aero/motion-core';
import { CHORD_VOICINGS, type ChordName, type StrumDirection } from '@aero/music-engine';
import { useMotionRef } from '@/store/controllers';

export interface GuitarSceneApi {
  chord: ChordName;
  /** strum events queued for the scene */
  strums: Array<{ direction: StrumDirection; velocity: number; times: Array<number | null>; consumed: boolean }>;
  muteAt: number;
}

export function createGuitarSceneApi(): GuitarSceneApi {
  return { chord: 'C', strums: [], muteAt: 0 };
}

const STRING_COUNT = 6;
const STRING_SPACING = 0.075;
const STRING_LEN = 3.2;
const STRING_RADII = [0.011, 0.0095, 0.008, 0.0062, 0.005, 0.0042];

function Body() {
  const geom = useMemo(() => {
    const s = new THREE.Shape();
    // dreadnought-ish outline in the XY plane (x along the neck)
    s.moveTo(-0.95, 0);
    s.bezierCurveTo(-0.95, 0.62, -0.55, 0.7, -0.3, 0.55);
    s.bezierCurveTo(-0.15, 0.46, 0.05, 0.42, 0.2, 0.5);
    s.bezierCurveTo(0.55, 0.66, 0.9, 0.5, 0.9, 0);
    s.bezierCurveTo(0.9, -0.5, 0.55, -0.66, 0.2, -0.5);
    s.bezierCurveTo(0.05, -0.42, -0.15, -0.46, -0.3, -0.55);
    s.bezierCurveTo(-0.55, -0.7, -0.95, -0.62, -0.95, 0);
    const hole = new THREE.Path();
    hole.absarc(0.22, 0, 0.2, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 32 });
    g.translate(0, 0, -0.22);
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={geom} castShadow receiveShadow>
        <meshStandardMaterial color="#c8823a" roughness={0.35} metalness={0.05} />
      </mesh>
      {/* sound-hole interior */}
      <mesh position={[0.22, 0, -0.12]}>
        <circleGeometry args={[0.2, 40]} />
        <meshStandardMaterial color="#1a0f08" roughness={1} />
      </mesh>
      {/* rosette */}
      <mesh position={[0.22, 0, 0.011]}>
        <ringGeometry args={[0.21, 0.26, 48]} />
        <meshStandardMaterial color="#3b2410" roughness={0.6} />
      </mesh>
      {/* bridge */}
      <mesh position={[-0.55, 0, 0.03]}>
        <boxGeometry args={[0.14, 0.62, 0.04]} />
        <meshStandardMaterial color="#2a1a10" roughness={0.6} />
      </mesh>
      {/* pickguard */}
      <mesh position={[0.02, -0.34, 0.012]} rotation={[0, 0, 0.2]}>
        <circleGeometry args={[0.24, 32]} />
        <meshStandardMaterial color="#1f1a17" roughness={0.4} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function Neck() {
  const frets = useMemo(() => Array.from({ length: 12 }, (_, i) => 0.95 + (i + 1) * 0.17), []);
  return (
    <group>
      <mesh position={[1.95, 0, -0.03]} castShadow>
        <boxGeometry args={[2.1, 0.5, 0.09]} />
        <meshStandardMaterial color="#3a2414" roughness={0.6} />
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
      {/* nut */}
      <mesh position={[3.0, 0, 0.035]}>
        <boxGeometry args={[0.03, 0.5, 0.03]} />
        <meshStandardMaterial color="#f1ead9" roughness={0.5} />
      </mesh>
      {/* headstock */}
      <mesh position={[3.35, 0, -0.03]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.66, 0.56, 0.07]} />
        <meshStandardMaterial color="#3a2414" roughness={0.6} />
      </mesh>
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh key={i} position={[3.15 + (i % 3) * 0.18, i < 3 ? 0.3 : -0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.12, 16]} />
          <meshStandardMaterial color="#d8dbe6" metalness={1} roughness={0.2} />
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
  useFrame((state, dt) => {
    const a = api.current;
    const now = performance.now();
    for (const s of a.strums) {
      if (s.consumed) continue;
      s.consumed = true;
      const order = s.times.map((t, i) => ({ t, i })).filter((x) => x.t !== null);
      for (const { i } of order) amps.current[i] = 0.6 + s.velocity * 1.0;
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
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = amp * 0.9;
      const dot = fretDots.current[i];
      if (dot) {
        const fret = voicing[i];
        dot.visible = fret !== null && fret > 0;
        if (fret) dot.position.x = 0.95 + fret * 0.17 - 0.085;
        (dot.material as THREE.MeshStandardMaterial).opacity = voicing[i] === null ? 0 : 1;
      }
    }
    void state;
  });
  return (
    <group>
      {Array.from({ length: STRING_COUNT }).map((_, i) => {
        const y = (i - 2.5) * STRING_SPACING;
        return (
          <group key={i}>
            <mesh ref={(m) => m && (refs.current[i] = m)} position={[STRING_LEN / 2 - 0.55, y, 0.06]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[STRING_RADII[i], STRING_RADII[i], STRING_LEN, 10]} />
              <meshStandardMaterial color="#e9ecf5" metalness={1} roughness={0.25} emissive="#c9b8ff" emissiveIntensity={0} />
            </mesh>
            <mesh ref={(m) => m && (fretDots.current[i] = m)} position={[1.5, y, 0.08]}>
              <sphereGeometry args={[0.028, 16, 16]} />
              <meshStandardMaterial color="#c98bff" emissive="#c98bff" emissiveIntensity={0.9} transparent />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Pick({ controllerId, api }: { controllerId: ControllerId | null; api: MutableRefObject<GuitarSceneApi> }) {
  const motion = useMotionRef(controllerId ?? 2);
  const g = useRef<THREE.Group>(null!);
  const y = useRef(0);
  const flash = useRef(0);
  const lastDir = useRef<StrumDirection>('down');
  const anim = useRef(0);
  useFrame((_, dt) => {
    const a = api.current;
    const s = controllerId ? motion.current : null;
    let target = 0;
    if (s && s.connected) target = THREE.MathUtils.clamp(-s.relative.pitch / 40, -1, 1) * 0.32;
    for (const st of a.strums) {
      if (st.consumed && (st as { seen?: boolean }).seen) continue;
      (st as { seen?: boolean }).seen = true;
      lastDir.current = st.direction;
      anim.current = 1;
      flash.current = 0.4 + st.velocity;
    }
    if (anim.current > 0) {
      const sweep = lastDir.current === 'down' ? 1 - anim.current * 2 : -(1 - anim.current * 2);
      target = -sweep * 0.3;
      anim.current = Math.max(0, anim.current - dt * 6);
    }
    flash.current = Math.max(0, flash.current - dt * 3);
    y.current += (target - y.current) * Math.min(1, dt * 18);
    g.current.position.y = y.current;
    g.current.rotation.x = -0.5 + y.current * 0.6;
    (g.current.children[0] as THREE.Mesh).scale.setScalar(1 + flash.current * 0.15);
  });
  return (
    <group position={[-0.25, 0, 0.16]} ref={g}>
      <mesh rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.07, 0.14, 3]} />
        <meshStandardMaterial color="#c98bff" emissive="#c98bff" emissiveIntensity={0.7} roughness={0.35} />
      </mesh>
    </group>
  );
}

export function GuitarScene({ api, strumController }: { api: MutableRefObject<GuitarSceneApi>; strumController: ControllerId | null }) {
  const quality = sceneSettings();
  return (
    <Canvas shadows={quality.shadows} camera={{ position: [0.9, -0.15, 3.6], fov: 40 }} dpr={quality.dpr} gl={{ antialias: quality.antialias }} onCreated={({ camera }) => camera.lookAt(0.8, 0, 0)}>
      <color attach="background" args={['#06070a']} />
      <ambientLight intensity={0.5} />
      <spotLight position={[2, 4, 4]} angle={0.6} penumbra={0.8} intensity={70} color="#f5e9ff" castShadow />
      <pointLight position={[-3, -2, 3]} intensity={12} color="#9b7dff" />
      <pointLight position={[4, 1, 2]} intensity={8} color="#ffd6a8" />
      <group rotation={[0.18, -0.55, 0.42]} position={[-0.45, 0.05, 0]}>
        <Body />
        <Neck />
        <Strings api={api} />
        <Pick controllerId={strumController} api={api} />
      </group>
      <mesh position={[0, -1.9, -1.5]} rotation={[-Math.PI / 2.4, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 8]} />
        <meshStandardMaterial color="#0c0e15" roughness={1} />
      </mesh>
      <fog attach="fog" args={['#06070a', 6, 12]} />
    </Canvas>
  );
}
