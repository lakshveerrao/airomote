import type { ActivityDefinition } from '@aero/activity-engine';

/** Coming Soon cards — definitions only, deliberately no runtime code. */
function soon(
  id: string,
  name: string,
  category: ActivityDefinition['category'],
  tagline: string,
  accent: string,
  controllers: 1 | 2 = 1,
): ActivityDefinition {
  return {
    id,
    name,
    category,
    tagline,
    description: '',
    status: 'coming-soon',
    accent,
    controllers: { min: 1, max: controllers },
    roles: [],
    defaultRoleAssignment: {},
    setupSteps: [],
    presets: [],
    defaultPresetId: '',
    actions: [],
  };
}

export const comingSoonActivities: ActivityDefinition[] = [
  soon('sky-glide', 'Sky Glide', 'games', 'Bank and dive through the clouds.', '#5ec8ff'),
  soon('rhythm-blade', 'Rhythm Blade', 'games', 'Slice to the beat.', '#ff5c9a', 2),
  soon('table-tennis', 'Table Tennis', 'games', 'Fast rallies, real swings.', '#ffd166'),
  soon('piano', 'Piano', 'music', 'Air keys, real notes.', '#7dd3fc', 2),
  soon('theremin', 'Theremin', 'music', 'Shape sound with your hands.', '#f0abfc'),
  soon('dj-deck', 'DJ Deck', 'music', 'Scratch, filter and drop.', '#fda4af', 2),
  soon('lunges', 'Lunges', 'workout', 'Step, hold, rise.', '#86efac'),
  soon('jumping-jacks', 'Jumping Jacks', 'workout', 'Full-body cardio.', '#fde68a'),
  soon('boxing', 'Boxing', 'workout', 'Jab, cross, hook.', '#fca5a5', 2),
  soon('shoulder-press', 'Shoulder Press', 'workout', 'Press overhead, count reps.', '#a5b4fc', 2),
  soon('bicep-curls', 'Bicep Curls', 'workout', 'Controlled curls, both arms.', '#c4b5fd', 2),
  soon('running', 'Running', 'workout', 'Cadence and pace.', '#67e8f9'),
];
