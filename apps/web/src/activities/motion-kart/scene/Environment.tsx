/**
 * Sky, sun, clouds, rolling terrain and the distant horizon for a kart theme.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TrackModel } from '../game/track';
import { seededRandom } from './geometry';
import type { KartTheme } from './themes';
import { cloudTexture, groundTexture, softDiscTexture } from './textures';
import { WORLD_CENTER, WORLD_SIZE, terrainHeight } from './world';

export function SkyDome({ theme }: { theme: KartTheme }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(theme.sky.top) },
          horizon: { value: new THREE.Color(theme.sky.horizon) },
          bottom: { value: new THREE.Color(theme.sky.bottom) },
          sunDir: { value: new THREE.Vector3(0.55, 0.62, 0.35).normalize() },
          sunColor: { value: new THREE.Color(theme.sky.sun) },
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vP;
          void main(){
            vec3 d = normalize(vP);
            float h = d.y;
            vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, bottom, clamp(-h*5.0,0.0,1.0));
            float s = max(dot(d, sunDir), 0.0);
            c += sunColor * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.18 + pow(s, 3.0) * 0.06);
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    [theme],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} frustumCulled={false} renderOrder={-10}>
      <sphereGeometry args={[900, 32, 16]} />
    </mesh>
  );
}

export function Clouds({ count }: { count: number }) {
  const textures = useMemo(() => [cloudTexture(3), cloudTexture(11), cloudTexture(29)], []);
  const clouds = useMemo(() => {
    const rnd = seededRandom(77);
    return Array.from({ length: count }, (_, i) => {
      const ang = rnd() * Math.PI * 2;
      const r = 260 + rnd() * 420;
      return {
        x: WORLD_CENTER.x + Math.cos(ang) * r,
        z: WORLD_CENTER.z + Math.sin(ang) * r,
        y: 70 + rnd() * 90,
        w: 90 + rnd() * 160,
        tex: i % 3,
        speed: 0.4 + rnd() * 0.8,
        opacity: 0.75 + rnd() * 0.25,
      };
    });
  }, [count]);
  const refs = useRef<THREE.Sprite[]>([]);
  useFrame((_, dt) => {
    clouds.forEach((c, i) => {
      const s = refs.current[i];
      if (!s) return;
      s.position.x += c.speed * dt;
      if (s.position.x > WORLD_CENTER.x + 720) s.position.x = WORLD_CENTER.x - 720;
    });
  });
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  return (
    <group>
      {clouds.map((c, i) => (
        <sprite key={i} ref={(s) => s && (refs.current[i] = s)} position={[c.x, c.y, c.z]} scale={[c.w, c.w * 0.5, 1]}>
          <spriteMaterial map={textures[c.tex]} transparent opacity={c.opacity} depthWrite={false} fog={false} />
        </sprite>
      ))}
    </group>
  );
}

export function Sun({ theme }: { theme: KartTheme }) {
  const tex = useMemo(() => softDiscTexture(128), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const dir = new THREE.Vector3(0.55, 0.62, 0.35).normalize().multiplyScalar(820);
  return (
    <sprite position={[WORLD_CENTER.x + dir.x, dir.y, WORLD_CENTER.z + dir.z]} scale={[140, 140, 1]}>
      <spriteMaterial map={tex} color={theme.sky.sun} transparent opacity={0.9} depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
    </sprite>
  );
}

/** Heightfield terrain with per-vertex colour variation, flat along the track. */
export function Terrain({ track, theme, segments }: { track: TrackModel; theme: KartTheme; segments: number }) {
  const { geometry, texture } = useMemo(() => {
    const g = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(theme.ground.base);
    const dark = new THREE.Color(theme.ground.dark);
    const light = new THREE.Color(theme.ground.light);
    const far = new THREE.Color(theme.ground.far);
    const hill = new THREE.Color(theme.hills.color);
    const tmp = new THREE.Color();
    const rnd = seededRandom(3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + WORLD_CENTER.x;
      const z = pos.getZ(i) + WORLD_CENTER.z;
      const near = track.nearest(x, z);
      const h = terrainHeight(x, z, near.distance, track, theme.hills.amplitude);
      pos.setXYZ(i, x, h - 0.06, z);
      // colour: base with noise, brighter on slopes/heights, muted far away
      const n = rnd();
      tmp.copy(base).lerp(n < 0.5 ? dark : light, Math.abs(n - 0.5) * 0.9);
      const hf = Math.max(0, Math.min(1, h / (theme.hills.amplitude * 0.9)));
      tmp.lerp(hill, hf * 0.6);
      tmp.lerp(far, Math.max(0, Math.min(1, (near.distance - 120) / 220)) * 0.7);
      // trodden verge right next to the run-off
      const verge = Math.max(0, 1 - Math.abs(near.distance - (track.wallDistance + 1.5)) / 3);
      tmp.lerp(new THREE.Color(theme.road.verge), verge * 0.35);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const texture = groundTexture(theme.ground.base, theme.ground.dark, theme.ground.light);
    return { geometry: g, texture };
  }, [track, theme, segments]);
  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
    },
    [geometry, texture],
  );
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors map={texture} roughness={1} metalness={0} />
    </mesh>
  );
}

/** Ring of soft mountains / mesas far outside the playable world. */
export function Horizon({ theme }: { theme: KartTheme }) {
  const items = useMemo(() => {
    const rnd = seededRandom(theme.id === 'canyon' ? 41 : 17);
    return Array.from({ length: 26 }, (_, i) => {
      const ang = (i / 26) * Math.PI * 2 + rnd() * 0.2;
      const r = 520 + rnd() * 140;
      return { x: WORLD_CENTER.x + Math.cos(ang) * r, z: WORLD_CENTER.z + Math.sin(ang) * r, w: 120 + rnd() * 180, h: 40 + rnd() * (theme.id === 'canyon' ? 90 : 70), mesa: theme.id === 'canyon' && rnd() < 0.6 };
    });
  }, [theme]);
  return (
    <group>
      {items.map((m, i) =>
        m.mesa ? (
          <mesh key={i} position={[m.x, m.h * 0.5 - 6, m.z]} rotation={[0, i, 0]}>
            <cylinderGeometry args={[m.w * 0.32, m.w * 0.5, m.h, 7]} />
            <meshStandardMaterial color={theme.hills.farColor} roughness={1} flatShading />
          </mesh>
        ) : (
          <mesh key={i} position={[m.x, -m.h * 0.35, m.z]} scale={[1.6, 0.55, 1]}>
            <sphereGeometry args={[m.w * 0.5, 14, 10]} />
            <meshStandardMaterial color={theme.hills.farColor} roughness={1} />
          </mesh>
        ),
      )}
    </group>
  );
}
