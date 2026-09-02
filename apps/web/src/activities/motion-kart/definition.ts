import type { ActivityDefinition } from '@aero/activity-engine';

/**
 * Motion Kart — original arcade kart racer. Consumes only universal actions:
 *   CONTINUOUS_X (steer -1..1), TURN_LEFT/TURN_RIGHT (held, keyboard/gamepad fallback),
 *   ACCELERATE, BRAKE (held 0..1), BOOST (trigger), PAUSE (trigger).
 */
export const motionKartDefinition: ActivityDefinition = {
  id: 'motion-kart',
  name: 'Motion Kart',
  category: 'games',
  tagline: 'Tilt to steer. Lean in to go faster.',
  description:
    'An arcade kart race across three laps of a coastal circuit. Hold a controller like a wheel and tilt it to steer; tip it forward to accelerate and back to brake.',
  status: 'available',
  accent: '#ff7a45',
  controllers: { min: 1, max: 2 },
  roles: [
    { id: 'driver', label: 'Steering', description: 'Tilt left and right to steer.', required: true },
    { id: 'copilot', label: 'Throttle', description: 'Tip forward to accelerate, back to brake, swing to boost.', required: false },
  ],
  defaultRoleAssignment: { driver: 1, copilot: 2 },
  setupSteps: [
    { title: 'Hold it like a wheel', body: 'Hold the controller flat in front of you with both hands, buttons up.', illustration: 'hold-flat' },
    { title: 'Tilt to steer', body: 'Tilt left or right to steer. Small tilts make small turns.' },
    { title: 'Lean to drive', body: 'Tip the front down to accelerate, back toward you to brake.' },
  ],
  presets: [
    {
      id: 'motion-steering',
      name: 'Motion Steering',
      description: 'One controller. Tilt left/right to steer, forward to accelerate, back to brake. Shake to boost.',
      rules: [
        { kind: 'tiltAxis', role: 'driver', axis: 'roll', action: 'CONTINUOUS_X', deadzoneDeg: 3, maxDeg: 32, curve: 1.25 },
        { kind: 'tiltAxis', role: 'driver', axis: 'pitch', action: 'CONTINUOUS_Y', deadzoneDeg: 5, maxDeg: 28, invert: true },
        { kind: 'tiltZone', role: 'driver', direction: 'forward', action: 'ACCELERATE' },
        { kind: 'tiltZone', role: 'driver', direction: 'back', action: 'BRAKE' },
        { kind: 'gesture', role: 'driver', gesture: 'shake', action: 'BOOST', cooldownMs: 1500 },
      ],
    },
    {
      id: 'dual-controller',
      name: 'Dual Controller',
      description: 'Controller 1 steers. Controller 2 is the throttle: tip forward to accelerate, back to brake, swing forward to boost.',
      rules: [
        { kind: 'tiltAxis', role: 'driver', axis: 'roll', action: 'CONTINUOUS_X', deadzoneDeg: 3, maxDeg: 32, curve: 1.25 },
        { kind: 'tiltAxis', role: 'copilot', axis: 'pitch', action: 'CONTINUOUS_Y', deadzoneDeg: 5, maxDeg: 28, invert: true },
        { kind: 'tiltZone', role: 'copilot', direction: 'forward', action: 'ACCELERATE' },
        { kind: 'tiltZone', role: 'copilot', direction: 'back', action: 'BRAKE' },
        { kind: 'gesture', role: 'copilot', gesture: 'swing', direction: 'forward', action: 'BOOST', cooldownMs: 1500 },
        { kind: 'gesture', role: 'copilot', gesture: 'shake', action: 'BOOST', cooldownMs: 1500 },
      ],
    },
    {
      id: 'gesture-steering',
      name: 'Gesture Steering',
      description: 'Rotate the controller like a dial to steer, tip forward to accelerate, swing forward to boost.',
      rules: [
        { kind: 'rateAxis', role: 'driver', axis: 'yawRate', action: 'CONTINUOUS_X', deadzoneDps: 12, maxDps: 160, invert: true },
        { kind: 'tiltZone', role: 'driver', direction: 'forward', action: 'ACCELERATE' },
        { kind: 'tiltZone', role: 'driver', direction: 'back', action: 'BRAKE' },
        { kind: 'gesture', role: 'driver', gesture: 'swing', direction: 'forward', action: 'BOOST', cooldownMs: 1500 },
      ],
    },
    {
      id: 'keyboard',
      name: 'Keyboard',
      description: 'Testing and accessibility only. W/A/S/D or arrows, Shift to boost.',
      rules: [],
      fallback: 'both',
    },
  ],
  defaultPresetId: 'motion-steering',
  actions: ['CONTINUOUS_X', 'CONTINUOUS_Y', 'TURN_LEFT', 'TURN_RIGHT', 'ACCELERATE', 'BRAKE', 'BOOST', 'PAUSE'],
  keyboardFallback: {
    KeyW: 'ACCELERATE',
    ArrowUp: 'ACCELERATE',
    KeyS: 'BRAKE',
    ArrowDown: 'BRAKE',
    KeyA: 'TURN_LEFT',
    ArrowLeft: 'TURN_LEFT',
    KeyD: 'TURN_RIGHT',
    ArrowRight: 'TURN_RIGHT',
    ShiftLeft: 'BOOST',
    Space: 'BOOST',
    Escape: 'PAUSE',
    Enter: 'CONFIRM',
  },
  defaultSensitivity: 'normal',
};
