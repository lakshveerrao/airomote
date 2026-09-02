import { describe, expect, it } from 'vitest';
import { encodeMotionPacket, decodePacket, PacketType, type MotionPacket } from '@aero/protocol';
import {
  ComplementaryOrientation,
  Hysteresis,
  LowPass,
  MotionEngine,
  PacketSynth,
  RunningStats,
  accelToPitchRoll,
  applyDeadzone,
  strikeFrames,
  stillFrames,
  sweepFrames,
  type GestureEvent,
  type SynthFrame,
} from './index';

function run(engine: MotionEngine, synth: PacketSynth, frames: SynthFrame[], events: GestureEvent[] = []) {
  const off = engine.on('gesture', (e) => events.push(e));
  let last = null;
  for (const f of frames) last = engine.ingest(synth.next(f));
  off();
  return { events, last };
}

describe('filters', () => {
  it('low-pass converges and attenuates noise', () => {
    const lp = new LowPass(5);
    let y = 0;
    for (let i = 0; i < 200; i++) y = lp.update(1, 0.01);
    expect(y).toBeGreaterThan(0.99);
    const noisy = new LowPass(2);
    let maxDev = 0;
    for (let i = 0; i < 500; i++) {
      const v = noisy.update(1 + (i % 2 ? 0.5 : -0.5), 0.01);
      if (i > 100) maxDev = Math.max(maxDev, Math.abs(v - 1));
    }
    expect(maxDev).toBeLessThan(0.05);
  });
  it('deadzone rescales continuously', () => {
    expect(applyDeadzone(0.05, 0.1)).toBe(0);
    expect(applyDeadzone(-0.05, 0.1)).toBe(0);
    expect(applyDeadzone(0.1, 0.1)).toBe(0);
    expect(applyDeadzone(0.55, 0.1)).toBeCloseTo(0.5, 5);
    expect(applyDeadzone(-1, 0.1)).toBe(-1);
    expect(applyDeadzone(2, 0.1)).toBe(1);
  });
  it('hysteresis needs enter threshold then holds until exit', () => {
    const h = new Hysteresis(10, 5);
    expect(h.update(7)).toBe(false);
    expect(h.update(11)).toBe(true);
    expect(h.update(7)).toBe(true);
    expect(h.update(4)).toBe(false);
  });
  it('running stats window is correct', () => {
    const s = new RunningStats(4);
    [1, 2, 3, 4, 5].forEach((v) => s.push(v));
    expect(s.mean).toBeCloseTo(3.5);
    expect(s.variance).toBeCloseTo(1.25);
  });
});

