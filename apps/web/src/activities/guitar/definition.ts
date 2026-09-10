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

/**
 * Natural (lead) mode tuning. The fret hand is the hand on the neck:
 *   tip forward/back  → slide along the neck (open string … NECK_MAX_FRET)
 *   roll the wrist    → choose which string is fretted
 * Both come from `tiltAxis`, which already produces a wrap-safe −1..1 axis from the
 * orientation relative to neutral, so no new rule kind is needed.
 */
export const NECK_MAX_FRET = 12;
/** Degrees of pitch travel (each way from neutral) that spans the whole neck. */
export const NECK_PITCH_DEG = 42;
/** Degrees of roll travel (each way from neutral) that spans low E → high E. */
export const STRING_ROLL_DEG = 38;
/** Fret hand freezes for this long around a strum so the body swing cannot lurch the note. */
export const STRUM_FREEZE_MS = 250;
/** Time constant of the fret/string smoothing — time-based, so packet rate does not matter. */
export const TRACK_TAU_MS = 90;
/** Extra fret/string travel needed to leave the current step (hysteresis, in steps). */
export const TRACK_HYSTERESIS = 0.32;

export const guitarDefinition: ActivityDefinition = {
  id: 'guitar',
  name: 'Guitar',
  category: 'music',
  tagline: 'One hand walks the neck. The other strums.',
  description:
    'Controller 1 is your fret hand: tip it forward and back to slide along the neck, roll your wrist to change string. Controller 2 is your strumming hand: swing down or up to sound the note. Swing harder to play louder. Switch to the Chords preset to strum six chords instead.',
  status: 'available',
  accent: '#c98bff',
  controllers: { min: 1, max: 2 },
  roles: [
    { id: 'fret', label: 'Fret hand', description: 'Tip forward and back to slide the neck, roll to change string.', required: false },
    { id: 'strum', label: 'Strumming', description: 'Swing down and up to strum.', required: true },
  ],
  defaultRoleAssignment: { fret: 1, strum: 2 },
  setupSteps: [
    { title: 'Fret hand', body: 'Hold Controller 1 upright in your left hand, like the neck of a guitar.', illustration: 'hold-upright' },
    { title: 'Walk the neck', body: 'Tip the fret hand forward toward the nut and back up the neck. Roll your wrist left for the low strings, right for the high ones. (Chords preset: tilt left for C, right for G, forward for Am, back for F, turn left for Em, right for D.)' },
    { title: 'Strum', body: 'Hold Controller 2 in your right hand over the strings. Swing down and up to strum.' },
  ],
  presets: [
    {
      id: 'natural',
      name: 'Natural',
      description:
        'Lead playing. The fret hand slides along the neck as you tip it forward and back, and rolls the wrist to change string. The strum hand sounds exactly that note.',
      rules: [
        // Tip forward (negative pitch) → toward the nut; tip back → up the neck.
        { kind: 'tiltAxis', role: 'fret', axis: 'pitch', action: 'FRET_POSITION', deadzoneDeg: 2, maxDeg: NECK_PITCH_DEG },
        // Roll left (negative) → low strings; roll right → high strings.
        { kind: 'tiltAxis', role: 'fret', axis: 'roll', action: 'STRING_SELECT', deadzoneDeg: 2, maxDeg: STRING_ROLL_DEG },
        { kind: 'gesture', role: 'strum', gesture: 'swing', direction: 'down', action: 'STRUM_DOWN', cooldownMs: 120 },
        { kind: 'gesture', role: 'strum', gesture: 'swing', direction: 'up', action: 'STRUM_UP', cooldownMs: 120 },
        { kind: 'gesture', role: 'strum', gesture: 'shake', action: 'MUTE', cooldownMs: 400 },
        { kind: 'magnitude', role: 'strum', action: 'INTENSITY', maxG: 2 },
      ],
    },
    {
      id: 'classic',
      name: 'Chords',
      description: 'Fret hand tilts/turns to pick a chord. Strum hand swings down and up. Shake the strum hand to mute.',
      rules: [
        { kind: 'zone', role: 'fret', action: 'SELECT_ZONE', zones: CHORD_ZONES, hysteresisDeg: 6 },
        { kind: 'gesture', role: 'strum', gesture: 'swing', direction: 'down', action: 'STRUM_DOWN', cooldownMs: 120 },
        { kind: 'gesture', role: 'strum', gesture: 'swing', direction: 'up', action: 'STRUM_UP', cooldownMs: 120 },
        { kind: 'gesture', role: 'strum', gesture: 'shake', action: 'MUTE', cooldownMs: 400 },
        { kind: 'magnitude', role: 'strum', action: 'INTENSITY', maxG: 2 },
      ],
    },
  ],
  defaultPresetId: 'natural',
  actions: ['SELECT_ZONE', 'FRET_POSITION', 'STRING_SELECT', 'STRUM_DOWN', 'STRUM_UP', 'MUTE', 'INTENSITY'],
  keyboardFallback: {
    // Natural mode: slide along the neck and change string. Held keys auto-repeat in the
    // activity, so `step` is one nudge per repeat rather than an absolute axis value.
    ArrowLeft: { action: 'FRET_POSITION', role: 'fret', meta: { step: -1 } },
    ArrowRight: { action: 'FRET_POSITION', role: 'fret', meta: { step: 1 } },
    KeyA: { action: 'FRET_POSITION', role: 'fret', meta: { step: -1 } },
    KeyD: { action: 'FRET_POSITION', role: 'fret', meta: { step: 1 } },
    KeyS: { action: 'STRING_SELECT', role: 'fret', meta: { step: -1 } },
    KeyW: { action: 'STRING_SELECT', role: 'fret', meta: { step: 1 } },
    // Chord mode
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
  motionOverrides: { yawDecayDps: 0.6, swingRecoveryMs: 90 },
};
