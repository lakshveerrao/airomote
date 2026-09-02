import { useCallback } from 'react';
import type { ActivityComponentProps } from '@/activities';
import { WorkoutActivity } from '@/features/workout/WorkoutActivity';
import { SquatDetector, squatOptionsFor } from './squatDetector';

const LABELS = { STANDING: 'Stand', DESCENDING: 'Down', BOTTOM: 'Hold', ASCENDING: 'Up' };

export default function Squats({ definition }: ActivityComponentProps) {
  const create = useCallback((level: 'low' | 'normal' | 'high') => new SquatDetector(squatOptionsFor(level)), []);
  return <WorkoutActivity definition={definition} mode="squat" createDetector={create} phaseLabel={LABELS} />;
}
