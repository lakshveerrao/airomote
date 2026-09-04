/**
 * Kart effects: tyre smoke when drifting / braking hard, dust off-road, sparks and a blue
 * trail while boosting. Two instanced sprite-like pools (soft puffs + small sparks).
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Kart } from '../game/kart';
import { softDiscTexture } from './textures';

const MAX_PUFFS = 160;
const MAX_SPARKS = 120;
const tmpO = new THREE.Object3D();

interface Pool {
  life: Float32Array;
  max: Float32Array;
  pos: Float32Array;
  vel: Float32Array;
  size: Float32Array;
  kind: Uint8Array; // 0 smoke, 1 dust, 2 boost
  next: number;
  accum: number;
}

function makePool(n: number): Pool {
  return { life: new Float32Array(n), max: new Float32Array(n), pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), size: new Float32Array(n), kind: new Uint8Array(n), next: 0, accum: 0 };
}

export function KartEffects({ getKart, dustColor }: { getKart: () => Kart | undefined; dustColor: string }) {
  const puffs = useRef<THREE.InstancedMesh>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const puffPool = useRef(makePool(MAX_PUFFS));
  const sparkPool = useRef(makePool(MAX_SPARKS));
  const tex = useMemo(() => softDiscTexture(64), []);
  const cSmoke = useMemo(() => new THREE.Color('#e9e9ea'), []);
  const cDust = useMemo(() => new THREE.Color(dustColor), [dustColor]);
  const cBoost = useMemo(() => new THREE.Color('#7dd3fc'), []);
  const cSpark = useMemo(() => new THREE.Color('#ffb347'), []);
  const cSparkHot = useMemo(() => new THREE.Color('#fff2c0'), []);

  useFrame(({ camera }, rawDt) => {
    const k = getKart();
    const pm = puffs.current;
    const sm = sparks.current;
    if (!pm || !sm) return;
    const dt = Math.min(rawDt, 0.05);
    const P = puffPool.current;
    const S = sparkPool.current;
    if (k) {
      const sp = Math.abs(k.speed);
      const fx = Math.cos(k.heading);
      const fz = Math.sin(k.heading);
      const drifting = sp > 14 && Math.abs(k.steer) > 0.55;
      const puffRate = k.offRoad && sp > 4 ? 55 : drifting ? 45 : k.boosting ? 20 : 0;
      P.accum += puffRate * dt;
      while (P.accum >= 1) {
        P.accum -= 1;
        const i = P.next;
        P.next = (P.next + 1) % MAX_PUFFS;
        const side = Math.random() < 0.5 ? 1 : -1;
        const kind = k.offRoad ? 1 : k.boosting && !drifting ? 2 : 0;
        P.kind[i] = kind;
        P.max[i] = kind === 2 ? 0.45 : kind === 1 ? 0.9 : 1.1;
        P.life[i] = P.max[i];
        P.size[i] = kind === 2 ? 0.28 : 0.55;
        // rear wheels
        P.pos[i * 3] = k.x - fx * (kind === 2 ? 1.5 : 0.8) - fz * side * 0.65;
        P.pos[i * 3 + 1] = 0.25;
        P.pos[i * 3 + 2] = k.z - fz * (kind === 2 ? 1.5 : 0.8) + fx * side * 0.65;
        const back = kind === 2 ? 10 : 1.5;
        P.vel[i * 3] = -fx * back + (Math.random() - 0.5) * 1.6 - fz * side * (drifting ? 2 : 0.4);
        P.vel[i * 3 + 1] = kind === 2 ? 0.3 : 1.3 + Math.random() * 0.8;
        P.vel[i * 3 + 2] = -fz * back + (Math.random() - 0.5) * 1.6 + fx * side * (drifting ? 2 : 0.4);
      }
      const sparkRate = k.boosting ? 140 : drifting ? 60 : 0;
      S.accum += sparkRate * dt;
      while (S.accum >= 1) {
        S.accum -= 1;
        const i = S.next;
        S.next = (S.next + 1) % MAX_SPARKS;
        const side = Math.random() < 0.5 ? 1 : -1;
        S.kind[i] = k.boosting ? 2 : 0;
        S.max[i] = 0.25 + Math.random() * 0.25;
        S.life[i] = S.max[i];
        S.size[i] = 0.09 + Math.random() * 0.08;
        S.pos[i * 3] = k.x - fx * (k.boosting ? 1.35 : 0.8) - fz * side * (k.boosting ? 0.22 : 0.7);
        S.pos[i * 3 + 1] = k.boosting ? 0.58 : 0.12;
        S.pos[i * 3 + 2] = k.z - fz * (k.boosting ? 1.35 : 0.8) + fx * side * (k.boosting ? 0.22 : 0.7);
        const back = k.boosting ? 14 + Math.random() * 8 : 4 + Math.random() * 4;
        S.vel[i * 3] = -fx * back + (Math.random() - 0.5) * 4;
        S.vel[i * 3 + 1] = 1 + Math.random() * 3;
        S.vel[i * 3 + 2] = -fz * back + (Math.random() - 0.5) * 4;
      }
    }
    // integrate puffs (billboarded to camera)
    for (let i = 0; i < MAX_PUFFS; i++) {
      if (P.life[i] <= 0) {
        tmpO.scale.setScalar(0);
        tmpO.position.set(0, -20, 0);
      } else {
        P.life[i] -= dt;
        P.pos[i * 3] += P.vel[i * 3] * dt;
        P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt;
        P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
        P.vel[i * 3] *= 1 - dt * 1.5;
        P.vel[i * 3 + 2] *= 1 - dt * 1.5;
        const f = Math.max(0, P.life[i] / P.max[i]);
        const grow = P.kind[i] === 2 ? 1 + (1 - f) * 1.5 : 1 + (1 - f) * 3.2;
        tmpO.position.set(P.pos[i * 3], Math.max(0.1, P.pos[i * 3 + 1]), P.pos[i * 3 + 2]);
        tmpO.quaternion.copy(camera.quaternion);
        tmpO.scale.setScalar(P.size[i] * grow);
        pm.setColorAt(i, P.kind[i] === 2 ? cBoost : P.kind[i] === 1 ? cDust : cSmoke);
      }
      tmpO.updateMatrix();
      pm.setMatrixAt(i, tmpO.matrix);
    }
    pm.instanceMatrix.needsUpdate = true;
    if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
    // integrate sparks
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (S.life[i] <= 0) {
        tmpO.scale.setScalar(0);
        tmpO.position.set(0, -20, 0);
      } else {
        S.life[i] -= dt;
        S.pos[i * 3] += S.vel[i * 3] * dt;
        S.pos[i * 3 + 1] += S.vel[i * 3 + 1] * dt;
        S.pos[i * 3 + 2] += S.vel[i * 3 + 2] * dt;
        S.vel[i * 3 + 1] -= 9 * dt;
        if (S.pos[i * 3 + 1] < 0.03) {
          S.pos[i * 3 + 1] = 0.03;
          S.vel[i * 3 + 1] *= -0.4;
        }
        const f = Math.max(0, S.life[i] / S.max[i]);
        tmpO.position.set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]);
        tmpO.quaternion.copy(camera.quaternion);
        tmpO.scale.set(S.size[i] * (1 + (1 - f)), S.size[i] * 0.6, 1);
        sm.setColorAt(i, S.kind[i] === 2 ? (f > 0.5 ? cSparkHot : cBoost) : f > 0.5 ? cSparkHot : cSpark);
      }
      tmpO.updateMatrix();
      sm.setMatrixAt(i, tmpO.matrix);
    }
    sm.instanceMatrix.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={puffs} args={[undefined, undefined, MAX_PUFFS]} frustumCulled={false} renderOrder={5}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={tex} transparent opacity={0.55} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={sparks} args={[undefined, undefined, MAX_SPARKS]} frustumCulled={false} renderOrder={6}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={tex} transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>
    </group>
  );
}
