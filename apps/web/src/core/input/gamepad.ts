import type { ActionEvent, ActionType } from '@aero/activity-engine';
import { applyDeadzone } from '@aero/motion-core';

/**
 * Gamepad API → universal actions. Optional fallback/testing adapter; polled from rAF.
 * Standard mapping: left stick X → CONTINUOUS_X (+TURN_LEFT/RIGHT), right trigger →
 * ACCELERATE, left trigger → BRAKE, A → STRIKE, B → BOOST, X → STRUM_DOWN, Y → STRUM_UP.
 */
export class GamepadActionSource {
  private raf: number | null = null;
  private lastAxis = 0;
  private buttons = new Map<number, boolean>();
  private held = new Map<ActionType, number>();
  private readonly buttonMap: Record<number, ActionType> = { 0: 'STRIKE', 1: 'BOOST', 2: 'STRUM_DOWN', 3: 'STRUM_UP', 9: 'PAUSE' };
  private readonly triggerButtons = new Set<ActionType>(['STRIKE', 'BOOST', 'STRUM_DOWN', 'STRUM_UP', 'PAUSE']);

  constructor(private readonly emit: (e: ActionEvent) => void) {}

  static available(): boolean {
    return typeof navigator !== 'undefined' && 'getGamepads' in navigator;
  }

  start(): void {
    if (this.raf !== null || !GamepadActionSource.available()) return;
    const loop = () => {
      this.poll();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    const now = performance.now();
    for (const [action] of this.held) this.emit(this.ev(action, 'end', 0, now));
    this.held.clear();
  }

  private ev(action: ActionType, phase: ActionEvent['phase'], value: number, timestamp: number): ActionEvent {
    return { action, phase, value, intensity: Math.abs(value), controllerId: null, role: null, source: 'gamepad', timestamp, confidence: 1 };
  }

  private hold(action: ActionType, value: number, now: number): void {
    const prev = this.held.get(action) ?? 0;
    if (value === 0 && prev === 0) return;
    const phase: ActionEvent['phase'] = prev === 0 ? 'start' : value === 0 ? 'end' : 'update';
    if (value === 0) this.held.delete(action);
    else this.held.set(action, value);
    this.emit(this.ev(action, phase, value, now));
  }

  private poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad) return;
    const now = performance.now();
    const x = applyDeadzone(pad.axes[0] ?? 0, 0.12);
    if (x !== this.lastAxis) {
      this.hold('CONTINUOUS_X', x, now);
      this.hold('TURN_LEFT', x < 0 ? -x : 0, now);
      this.hold('TURN_RIGHT', x > 0 ? x : 0, now);
      this.lastAxis = x;
    }
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    this.hold('ACCELERATE', rt > 0.05 ? rt : 0, now);
    this.hold('BRAKE', lt > 0.05 ? lt : 0, now);
    for (const [idx, action] of Object.entries(this.buttonMap)) {
      const i = Number(idx);
      const pressed = pad.buttons[i]?.pressed ?? false;
      const was = this.buttons.get(i) ?? false;
      if (pressed && !was && this.triggerButtons.has(action)) this.emit(this.ev(action, 'trigger', 0.8, now));
      this.buttons.set(i, pressed);
    }
  }
}
