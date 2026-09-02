import { describe, expect, it } from 'vitest';
import { MetricsTracker, worldVertical, gravityAngleDeg, type RepRecord } from './types';
import { emptyState } from '@aero/motion-core';

const rep = (i: number, start: number, dur: number): RepRecord => ({ index: i, startedAt: start, endedAt: start + dur, durationMs: dur, depth: 0.8, quality: 0.8 });

describe('MetricsTracker', () => {
  it('reports consistency 1 for identical rep durations and correct average', () => {
    const m = new MetricsTracker();
    m.start(0);
    for (let i = 0; i < 4; i++) m.addRep(rep(i + 1, i * 3000, 2000));
    const x = m.metrics(12000);
    expect(x.reps).toBe(4);
    expect(x.avgRepMs).toBe(2000);
    expect(x.consistency).toBe(1);
    expect(x.cadence).toBeCloseTo(20, 5);
    expect(x.durationMs).toBe(12000);
    expect(x.bestStreak).toBe(4);
    expect(x.rhythm).toBe('steady');
  });

  it('lowers consistency for varied durations and detects slowing down', () => {
    const m = new MetricsTracker();
    m.start(0);
    m.addRep(rep(1, 0, 1500));
    m.addRep(rep(2, 3000, 1500));
    m.addRep(rep(3, 6000, 3000));
    const x = m.metrics(10000);
    expect(x.avgRepMs).toBe(2000);
    expect(x.consistency).toBeLessThan(0.8);
    expect(x.consistency).toBeGreaterThan(0);
    expect(x.rhythm).toBe('slowing down');
  });

  it('streaks break after long gaps', () => {
    const m = new MetricsTracker();
    m.start(0);
    m.addRep(rep(1, 0, 2000));
    m.addRep(rep(2, 3000, 2000));
    m.addRep(rep(3, 20000, 2000));
    expect(m.metrics(25000).bestStreak).toBe(2);
  });
});

describe('frame helpers', () => {
  it('worldVertical returns the up component of linear acceleration', () => {
    const s = emptyState(1);
    s.orientation = { pitch: 0, roll: 0, yaw: 0 };
    s.linearAccel = { x: 0.2, y: 0, z: -0.3 };
    expect(worldVertical(s)).toBeCloseTo(-0.3, 5);
    s.orientation = { pitch: 90, roll: 0, yaw: 0 };
    expect(worldVertical(s)).toBeCloseTo(0.2, 5);
  });
  it('gravityAngleDeg measures rotation from a reference', () => {
    const s = emptyState(1);
    s.orientation = { pitch: 45, roll: 0, yaw: 0 };
    expect(gravityAngleDeg(s, { x: 0, y: 0, z: 1 })).toBeCloseTo(45, 3);
  });
});
