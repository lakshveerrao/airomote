import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ActivityDefinition } from '@aero/activity-engine';
import { activityRegistry } from '@/core/runtime';
import { motionKartDefinition } from './motion-kart/definition';
import { drumsDefinition } from './drums/definition';
import { guitarDefinition } from './guitar/definition';
import { squatsDefinition } from './squats/definition';
import { pushupsDefinition } from './pushups/definition';
import { comingSoonActivities } from './coming-soon';

/**
 * Activity catalogue. To add an activity:
 *   1. create activities/<id>/definition.ts (ActivityDefinition — roles, presets, setup copy)
 *   2. create activities/<id>/<Name>.tsx (full-screen React component using useActivitySession)
 *   3. add both here. No firmware, transport or motion-engine changes.
 */
export const availableActivities: ActivityDefinition[] = [
  motionKartDefinition,
  drumsDefinition,
  guitarDefinition,
  squatsDefinition,
  pushupsDefinition,
];

for (const def of [...availableActivities, ...comingSoonActivities]) activityRegistry.register(def);

export interface ActivityComponentProps {
  definition: ActivityDefinition;
}

export const activityComponents: Record<string, LazyExoticComponent<ComponentType<ActivityComponentProps>>> = {
  'motion-kart': lazy(() => import('./motion-kart/MotionKart')),
  drums: lazy(() => import('./drums/Drums')),
  guitar: lazy(() => import('./guitar/Guitar')),
  squats: lazy(() => import('./squats/Squats')),
  pushups: lazy(() => import('./pushups/Pushups')),
};

export const categoryMeta = {
  games: { label: 'Games', path: '/games', accent: 'var(--games)', soft: 'var(--games-soft)', blurb: 'Motion-controlled arcade play.' },
  music: { label: 'Music', path: '/music', accent: 'var(--music)', soft: 'var(--music-soft)', blurb: 'Instruments you play in the air.' },
  workout: { label: 'Workout', path: '/workout', accent: 'var(--workout)', soft: 'var(--workout-soft)', blurb: 'Reps that only count when they are real.' },
} as const;
