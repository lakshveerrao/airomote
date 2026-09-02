import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ActivitySessionRecord } from '@aero/activity-engine';

/**
 * Local session history (workouts today; any activity later). Kept as a flat list of
 * ActivitySessionRecord so a future cloud sync only needs to push/pull this array.
 */
export interface HistoryState {
  sessions: ActivitySessionRecord[];
  add(record: ActivitySessionRecord): void;
  remove(startedAt: number): void;
  clear(): void;
}

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      sessions: [],
      add: (record) => set((s) => ({ sessions: [record, ...s.sessions].slice(0, 500) })),
      remove: (startedAt) => set((s) => ({ sessions: s.sessions.filter((x) => x.startedAt !== startedAt) })),
      clear: () => set({ sessions: [] }),
    }),
    { name: 'aero.history.v1' },
  ),
);

export function sessionsFor(sessions: ActivitySessionRecord[], activityId: string): ActivitySessionRecord[] {
  return sessions.filter((s) => s.activityId === activityId);
}
