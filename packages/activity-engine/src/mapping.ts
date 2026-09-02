import type { ControllerId, ControllerMotionState, Direction, GestureEvent, GestureType } from '@aero/motion-core';
import { applyDeadzone, clamp } from '@aero/motion-core';
import type { ActionEvent, ActionType } from './actions';

export type SensitivityLevel = 'low' | 'normal' | 'high';
export type RoleAssignment = Record<string, ControllerId | null>;

/**
 * Mapping rules — the configurable bridge between motion and actions.
 * A preset is a list of rules; each rule applies to one controller *role*.
 */
export type MappingRule =
  | {
      /** Continuous axis from orientation relative to neutral. */
      kind: 'tiltAxis';
      role: string;
      axis: 'roll' | 'pitch' | 'yaw';
      action: ActionType;
      /** Degrees ignored around neutral. */
      deadzoneDeg: number;
      /** Degrees that produce full deflection (±1). */
      maxDeg: number;
      invert?: boolean;
      /** Optional response curve exponent (1 = linear, 2 = softer centre). */
      curve?: number;
    }
  | {
      /** Continuous axis from angular rate (deg/s). */
      kind: 'rateAxis';
      role: string;
      axis: 'pitchRate' | 'rollRate' | 'yawRate';
      action: ActionType;
      deadzoneDps: number;
      maxDps: number;
      invert?: boolean;
    }
  | {
      /** Continuous from a linear acceleration axis in g. */
      kind: 'accelAxis';
      role: string;
      axis: 'x' | 'y' | 'z';
      action: ActionType;
      deadzoneG: number;
      maxG: number;
      invert?: boolean;
    }
  | {
      /** Held action while tilted past the threshold in one direction (uses TiltDetector). */
      kind: 'tiltZone';
      role: string;
      direction: Direction;
      action: ActionType;
    }
  | {
      /** Held action while rotated (yaw) past the threshold (uses RotateDetector). */
      kind: 'rotateZone';
      role: string;
      direction: 'left' | 'right';
      action: ActionType;
    }
  | {
      /** Trigger on a gesture peak (strike/swing/shake). */
      kind: 'gesture';
      role: string;
      gesture: GestureType;
      direction?: Direction;
      action: ActionType;
      cooldownMs?: number;
      minIntensity?: number;
    }
  | {
      /**
       * Orientation zones: emits SELECT_ZONE (or given action) as an `update` whenever the
       * active zone changes. Zones are checked in order; first match wins. Angles are relative.
       */
      kind: 'zone';
      role: string;
      action: ActionType;
      zones: OrientationZone[];
      /** Degrees of hysteresis added around the current zone to avoid flicker. */
      hysteresisDeg?: number;
    }
  | {
      /** Emit a continuous INTENSITY-like action from motion magnitude. */
      kind: 'magnitude';
      role: string;
      action: ActionType;
      maxG: number;
    };

export interface OrientationZone {
  id: string;
  pitch?: [number, number];
  roll?: [number, number];
  yaw?: [number, number];
}

export interface MappingPreset {
  id: string;
  name: string;
  description: string;
  rules: MappingRule[];
  /** Non-motion sources allowed for this preset (keyboard is always allowed as fallback). */
  fallback?: 'keyboard' | 'gamepad' | 'both';
}

export const SENSITIVITY_SCALE: Record<SensitivityLevel, number> = { low: 0.7, normal: 1, high: 1.4 };

function inRange(v: number, r?: [number, number], pad = 0): boolean {
  if (!r) return true;
  return v >= r[0] - pad && v <= r[1] + pad;
}

export function matchZone(
  o: { pitch: number; roll: number; yaw: number },
  zones: OrientationZone[],
  current: string | null,
  hysteresisDeg = 0,
): string | null {
  // Zones are checked in priority order. The current zone is grown by the hysteresis margin,
  // every other zone is shrunk by it, so a boundary must be crossed decisively to switch.
  // Catch-all zones (no ranges) match regardless of padding.
  for (const z of zones) {
    const pad = z.id === current ? hysteresisDeg : -hysteresisDeg;
    if (inRange(o.pitch, z.pitch, pad) && inRange(o.roll, z.roll, pad) && inRange(o.yaw, z.yaw, pad)) return z.id;
  }
  return null;
}

