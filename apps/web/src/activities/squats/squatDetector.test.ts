import { describe, expect, it } from 'vitest';
import { SquatDetector } from './squatDetector';
import { noiseFrames, squat, still, stream } from '../../features/workout/exercise/testUtils';
import type { DetectorEvent } from '../../features/workout/exercise/types';

function run(frames: ReturnType<typeof still>) {
  const det = new SquatDetector();
  const states = stream(frames);
  const events: DetectorEvent[] = [];
  let calibrated = false;
  for (const s of states) {
    if (!calibrated && s.isStationary) {
      det.calibrate(s);
      calibrated = true;
    }
    const e = det.update(s);
    if (e) events.push(e);
  }
  return { det, events };
}

describe('SquatDetector', () => {
  it('counts 5 clean squats exactly once each', () => {
    const frames = [...still(1.5)];
    for (let i = 0; i < 5; i++) frames.push(...squat(), ...still(1.0));
    const { det, events } = run(frames);
    expect(det.reps).toBe(5);
    const seq = events.filter((e) => e.type === 'state').map((e) => (e as { to: string }).to);
    expect(seq.slice(0, 3)).toEqual(['DESCENDING', 'BOTTOM', 'ASCENDING']);
    expect(events.filter((e) => e.type === 'rep').length).toBe(5);
    const reps = events.filter((e) => e.type === 'rep') as Array<{ rep: { durationMs: number; depth: number } }>;
    expect(reps[0].rep.durationMs).toBeGreaterThan(900);
    expect(reps[0].rep.durationMs).toBeLessThan(2500);
    expect(reps[0].rep.depth).toBeGreaterThan(0.2);
  });

  it('ignores half squats (small amplitude)', () => {
    const frames = [...still(1.5)];
    for (let i = 0; i < 4; i++) frames.push(...squat(0.06), ...still(1.0));
    expect(run(frames).det.reps).toBe(0);
  });

  it('ignores random shaking', () => {
    const frames = [...still(1.5), ...noiseFrames(6, 0.3), ...still(1.5)];
    expect(run(frames).det.reps).toBe(0);
  });

  it('still counts a squat with a 1 s hold at the bottom', () => {
    const frames = [...still(1.5), ...squat(0.25, 1.0), ...still(1.0)];
    expect(run(frames).det.reps).toBe(1);
  });

  it('counts two back-to-back squats as 2, not 3', () => {
    const frames = [...still(1.5), ...squat(), ...squat(), ...still(1.0)];
    expect(run(frames).det.reps).toBe(2);
  });

  it('exposes a live depth that rises during the descent', () => {
    const det = new SquatDetector();
    const states = stream([...still(1.5), ...squat()]);
    let maxDepth = 0;
    for (const s of states) {
      det.update(s);
      maxDepth = Math.max(maxDepth, det.depth);
    }
    expect(maxDepth).toBeGreaterThan(0.25);
  });

  it('reset clears state and count', () => {
    const { det } = run([...still(1.5), ...squat(), ...still(1)]);
    expect(det.reps).toBe(1);
    det.reset();
    expect(det.reps).toBe(0);
    expect(det.state).toBe('STANDING');
  });
});
