/**
 * Motion Kart scene root: world for the selected theme, karts, effects, simulation stepping
 * and the chase camera. Gameplay lives in ../game; this file only renders it.
 */
import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { sceneSettings } from '@/features/activity/sceneQuality';
import type { Race } from '../game/race';
import type { KartInput } from '../game/kart';
import { Clouds, Horizon, SkyDome, Sun, Terrain } from './Environment';
import { KartModel } from './KartModel';
import { KartEffects } from './Particles';
import { Billboards, Flags, Flora, Grandstands } from './Scenery';
import { Barriers, CheckpointArches, Gantry, Road, TyreWalls } from './TrackMesh';
import { kartTheme, type KartThemeId } from './themes';

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

function Simulation({ driver, shadows, sunColor, sunIntensity }: { driver: SceneDriver; shadows: boolean; sunColor: string; sunIntensity: number }) {
  const { camera } = useThree();
  const acc = useRef(0);
  const camPos = useRef(new THREE.Vector3(0, 8, 24));
  const camTarget = useRef(new THREE.Vector3());
  const light = useRef<THREE.DirectionalLight>(null);
  const lightTarget = useMemo(() => new THREE.Object3D(), []);
  const orbit = useRef(0);
  const initialised = useRef(false);
  const shake = useRef(0);
  const roll = useRef(0);

  useFrame((state, rawDt) => {
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
    const t = state.clock.elapsedTime;
    if (driver.showcase()) {
      // slow cinematic orbit around the grid
      orbit.current += dt * 0.1;
      const r = 14;
      tmpV.set(k.x + Math.cos(orbit.current) * r, 3.2 + Math.sin(orbit.current * 0.7) * 1.2, k.z + Math.sin(orbit.current) * r);
      camPos.current.lerp(tmpV, initialised.current ? 1 - Math.exp(-dt * 2) : 1);
      tmpT.set(k.x, 1.0, k.z);
      camTarget.current.lerp(tmpT, initialised.current ? 1 - Math.exp(-dt * 3) : 1);
      const fov = 50;
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov += (fov - cam.fov) * 0.1;
        cam.updateProjectionMatrix();
      }
      roll.current *= 0.9;
    } else {
      const fx = Math.cos(k.heading);
      const fz = Math.sin(k.heading);
      const sp = Math.abs(k.speed);
      const spN = Math.min(sp / 40, 1);
      const dist = 6.8 + spN * 2.6 + (k.boosting ? 1.4 : 0);
      const height = 2.8 + spN * 0.9;
      // camera lags a little behind the steering, like a real chase cam
      const lag = -k.steer * 0.35 * spN;
      const cx = Math.cos(k.heading + lag);
      const cz = Math.sin(k.heading + lag);
      tmpV.set(k.x - cx * dist, height, k.z - cz * dist);
      const follow = driver.running() ? 1 - Math.exp(-dt * 6) : 0;
      camPos.current.lerp(tmpV, initialised.current ? follow : 1);
      tmpT.set(k.x + fx * 7, 0.8, k.z + fz * 7);
      camTarget.current.lerp(tmpT, initialised.current ? Math.min(1, follow * 1.6) : 1);
      const fov = 58 + spN * 16 + (k.boosting ? 8 : 0);
      if (Math.abs(cam.fov - fov) > 0.05) {
        cam.fov += (fov - cam.fov) * 0.08;
        cam.updateProjectionMatrix();
      }
      shake.current = THREE.MathUtils.lerp(shake.current, k.boosting ? 0.05 : k.offRoad && sp > 5 ? 0.03 : 0, 0.1);
      roll.current = THREE.MathUtils.lerp(roll.current, -k.steer * 0.04 * spN, 0.08);
    }
    initialised.current = true;
    cam.position.copy(camPos.current);
    if (shake.current > 0.001) cam.position.add(tmpV.set(Math.sin(t * 43) * shake.current, Math.cos(t * 51) * shake.current, 0));
    cam.lookAt(camTarget.current);
    cam.rotateZ(roll.current);

    if (light.current) {
      light.current.position.set(k.x + 55, 80, k.z + 35);
      lightTarget.position.set(k.x, 0, k.z);
      lightTarget.updateMatrixWorld();
    }
  }, -1);

  return (
    <>
      <directionalLight
        ref={light}
        castShadow={shadows}
        intensity={sunIntensity}
        color={sunColor}
        target={lightTarget}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-near={10}
        shadow-camera-far={260}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
      <primitive object={lightTarget} />
    </>
  );
}

export function KartScene({ driver, accent, themeId }: { driver: SceneDriver; accent: string; themeId: KartThemeId }) {
  const track = driver.race().track;
  const raceForArches = driver.race();
  const quality = sceneSettings();
  const high = quality.shadows;
  const theme = kartTheme(themeId);
  return (
    <Canvas
      shadows={quality.shadows ? { type: THREE.PCFSoftShadowMap } : false}
      dpr={quality.dpr}
      gl={{ antialias: quality.antialias, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ fov: 58, near: 0.3, far: 2000, position: [0, 8, 24] }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={[theme.sky.horizon]} />
      <fog attach="fog" args={[theme.fog.color, theme.fog.near, theme.fog.far]} />
      <hemisphereLight args={[theme.light.hemiSky, theme.light.hemiGround, 0.85]} />
      <ambientLight intensity={theme.light.ambient} />
      <SkyDome theme={theme} />
      <Sun theme={theme} />
      <Clouds count={high ? 26 : 12} />
      <Horizon theme={theme} />
      <Terrain track={track} theme={theme} segments={high ? 180 : 110} />
      <Road track={track} theme={theme} />
      <Barriers track={track} theme={theme} />
      {theme.barrier === 'fence' && <TyreWalls track={track} theme={theme} />}
      <Flora track={track} theme={theme} density={high ? 1 : 0.5} />
      <Grandstands track={track} theme={theme} crowdPerStand={high ? 180 : 80} />
      <Billboards track={track} theme={theme} />
      <Flags track={track} theme={theme} />
      <Gantry track={track} theme={theme} accent={accent} />
      <CheckpointArches race={raceForArches} />
      <KartModel getKart={() => driver.race().player} color={accent} player letter="A" />
      {[0, 1, 2].map((i) => (
        <KartModel key={i} getKart={() => driver.race().ai[i]?.kart} color={driver.race().ai[i]?.kart.color ?? '#888'} letter={['B', 'C', 'D'][i]} />
      ))}
      <KartEffects getKart={() => driver.race().player} dustColor={theme.dust} />
      <Simulation driver={driver} shadows={high} sunColor={theme.light.sun} sunIntensity={theme.light.sunIntensity} />
    </Canvas>
  );
}
