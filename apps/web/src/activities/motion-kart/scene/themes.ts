/**
 * Visual worlds for Motion Kart. The race core (track spline, physics, AI) is identical for
 * every theme; a theme only changes what the world looks like.
 */
export type KartThemeId = 'meadow' | 'canyon';

export interface KartTheme {
  id: KartThemeId;
  name: string;
  subtitle: string;
  /** CSS gradient for the picker card. */
  swatch: string;
  sky: { top: string; horizon: string; bottom: string; sun: string };
  fog: { color: string; near: number; far: number };
  light: { sun: string; sunIntensity: number; hemiSky: string; hemiGround: string; ambient: number };
  ground: { base: string; dark: string; light: string; far: string };
  hills: { amplitude: number; color: string; farColor: string };
  road: { base: string; speck: string; dirt: boolean; line: string; kerbA: string; kerbB: string; verge: string };
  barrier: 'fence' | 'tyres' | 'rocks';
  flora: 'trees' | 'desert';
  grandstands: boolean;
  dust: string;
  banners: { primary: string; secondary: string; text: string };
}

export const KART_THEMES: KartTheme[] = [
  {
    id: 'meadow',
    name: 'Meadow Circuit',
    subtitle: 'Green hills, big crowds',
    swatch: 'linear-gradient(180deg, #62aef0 0%, #9fd2ff 45%, #5fb24a 46%, #3f8a34 100%)',
    sky: { top: '#2f7fdc', horizon: '#c8e2fb', bottom: '#a9cbe8', sun: '#fff3d6' },
    fog: { color: '#c3daf2', near: 140, far: 620 },
    light: { sun: '#fff2dc', sunIntensity: 2.6, hemiSky: '#cfe3ff', hemiGround: '#4d7a37', ambient: 0.22 },
    ground: { base: '#5aa63f', dark: '#3f8a30', light: '#7cc456', far: '#4b8f3a' },
    hills: { amplitude: 9, color: '#4f9a3c', farColor: '#3f7a4a' },
    road: { base: '#3d4048', speck: '#5a5e68', dirt: false, line: '#e8e9ec', kerbA: '#e0362d', kerbB: '#f4f3ee', verge: '#7f6a45' },
    barrier: 'fence',
    flora: 'trees',
    grandstands: true,
    dust: '#c9b98f',
    banners: { primary: '#e0362d', secondary: '#1d5fd1', text: 'Meadow Circuit' },
  },
  {
    id: 'canyon',
    name: 'Canyon Run',
    subtitle: 'Red rock, dust and sun',
    swatch: 'linear-gradient(180deg, #4aa3ff 0%, #bfe1ff 40%, #d98a4a 41%, #b25a2c 100%)',
    sky: { top: '#2b7be0', horizon: '#dbe9fb', bottom: '#e8c9a8', sun: '#fff7e0' },
    fog: { color: '#e6cfb4', near: 120, far: 560 },
    light: { sun: '#fff5e4', sunIntensity: 3.0, hemiSky: '#cfe0ff', hemiGround: '#a0603a', ambient: 0.28 },
    ground: { base: '#d59a5c', dark: '#b87740', light: '#eab77c', far: '#c48a55' },
    hills: { amplitude: 14, color: '#c2703a', farColor: '#9a5a3c' },
    road: { base: '#b8814d', speck: '#d6a06a', dirt: true, line: '#f2e6cf', kerbA: '#b83a2a', kerbB: '#f3ead6', verge: '#c99460' },
    barrier: 'rocks',
    flora: 'desert',
    grandstands: false,
    dust: '#e0b07a',
    banners: { primary: '#b83a2a', secondary: '#1f6fd6', text: 'Canyon Run' },
  },
];

export const DEFAULT_KART_THEME: KartThemeId = 'meadow';
const KEY = 'aero.kart.track';

export function kartTheme(id: KartThemeId): KartTheme {
  return KART_THEMES.find((t) => t.id === id) ?? KART_THEMES[0];
}

export function loadKartTheme(): KartThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && KART_THEMES.some((t) => t.id === v)) return v as KartThemeId;
  } catch {
    /* no storage */
  }
  return DEFAULT_KART_THEME;
}

export function saveKartTheme(id: KartThemeId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* no storage */
  }
}
