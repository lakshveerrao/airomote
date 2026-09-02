import type { ControllerId } from '@aero/motion-core';

/**
 * Universal actions. Every input source (motion controllers, simulator, keyboard, gamepad)
 * produces these; every activity consumes only these. Nothing downstream ever sees W/A/S/D.
 */
export const ACTION_TYPES = [
  // tilt (held)
  'TILT_LEFT',
  'TILT_RIGHT',
  'TILT_FORWARD',
  'TILT_BACK',
  // rotation about vertical axis (held)
  'ROTATE_LEFT',
  'ROTATE_RIGHT',
  // swings (triggers)
  'SWING_LEFT',
  'SWING_RIGHT',
  'SWING_UP',
  'SWING_DOWN',
  'SWING_FORWARD',
  'SWING_BACK',
  // triggers
  'STRIKE',
  'STRUM_UP',
  'STRUM_DOWN',
  'SHAKE',
  'PUNCH',
  'JUMP',
  'MUTE',
  // driving
  'ACCELERATE',
  'BRAKE',
  'BOOST',
  'TURN_LEFT',
  'TURN_RIGHT',
  // navigation / generic
  'SELECT_ZONE',
  'MOTION_START',
  'MOTION_END',
  'HOLD',
  'RELEASE',
  'PAUSE',
  'CONFIRM',
  // continuous axes (-1..1)
  'CONTINUOUS_X',
  'CONTINUOUS_Y',
  'CONTINUOUS_Z',
  'INTENSITY',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export type ActionPhase = 'start' | 'update' | 'end' | 'trigger';
export type ActionSource = 'motion' | 'simulator' | 'keyboard' | 'gamepad' | 'ui';

export interface ActionEvent {
  action: ActionType;
  phase: ActionPhase;
  /** Held/continuous actions: -1..1 or 0..1. Triggers: same as intensity. */
  value: number;
  /** 0..1 strength for triggers (strike velocity, swing speed). */
  intensity: number;
  /** Which physical controller produced it (null for keyboard/gamepad). */
  controllerId: ControllerId | null;
  /** Which activity role that controller was playing. */
  role: string | null;
  source: ActionSource;
  timestamp: number;
  confidence: number;
  /** Optional payload: zone id for SELECT_ZONE, raw peak for diagnostics, etc. */
  meta?: Record<string, string | number | boolean>;
}

export function isActionType(s: string): s is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(s);
}

/** Small typed pub/sub for actions. */
export class ActionBus {
  private listeners = new Set<(e: ActionEvent) => void>();
  private byAction = new Map<ActionType, Set<(e: ActionEvent) => void>>();

  emit(e: ActionEvent): void {
    for (const l of this.listeners) l(e);
    const set = this.byAction.get(e.action);
    if (set) for (const l of set) l(e);
  }

  onAny(cb: (e: ActionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  on(action: ActionType, cb: (e: ActionEvent) => void): () => void {
    let set = this.byAction.get(action);
    if (!set) {
      set = new Set();
      this.byAction.set(action, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  clear(): void {
    this.listeners.clear();
    this.byAction.clear();
  }
}

/**
 * Convenience: keeps the current value of held/continuous actions so activities can poll
 * per frame instead of subscribing to every update. Triggers are exposed as an edge counter.
 */
export class ActionState {
  private values = new Map<ActionType, number>();
  private triggers = new Map<ActionType, { count: number; lastIntensity: number; lastAt: number }>();

  apply(e: ActionEvent): void {
    if (e.phase === 'trigger') {
      const t = this.triggers.get(e.action) ?? { count: 0, lastIntensity: 0, lastAt: 0 };
      t.count++;
      t.lastIntensity = e.intensity;
      t.lastAt = e.timestamp;
      this.triggers.set(e.action, t);
      return;
    }
    if (e.phase === 'end') this.values.set(e.action, 0);
    else this.values.set(e.action, e.value);
  }

  value(action: ActionType): number {
    return this.values.get(action) ?? 0;
  }

  held(action: ActionType, threshold = 0.05): boolean {
    return Math.abs(this.value(action)) > threshold;
  }

  /** Number of trigger events since the last call (consumes them). */
  consume(action: ActionType): { count: number; intensity: number } {
    const t = this.triggers.get(action);
    if (!t || t.count === 0) return { count: 0, intensity: 0 };
    const out = { count: t.count, intensity: t.lastIntensity };
    t.count = 0;
    return out;
  }

  reset(): void {
    this.values.clear();
    this.triggers.clear();
  }
}
