import type { ActivityDefinition, OrientationZone } from '@aero/activity-engine';

/**
 * Drum zones. MPU6050 cannot give hand position, so the target drum is chosen from where the
 * stick is *pointing* relative to the neutral pose captured at calibration:
 *   yaw  (+ left / − right)  → which drum across the kit
 *   pitch (+ stick raised)   → cymbals (crash/ride) above the drums
 * Order = priority (first match wins). Hysteresis keeps the highlight stable near boundaries.
 */
export const DRUM_ZONES: OrientationZone[] = [
  { id: 'ride', yaw: [12, 180], pitch: [14, 90] },
  { id: 'crash', yaw: [-180, -12], pitch: [14, 90] },
  { id: 'hihat', yaw: [32, 180] },
  { id: 'snare', yaw: [9, 32] },
  { id: 'tom1', yaw: [-9, 9] },
  { id: 'tom2', yaw: [-32, -9] },
  { id: 'floor', yaw: [-180, -32] },
];

export type DrumId = 'hihat' | 'snare' | 'tom1' | 'tom2' | 'floor' | 'crash' | 'ride' | 'kick';

export const drumsDefinition: ActivityDefinition = {
  id: 'drums',
  name: 'Drums',
  category: 'music',
  tagline: 'Two sticks. A full kit.',
  description:
    'Both controllers become drumsticks. Point at a drum to aim — it lights up — then strike down to play it. Hit harder for a louder sound. Raise the stick for cymbals.',
  status: 'available',
  accent: '#9b7dff',
  controllers: { min: 1, max: 2 },
  roles: [
    { id: 'stick1', label: 'Stick 1', description: 'Aim by pointing, strike down to hit.', required: true },
    { id: 'stick2', label: 'Stick 2', description: 'Aim by pointing, strike down to hit.', required: false },
  ],
  defaultRoleAssignment: { stick1: 1, stick2: 2 },
  setupSteps: [
    { title: 'Hold like sticks', body: 'Hold one controller in each hand like drumsticks, front pointing at the snare.', illustration: 'two-hands' },
    { title: 'Aim by pointing', body: 'Turn a stick left or right to aim. The drum you will hit lights up.' },
    { title: 'Strike to play', body: 'Flick the stick down. Raise it high and strike for crash and ride.' },
  ],
  presets: [
    {
      id: 'sticks',
      name: 'Drumsticks',
      description: 'Point to aim, strike down to hit. Raised stick reaches the cymbals. Shake for the kick.',
      rules: [
        { kind: 'zone', role: 'stick1', action: 'SELECT_ZONE', zones: DRUM_ZONES, hysteresisDeg: 5 },
        { kind: 'zone', role: 'stick2', action: 'SELECT_ZONE', zones: DRUM_ZONES, hysteresisDeg: 5 },
        { kind: 'gesture', role: 'stick1', gesture: 'strike', action: 'STRIKE', cooldownMs: 45 },
        { kind: 'gesture', role: 'stick2', gesture: 'strike', action: 'STRIKE', cooldownMs: 45 },
        { kind: 'gesture', role: 'stick1', gesture: 'swing', direction: 'forward', action: 'PUNCH', cooldownMs: 150, minIntensity: 0.35 },
        { kind: 'gesture', role: 'stick2', gesture: 'swing', direction: 'forward', action: 'PUNCH', cooldownMs: 150, minIntensity: 0.35 },
      ],
    },
  ],
  defaultPresetId: 'sticks',
  actions: ['SELECT_ZONE', 'STRIKE', 'PUNCH', 'INTENSITY'],
  keyboardFallback: {
    // Testing only: number keys aim stick 1, Space strikes, K = kick. Right hand: J/L aim stick 2, Enter strikes.
    Digit1: { action: 'SELECT_ZONE', role: 'stick1', meta: { zone: 'hihat' } },
    Digit2: { action: 'SELECT_ZONE', role: 'stick1', meta: { zone: 'snare' } },
    Digit3: { action: 'SELECT_ZONE', role: 'stick1', meta: { zone: 'tom1' } },
    Digit4: { action: 'SELECT_ZONE', role: 'stick1', meta: { zone: 'tom2' } },
    Digit5: { action: 'SELECT_ZONE', role: 'stick1', meta: { zone: 'floor' } },
    Digit6: { action: 'SELECT_ZONE', role: 'stick1', meta: { zone: 'crash' } },
    Digit7: { action: 'SELECT_ZONE', role: 'stick1', meta: { zone: 'ride' } },
    Space: { action: 'STRIKE', role: 'stick1' },
    KeyJ: { action: 'SELECT_ZONE', role: 'stick2', meta: { zone: 'snare' } },
    KeyL: { action: 'SELECT_ZONE', role: 'stick2', meta: { zone: 'floor' } },
    KeyI: { action: 'SELECT_ZONE', role: 'stick2', meta: { zone: 'crash' } },
    Enter: { action: 'STRIKE', role: 'stick2' },
    KeyK: { action: 'PUNCH', role: 'stick1' },
    Escape: 'PAUSE',
  },
  defaultSensitivity: 'normal',
  // Drift bound: relax yaw to centre slowly (a still stick drifts back to the snare over ~30 s).
  motionOverrides: { yawDecayDps: 1, strikeRecoveryMs: 50 },
};
