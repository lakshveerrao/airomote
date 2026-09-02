import type { ActivityDefinition, OrientationZone } from '@aero/activity-engine';

export type ChordName = 'C' | 'G' | 'Am' | 'F' | 'Em' | 'D';
export const CHORDS: ChordName[] = ['C', 'G', 'Am', 'F', 'Em', 'D'];

/**
 * Chord zones for the fret hand (relative to the neutral pose):
 *   rotate left → Em, rotate right → D (checked first: rotation is deliberate)
 *   tilt left → C, tilt right → G
 *   tip forward → Am, tip back → F
 * No catch-all: when the hand is near neutral the current chord is kept.
 */
export const CHORD_ZONES: OrientationZone[] = [
  { id: 'Em', yaw: [28, 180] },
  { id: 'D', yaw: [-180, -28] },
  { id: 'C', roll: [-90, -20] },
  { id: 'G', roll: [20, 90] },
  { id: 'Am', pitch: [-90, -20] },
  { id: 'F', pitch: [20, 90] },
];

export const guitarDefinition: ActivityDefinition = {
  id: 'guitar',
  name: 'Guitar',
  category: 'music',
  tagline: 'One hand shapes the chord. The other strums.',
  description:
    'Controller 1 is your fret hand: tilt or turn it to choose a chord. Controller 2 is your strumming hand: swing down or up to strum. Swing harder to play louder.',
  status: 'available',
  accent: '#c98bff',
  controllers: { min: 1, max: 2 },
  roles: [
    { id: 'fret', label: 'Chords', description: 'Tilt and turn to change chords.', required: false },
    { id: 'strum', label: 'Strumming', description: 'Swing down and up to strum.', required: true },
  ],
  defaultRoleAssignment: { fret: 1, strum: 2 },
  setupSteps: [
    { title: 'Fret hand', body: 'Hold Controller 1 upright in your left hand, like the neck of a guitar.', illustration: 'hold-upright' },
    { title: 'Choose chords', body: 'Tilt left for C, right for G, forward for Am, back for F. Turn left for Em, right for D.' },
    { title: 'Strum', body: 'Hold Controller 2 in your right hand over the strings. Swing down and up to strum.' },
  ],
  presets: [
    {
      id: 'classic',
      name: 'Classic',
      description: 'Fret hand tilts/turns to pick a chord. Strum hand swings down and up. Shake the strum hand to mute.',
      rules: [
        { kind: 'zone', role: 'fret', action: 'SELECT_ZONE', zones: CHORD_ZONES, hysteresisDeg: 6 },
        { kind: 'gesture', role: 'strum', gesture: 'swing', direction: 'down', action: 'STRUM_DOWN', cooldownMs: 70 },
        { kind: 'gesture', role: 'strum', gesture: 'swing', direction: 'up', action: 'STRUM_UP', cooldownMs: 70 },
        { kind: 'gesture', role: 'strum', gesture: 'shake', action: 'MUTE', cooldownMs: 400 },
        { kind: 'magnitude', role: 'strum', action: 'INTENSITY', maxG: 2 },
      ],
    },
  ],
  defaultPresetId: 'classic',
  actions: ['SELECT_ZONE', 'STRUM_DOWN', 'STRUM_UP', 'MUTE', 'INTENSITY'],
  keyboardFallback: {
    Digit1: { action: 'SELECT_ZONE', role: 'fret', meta: { zone: 'C' } },
    Digit2: { action: 'SELECT_ZONE', role: 'fret', meta: { zone: 'G' } },
    Digit3: { action: 'SELECT_ZONE', role: 'fret', meta: { zone: 'Am' } },
    Digit4: { action: 'SELECT_ZONE', role: 'fret', meta: { zone: 'F' } },
    Digit5: { action: 'SELECT_ZONE', role: 'fret', meta: { zone: 'Em' } },
    Digit6: { action: 'SELECT_ZONE', role: 'fret', meta: { zone: 'D' } },
    KeyQ: { action: 'STRUM_DOWN', role: 'strum' },
    KeyE: { action: 'STRUM_UP', role: 'strum' },
    ArrowDown: { action: 'STRUM_DOWN', role: 'strum' },
    ArrowUp: { action: 'STRUM_UP', role: 'strum' },
    KeyM: { action: 'MUTE', role: 'strum' },
    Escape: 'PAUSE',
  },
  defaultSensitivity: 'normal',
  motionOverrides: { yawDecayDps: 0.6, swingRecoveryMs: 60 },
};
