import { useMemo, useRef } from 'react';
import { sceneSettings } from '@/features/activity/sceneQuality';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import type { ControllerId } from '@aero/motion-core';
import { useMotionRef } from '@/store/controllers';
import { useSettings } from '@/store/settings';

export const CONTROLLER_COLORS: Record<ControllerId, string> = { 1: '#6ea8ff', 2: '#ff9a6a' };

const DEG = Math.PI / 180;

/**
 * Body frame → three.js: X forward → -Z, Y left → -X, Z up → +Y.
 * pitch (nose up +) → rotation.x = +pitch, roll (right down +) → rotation.z = -roll,
 * yaw (left +) → rotation.y = +yaw. Euler order YXZ.
 */
function ControllerModel({ id, position, showLabel }: { id: ControllerId; position: [number, number, number]; showLabel?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const motion = useMotionRef(id);
  const color = CONTROLLER_COLORS[id];
  const target = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);
  const connected = useRef(false);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const s = motion.current;
    connected.current = s.connected;
    const o = s.connected ? s.orientation : { pitch: 0, roll: 0, yaw: 0 };
    target.set(o.pitch * DEG, o.yaw * DEG, -o.roll * DEG, 'YXZ');
    const k = 1 - Math.exp(-dt * 22);
    g.rotation.x += (target.x - g.rotation.x) * k;
    g.rotation.y += shortest(target.y - g.rotation.y) * k;
    g.rotation.z += shortest(target.z - g.rotation.z) * k;
    // gentle idle float when disconnected
    g.position.y = position[1] + (s.connected ? 0 : Math.sin(performance.now() / 900 + id) * 0.04);
    if (ring.current) {
      const m = ring.current.material as THREE.MeshStandardMaterial;
      const pulse = s.connected ? 1.6 + Math.min(1.5, s.angularSpeed / 200) : 0.25;
      m.emissiveIntensity += (pulse - m.emissiveIntensity) * k;
    }
  });

  return (
    <group position={position}>
      <group ref={group} rotation={new THREE.Euler(0, 0, 0, 'YXZ')}>
        {/* body: capsule along Z (forward = -Z) */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <capsuleGeometry args={[0.32, 1.5, 12, 32]} />
          <meshStandardMaterial color="#e9ecf3" roughness={0.35} metalness={0.15} />
        </mesh>
        {/* soft grip band */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.35]}>
          <cylinderGeometry args={[0.335, 0.335, 0.5, 32]} />
          <meshStandardMaterial color="#1c2130" roughness={0.7} />
        </mesh>
        {/* front indicator ring */}
        <mesh ref={ring} position={[0, 0, -0.82]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.045, 12, 40]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} roughness={0.3} />
        </mesh>
        {/* top button */}
        <mesh position={[0, 0.33, -0.3]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
        </mesh>
        {/* top face marker */}
        <mesh position={[0, 0.325, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.22, 0.5]} />
          <meshStandardMaterial color="#c4c9d6" roughness={0.6} />
        </mesh>
      </group>
      {showLabel !== false && <Label id={id} color={color} />}
    </group>
  );
}

function shortest(d: number): number {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function Label({ id, color }: { id: ControllerId; color: string }) {
  // small floor disc under each controller tinted with its colour
  return (
    <mesh position={[0, -1.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.9, 0.95, 64]} />
      <meshBasicMaterial color={color} transparent opacity={id ? 0.35 : 0} />
    </mesh>
  );
}

export interface ControllerSceneProps {
  ids: ControllerId[];
  height?: number | string;
  /** Render the label overlay with controller names under each model. */
  labels?: boolean;
  className?: string;
}

/** Live 3D mirror of the physical controllers. Reused by setup, settings and diagnostics. */
export function ControllerScene({ ids, height = 380, labels = true, className }: ControllerSceneProps) {
  const names = useSettings((s) => s.controllerNames);
  const positions: Array<[number, number, number]> =
    ids.length === 1 ? [[0, 0, 0]] : ids.map((_, i) => [(i === 0 ? -1 : 1) * 1.6, 0, 0]);
  const quality = sceneSettings();
  return (
    <div className={className} style={{ position: 'relative', height, width: '100%' }}>
      <Canvas
        shadows={quality.shadows}
        dpr={quality.dpr}
        camera={{ position: [0, 1.6, 5.2], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 6, 4]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-5, 2, -3]} intensity={0.8} color="#8fb4ff" />
        <pointLight position={[0, -1, 3]} intensity={0.6} color="#9b7dff" />
        {ids.map((id, i) => (
          <ControllerModel key={id} id={id} position={positions[i]} showLabel={labels} />
        ))}
        <ContactShadows position={[0, -1.2, 0]} opacity={0.55} scale={9} blur={2.6} far={3} color="#000" frames={quality.shadows ? Infinity : 1} />
      </Canvas>
      {labels && (
        <div className="scene-labels" style={{ gridTemplateColumns: `repeat(${ids.length}, 1fr)` }}>
          {ids.map((id) => (
            <div key={id} className="scene-label">
              <span className="scene-label__dot" style={{ background: CONTROLLER_COLORS[id] }} />
              {names[id]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ControllerScene;
