import { describe, expect, it } from 'vitest';
import { PushupDetector } from './pushupDetector';
import { armSweep, noiseFrames, rampTo, still, stream } from '../../features/workout/exercise/testUtils';
import type { DetectorEvent } from '../../features/workout/exercise/types';

function run(frames: ReturnType<typeof still>) {
  const det = new PushupDetector();
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

describe('PushupDetector', () => {
  it('counts 4 full push-ups (0→50→0° in 1.8 s)', () => {
    const frames = [...still(1.5)];
    for (let i = 0; i < 4; i++) frames.push(...armSweep(50, 1.8), ...still(0.6));
    const { det, events } = run(frames);
    expect(det.reps).toBe(4);
    const seq = events.filter((e) => e.type === 'state').map((e) => (e as { to: string }).to);
    expect(seq.slice(0, 3)).toEqual(['DESCENDING', 'BOTTOM', 'ASCENDING']);
    expect(events.filter((e) => e.type === 'rep').length).toBe(4);
  });

  it('rejects shallow reps (0→20→0°)', () => {
    const frames = [...still(1.5)];
    for (let i = 0; i < 3; i++) frames.push(...armSweep(20, 1.8), ...still(0.6));
    const { det, events } = run(frames);
    expect(det.reps).toBe(0);
    expect(events.some((e) => e.type === 'rejected')).toBe(true);
  });

  it('does not count when tilting slowly to 50° and staying there', () => {
    const frames = [...still(1.5), ...rampTo(50, 3), ...still(9.5, 50)];
    const { det } = run(frames);
    expect(det.reps).toBe(0);
    expect(det.state).toBe('UP'); // timed out back to UP without counting
  });

  it('ignores random shaking', () => {
    const { det } = run([...still(1.5), ...noiseFrames(5, 0.3), ...still(1)]);
    expect(det.reps).toBe(0);
  });

  it('works regardless of which way the controller is strapped (starts at 40° pitch)', () => {
    const frames = [...still(1.5, 40)];
    for (let i = 0; i < 3; i++) frames.push(...armSweep(50, 1.8).map((f) => ({ ...f, pitch: 40 - f.pitch })), ...still(0.6, 40));
    expect(run(frames).det.reps).toBe(3);
  });

  it('exposes live depth', () => {
    const det = new PushupDetector();
    let max = 0;
    for (const s of stream([...still(1.5), ...armSweep(50, 1.8)])) {
      det.update(s);
      max = Math.max(max, det.depth);
    }
    expect(max).toBeGreaterThan(0.9);
  });
});