describe('orientation', () => {
  it('derives pitch/roll from gravity with the documented sign convention', () => {
    expect(accelToPitchRoll({ x: 0, y: 0, z: 1 })).toMatchObject({ pitch: 0, roll: 0 });
    // nose up 30°: x picks up +sin(30)
    const up = accelToPitchRoll({ x: 0.5, y: 0, z: 0.866 });
    expect(up.pitch).toBeCloseTo(30, 0);
    // right side down 45°: y picks up +
    const right = accelToPitchRoll({ x: 0, y: 0.707, z: 0.707 });
    expect(right.roll).toBeCloseTo(45, 0);
  });
  it('complementary filter follows gyro fast and converges to accel', () => {
    const o = new ComplementaryOrientation(0.98);
    o.update({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 0.01, true);
    // rotate nose-up at 100 deg/s for 0.3 s while accel still says flat (transient): gyro dominates
    for (let i = 0; i < 30; i++) o.update({ x: 0, y: 0, z: 1 }, { x: 0, y: -100, z: 0 }, 0.01, false);
    expect(o.pitch).toBeGreaterThan(20);
    // hold still with accel saying 30° → converges
    for (let i = 0; i < 400; i++) o.update({ x: 0.5, y: 0, z: 0.866 }, { x: 0, y: 0, z: 0 }, 0.01, true);
    expect(o.pitch).toBeCloseTo(30, 0);
  });
  it('yaw integrates gyro z and decays when stationary', () => {
    const o = new ComplementaryOrientation(0.98, 10);
    o.update({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 0.01, true);
    for (let i = 0; i < 50; i++) o.update({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 90 }, 0.01, false);
    expect(o.yaw).toBeCloseTo(45, 0);
    for (let i = 0; i < 1000; i++) o.update({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 0.01, true);
    expect(Math.abs(o.yaw)).toBeLessThan(1);
  });
});

describe('MotionEngine state', () => {
  it('detects stationary and sets a neutral automatically', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 1 });
    const { last } = run(engine, synth, stillFrames(120, 5, -3));
    expect(last?.isStationary).toBe(true);
    expect(last?.connected).toBe(true);
    expect(engine.getProcessor(1).hasNeutral).toBe(true);
    expect(Math.abs(last!.relative.pitch)).toBeLessThan(1.5);
    expect(Math.abs(last!.relative.roll)).toBeLessThan(1.5);
    expect(last!.orientation.pitch).toBeCloseTo(5, 0);
  });

  it('reports one controller connected when only one streams, and disconnect on stale', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 2 });
    run(engine, synth, stillFrames(20));
    expect(engine.connectedIds()).toEqual([2]);
    expect(engine.getState(1).connected).toBe(false);
    const conn: Array<[number, boolean]> = [];
    engine.on('connection', (id, c) => conn.push([id, c]));
    engine.checkStale(engine.getState(2).hostTime + 5000);
    expect(engine.getState(2).connected).toBe(false);
    expect(conn).toEqual([[2, false]]);
  });

  it('drops duplicate and late packets but recovers after a reboot', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 1 });
    const a = synth.next({ pitch: 0, roll: 0 });
    const b = synth.next({ pitch: 0, roll: 0 });
    expect(engine.ingest(a)).not.toBeNull();
    expect(engine.ingest(b)).not.toBeNull();
    expect(engine.ingest(b)).toBeNull(); // duplicate
    expect(engine.ingest(a)).toBeNull(); // late
    const rebooted = new PacketSynth({ controllerId: 1, startSequence: 0, startTimestamp: 0 });
    expect(engine.ingest(rebooted.next({ pitch: 0, roll: 0 }))).not.toBeNull();
    expect(engine.getSequenceStats(1).duplicates).toBe(1);
    expect(engine.getSequenceStats(1).outOfOrder).toBe(1);
  });

  it('ignores non-motion packets and unknown device ids', () => {
    const engine = new MotionEngine();
    const bytes = encodeMotionPacket({ deviceId: 7, timestamp: 1, accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 } });
    const r = decodePacket(bytes, 1);
    expect(r.ok && engine.ingest(r.packet)).toBeNull();
  });

  it('handles saturated / garbage motion values without NaN', () => {
    const engine = new MotionEngine();
    const bytes = encodeMotionPacket({
      deviceId: 1,
      timestamp: 1,
      sequence: 1,
      accel: { x: 32, y: -32, z: 32 },
      gyro: { x: 3000, y: -3000, z: 3000 },
    });
    const r = decodePacket(bytes, 1);
    const s = r.ok ? engine.ingest(r.packet as MotionPacket) : null;
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!.orientation.pitch)).toBe(true);
    expect(Number.isFinite(s!.motionMagnitude)).toBe(true);
    expect(s!.confidence).toBeLessThan(0.7);
  });
});

