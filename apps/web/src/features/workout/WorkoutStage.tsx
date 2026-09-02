import { useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Mutable, high-rate values written by the detector loop and read per frame (no React state). */
export interface WorkoutVisual {
  depth: number; // 0..1 range of motion
  pulse: number; // set to 1 on each counted rep, decays
  running: boolean;
}

export type FigureMode = 'squat' | 'pushup';

function Figure({ visual, mode, accent }: { visual: MutableRefObject<WorkoutVisual>; mode: FigureMode; accent: string }) {
  const group = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const smooth = useRef(0);
  const color = new THREE.Color(accent);

  useFrame((state, dt) => {
    const v = visual.current;
    smooth.current += (v.depth - smooth.current) * Math.min(1, dt * 14);
    const d = smooth.current;
    v.pulse = Math.max(0, v.pulse - dt * 2.2);
    if (group.current && torso.current && head.current) {
      if (mode === 'squat') {
        // figure crouches: torso shortens and lowers, slight forward lean
        const h = 1.6 - d * 0.75;
        torso.current.scale.set(1 + d * 0.25, h / 1.6, 1 + d * 0.25);
        torso.current.position.y = h / 2;
        head.current.position.y = h + 0.32;
        group.current.rotation.z = 0;
        group.current.rotation.x = -d * 0.22;
        group.current.position.y = 0;
      } else {
        // plank: figure horizontal, lowering toward the floor line
        group.current.rotation.z = -Math.PI / 2 + 0.12;
        group.current.rotation.x = 0;
        torso.current.scale.set(1, 1, 1);
        torso.current.position.y = 0.8;
        head.current.position.y = 1.92;
        group.current.position.y = 0.75 - d * 0.55;
      }
      const breathe = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.01;
      group.current.scale.setScalar(breathe);
    }
    if (ring.current) {
      const p = v.pulse;
      ring.current.scale.setScalar(1 + (1 - p) * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = p * 0.8;
    }
    if (glow.current) glow.current.intensity = 6 + d * 8 + v.pulse * 30;
  });

  return (
    <>
      <group ref={group}>
        <mesh ref={torso} castShadow>
          <capsuleGeometry args={[0.32, 1.0, 8, 24]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.35} metalness={0.1} />
        </mesh>
        <mesh ref={head}>
          <sphereGeometry args={[0.22, 32, 32]} />
          <meshStandardMaterial color="#f4f6fb" emissive="#f4f6fb" emissiveIntensity={0.25} roughness={0.4} />
        </mesh>
      </group>
      <pointLight ref={glow} position={[0, 1.4, 1.2]} color={color} intensity={8} distance={9} decay={2} />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.7, 0.78, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0} />
      </mesh>
    </>
  );
}

function Floor({ accent }: { accent: string }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[6, 64]} />
        <meshStandardMaterial color="#0d1017" roughness={0.9} />
      </mesh>
      <gridHelper args={[12, 24, accent, '#1a1f2b']} position={[0, 0.005, 0]} />
    </>
  );
}

export function WorkoutStage({ visual, mode, accent }: { visual: MutableRefObject<WorkoutVisual>; mode: FigureMode; accent: string }) {
  return (
    <Canvas dpr={[1, 1.75]} shadows camera={{ position: [0, 1.6, 5.4], fov: 40 }} gl={{ antialias: true, alpha: false }} onCreated={({ gl, scene }) => { gl.setClearColor('#06070a'); scene.fog = new THREE.Fog('#06070a', 7, 14); }}>
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
      <Floor accent={accent} />
      <Figure visual={visual} mode={mode} accent={accent} />
    </Canvas>
  );
}
