import { useEffect, useMemo, useRef, useState } from 'react';
import type { ControllerId, MotionConfig } from '@aero/motion-core';
import {
  ActionMapper,
  ActionState,
  resolveRoles,
  type ActionEvent,
  type ActivityDefinition,
  type MappingPreset,
  type RoleAssignment,
  type SensitivityLevel,
} from '@aero/activity-engine';
import { actionBus, controllerManager, motionEngine } from './runtime';
import { KeyboardActionSource } from './input/keyboard';
import { GamepadActionSource } from './input/gamepad';
import { useSettings } from '@/store/settings';
import { useControllerSlots } from '@/store/controllers';

/**
 * Wires one activity to the input stack:
 *   MotionEngine (states + gestures) → ActionMapper(preset, roles) → ActionBus
 *   KeyboardActionSource / GamepadActionSource → ActionBus (fallbacks)
 * Activities subscribe to the bus (or poll ActionState) and never touch transports/keys.
 */
export class ActivitySession {
  readonly mapper: ActionMapper;
  readonly actions = new ActionState();
  private unsubs: Array<() => void> = [];
  private keyboard: KeyboardActionSource | null = null;
  private gamepad: GamepadActionSource | null = null;
  private active = false;
  private savedConfig: MotionConfig | null = null;

  constructor(
    readonly def: ActivityDefinition,
    preset: MappingPreset,
    roles: RoleAssignment,
    sensitivity: SensitivityLevel,
  ) {
    this.mapper = new ActionMapper(preset, roles, (e) => this.dispatch(e));
    this.mapper.setSensitivity(sensitivity);
  }

  private dispatch(e: ActionEvent): void {
    if (!this.active) return;
    this.actions.apply(e);
    actionBus.emit(e);
  }

  start(opts: { keyboard: boolean; gamepad: boolean }): void {
    if (this.active) return;
    this.active = true;
    if (this.def.motionOverrides) {
      this.savedConfig = motionEngine.getConfig();
      motionEngine.setConfig({ ...this.savedConfig, ...this.def.motionOverrides });
    }
    this.unsubs.push(motionEngine.on('state', (s) => this.mapper.onState(s)));
    this.unsubs.push(motionEngine.on('gesture', (g) => this.mapper.onGesture(g)));
    this.unsubs.push(
      motionEngine.on('connection', (id, connected) => {
        if (!connected) this.mapper.releaseAll(id, performance.now());
      }),
    );
    if (opts.keyboard) {
      this.keyboard = new KeyboardActionSource((e) => this.dispatch(e), this.def.keyboardFallback ?? undefined);
      this.keyboard.start();
    }
    if (opts.gamepad) {
      this.gamepad = new GamepadActionSource((e) => this.dispatch(e));
      this.gamepad.start();
    }
  }

  setPreset(p: MappingPreset): void {
    this.mapper.setPreset(p);
    this.actions.reset();
  }

  setRoles(r: RoleAssignment): void {
    this.mapper.setRoles(r);
    this.actions.reset();
  }

  setSensitivity(level: SensitivityLevel): void {
    this.mapper.setSensitivity(level);
  }

  /** Re-centre neutral orientation for all controllers in this session. */
  recentre(): void {
    for (const id of Object.values(this.mapper.getRoles())) if (id) controllerManager.setNeutral(id);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.savedConfig) {
      motionEngine.setConfig(this.savedConfig);
      this.savedConfig = null;
    }
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.keyboard?.stop();
    this.gamepad?.stop();
    this.keyboard = null;
    this.gamepad = null;
    this.actions.reset();
  }
}

export interface UseActivitySessionResult {
  session: ActivitySession;
  preset: MappingPreset;
  setPreset(id: string): void;
  roles: RoleAssignment;
  setRoles(r: RoleAssignment): void;
  sensitivity: SensitivityLevel;
  setSensitivity(l: SensitivityLevel): void;
  ready: boolean;
  missingRoles: string[];
  connected: ControllerId[];
}

/**
 * React glue: builds a session for `def`, keeps preset/roles/sensitivity persisted per
 * activity, re-resolves roles as controllers come and go, and starts/stops with the component.
 */
export function useActivitySession(def: ActivityDefinition): UseActivitySessionResult {
  const settings = useSettings();
  const slots = useControllerSlots();
  const connected = useMemo(
    () => ([1, 2] as ControllerId[]).filter((id) => slots[id].transportState === 'connected'),
    [slots],
  );
  const presetId = settings.activityPresets[def.id] ?? def.defaultPresetId;
  const preset = def.presets.find((p) => p.id === presetId) ?? def.presets[0];
  const preferred = settings.activityRoles[def.id] ?? def.defaultRoleAssignment;
  const sensitivity = settings.activitySensitivity[def.id] ?? def.defaultSensitivity ?? settings.sensitivity;
  const resolved = useMemo(() => resolveRoles(def, preferred, connected), [def, preferred, connected]);

  const sessionRef = useRef<ActivitySession | null>(null);
  if (!sessionRef.current) sessionRef.current = new ActivitySession(def, preset, resolved.assignment, sensitivity);
  const session = sessionRef.current;

  const [, force] = useState(0);
  useEffect(() => {
    session.start({ keyboard: settings.keyboardFallback, gamepad: settings.gamepadFallback });
    return () => session.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    session.setPreset(preset);
    force((n) => n + 1);
  }, [session, preset]);
  useEffect(() => {
    session.setRoles(resolved.assignment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, JSON.stringify(resolved.assignment)]);
  useEffect(() => {
    session.setSensitivity(sensitivity);
  }, [session, sensitivity]);
  useEffect(() => {
    settings.setLastActivity(def.id, def.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);

  return {
    session,
    preset,
    setPreset: (id) => settings.setActivityPreset(def.id, id),
    roles: resolved.assignment,
    setRoles: (r) => settings.setActivityRoles(def.id, r),
    sensitivity,
    setSensitivity: (l) => settings.setActivitySensitivity(def.id, l),
    ready: resolved.ready,
    missingRoles: resolved.missing,
    connected,
  };
}

/** Subscribe to actions for the lifetime of a component (stable callback ref). */
export function useActions(cb: (e: ActionEvent) => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => actionBus.onAny((e) => ref.current(e)), []);
}