describe('gesture detection', () => {
  const prime = (engine: MotionEngine, synth: PacketSynth) => run(engine, synth, stillFrames(120, 10, 0));

  it('detects a strike with intensity scaling and no double count', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 1 });
    prime(engine, synth);
    const soft = run(engine, synth, [...strikeFrames(300), ...stillFrames(40, 10, 0)]).events.filter(
      (e) => e.gesture === 'strike' && e.phase === 'peak',
    );
    const hard = run(engine, synth, [...strikeFrames(800), ...stillFrames(40, 10, 0)]).events.filter(
      (e) => e.gesture === 'strike' && e.phase === 'peak',
    );
    expect(soft.length).toBe(1);
    expect(hard.length).toBe(1);
    expect(hard[0].intensity).toBeGreaterThan(soft[0].intensity);
    expect(hard[0].direction).toBe('down');
  });

  it('allows fast alternating strikes (8 hits/s) and counts each once', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 1 });
    prime(engine, synth);
    const frames: SynthFrame[] = [];
    for (let i = 0; i < 8; i++) {
      // ~140 ms per hit: whip down 40 deg in 60 ms, hard stop, return in 60 ms
      frames.push(...sweepFrames(6, { pitch: 10, roll: 0 }, { pitch: -30, roll: 0 }));
      frames.push({ pitch: -30, roll: 0, linear: { x: 0, y: 0, z: 1.5 } });
      frames.push({ pitch: -30, roll: 0, linear: { x: 0, y: 0, z: -0.2 } });
      frames.push(...sweepFrames(6, { pitch: -30, roll: 0 }, { pitch: 10, roll: 0 }));
    }
    frames.push(...stillFrames(30, 10, 0));
    const peaks = run(engine, synth, frames).events.filter((e) => e.gesture === 'strike' && e.phase === 'peak');
    expect(peaks.length).toBeGreaterThanOrEqual(6);
    expect(peaks.length).toBeLessThanOrEqual(8);
  });

  it('does not strike on slow tilting or small noise', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 1, noiseAccelG: 0.03, noiseGyroDps: 4 });
    prime(engine, synth);
    const frames = [...sweepFrames(150, { pitch: 10, roll: 0 }, { pitch: -40, roll: 0 }), ...stillFrames(100, -40, 0)];
    const strikes = run(engine, synth, frames).events.filter((e) => e.gesture === 'strike' && e.phase === 'peak');
    expect(strikes.length).toBe(0);
  });

  it('detects swing direction up vs down', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 2 });
    prime(engine, synth);
    const down = run(engine, synth, [...sweepFrames(8, { pitch: 10, roll: 0 }, { pitch: -50, roll: 0 }), ...stillFrames(40, -50, 0)]).events;
    const up = run(engine, synth, [...sweepFrames(8, { pitch: -50, roll: 0 }, { pitch: 20, roll: 0 }), ...stillFrames(40, 20, 0)]).events;
    const dPeaks = down.filter((e) => e.gesture === 'swing' && e.phase === 'peak');
    const uPeaks = up.filter((e) => e.gesture === 'swing' && e.phase === 'peak');
    expect(dPeaks.length).toBe(1);
    expect(dPeaks[0].direction).toBe('down');
    expect(uPeaks.length).toBe(1);
    expect(uPeaks[0].direction).toBe('up');
  });

  it('detects tilt zones with hysteresis relative to neutral', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 1 });
    prime(engine, synth);
    const evs = run(engine, synth, [
      ...sweepFrames(60, { pitch: 10, roll: 0 }, { pitch: 10, roll: 35 }),
      ...stillFrames(30, 10, 35),
      ...sweepFrames(60, { pitch: 10, roll: 35 }, { pitch: 10, roll: 14 }), // between exit(10) and enter(18): still active
      ...stillFrames(30, 10, 14),
      ...sweepFrames(60, { pitch: 10, roll: 14 }, { pitch: 10, roll: 0 }),
      ...stillFrames(30, 10, 0),
    ]).events.filter((e) => e.gesture === 'tilt' && e.phase !== 'peak');
    expect(evs.map((e) => `${e.phase}:${e.direction}`)).toEqual(['start:right', 'end:right']);
  });

  it('detects shake', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 1 });
    prime(engine, synth);
    const frames: SynthFrame[] = [];
    for (let i = 0; i < 60; i++) frames.push({ pitch: 10, roll: 0, linear: { x: Math.sin(i * 0.9) * 1.2, y: 0, z: 0 } });
    frames.push(...stillFrames(60, 10, 0));
    const evs = run(engine, synth, frames).events.filter((e) => e.gesture === 'shake');
    expect(evs.some((e) => e.phase === 'start')).toBe(true);
    expect(evs.some((e) => e.phase === 'end')).toBe(true);
  });

  it('detects rotation left/right via yaw', () => {
    const engine = new MotionEngine();
    const synth = new PacketSynth({ controllerId: 1 });
    prime(engine, synth);
    const frames: SynthFrame[] = [];
    for (let i = 0; i < 40; i++) frames.push({ pitch: 10, roll: 0, yawRate: 150 }); // +60°
    frames.push(...stillFrames(5, 10, 0));
    const evs = run(engine, synth, frames).events.filter((e) => e.gesture === 'rotate' && e.phase === 'start');
    expect(evs.length).toBe(1);
    expect(evs[0].direction).toBe('left');
  });

  it('two controllers are processed independently', () => {
    const engine = new MotionEngine();
    const s1 = new PacketSynth({ controllerId: 1 });
    const s2 = new PacketSynth({ controllerId: 2 });
    prime(engine, s1);
    prime(engine, s2);
    const evs: GestureEvent[] = [];
    engine.on('gesture', (e) => evs.push(e));
    const f1 = [...strikeFrames(600), ...stillFrames(40, 10, 0)];
    const f2 = stillFrames(f1.length, 10, 0);
    for (let i = 0; i < f1.length; i++) {
      engine.ingest(s1.next(f1[i]));
      engine.ingest(s2.next(f2[i]));
    }
    const peaks = evs.filter((e) => e.gesture === 'strike' && e.phase === 'peak');
    expect(peaks.length).toBe(1);
    expect(peaks[0].controllerId).toBe(1);
    expect(engine.connectedIds()).toEqual([1, 2]);
  });

  it('synth packets decode as motion type', () => {
    const synth = new PacketSynth({ controllerId: 1 });
    expect(synth.next({ pitch: 0, roll: 0 }).type).toBe(PacketType.MOTION);
  });
});
