import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ControllerId } from '@aero/motion-core';
import type { RoleAssignment, SensitivityLevel } from '@aero/activity-engine';
import type { TransportKind } from '@/core/transport/types';

export interface RememberedDevice {
  kind: TransportKind;
  id: string | null;
  name: string | null;
}

export interface SettingsState {
  setupComplete: boolean;
  developerMode: boolean;
  controllerNames: Record<ControllerId, string>;
  rememberedDevices: Partial<Record<ControllerId, RememberedDevice>>;
  sensitivity: SensitivityLevel;
  volume: number; // 0..1
  muted: boolean;
  lastActivityId: string | null;
  lastCategory: 'games' | 'music' | 'workout' | null;
  /** Per-activity chosen preset id and role assignment. */
  activityPresets: Record<string, string>;
  activityRoles: Record<string, RoleAssignment>;
  activitySensitivity: Record<string, SensitivityLevel>;
  autoRecalibrate: boolean;
  reducedMotion: boolean;
  keyboardFallback: boolean;
  gamepadFallback: boolean;

  setSetupComplete(v: boolean): void;
  setDeveloperMode(v: boolean): void;
  renameController(id: ControllerId, name: string): void;
  rememberDevice(id: ControllerId, d: RememberedDevice | null): void;
  setSensitivity(v: SensitivityLevel): void;
  setVolume(v: number): void;
  setMuted(v: boolean): void;
  setLastActivity(id: string | null, category: SettingsState['lastCategory']): void;
  setActivityPreset(activityId: string, presetId: string): void;
  setActivityRoles(activityId: string, roles: RoleAssignment): void;
  setActivitySensitivity(activityId: string, level: SensitivityLevel): void;
  setAutoRecalibrate(v: boolean): void;
  setKeyboardFallback(v: boolean): void;
  setGamepadFallback(v: boolean): void;
  resetAll(): void;
}

const defaults = {
  setupComplete: false,
  developerMode: false,
  controllerNames: { 1: 'Controller 1', 2: 'Controller 2' } as Record<ControllerId, string>,
  rememberedDevices: {},
  sensitivity: 'normal' as SensitivityLevel,
  volume: 0.8,
  muted: false,
  lastActivityId: null,
  lastCategory: null,
  activityPresets: {},
  activityRoles: {},
  activitySensitivity: {},
  autoRecalibrate: true,
  reducedMotion: false,
  keyboardFallback: true,
  gamepadFallback: false,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setSetupComplete: (setupComplete) => set({ setupComplete }),
      setDeveloperMode: (developerMode) => set({ developerMode }),
      renameController: (id, name) => set((s) => ({ controllerNames: { ...s.controllerNames, [id]: name.trim() || `Controller ${id}` } })),
      rememberDevice: (id, d) =>
        set((s) => {
          const next = { ...s.rememberedDevices };
          if (d) next[id] = d;
          else delete next[id];
          return { rememberedDevices: next };
        }),
      setSensitivity: (sensitivity) => set({ sensitivity }),
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
      setMuted: (muted) => set({ muted }),
      setLastActivity: (lastActivityId, lastCategory) => set({ lastActivityId, lastCategory }),
      setActivityPreset: (activityId, presetId) => set((s) => ({ activityPresets: { ...s.activityPresets, [activityId]: presetId } })),
      setActivityRoles: (activityId, roles) => set((s) => ({ activityRoles: { ...s.activityRoles, [activityId]: roles } })),
      setActivitySensitivity: (activityId, level) => set((s) => ({ activitySensitivity: { ...s.activitySensitivity, [activityId]: level } })),
      setAutoRecalibrate: (autoRecalibrate) => set({ autoRecalibrate }),
      setKeyboardFallback: (keyboardFallback) => set({ keyboardFallback }),
      setGamepadFallback: (gamepadFallback) => set({ gamepadFallback }),
      resetAll: () => set({ ...defaults }),
    }),
    { name: 'aero.settings.v1' },
  ),
);
