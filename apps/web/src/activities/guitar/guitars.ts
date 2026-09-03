/**
 * Guitar catalogue for the Guitar activity: what the 3D guitarist holds.
 * Purely visual — the chords, strumming and audio are the same for every model.
 */
export type GuitarModelId = 'lespaul' | 'strat' | 'sg' | 'flyingv' | 'acoustic';

export interface GuitarModel {
  id: GuitarModelId;
  name: string;
  subtitle: string;
  electric: boolean;
  /** Centre colour of the top (sunburst centre / solid colour). */
  color: string;
  /** Edge colour of the top; equal to `color` for a solid finish. */
  edge: string;
  pickguard: string | null;
  hardware: 'gold' | 'chrome';
  /** CSS background for the picker swatch. */
  swatch: string;
}

export const GUITAR_MODELS: GuitarModel[] = [
  {
    id: 'lespaul',
    name: 'Les Paul',
    subtitle: 'Cherry sunburst',
    electric: true,
    color: '#e0522a',
    edge: '#3a0a08',
    pickguard: '#f3e6c8',
    hardware: 'gold',
    swatch: 'radial-gradient(circle at 45% 40%, #ff7a3c 0%, #c8341c 45%, #3a0a08 100%)',
  },
  {
    id: 'strat',
    name: 'Strat',
    subtitle: 'Sunburst, cream guard',
    electric: true,
    color: '#f0a83c',
    edge: '#1c0d06',
    pickguard: '#f6f0dc',
    hardware: 'chrome',
    swatch: 'radial-gradient(circle at 45% 40%, #ffc860 0%, #b8641e 50%, #1c0d06 100%)',
  },
  {
    id: 'sg',
    name: 'SG',
    subtitle: 'Heritage cherry',
    electric: true,
    color: '#8c1a22',
    edge: '#5a0d14',
    pickguard: '#101010',
    hardware: 'chrome',
    swatch: 'linear-gradient(135deg, #a8202a, #5a0d14)',
  },
  {
    id: 'flyingv',
    name: 'Flying V',
    subtitle: 'Arctic white',
    electric: true,
    color: '#f2f0ea',
    edge: '#d8d4c8',
    pickguard: null,
    hardware: 'gold',
    swatch: 'linear-gradient(135deg, #ffffff, #cfcabc)',
  },
  {
    id: 'acoustic',
    name: 'Acoustic',
    subtitle: 'Natural dreadnought',
    electric: false,
    color: '#d99a4c',
    edge: '#8a5222',
    pickguard: '#1f1a17',
    hardware: 'chrome',
    swatch: 'radial-gradient(circle at 45% 40%, #e8b06a 0%, #b9782f 55%, #6a3d18 100%)',
  },
];

export const DEFAULT_GUITAR: GuitarModelId = 'lespaul';
const KEY = 'aero.guitar.model';

export function loadGuitarModel(): GuitarModelId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && GUITAR_MODELS.some((m) => m.id === v)) return v as GuitarModelId;
  } catch {
    /* no storage */
  }
  return DEFAULT_GUITAR;
}

export function saveGuitarModel(id: GuitarModelId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* no storage */
  }
}

export function guitarModel(id: GuitarModelId): GuitarModel {
  return GUITAR_MODELS.find((m) => m.id === id) ?? GUITAR_MODELS[0];
}
