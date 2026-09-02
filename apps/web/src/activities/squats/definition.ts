import type { ActivityDefinition } from '@aero/activity-engine';

/**
 * Squats. The exercise detector consumes the role's motion state directly
 * (Raw Motion → Exercise Detector → State Machine → Rep Validation → Metrics) — see
 * squatDetector.ts. The mapping preset only exposes INTENSITY for the ambient visual.
 */
export const squatsDefinition: ActivityDefinition = {
  id: 'squats',
  name: 'Squats',
  category: 'workout',
  tagline: 'Every rep counted. Only the real ones.',
  description:
    'Hold one controller against your chest with both hands, or slip it into a front pocket. Squat down and stand back up — a rep counts only when you complete the full movement.',
  status: 'available',
  accent: '#3ddc97',
  controllers: { min: 1, max: 1 },
  roles: [{ id: 'body', label: 'Body', description: 'Held at the chest or in a front pocket.', required: true }],
  defaultRoleAssignment: { body: 1 },
  setupSteps: [
    { title: 'Hold at your chest', body: 'Hold the controller flat against your chest with both hands, front pointing up.', illustration: 'chest' },
    { title: 'Stand still', body: 'Stand upright for a moment so we can learn your standing position.' },
    { title: 'Squat', body: 'Lower down until your thighs are about parallel, then drive back up.' },
  ],
  presets: [
    {
      id: 'chest',
      name: 'Chest hold',
      description: 'Controller held against the chest or in a front pocket.',
      rules: [{ kind: 'magnitude', role: 'body', action: 'INTENSITY', maxG: 1.5 }],
    },
  ],
  defaultPresetId: 'chest',
  actions: ['INTENSITY', 'PAUSE'],
  keyboardFallback: { Escape: 'PAUSE', Space: 'CONFIRM' },
  defaultSensitivity: 'normal',
};
