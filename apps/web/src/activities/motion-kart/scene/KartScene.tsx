import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Race } from '../game/race';
import type { Kart, KartInput } from '../game/kart';
import type { TrackModel } from '../game/track';
import { ribbonGeometry, scatterOffTrack, seededRandom } from './geometry';

export interface SceneDriver {
  /** Current race (replaced on restart). */
  race: () => Race;
  /** True while the simulation should advance. */
  running: () => boolean;
  /** True on the intro screen: slow orbit camera. */
  showcase: () => boolean;
  input: () => KartInput;
  /** Called every rendered frame after stepping. */
  onFrame: (race: Race, dt: number) => void;
}

const FIXED_DT = 1 / 120;
const tmpV = new THREE.Vector3();
const tmpT = new THREE.Vector3();
const tmpO = new THREE.Object3D();

// ---------------------------------------------------------------- track & world

function Track({ track }: { track: TrackModel }) {
  const geos = useMemo(() => {
    const hw = track.halfWidth;
    const road = ribbonGeometry(track, -hw, hw, 0.02, { every: 2 });
    const shoulderL = ribbonGeometry(track, hw, hw + 1.1, 0.012, { every: 3 });
    const shoulderR = ribbonGeometry(track, -hw - 1.1, -hw, 0.012, { every: 3 });
    const stripe = (i: number): [number, number, number] => (Math.floor(i / 12) % 2 === 0 ? [0.95, 0.25, 0.22] : [0.96, 0.96, 0.94]);
    const edgeL = ribbonGeometry(track, hw - 0.42, hw - 0.05, 0.03, { every: 2, colorFn: stripe });
    const edgeR = ribbonGeometry(track, -hw + 0.05, -hw + 0.42, 0.03, { every: 2, colorFn: stripe });
    const centre = ribbonGeometry(track, -0.09, 0.09, 0.03, { every: 2, dashPeriod: 24, dashOn: 12 });
    // start/finish checker: 2 m long, 8 squares across
    const n = track.samples.length;
    const step = track.length / n;
    const checkerRows = Math.max(2, Math.round(2.4 / step));
    const checker = new THREE.BufferGeometry();
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const cols = 8;
    for (let r = 0; r < checkerRows; r++) {
      const s0 = track.samples[r % n];
      const s1 = track.samples[(r + 1) % n];
      for (let c = 0; c < cols; c++) {
        const a = -hw + (c / cols) * 2 * hw;
        const b = -hw + ((c + 1) / cols) * 2 * hw;
        const shade = (r + c) % 2 === 0 ? 0.95 : 0.08;
        for (const p of [s0, s1]) {
          const nx = p.tz;
          const nz = -p.tx;
          pos.push(p.x + nx * a, 0.035, p.z + nz * a, p.x + nx * b, 0.035, p.z + nz * b);
          col.push(shade, shade, shade, shade, shade, shade);
        }
        const base = (r * cols + c) * 4;
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    checker.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    checker.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    checker.setIndex(idx);
    checker.computeVertexNormals();
    return { road, shoulderL, shoulderR, edgeL, edgeR, centre, checker };
  }, [track]);

  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);

  return (
    <group>
      <mesh geometry={geos.road} receiveShadow>
        <meshStandardMaterial color="#3b3f49" roughness={0.95} metalness={0} />
      </mesh>
      <mesh geometry={geos.shoulderL} receiveShadow>
        <meshStandardMaterial color="#8d7d5b" roughness={1} />
      </mesh>
      <mesh geometry={geos.shoulderR} receiveShadow>
        <meshStandardMaterial color="#8d7d5b" roughness={1} />
      </mesh>
      <mesh geometry={geos.edgeL}>
        <meshStandardMaterial vertexColors roughness={0.8} />
      </mesh>
      <mesh geometry={geos.edgeR}>
        <meshStandardMaterial vertexColors roughness={0.8} />
      </mesh>
      <mesh geometry={geos.centre}>
        <meshStandardMaterial color="#d9dce3" roughness={0.8} />
      </mesh>
      <mesh geometry={geos.checker}>
        <meshStandardMaterial vertexColors roughness={0.8} />
      </mesh>
    </group>
  );
}

function Posts({ track }: { track: TrackModel }) {
  // low boundary posts along both walls
  const ref = useRef<THREE.InstancedMesh>(null);
  const positions = useMemo(() => {
    const out: THREE.Vector3[] = [];
    for (let s = 0; s < track.length; s += 7) {
      for (const side of [1, -1]) {
        const p = track.offsetPoint(s, side * (track.wallDistance + 0.3));
        out.push(new THREE.Vector3(p.x, 0.45, p.z));
      }
    }
    return out;
  }, [track]);
  useEffect(() => {
    const m = ref.current!;
    positions.forEach((p, i) => {
      tmpO.position.copy(p);
      tmpO.rotation.set(0, 0, 0);
      tmpO.scale.set(1, 1, 1);
      tmpO.updateMatrix();
      m.setMatrixAt(i, tmpO.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [positions]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, positions.length]} castShadow>
      <cylinderGeometry args={[0.09, 0.11, 0.9, 6]} />
      <meshStandardMaterial color="#e8e6df" roughness={0.9} />
    </instancedMesh>
  );
}

function Foliage({ track }: { track: TrackModel }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const rocks = useRef<THREE.InstancedMesh>(null);
  const trees = useMemo(() => scatterOffTrack(track, 170, 11, 2.5), [track]);
  const stones = useMemo(() => scatterOffTrack(track, 70, 23, 1.2), [track]);
  useEffect(() => {
    const rnd = seededRandom(5);
    trees.forEach((t, i) => {
      const h = 3.2 * t.scale;
      tmpO.position.set(t.x, h * 0.35, t.z);
      tmpO.rotation.set(0, t.rot, 0);
      tmpO.scale.set(t.scale, t.scale, t.scale);
      tmpO.updateMatrix();
      trunks.current!.setMatrixAt(i, tmpO.matrix);
      tmpO.position.set(t.x, h * 0.35 + 2.4 * t.scale, t.z);
      const cs = t.scale * (0.9 + rnd() * 0.3);
      tmpO.scale.set(cs, t.scale * 1.1, cs);
      tmpO.updateMatrix();
      crowns.current!.setMatrixAt(i, tmpO.matrix);
    });
    trunks.current!.instanceMatrix.needsUpdate = true;
    crowns.current!.instanceMatrix.needsUpdate = true;
    stones.forEach((r, i) => {
      tmpO.position.set(r.x, 0.35 * r.scale, r.z);
      tmpO.rotation.set(r.rot, r.rot * 0.7, 0);
      tmpO.scale.set(r.scale, r.scale * 0.7, r.scale);
      tmpO.updateMatrix();
      rocks.current!.setMatrixAt(i, tmpO.matrix);
    });
    rocks.current!.instanceMatrix.needsUpdate = true;
  }, [trees, stones]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.18, 0.28, 2.4, 6]} />
        <meshStandardMaterial color="#6b4b32" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, trees.length]} castShadow>
        <coneGeometry args={[1.6, 3.4, 7]} />
        <meshStandardMaterial color="#2f8a4f" roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={rocks} args={[undefined, undefined, stones.length]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.8, 0]} />
        <meshStandardMaterial color="#8a8f99" roughness={1} flatShading />
      </instancedMesh>
    </group>
  );
}

