// @vitest-environment jsdom
/**
 * Guitar natural-mode motion pipeline, end to end through the simulator:
 *   SimulatorTransport (real encoded bytes) → ControllerManager → MotionEngine → ActionMapper
 *   → LeadTracker (driven from a 60 fps render loop, exactly as Guitar.tsx does).
 *
 * The two real boards stream at very different rates (~30–50 vs ~110 packets/s), so the same
 * physical tilt must land on the same fret at both rates, and one physical swing must produce
 * exactly one strum at both rates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionEngine } from '@aero/motion-core';
import { ActionMapper, type ActionEvent } from '@aero/activity-engine';
import { ControllerManager } from '../../core/ControllerManager';
import { SimulatorTransport } from '../../core/transport/simulator';
import { guitarDefinition, NECK_MAX_FRET, STRUM_FREEZE_MS, TRACK_HYSTERESIS, TRACK_TAU_MS } from './definition';
import { LeadTracker } from './leadTracker';

const natural = guitarDefinition.presets.find((p) => p.id === 'natural')!;

/** Replay recorded axis events through a tracker on a 60 fps clock (what the component does). */
function replay(events: Array<{ t: number; v: number }>, opts: { axis: 'fret' | 'string' }): LeadTracker {
  const t = new LeadTracker({ maxFret: NECK_MAX_FRET, strings: 6, tauMs: TRACK_TAU_MS, hysteresis: TRACK_HYSTERESIS, freezeMs: STRUM_FREEZE_MS });
  if (events.length === 0) return t;
  let i = 0;
  const start = events[0].t;
  const end = events.at(-1)!.t;
  for (let now = start; now <= end; now += 1000 / 60) {
    while (i < events.length && events[i].t <= now) {
      if (opts.axis === 'fret') t.setFretAxis(events[i].v);
      else t.setStringAxis(events[i].v);
      i++;
    }
    t.update(now);
  }
  return t;
}

describe('guitar natural mode through the simulator', { timeout: 30000 }, () => {
  let engine: MotionEngine;
  let manager: ControllerManager;

  beforeEach(() => {
    vi.useFakeTimers();
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => ((t += 0.001), Date.now() + t));
    engine = new MotionEngine();
    manager = new ControllerManager(engine);
  });
  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const settle = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const attach = async (id: 1 | 2, t: SimulatorTransport) => {
    const p = manager.attach(id, t);
    await settle(400);
    await p;
  };

  /** Tilt the fret hand by `pitchDeg` on a controller streaming at `rateHz`, return the tracker. */
  async function tiltAt(rateHz: number, pitchDeg: number): Promise<{ tracker: LeadTracker; packets: number }> {
    const t1 = new SimulatorTransport(1, rateHz);
    await attach(1, t1);
    await settle(3500); // auto-calibration: captures the neutral pose
    const events: Array<{ t: number; v: number }> = [];
    const mapper = new ActionMapper(natural, { fret: 1, strum: null }, (e: ActionEvent) => {
      if (e.action === 'FRET_POSITION') events.push({ t: e.timestamp, v: e.phase === 'end' ? 0 : e.value });
    });
    const off = engine.on('state', (s) => mapper.onState(s));
    t1.model.targetPitch = pitchDeg;
    await settle(1500);
    off();
    return { tracker: replay(events, { axis: 'fret' }), packets: events.length };
  }

  it('the same tilt lands on the same fret at 30 Hz and at 110 Hz', async () => {
    // +21° of pitch is half of the preset's 42° span → three quarters up the neck → fret 9
    const slow = await tiltAt(30, 21);
    manager.destroy();
    engine = new MotionEngine();
    manager = new ControllerManager(engine);
    const fast = await tiltAt(110, 21);

    expect(slow.packets).toBeGreaterThan(10);
    expect(fast.packets).toBeGreaterThan(slow.packets * 2); // really are different rates
    expect(slow.tracker.fret).toBe(fast.tracker.fret);
    // 21 deg of the preset's 42 deg span, minus the 2 deg deadzone, is three quarters up the neck
    expect(slow.tracker.fret).toBeGreaterThanOrEqual(8);
    expect(slow.tracker.fret).toBeLessThanOrEqual(9);
    expect(Math.abs(slow.tracker.fretPos - fast.tracker.fretPos)).toBeLessThan(0.03);
  });

  it('one synthetic swing produces exactly one strum, at either packet rate', async () => {
    for (const rateHz of [30, 110]) {
      manager.destroy();
      engine = new MotionEngine();
      manager = new ControllerManager(engine);
      const t2 = new SimulatorTransport(2, rateHz);
      await attach(2, t2);
      await settle(3500);
      const actions: ActionEvent[] = [];
      const mapper = new ActionMapper(natural, { fret: null, strum: 2 }, (e) => actions.push(e));
      const offS = engine.on('state', (s) => mapper.onState(s));
      const offG = engine.on('gesture', (g) => mapper.onGesture(g));
      t2.model.swing('down', 0.8);
      await settle(900);
      offS();
      offG();
      const strums = actions.filter((a) => a.action === 'STRUM_DOWN' || a.action === 'STRUM_UP');
      // The scripted swing whips down and then returns to neutral; the return is a real
      // upward rotation, so it legitimately reads as an up-stroke. What must never happen is
      // the *same* stroke firing twice — that is what the gesture cooldown guards.
      const downs = strums.filter((a) => a.action === 'STRUM_DOWN');
      expect(downs.length, `rate ${rateHz} Hz`).toBe(1);
      expect(downs[0].role).toBe('strum');
      expect(downs[0].intensity).toBeGreaterThan(0);
      expect(strums.filter((a) => a.action === 'STRUM_UP').length, `rate ${rateHz} Hz`).toBeLessThanOrEqual(1);
      expect(strums[0].action).toBe('STRUM_DOWN');
    }
  });
});
