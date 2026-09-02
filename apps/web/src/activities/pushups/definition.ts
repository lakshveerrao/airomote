import type { ActivityDefinition } from '@aero/activity-engine';

/**
 * Push-ups. Controller on the upper arm (armband/sleeve) — the arm angle swings from near
 * vertical (top) to near horizontal (bottom), which the MPU6050 measures reliably as pitch/roll
 * change. Detector in pushupDetector.ts.
 */
export const pushupsDefinition: ActivityDefinition = {
  id: 'pushups',
  name: 'Push-ups',
  category: 'workout',
  tagline: 'Full range. Full credit.',
  description:
    'Strap or tuck one controller on your upper arm. Lower until your chest is near the floor, then press up. Half reps are not counted.',
  status: 'available',
  accent: '#38c6b8',
  controllers: { min: 1, max: 1 },
  roles: [{ id: 'body', label: 'Upper arm', description: 'Strapped to the upper arm, front pointing toward the elbow.', required: true }],
  defaultRoleAssignment: { body: 1 },
  setupSteps: [
    { title: 'Place the controller', body: 'Slide the controller under a sleeve or armband on your upper arm, front pointing toward your elbow.', illustration: 'strap-arm' },
    { title: 'Get into position', body: 'Move into the top of a push-up with straight arms and hold still for a moment.' },
    { title: 'Go', body: 'Lower until your chest is close to the floor, then push all the way up.' },
  ],
  presets: [
    {
      id: 'upper-arm',
      name: 'Upper arm',
      description: 'Controller on the upper arm.',
      rules: [{ kind: 'magnitude', role: 'body', action: 'INTENSITY', maxG: 1.5 }],
    },
  ],
  defaultPresetId: 'upper-arm',
  actions: ['INTENSITY', 'PAUSE'],
  keyboardFallback: { Escape: 'PAUSE', Space: 'CONFIRM' },
  defaultSensitivity: 'normal',
};
