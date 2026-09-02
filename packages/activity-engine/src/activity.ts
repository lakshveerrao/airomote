import type { ControllerId } from '@aero/motion-core';

import type { MotionConfig } from '@aero/motion-core';
import type { ActionEvent, ActionType } from './actions';
import type { MappingPreset, RoleAssignment, SensitivityLevel } from './mapping';


export type ActivityCategory = 'games' | 'music' | 'workout';
export type ActivityStatus = 'available' | 'coming-soon';

export interface ControllerRole {
  id: string;
  label: string;
  description: string;
  required: boolean;
}

export interface SetupStep {
  title: string;
  body: string;
  /** Optional illustration key rendered by the web app. */
  illustration?: 'hold-upright' | 'hold-flat' | 'strap-arm' | 'pocket' | 'two-hands' | 'chest';
}

export interface KeyboardBinding {
  action: ActionType;
  /** Role the key pretends to be (so activities can route it like a controller). */
  role?: string;
  /** Extra payload, e.g. { zone: 'snare' } for SELECT_ZONE. */
  meta?: Record<string, string | number | boolean>;
}

export interface KeyboardFallback {
  /** Keyboard key (KeyboardEvent.code) → action. Only for development/accessibility. */
  [code: string]: ActionType | KeyboardBinding;
}

/**
 * Static description of an activity. Everything a menu, a setup screen and the mapping
 * engine need to know — with no rendering code. Adding activity #100 = one more of these
 * plus its runtime/component.
 */
export interface ActivityDefinition {
  id: string;
  name: string;
  category: ActivityCategory;
  tagline: string;
  description: string;
  status: ActivityStatus;
  /** Accent colour used by the card and the full-screen experience. */
  accent: string;
  controllers: { min: 1 | 2; max: 1 | 2 };
  roles: ControllerRole[];
  defaultRoleAssignment: RoleAssignment;
  setupSteps: SetupStep[];
  presets: MappingPreset[];
  defaultPresetId: string;
  /** Universal actions this activity consumes (documentation + diagnostics filter). */
  actions: ActionType[];
  keyboardFallback?: KeyboardFallback;
  defaultSensitivity?: SensitivityLevel;
  /** Motion-engine tuning applied while this activity runs (e.g. slower yaw decay for drums). */
  motionOverrides?: Partial<MotionConfig>;
}

export type ActivityLifecycle = 'idle' | 'setup' | 'running' | 'paused' | 'finished';

/**
 * The live side of an activity. The web app's React component creates one, forwards actions
 * from the mapper, and drives update() from its render loop.
 */
export interface ActivityRuntime {
  readonly lifecycle: ActivityLifecycle;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Called once per rendered frame with delta seconds. */
  update?(dt: number, now: number): void;
  onAction(event: ActionEvent): void;
  /** Called when a controller for one of the roles connects/disconnects. */
  onControllerChange?(role: string, controllerId: ControllerId | null): void;
  cleanup(): void;
}

export interface ActivitySessionRecord {
  activityId: string;
  startedAt: number; // epoch ms
  endedAt: number;
  durationMs: number;
  /** Activity-specific summary: reps, laps, notes played… */
  summary: Record<string, number | string>;
}

/** Registry — the web app registers all activities at startup. */
export class ActivityRegistry {
  private defs = new Map<string, ActivityDefinition>();

  register(def: ActivityDefinition): void {
    if (this.defs.has(def.id)) throw new Error(`Activity '${def.id}' already registered`);
    validateActivity(def);
    this.defs.set(def.id, def);
  }

  get(id: string): ActivityDefinition | undefined {
    return this.defs.get(id);
  }

  all(): ActivityDefinition[] {
    return [...this.defs.values()];
  }

  byCategory(category: ActivityCategory): ActivityDefinition[] {
    return this.all().filter((d) => d.category === category);
  }
}

export function validateActivity(def: ActivityDefinition): void {
  if (def.status === 'coming-soon') return;
  if (!def.presets.some((p) => p.id === def.defaultPresetId))
    throw new Error(`Activity '${def.id}': defaultPresetId '${def.defaultPresetId}' not in presets`);
  const roleIds = new Set(def.roles.map((r) => r.id));
  for (const p of def.presets)
    for (const r of p.rules)
      if (!roleIds.has(r.role)) throw new Error(`Activity '${def.id}' preset '${p.id}': unknown role '${r.role}'`);
  for (const role of Object.keys(def.defaultRoleAssignment))
    if (!roleIds.has(role)) throw new Error(`Activity '${def.id}': default assignment for unknown role '${role}'`);
  const required = def.roles.filter((r) => r.required).length;
  if (required > def.controllers.max) throw new Error(`Activity '${def.id}': more required roles than controllers`);
}

/**
 * Resolve which controller plays which role given what is connected. Required roles get
 * priority; when only one controller is connected and the activity supports one, the
 * connected controller takes the first required role.
 */
export function resolveRoles(
  def: ActivityDefinition,
  preferred: RoleAssignment,
  connected: ControllerId[],
): { assignment: RoleAssignment; ready: boolean; missing: string[] } {
  const assignment: RoleAssignment = {};
  const used = new Set<ControllerId>();
  for (const role of def.roles) assignment[role.id] = null;
  const wanted = (roleId: string) => preferred[roleId] ?? def.defaultRoleAssignment[roleId] ?? null;
  const take = (roleId: string, id: ControllerId | null) => {
    if (id && connected.includes(id) && !used.has(id)) {
      assignment[roleId] = id;
      used.add(id);
    }
  };
  // 1. required roles get their preferred controller, 2. required roles take any spare,
  // 3. optional roles get their preferred controller, 4. optional roles take any spare.
  for (const role of def.roles) if (role.required) take(role.id, wanted(role.id));
  for (const role of def.roles) if (role.required && !assignment[role.id]) take(role.id, connected.find((c) => !used.has(c)) ?? null);
  for (const role of def.roles) if (!role.required) take(role.id, wanted(role.id));
  for (const role of def.roles) if (!role.required && !assignment[role.id]) take(role.id, connected.find((c) => !used.has(c)) ?? null);
  const missing = def.roles.filter((r) => r.required && !assignment[r.id]).map((r) => r.id);
  const ready = missing.length === 0 && connected.length >= def.controllers.min;
  return { assignment, ready, missing };
}
