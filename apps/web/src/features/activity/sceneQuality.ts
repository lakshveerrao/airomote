/**
 * Scene quality for the Three.js activities.
 * Real-time shadow maps and a high device pixel ratio are the two costs that matter on the
 * integrated GPUs most laptops have; motion interaction must stay at 60 fps before anything
 * decorative. Detected once from the WebGL renderer string; overridable for testing via
 * localStorage `aero.sceneQuality` = 'high' | 'low'.
 */
export type SceneQuality = 'high' | 'low';

let cached: SceneQuality | null = null;

export function detectSceneQuality(): SceneQuality {
  if (cached) return cached;
  try {
    const override = localStorage.getItem('aero.sceneQuality');
    if (override === 'high' || override === 'low') return (cached = override);
  } catch {
    /* no storage */
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    const integrated = /swiftshader|llvmpipe|software|intel|iris|uhd|mali|adreno|powervr|apple/i.test(renderer);
    const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
    cached = integrated || fewCores ? 'low' : 'high';
  } catch {
    cached = 'low';
  }
  return cached;
}

export interface SceneSettings {
  shadows: boolean;
  dpr: [number, number];
  shadowMapSize: number;
  antialias: boolean;
}

export function sceneSettings(quality: SceneQuality = detectSceneQuality()): SceneSettings {
  return quality === 'high'
    ? { shadows: true, dpr: [1, 1.5], shadowMapSize: 1024, antialias: true }
    : { shadows: false, dpr: [1, 1.25], shadowMapSize: 512, antialias: true };
}
