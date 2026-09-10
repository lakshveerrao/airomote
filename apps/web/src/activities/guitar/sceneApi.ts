/**
 * Mutable hand-off object between the Guitar activity (React state / input handling) and the
 * 3D scene (react-three-fiber, reads it every frame from a ref). Never re-created while the
 * activity is mounted — the activity mutates the fields in place and the scene polls them, so
 * there is no per-frame React render.
 */
import type { ChordName, StrumDirection } from '@aero/music-engine';

export interface GuitarSceneApi {
  chord: ChordName;
  /** strum events queued for the scene */
  strums: Array<{ direction: StrumDirection; velocity: number; times: Array<number | null>; at: number; consumed: boolean; seen?: boolean }>;
  muteAt: number;
  /** 'chords' plays whole voicings, 'lead' plays a single fretted note */
  mode: 'chords' | 'lead';
  /** the single note being played in lead mode; string 0 = low E */
  lead: { string: number; fret: number } | null;
  /** 0..1 smoothed fret-hand position along the neck (0 = nut, 1 = the 12th fret) */
  fretPos: number;
  /** 0..5 smoothed string position (fractional), 0 = low E … 5 = high e */
  stringPos: number;
}

export function createGuitarSceneApi(): GuitarSceneApi {
  return { chord: 'C', strums: [], muteAt: 0, mode: 'chords', lead: null, fretPos: 0.25, stringPos: 2 };
}