/**
 * Turns motion states + gesture events into ActionEvents according to a preset and a role
 * assignment. Pure — feed it states/gestures and collect emitted actions. Both real
 * controllers and the simulator go through the MotionEngine, so this never knows the source.
 */
export class ActionMapper {
  private preset: MappingPreset;
  private roles: RoleAssignment;
  private sensitivity: SensitivityLevel = 'normal';
  private readonly held = new Map<string, boolean>(); // ruleKey → currently held
  private readonly lastTrigger = new Map<string, number>();
  private readonly zoneState = new Map<string, string | null>();
  private readonly axisLast = new Map<string, number>();

  constructor(
    preset: MappingPreset,
    roles: RoleAssignment,
    private readonly emit: (e: ActionEvent) => void,
  ) {
    this.preset = preset;
    this.roles = roles;
  }

  setPreset(preset: MappingPreset): void {
    this.preset = preset;
    this.reset();
  }

  setRoles(roles: RoleAssignment): void {
    this.roles = roles;
    this.reset();
  }

  setSensitivity(level: SensitivityLevel): void {
    this.sensitivity = level;
  }

  getPreset(): MappingPreset {
    return this.preset;
  }

  getRoles(): RoleAssignment {
    return this.roles;
  }

  private roleFor(controllerId: ControllerId): string[] {
    return Object.entries(this.roles)
      .filter(([, id]) => id === controllerId)
      .map(([role]) => role);
  }

  private base(s: { controllerId: ControllerId; hostTime?: number; timestamp: number; confidence: number }, role: string) {
    return {
      controllerId: s.controllerId,
      role,
      source: 'motion' as const,
      timestamp: 'hostTime' in s && s.hostTime !== undefined ? s.hostTime : s.timestamp,
      confidence: s.confidence,
    };
  }

