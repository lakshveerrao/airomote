import { describe, expect, it } from 'vitest';
import { MotionEngine, PacketSynth, stillFrames, strikeFrames, sweepFrames, type SynthFrame } from '@aero/motion-core';
import {
  ActionBus,
  ActionMapper,
  ActionState,
  ActivityRegistry,
  matchZone,
  resolveRoles,
  type ActionEvent,
  type ActivityDefinition,
  type MappingPreset,
} from './index';

const preset: MappingPreset = {
  id: 'test',
  name: 'Test',
  description: '',
  rules: [
    { kind: 'tiltAxis', role: 'steer', axis: 'roll', action: 'CONTINUOUS_X', deadzoneDeg: 5, maxDeg: 40 },
    { kind: 'tiltZone', role: 'steer', direction: 'forward', action: 'ACCELERATE' },
    { kind: 'gesture', role: 'stick', gesture: 'strike', action: 'STRIKE', cooldownMs: 30 },
    { kind: 'gesture', role: 'stick', gesture: 'swing', direction: 'up', action: 'STRUM_UP' },
    {
      kind: 'zone',
      role: 'stick',
      action: 'SELECT_ZONE',
      zones: [
        { id: 'left', yaw: [20, 180] },
        { id: 'right', yaw: [-180, -20] },
        { id: 'centre' },
      ],
    },
  ],
};

function pipeline(roles: Record<string, 1 | 2 | null>) {
  const engine = new MotionEngine();
  const actions: ActionEvent[] = [];
  const mapper = new ActionMapper(preset, roles, (e) => actions.push(e));
  engine.on('state', (s) => mapper.onState(s));
  engine.on('gesture', (g) => mapper.onGesture(g));
  return { engine, actions, mapper };
}

function feed(engine: MotionEngine, synth: PacketSynth, frames: SynthFrame[]) {
  for (const f of frames) engine.ingest(synth.next(f));
}

describe('ActionMapper', () => {
  it('maps roll tilt to a continuous axis with deadzone and full deflection', () => {
    const { engine, actions } = pipeline({ steer: 1, stick: 2 });
    const synth = new PacketSynth({ controllerId: 1 });
    feed(engine, synth, stillFrames(120, 0, 0)); // neutral
    feed(engine, synth, [...sweepFrames(50, { pitch: 0, roll: 0 }, { pitch: 0, roll: 45 }), ...stillFrames(60, 0, 45)]);
    const axis = actions.filter((a) => a.action === 'CONTINUOUS_X');
    expect(axis[0].phase).toBe('start');
    expect(axis.at(-1)!.value).toBeGreaterThan(0.95);
    expect(axis.at(-1)!.role).toBe('steer');
    expect(axis.at(-1)!.controllerId).toBe(1);
    // small tilt inside the deadzone produces nothing new
    const before = actions.length;
    feed(engine, synth, [...sweepFrames(50, { pitch: 0, roll: 45 }, { pitch: 0, roll: 2 }), ...stillFrames(60, 0, 2)]);
    const ended = actions.slice(before).filter((a) => a.action === 'CONTINUOUS_X');
    expect(ended.at(-1)!.phase).toBe('end');
  });

  it('turns a forward tilt into a held ACCELERATE with start/end', () => {
    const { engine, actions } = pipeline({ steer: 1, stick: 2 });
    const synth = new PacketSynth({ controllerId: 1 });
    feed(engine, synth, stillFrames(120, 0, 0));
    feed(engine, synth, [
      ...sweepFrames(40, { pitch: 0, roll: 0 }, { pitch: -35, roll: 0 }),
      ...stillFrames(20, -35, 0),
      ...sweepFrames(40, { pitch: -35, roll: 0 }, { pitch: 0, roll: 0 }),
      ...stillFrames(40, 0, 0),
    ]);
    const acc = actions.filter((a) => a.action === 'ACCELERATE' && a.phase !== 'update');
    expect(acc.map((a) => a.phase)).toEqual(['start', 'end']);
  });

  it('maps strikes to STRIKE triggers with intensity, honouring roles', () => {
    const { engine, actions } = pipeline({ steer: 1, stick: 2 });
    const s1 = new PacketSynth({ controllerId: 1 });
    const s2 = new PacketSynth({ controllerId: 2 });
    feed(engine, s1, stillFrames(120, 10, 0));
    feed(engine, s2, stillFrames(120, 10, 0));
    feed(engine, s1, [...strikeFrames(600), ...stillFrames(40, 10, 0)]); // steer role strikes → nothing
    feed(engine, s2, [...strikeFrames(600), ...stillFrames(40, 10, 0)]);
    const strikes = actions.filter((a) => a.action === 'STRIKE');
    expect(strikes.length).toBe(1);
    expect(strikes[0].controllerId).toBe(2);
    expect(strikes[0].role).toBe('stick');
    expect(strikes[0].phase).toBe('trigger');
    expect(strikes[0].intensity).toBeGreaterThan(0.2);
  });

  it('emits SELECT_ZONE only when the zone changes', () => {
    const { engine, actions } = pipeline({ steer: 1, stick: 2 });
    const s2 = new PacketSynth({ controllerId: 2 });
    feed(engine, s2, stillFrames(120, 0, 0));
    const frames: SynthFrame[] = [];
    for (let i = 0; i < 40; i++) frames.push({ pitch: 0, roll: 0, yawRate: 120 }); // +48° → left
    frames.push(...stillFrames(5, 0, 0));
    for (let i = 0; i < 80; i++) frames.push({ pitch: 0, roll: 0, yawRate: -120 }); // -48° → right
    frames.push(...stillFrames(5, 0, 0));
    feed(engine, s2, frames);
    const zones = actions.filter((a) => a.action === 'SELECT_ZONE').map((a) => a.meta?.zone);
    expect(zones).toEqual(['centre', 'left', 'centre', 'right']);
  });

  it('ignores controllers without a role and releases held actions on disconnect', () => {
    const { engine, actions, mapper } = pipeline({ steer: 1, stick: null });
    const s2 = new PacketSynth({ controllerId: 2 });
    feed(engine, s2, [...stillFrames(120, 0, 0), ...strikeFrames(600)]);
    expect(actions.length).toBe(0);
    const s1 = new PacketSynth({ controllerId: 1 });
    feed(engine, s1, stillFrames(120, 0, 0));
    feed(engine, s1, [...sweepFrames(40, { pitch: 0, roll: 0 }, { pitch: -35, roll: 30 }), ...stillFrames(10, -35, 30)]);
    expect(actions.some((a) => a.action === 'ACCELERATE' && a.phase === 'start')).toBe(true);
    mapper.releaseAll(1, 999);
    const ends = actions.filter((a) => a.phase === 'end').map((a) => a.action);
    expect(ends).toContain('ACCELERATE');
    expect(ends).toContain('CONTINUOUS_X');
  });

  it('matchZone applies hysteresis to the current zone', () => {
    const zones = [{ id: 'a', roll: [-10, 10] as [number, number] }, { id: 'b' }];
    expect(matchZone({ pitch: 0, roll: 0, yaw: 0 }, zones, null)).toBe('a');
    expect(matchZone({ pitch: 0, roll: 13, yaw: 0 }, zones, 'a', 5)).toBe('a');
    expect(matchZone({ pitch: 0, roll: 13, yaw: 0 }, zones, null, 5)).toBe('b');
    expect(matchZone({ pitch: 0, roll: 16, yaw: 0 }, zones, 'a', 5)).toBe('b');
  });
});

