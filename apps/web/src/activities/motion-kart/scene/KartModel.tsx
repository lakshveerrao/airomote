/**
 * The kart: rounded shell with nose emblem, side pods, exhaust, chrome-rim tyres that steer and
 * spin, and a helmeted driver holding the wheel. Reads the simulation each frame.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Kart } from '../game/kart';
import { emblemTexture } from './textures';

export function KartModel({ getKart, color, player, letter = 'A' }: { getKart: () => Kart | undefined; color: string; player?: boolean; letter?: string }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const wheels = useRef<Array<THREE.Group | null>>([]);
  const tyres = useRef<Array<THREE.Mesh | null>>([]);
  const wheelRef = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Mesh>(null);
  const emblem = useMemo(() => emblemTexture(letter, color), [letter, color]);
  useEffect(() => () => emblem.dispose(), [emblem]);
  const bob = useRef(0);

  useFrame((state, dt) => {
    const k = getKart();
    const g = group.current;
    if (!k || !g) return;
    const t = state.clock.elapsedTime;
    g.position.set(k.x, 0, k.z);
    g.rotation.y = -k.heading;
    // body: roll into the turn, pitch with acceleration, a little suspension bob at speed
    const sp = Math.abs(k.speed);
    bob.current = sp > 2 ? Math.sin(t * 24) * Math.min(0.012, sp * 0.0004) : 0;
    if (body.current) {
      body.current.rotation.x = k.bodyRoll;
      body.current.rotation.z = THREE.MathUtils.lerp(body.current.rotation.z, k.boosting ? -0.05 : k.offRoad ? Math.sin(t * 30) * 0.01 : 0, 0.15);
      body.current.position.y = bob.current + (k.offRoad && sp > 4 ? Math.sin(t * 37) * 0.02 : 0);
    }
    const steer = k.steer * 0.5;
    wheels.current.forEach((w, i) => {
      if (!w) return;
      if (i < 2) w.rotation.y = -steer;
    });
    tyres.current.forEach((m) => m && (m.rotation.z = -k.wheelSpin));
    if (wheelRef.current) wheelRef.current.rotation.y = -k.steer * 1.2;
    if (head.current) {
      head.current.rotation.z = THREE.MathUtils.lerp(head.current.rotation.z, k.steer * 0.25, 0.1);
      head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, k.boosting ? 0.15 : 0, 0.1);
    }
    if (flame.current) {
      flame.current.visible = k.boosting;
      const s = 0.8 + Math.random() * 0.6;
      flame.current.scale.set(s, 1 + Math.random() * 0.8, s);
    }
  });

  const dark = '#15171d';
  const chrome = '#d9dde6';
  const wheelPos: Array<[number, number, number]> = [
    [0.66, 0.31, 0.66],
    [0.66, 0.31, -0.66],
    [-0.7, 0.33, 0.7],
    [-0.7, 0.33, -0.7],
  ];
  const suit = player ? '#f4f6fb' : '#2a2d38';
  return (
    <group ref={group}>
      <group ref={body}>
        {/* floor pan + side pods */}
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[2.0, 0.14, 1.15]} />
          <meshStandardMaterial color={dark} roughness={0.6} metalness={0.3} />
        </mesh>
        {[0.62, -0.62].map((z, i) => (
          <mesh key={i} position={[-0.1, 0.42, z]} castShadow>
            <capsuleGeometry args={[0.13, 1.0, 4, 10]} />
            <meshStandardMaterial color={color} roughness={0.3} metalness={0.15} />
          </mesh>
        ))}
        {/* main shell (rounded) */}
        <mesh position={[0.25, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <capsuleGeometry args={[0.38, 0.9, 6, 16]} />
          <meshPhysicalMaterial color={color} roughness={0.22} metalness={0.1} clearcoat={0.9} clearcoatRoughness={0.15} />
        </mesh>
        {/* nose cone with emblem */}
        <mesh position={[1.05, 0.5, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
          <coneGeometry args={[0.36, 0.5, 18]} />
          <meshPhysicalMaterial color={color} roughness={0.22} metalness={0.1} clearcoat={0.9} clearcoatRoughness={0.15} />
        </mesh>
        <mesh position={[0.86, 0.78, 0]} rotation={[-Math.PI / 2 + 0.75, 0, 0]}>
          <circleGeometry args={[0.2, 24]} />
          <meshStandardMaterial map={emblem} transparent roughness={0.4} />
        </mesh>
        {/* front bumper */}
        <mesh position={[1.22, 0.32, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.5, 0.06, 8, 24, Math.PI]} />
          <meshStandardMaterial color={chrome} metalness={1} roughness={0.25} />
        </mesh>
        {/* rear bumper + wing */}
        <mesh position={[-1.15, 0.36, 0]} castShadow>
          <boxGeometry args={[0.1, 0.12, 1.3]} />
          <meshStandardMaterial color={chrome} metalness={1} roughness={0.3} />
        </mesh>
        <mesh position={[-1.0, 0.9, 0]} castShadow>
          <boxGeometry args={[0.32, 0.05, 1.25]} />
          <meshStandardMaterial color={dark} roughness={0.5} metalness={0.3} />
        </mesh>
        {[0.55, -0.55].map((z, i) => (
          <mesh key={i} position={[-1.0, 0.72, z]}>
            <boxGeometry args={[0.24, 0.32, 0.05]} />
            <meshStandardMaterial color={color} roughness={0.35} />
          </mesh>
        ))}
        {/* engine + exhausts */}
        <mesh position={[-0.75, 0.6, 0]} castShadow>
          <boxGeometry args={[0.5, 0.36, 0.7]} />
          <meshStandardMaterial color="#2b2e37" roughness={0.5} metalness={0.6} />
        </mesh>
        {[0.22, -0.22].map((z, i) => (
          <mesh key={i} position={[-1.2, 0.58, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.07, 0.09, 0.5, 12]} />
            <meshStandardMaterial color={chrome} metalness={1} roughness={0.2} />
          </mesh>
        ))}
        <mesh ref={flame} position={[-1.55, 0.58, 0]} rotation={[0, 0, Math.PI / 2]} visible={false}>
          <coneGeometry args={[0.16, 0.7, 10]} />
          <meshBasicMaterial color="#ffb347" transparent opacity={0.9} />
        </mesh>
        {/* seat + driver */}
        <mesh position={[-0.35, 0.72, 0]} castShadow>
          <boxGeometry args={[0.35, 0.55, 0.6]} />
          <meshStandardMaterial color={dark} roughness={0.8} />
        </mesh>
        <mesh position={[-0.2, 0.92, 0]} castShadow>
          <capsuleGeometry args={[0.23, 0.32, 4, 12]} />
          <meshStandardMaterial color={suit} roughness={0.7} />
        </mesh>
        {/* arms to the wheel */}
        {[0.2, -0.2].map((z, i) => (
          <mesh key={i} position={[0.12, 0.98, z]} rotation={[0, 0, -0.9]} castShadow>
            <capsuleGeometry args={[0.06, 0.5, 4, 8]} />
            <meshStandardMaterial color={suit} roughness={0.7} />
          </mesh>
        ))}
        {[0.2, -0.2].map((z, i) => (
          <mesh key={i} position={[0.4, 1.06, z]}>
            <sphereGeometry args={[0.08, 10, 8]} />
            <meshStandardMaterial color="#f7f7f5" roughness={0.6} />
          </mesh>
        ))}
        {/* helmet */}
        <group ref={head} position={[-0.2, 1.36, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.27, 18, 14]} />
            <meshPhysicalMaterial color={color} roughness={0.2} metalness={0.1} clearcoat={1} />
          </mesh>
          <mesh position={[0.16, 0.0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <sphereGeometry args={[0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshPhysicalMaterial color="#0f1a2a" roughness={0.05} metalness={0.6} clearcoat={1} />
          </mesh>
          <mesh position={[0, 0.2, 0]} rotation={[-Math.PI / 2 + 0.2, 0, 0]}>
            <circleGeometry args={[0.12, 20]} />
            <meshStandardMaterial map={emblem} transparent />
          </mesh>
        </group>
        {/* steering wheel */}
        <mesh ref={wheelRef} position={[0.42, 1.0, 0]} rotation={[0, 0, Math.PI / 2 - 0.5]}>
          <torusGeometry args={[0.17, 0.028, 8, 20]} />
          <meshStandardMaterial color="#111" roughness={0.6} />
        </mesh>
      </group>
      {/* wheels: hub group steers, tyre mesh spins */}
      {wheelPos.map((p, i) => (
        <group key={i} position={p} ref={(el) => (wheels.current[i] = el)}>
          <mesh rotation={[Math.PI / 2, 0, 0]} ref={(el) => (tyres.current[i] = el)} castShadow>
            <cylinderGeometry args={[0.31, 0.31, 0.3, 20]} />
            <meshStandardMaterial color="#141519" roughness={0.95} />
          </mesh>
          {[0.16, -0.16].map((z, j) => (
            <mesh key={j} position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.19, 0.19, 0.02, 16]} />
              <meshStandardMaterial color={player ? '#e3c25a' : chrome} metalness={1} roughness={0.25} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
