import { useCallback } from 'react';
import type { ActivityComponentProps } from '@/activities';
import { WorkoutActivity } from '@/features/workout/WorkoutActivity';
import { PushupDetector, pushupOptionsFor } from './pushupDetector';

const LABELS = { UP: 'Top', DESCENDING: 'Down', BOTTOM: 'Hold', ASCENDING: 'Up' };

export default function Pushups({ definition }: ActivityComponentProps) {
  const create = useCallback((level: 'low' | 'normal' | 'high') => new PushupDetector(pushupOptionsFor(level)), []);
  return <WorkoutActivity definition={definition} mode="pushup" createDetector={create} phaseLabel={LABELS} />;
}
