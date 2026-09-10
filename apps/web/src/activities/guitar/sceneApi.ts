/**
 * Shared mutable handle between the guitar activity (writer) and the 3D scene (reader).
 *
 * It lives in its own module so the activity and GuitarScene.tsx can be edited independently:
 * both sides import `GuitarSceneApi` / `createGuitarSceneApi` from here.
 *
 * The activity mutates the object in place every frame — never re-create it — so the scene's
 * useFrame loop can read it without causing React re-renders.
 */
import type { ChordName, StrumDirection } from '@aero/music-engine';

export interface GuitarSceneApi {
  /** Chord shown on the fretboard in chord mode (kept in sync in lead mode too). */
  chord: ChordName;
  /** Strum events queued for the scene. */
  strums: Array<{ direction: StrumDirection; velocity: number; times: Array<number | null>; at: number; consumed: boolean; seen?: boolean }>;
  muteAt: number;

  /* --- natural-motion fields, written by the activity, read by the scene --- */

  /** Which preset is active. */
  mode: 'chords' | 'lead';
  /** Tracked note in lead mode (string 0 = low E), null in chord mode. */
  lead: { string: number; fret: number } | null;
  /** 0..1 smoothed hand position along the neck (0 = nut, 1 = 12th fret). */
  fretPos: number;
  /** 0..5 smoothed, fractional string position — drives finger placement across strings. */
  stringPos: number;
}

export function createGuitarSceneApi(): GuitarSceneApi {
  return { chord: 'C', strums: [], muteAt: 0, mode: 'chords', lead: null, fretPos: 0.25, stringPos: 2 };
}
