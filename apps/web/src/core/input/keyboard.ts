import type { ActionEvent, ActionType, KeyboardBinding, KeyboardFallback } from '@aero/activity-engine';

/**
 * Keyboard → universal actions. Development / accessibility fallback ONLY.
 * Activities never see key codes; they see the same ActionEvents motion produces.
 * Held keys produce start/end; keys mapped to trigger-style actions produce 'trigger'.
 */
const TRIGGER_ACTIONS = new Set<ActionType>([
  'STRIKE',
  'STRUM_UP',
  'STRUM_DOWN',
  'SHAKE',
  'PUNCH',
  'JUMP',
  'MUTE',
  'BOOST',
  'SWING_LEFT',
  'SWING_RIGHT',
  'SWING_UP',
  'SWING_DOWN',
  'SWING_FORWARD',
  'SWING_BACK',
  'CONFIRM',
  'PAUSE',
]);

export const DEFAULT_KEYBOARD: KeyboardFallback = {
  KeyW: 'ACCELERATE',
  ArrowUp: 'ACCELERATE',
  KeyS: 'BRAKE',
  ArrowDown: 'BRAKE',
  KeyA: 'TURN_LEFT',
  ArrowLeft: 'TURN_LEFT',
  KeyD: 'TURN_RIGHT',
  ArrowRight: 'TURN_RIGHT',
  Space: 'STRIKE',
  ShiftLeft: 'BOOST',
  KeyQ: 'STRUM_DOWN',
  KeyE: 'STRUM_UP',
  KeyM: 'MUTE',
  Escape: 'PAUSE',
  Enter: 'CONFIRM',
};

function normalise(b: ActionType | KeyboardBinding): KeyboardBinding {
  return typeof b === 'string' ? { action: b } : b;
}

export class KeyboardActionSource {
  private map: KeyboardFallback;
  private held = new Map<string, KeyboardBinding>();
  private enabled = false;

  constructor(
    private readonly emit: (e: ActionEvent) => void,
    map: KeyboardFallback = DEFAULT_KEYBOARD,
  ) {
    this.map = map;
  }

  setMap(map: KeyboardFallback): void {
    this.releaseAll();
    this.map = map;
  }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.releaseAll);
  }

  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.releaseAll);
    this.releaseAll();
  }

  private isEditable(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  private event(b: KeyboardBinding, phase: ActionEvent['phase'], value: number): ActionEvent {
    return {
      action: b.action,
      phase,
      value,
      intensity: Math.abs(value),
      controllerId: null,
      role: b.role ?? null,
      source: 'keyboard',
      timestamp: performance.now(),
      confidence: 1,
      meta: b.meta,
    };
  }

  private onDown = (e: KeyboardEvent): void => {
    if (this.isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const raw = this.map[e.code];
    if (!raw) return;
    e.preventDefault();
    if (e.repeat) return;
    const b = normalise(raw);
    if (TRIGGER_ACTIONS.has(b.action)) {
      this.emit(this.event(b, 'trigger', 0.8));
      return;
    }
    this.held.set(e.code, b);
    this.emit(this.event(b, 'start', 1));
  };

  private onUp = (e: KeyboardEvent): void => {
    const b = this.held.get(e.code);
    if (!b) return;
    this.held.delete(e.code);
    this.emit(this.event(b, 'end', 0));
  };

  private releaseAll = (): void => {
    for (const b of this.held.values()) this.emit(this.event(b, 'end', 0));
    this.held.clear();
  };
}