describe('ActionBus / ActionState', () => {
  const ev = (action: ActionEvent['action'], phase: ActionEvent['phase'], value = 1): ActionEvent => ({
    action,
    phase,
    value,
    intensity: Math.abs(value),
    controllerId: null,
    role: null,
    source: 'keyboard',
    timestamp: 0,
    confidence: 1,
  });
  it('routes by action and to any-listeners', () => {
    const bus = new ActionBus();
    const got: string[] = [];
    bus.on('BRAKE', (e) => got.push(`brake:${e.phase}`));
    bus.onAny((e) => got.push(`any:${e.action}`));
    bus.emit(ev('BRAKE', 'start'));
    bus.emit(ev('JUMP', 'trigger'));
    expect(got).toEqual(['any:BRAKE', 'brake:start', 'any:JUMP']);
  });
  it('ActionState tracks held values and consumes triggers once', () => {
    const st = new ActionState();
    st.apply(ev('TURN_LEFT', 'start', 0.4));
    expect(st.value('TURN_LEFT')).toBe(0.4);
    st.apply(ev('TURN_LEFT', 'end', 0));
    expect(st.held('TURN_LEFT')).toBe(false);
    st.apply(ev('STRIKE', 'trigger', 0.8));
    st.apply(ev('STRIKE', 'trigger', 0.6));
    expect(st.consume('STRIKE')).toEqual({ count: 2, intensity: 0.6 });
    expect(st.consume('STRIKE').count).toBe(0);
  });
});

describe('ActivityRegistry / roles', () => {
  const def: ActivityDefinition = {
    id: 'demo',
    name: 'Demo',
    category: 'games',
    tagline: '',
    description: '',
    status: 'available',
    accent: '#fff',
    controllers: { min: 1, max: 2 },
    roles: [
      { id: 'steer', label: 'Steering', description: '', required: true },
      { id: 'stick', label: 'Action', description: '', required: false },
    ],
    defaultRoleAssignment: { steer: 1, stick: 2 },
    setupSteps: [],
    presets: [preset],
    defaultPresetId: 'test',
    actions: ['CONTINUOUS_X', 'ACCELERATE', 'STRIKE'],
  };

  it('validates presets and roles', () => {
    const reg = new ActivityRegistry();
    reg.register(def);
    expect(reg.byCategory('games').length).toBe(1);
    expect(() => reg.register(def)).toThrow(/already/);
    expect(() => reg.register({ ...def, id: 'x', defaultPresetId: 'nope' })).toThrow(/defaultPresetId/);
    expect(() =>
      reg.register({ ...def, id: 'y', presets: [{ ...preset, rules: [{ kind: 'gesture', role: 'ghost', gesture: 'strike', action: 'STRIKE' }] }] }),
    ).toThrow(/unknown role/);
  });

  it('resolves roles for one and two controllers, and swapped preference', () => {
    expect(resolveRoles(def, {}, [1, 2])).toEqual({ assignment: { steer: 1, stick: 2 }, ready: true, missing: [] });
    expect(resolveRoles(def, {}, [2])).toEqual({ assignment: { steer: 2, stick: null }, ready: true, missing: [] });
    expect(resolveRoles(def, { steer: 2, stick: 1 }, [1, 2]).assignment).toEqual({ steer: 2, stick: 1 });
    expect(resolveRoles(def, {}, []).ready).toBe(false);
    const twoRequired = { ...def, roles: def.roles.map((r) => ({ ...r, required: true })), controllers: { min: 2 as const, max: 2 as const } };
    const r = resolveRoles(twoRequired, {}, [1]);
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(['stick']);
  });
});