function Gantry({ track, accent }: { track: TrackModel; accent: string }) {
  const p = track.pointAt(0);
  const h = track.headingAt(0);
  const w = track.halfWidth + 1.4;
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, -h, 0]}>
      {[w, -w].map((z, i) => (
        <mesh key={i} position={[0, 2.6, z]} castShadow>
          <boxGeometry args={[0.35, 5.2, 0.35]} />
          <meshStandardMaterial color="#e9e9ee" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 5.3, 0]} castShadow>
        <boxGeometry args={[0.6, 0.7, w * 2 + 0.35]} />
        <meshStandardMaterial color={accent} roughness={0.5} emissive={accent} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

function CheckpointArches({ race }: { race: Race }) {
  const items = useMemo(
    () =>
      race.checkpointS.slice(1).map((s) => ({
        p: race.track.pointAt(s),
        h: race.track.headingAt(s),
      })),
    [race],
  );
  const w = race.track.halfWidth + 0.9;
  return (
    <group>
      {items.map((it, i) => (
        <group key={i} position={[it.p.x, 0, it.p.z]} rotation={[0, -it.h, 0]}>
          {[w, -w].map((z, j) => (
            <mesh key={j} position={[0, 1.4, z]}>
              <boxGeometry args={[0.16, 2.8, 0.16]} />
              <meshStandardMaterial color="#6ea8ff" emissive="#6ea8ff" emissiveIntensity={0.5} transparent opacity={0.55} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function World({ track, accent }: { track: TrackModel; accent: string }) {
  return (
    <group>
      {/* grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[60, -0.02, -40]} receiveShadow>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color="#5f9a48" roughness={1} />
      </mesh>
      {/* beach */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-30, -0.01, -40]} receiveShadow>
        <planeGeometry args={[40, 900]} />
        <meshStandardMaterial color="#d9c48e" roughness={1} />
      </mesh>
      {/* sea */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-350, -0.3, -40]}>
        <planeGeometry args={[600, 900]} />
        <meshStandardMaterial color="#2f7fc4" roughness={0.25} metalness={0.1} />
      </mesh>
      {/* distant hills */}
      {[
        [150, -230, 60],
        [230, -120, 80],
        [240, 40, 70],
        [140, 170, 55],
        [-10, 190, 50],
      ].map(([x, z, r], i) => (
        <mesh key={i} position={[x, -r * 0.55, z]}>
          <sphereGeometry args={[r, 18, 12]} />
          <meshStandardMaterial color="#4c7f63" roughness={1} />
        </mesh>
      ))}
      <Track track={track} />
      <Posts track={track} />
      <Foliage track={track} />
      <Gantry track={track} accent={accent} />
    </group>
  );
}

function SkyDome() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color('#3f7fd6') }, horizon: { value: new THREE.Color('#cfe4f7') }, bottom: { value: new THREE.Color('#9fbfe0') } },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP;
          void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, clamp(-h*4.0,0.0,1.0)); gl_FragColor = vec4(c,1.0); }`,
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} frustumCulled={false}>
      <sphereGeometry args={[800, 24, 12]} />
    </mesh>
  );
}

// ---------------------------------------------------------------- karts

function KartMesh({ getKart, color, player }: { getKart: () => Kart | undefined; color: string; player?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const wheels = useRef<Array<THREE.Mesh | null>>([]);
  const glow = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const k = getKart();
    const g = group.current;
    if (!k || !g) return;
    g.position.set(k.x, 0, k.z);
    g.rotation.y = -k.heading;
    if (body.current) body.current.rotation.x = k.bodyRoll;
    const steer = k.steer * 0.45;
    wheels.current.forEach((w, i) => {
      if (!w) return;
      w.rotation.z = -k.wheelSpin;
      if (i < 2) w.rotation.y = -steer; // front wheels
    });
    if (glow.current) {
      const m = glow.current.material as THREE.MeshBasicMaterial;
      const target = k.boosting ? 0.85 : 0;
      m.opacity += (target - m.opacity) * 0.2;
      glow.current.visible = m.opacity > 0.02;
      glow.current.scale.setScalar(1 + (k.boosting ? Math.random() * 0.25 : 0));
    }
  });
  const wheelPos: Array<[number, number, number]> = [
    [0.62, 0.3, 0.6],
    [0.62, 0.3, -0.6],
    [-0.62, 0.3, 0.64],
    [-0.62, 0.3, -0.64],
  ];
  return (
    <group ref={group}>
      <group ref={body}>
        {/* chassis */}
        <mesh position={[0, 0.34, 0]} castShadow>
          <boxGeometry args={[1.9, 0.22, 1.05]} />
          <meshStandardMaterial color="#1c1e26" roughness={0.6} />
        </mesh>
        {/* body shell */}
        <mesh position={[0.15, 0.55, 0]} castShadow>
          <boxGeometry args={[1.35, 0.3, 0.8]} />
          <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
        </mesh>
        {/* nose */}
        <mesh position={[0.95, 0.5, 0]} castShadow>
          <boxGeometry args={[0.5, 0.18, 0.6]} />
          <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
        </mesh>
        {/* rear wing */}
        <mesh position={[-0.9, 0.82, 0]} castShadow>
          <boxGeometry args={[0.28, 0.06, 1.1]} />
          <meshStandardMaterial color="#1c1e26" roughness={0.5} />
        </mesh>
        {[0.5, -0.5].map((z, i) => (
          <mesh key={i} position={[-0.9, 0.7, z]}>
            <boxGeometry args={[0.2, 0.22, 0.05]} />
            <meshStandardMaterial color="#1c1e26" />
          </mesh>
        ))}
        {/* driver */}
        <mesh position={[-0.25, 0.85, 0]} castShadow>
          <capsuleGeometry args={[0.22, 0.35, 4, 10]} />
          <meshStandardMaterial color={player ? '#f4f6fb' : '#2a2d38'} roughness={0.7} />
        </mesh>
        <mesh position={[-0.25, 1.22, 0]} castShadow>
          <sphereGeometry args={[0.24, 14, 10]} />
          <meshStandardMaterial color={color} roughness={0.25} metalness={0.2} />
        </mesh>
        {/* steering wheel */}
        <mesh position={[0.25, 0.95, 0]} rotation={[0, 0, Math.PI / 2 - 0.4]}>
          <torusGeometry args={[0.16, 0.025, 8, 16]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      </group>
      {wheelPos.map((p, i) => (
        <mesh key={i} position={p} rotation={[Math.PI / 2, 0, 0]} ref={(el) => (wheels.current[i] = el)} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.26, 14]} />
          <meshStandardMaterial color="#15161a" roughness={0.9} />
        </mesh>
      ))}
      {/* boost glow */}
      <mesh ref={glow} position={[-1.25, 0.45, 0]} visible={false}>
        <sphereGeometry args={[0.35, 10, 8]} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={0} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- particles

const MAX_PARTICLES = 64;
function Particles({ getKart }: { getKart: () => Kart | undefined }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const state = useRef({
    life: new Float32Array(MAX_PARTICLES),
    pos: new Float32Array(MAX_PARTICLES * 3),
    vel: new Float32Array(MAX_PARTICLES * 3),
    kind: new Uint8Array(MAX_PARTICLES),
    next: 0,
    accum: 0,
  });
  const colorDust = useMemo(() => new THREE.Color('#b9a77d'), []);
  const colorBoost = useMemo(() => new THREE.Color('#7dd3fc'), []);
  useFrame((_, dt) => {
    const m = ref.current;
    const k = getKart();
    if (!m) return;
    const s = state.current;
    const d = Math.min(dt, 0.05);
    if (k) {
      const rate = k.offRoad && Math.abs(k.speed) > 4 ? 40 : k.boosting ? 60 : 0;
      s.accum += rate * d;
      const fx = Math.cos(k.heading);
      const fz = Math.sin(k.heading);
      while (s.accum >= 1) {
        s.accum -= 1;
        const i = s.next;
        s.next = (s.next + 1) % MAX_PARTICLES;
        const side = Math.random() < 0.5 ? 1 : -1;
        s.kind[i] = k.boosting && !k.offRoad ? 1 : 0;
        s.life[i] = s.kind[i] ? 0.35 : 0.7;
        s.pos[i * 3] = k.x - fx * 0.9 - fz * side * 0.5;
        s.pos[i * 3 + 1] = 0.25;
        s.pos[i * 3 + 2] = k.z - fz * 0.9 + fx * side * 0.5;
        const back = s.kind[i] ? 9 : 2;
        s.vel[i * 3] = -fx * back + (Math.random() - 0.5) * 2;
        s.vel[i * 3 + 1] = s.kind[i] ? 0.5 : 1.8 + Math.random();
        s.vel[i * 3 + 2] = -fz * back + (Math.random() - 0.5) * 2;
      }
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (s.life[i] <= 0) {
        tmpO.scale.setScalar(0);
        tmpO.position.set(0, -10, 0);
      } else {
        s.life[i] -= d;
        s.pos[i * 3] += s.vel[i * 3] * d;
        s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * d;
        s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * d;
        s.vel[i * 3 + 1] -= 2 * d;
        const f = Math.max(0, s.life[i] / (s.kind[i] ? 0.35 : 0.7));
        tmpO.position.set(s.pos[i * 3], Math.max(0.05, s.pos[i * 3 + 1]), s.pos[i * 3 + 2]);
        tmpO.scale.setScalar(s.kind[i] ? 0.25 * f : 0.5 * (1.2 - f));
        m.setColorAt(i, s.kind[i] ? colorBoost : colorDust);
      }
      tmpO.updateMatrix();
      m.setMatrixAt(i, tmpO.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
      <sphereGeometry args={[0.5, 6, 5]} />
      <meshBasicMaterial transparent opacity={0.55} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------- simulation + camera

function Simulation({ driver }: { driver: SceneDriver }) {
  const { camera } = useThree();
  const acc = useRef(0);
  const camPos = useRef(new THREE.Vector3(0, 8, 24));
  const camTarget = useRef(new THREE.Vector3());
  const light = useRef<THREE.DirectionalLight>(null);
  const lightTarget = useMemo(() => new THREE.Object3D(), []);
  const orbit = useRef(0);
  const initialised = useRef(false);

  useFrame((_, rawDt) => {
    const race = driver.race();
    const dt = Math.min(rawDt, 0.05);
    if (driver.running()) {
      acc.current += dt;
      const input = driver.input();
      let steps = 0;
      while (acc.current >= FIXED_DT && steps < 8) {
        race.step(FIXED_DT, input);
        acc.current -= FIXED_DT;
        steps++;
      }
    } else acc.current = 0;
    driver.onFrame(race, dt);

    const k = race.player;
    const cam = camera as THREE.PerspectiveCamera;
    if (driver.showcase()) {
      // slow orbit around the grid
      orbit.current += dt * 0.12;
      const r = 26;
      tmpV.set(k.x + Math.cos(orbit.current) * r, 9 + Math.sin(orbit.current * 0.7) * 2, k.z + Math.sin(orbit.current) * r);
      camPos.current.lerp(tmpV, initialised.current ? 1 - Math.exp(-dt * 2) : 1);
      tmpT.set(k.x, 1.2, k.z);
      camTarget.current.lerp(tmpT, initialised.current ? 1 - Math.exp(-dt * 3) : 1);
      const fov = 55;
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov += (fov - cam.fov) * 0.1;
        cam.updateProjectionMatrix();
      }
    } else {
      const fx = Math.cos(k.heading);
      const fz = Math.sin(k.heading);
      const sp = Math.abs(k.speed);
      const dist = 7.5 + Math.min(sp / 40, 1) * 2.5 + (k.boosting ? 1.2 : 0);
      const height = 3.2 + Math.min(sp / 40, 1) * 0.8;
      tmpV.set(k.x - fx * dist, height, k.z - fz * dist);
      const follow = driver.running() ? 1 - Math.exp(-dt * 5.5) : 0;
      camPos.current.lerp(tmpV, initialised.current ? follow : 1);
      tmpT.set(k.x + fx * 6, 0.9, k.z + fz * 6);
      camTarget.current.lerp(tmpT, initialised.current ? Math.min(1, follow * 1.6) : 1);
      const fov = 60 + Math.min(sp / 40, 1) * 14 + (k.boosting ? 6 : 0);
      if (Math.abs(cam.fov - fov) > 0.05) {
        cam.fov += (fov - cam.fov) * 0.08;
        cam.updateProjectionMatrix();
      }
    }
    initialised.current = true;
    cam.position.copy(camPos.current);
    cam.lookAt(camTarget.current);

    if (light.current) {
      light.current.position.set(k.x + 40, 70, k.z + 25);
      lightTarget.position.set(k.x, 0, k.z);
      lightTarget.updateMatrixWorld();
    }
  }, -1);

  return (
    <>
      <directionalLight
        ref={light}
        castShadow
        intensity={2.4}
        color="#fff4e0"
        target={lightTarget}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={10}
        shadow-camera-far={200}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />
      <primitive object={lightTarget} />
    </>
  );
}

// ---------------------------------------------------------------- root

export function KartScene({ driver, accent }: { driver: SceneDriver; accent: string }) {
  const track = driver.race().track;
  const raceForArches = driver.race();
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 60, near: 0.3, far: 1600, position: [0, 8, 24] }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#9fbfe0']} />
      <fog attach="fog" args={['#bcd6ee', 120, 520]} />
      <hemisphereLight args={['#dfeeff', '#4a6a3a', 0.9]} />
      <ambientLight intensity={0.25} />
      <SkyDome />
      <World track={track} accent={accent} />
      <CheckpointArches race={raceForArches} />
      <KartMesh getKart={() => driver.race().player} color={accent} player />
      {[0, 1, 2].map((i) => (
        <KartMesh key={i} getKart={() => driver.race().ai[i]?.kart} color={driver.race().ai[i]?.kart.color ?? '#888'} />
      ))}
      <Particles getKart={() => driver.race().player} />
      <Simulation driver={driver} />
    </Canvas>
  );
}