  /** Continuous rules — call on every state update. */
  onState(s: ControllerMotionState): void {
    const roles = this.roleFor(s.controllerId);
    if (roles.length === 0) return;
    const k = SENSITIVITY_SCALE[this.sensitivity];
    for (let i = 0; i < this.preset.rules.length; i++) {
      const rule = this.preset.rules[i];
      if (!roles.includes(rule.role)) continue;
      const key = `${i}:${s.controllerId}`;
      switch (rule.kind) {
        case 'tiltAxis': {
          const raw = rule.axis === 'roll' ? s.relative.roll : rule.axis === 'pitch' ? s.relative.pitch : s.relative.yaw;
          let v = applyDeadzone(raw * k, rule.deadzoneDeg, rule.maxDeg);
          if (rule.curve && rule.curve !== 1) v = Math.sign(v) * Math.pow(Math.abs(v), rule.curve);
          if (rule.invert) v = -v;
          this.axis(key, rule.action, v, s, rule.role);
          break;
        }
        case 'rateAxis': {
          const raw = rule.axis === 'pitchRate' ? -s.gyro.y : rule.axis === 'rollRate' ? s.gyro.x : s.gyro.z;
          let v = applyDeadzone(raw * k, rule.deadzoneDps, rule.maxDps);
          if (rule.invert) v = -v;
          this.axis(key, rule.action, v, s, rule.role);
          break;
        }
        case 'accelAxis': {
          const raw = s.linearAccel[rule.axis];
          let v = applyDeadzone(raw * k, rule.deadzoneG, rule.maxG);
          if (rule.invert) v = -v;
          this.axis(key, rule.action, v, s, rule.role);
          break;
        }
        case 'magnitude': {
          const v = clamp((s.motionMagnitude * k) / rule.maxG, 0, 1);
          this.axis(key, rule.action, v, s, rule.role);
          break;
        }
        case 'zone': {
          const prev = this.zoneState.get(key) ?? null;
          const next = matchZone(s.relative, rule.zones, prev, rule.hysteresisDeg ?? 6);
          if (next !== prev) {
            this.zoneState.set(key, next);
            this.emit({
              ...this.base(s, rule.role),
              action: rule.action,
              phase: 'update',
              value: next ? rule.zones.findIndex((z) => z.id === next) : -1,
              intensity: 0,
              meta: { zone: next ?? '', previous: prev ?? '' },
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private axis(key: string, action: ActionType, v: number, s: ControllerMotionState, role: string): void {
    const last = this.axisLast.get(key) ?? 0;
    if (v === 0 && last === 0) return;
    let phase: ActionEvent['phase'] = 'update';
    if (last === 0 && v !== 0) phase = 'start';
    else if (last !== 0 && v === 0) phase = 'end';
    this.axisLast.set(key, v);
    this.emit({ ...this.base(s, role), action, phase, value: v, intensity: Math.abs(v) });
  }

  /** Discrete rules — call for every gesture event. */
  onGesture(g: GestureEvent): void {
    const roles = this.roleFor(g.controllerId);
    if (roles.length === 0) return;
    for (let i = 0; i < this.preset.rules.length; i++) {
      const rule = this.preset.rules[i];
      if (!roles.includes(rule.role)) continue;
      const key = `${i}:${g.controllerId}`;
      const base = {
        controllerId: g.controllerId,
        role: rule.role,
        source: 'motion' as const,
        timestamp: g.timestamp,
        confidence: g.confidence,
        meta: { peak: g.peak, gesture: g.gesture, direction: g.direction ?? '' },
      };
      switch (rule.kind) {
        case 'tiltZone':
          if (g.gesture !== 'tilt' || g.direction !== rule.direction) break;
          this.heldGesture(key, rule.action, g, base);
          break;
        case 'rotateZone':
          if (g.gesture !== 'rotate' || g.direction !== rule.direction) break;
          this.heldGesture(key, rule.action, g, base);
          break;
        case 'gesture': {
          if (g.gesture !== rule.gesture) break;
          if (rule.direction && g.direction !== rule.direction) break;
          // rotate/tilt are held gestures — trigger on start; others trigger on peak
          const triggerPhase = g.gesture === 'rotate' || g.gesture === 'tilt' ? 'start' : 'peak';
          if (g.phase !== triggerPhase) break;
          if (g.intensity < (rule.minIntensity ?? 0)) break;
          const last = this.lastTrigger.get(key) ?? -Infinity;
          if (g.timestamp - last < (rule.cooldownMs ?? 0)) break;
          this.lastTrigger.set(key, g.timestamp);
          this.emit({ ...base, action: rule.action, phase: 'trigger', value: g.intensity, intensity: g.intensity });
          break;
        }
        default:
          break;
      }
    }
  }

  private heldGesture(key: string, action: ActionType, g: GestureEvent, base: Omit<ActionEvent, 'action' | 'phase' | 'value' | 'intensity'>): void {
    if (g.phase === 'start') {
      this.held.set(key, true);
      this.emit({ ...base, action, phase: 'start', value: Math.max(g.intensity, 0.01), intensity: g.intensity });
    } else if (g.phase === 'peak' && this.held.get(key)) {
      this.emit({ ...base, action, phase: 'update', value: Math.max(g.intensity, 0.01), intensity: g.intensity });
    } else if (g.phase === 'end' && this.held.get(key)) {
      this.held.set(key, false);
      this.emit({ ...base, action, phase: 'end', value: 0, intensity: 0 });
    }
  }

  /** Release everything held (controller disconnected, activity paused …). */
  releaseAll(controllerId: ControllerId, timestamp: number): void {
    for (const [key, isHeld] of this.held) {
      if (!isHeld || !key.endsWith(`:${controllerId}`)) continue;
      const ruleIndex = Number(key.split(':')[0]);
      const rule = this.preset.rules[ruleIndex];
      if (!rule) continue;
      this.held.set(key, false);
      this.emit({
        action: rule.action,
        phase: 'end',
        value: 0,
        intensity: 0,
        controllerId,
        role: rule.role,
        source: 'motion',
        timestamp,
        confidence: 0,
      });
    }
    for (const [key, v] of this.axisLast) {
      if (v === 0 || !key.endsWith(`:${controllerId}`)) continue;
      const rule = this.preset.rules[Number(key.split(':')[0])];
      if (!rule) continue;
      this.axisLast.set(key, 0);
      this.emit({
        action: rule.action,
        phase: 'end',
        value: 0,
        intensity: 0,
        controllerId,
        role: rule.role,
        source: 'motion',
        timestamp,
        confidence: 0,
      });
    }
  }

  reset(): void {
    this.held.clear();
    this.lastTrigger.clear();
    this.zoneState.clear();
    this.axisLast.clear();
  }
}
