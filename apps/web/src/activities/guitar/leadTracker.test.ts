import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAD_OPTIONS, LeadTracker, deltaDeg, latch } from './leadTracker';

/** Feed the tracker a constant axis for `ms` at `hz`, ticking the render loop at 60 fps. */
function drive(t: LeadTracker, fretAxis: number, stringAxis: number, ms: number, packetHz: number, t0 = 1000): number {
  const packetDt = 1000 / packetHz;
  const frameDt = 1000 / 60;
  let nextPacket = t0;
  let nextFrame = t0;
  let now = t0;
  const end = t0 + ms;
  while (now <= end) {
    now = Math.min(nextPacket, nextFrame);
    if (now > end) break;
    if (now >= nextPacket) {
      t.setFretAxis(fretAxis);
      t.setStringAxis(stringAxis);
      nextPacket += packetDt;
    }
    if (now >= nextFrame) {
      t.update(now);
      nextFrame += frameDt;
    }
  }
  return now;
}

describe('deltaDeg', () => {
  it('is wrap-safe around ±180', () => {
    expect(deltaDeg(10, 0)).toBe(10);
    expect(deltaDeg(-170, 170)).toBe(20);
    expect(deltaDeg(170, -170)).toBe(-20);
    // upside-down board sitting near 180: a small physical move is a small delta
    expect(deltaDeg(179, 176)).toBe(3);
    expect(deltaDeg(-179, 178)).toBe(3);
    for (let a = -720; a <= 720; a += 7) {
      const d = deltaDeg(a, 123);
      expect(d).toBeGreaterThan(-180.0001);
      expect(d).toBeLessThanOrEqual(180.0001);
    }
  });
});

describe('latch', () => {
  it('only moves once the value leaves the band around the current step', () => {
    expect(latch(3, 3.4, 0.32, 0, 12)).toBe(3);
    expect(latch(3, 3.8, 0.32, 0, 12)).toBe(3); // inside 0.5 + 0.32
    expect(latch(3, 3.9, 0.32, 0, 12)).toBe(4);
    expect(latch(3, 2.1, 0.32, 0, 12)).toBe(2);
    expect(latch(3, 99, 0.32, 0, 12)).toBe(12);
    expect(latch(3, -99, 0.32, 0, 12)).toBe(0);
  });
});

describe('LeadTracker', () => {
  it('maps the axes onto the neck and settles to the same note at 30 Hz and 110 Hz', () => {
    const opts = { maxFret: 12, strings: 6 };
    const slow = new LeadTracker(opts);
    const fast = new LeadTracker(opts);
    // +0.5 on the fret axis → 9 frets up the neck; -0.6 on the string axis → string 1
    drive(slow, 0.5, -0.6, 900, 30);
    drive(fast, 0.5, -0.6, 900, 110);
    expect(slow.fret).toBe(9);
    expect(fast.fret).toBe(9);
    expect(slow.string).toBe(1);
    expect(fast.string).toBe(1);
    expect(slow.fretPos).toBeCloseTo(fast.fretPos, 2);
    expect(slow.stringPos).toBeCloseTo(fast.stringPos, 2);
    expect(slow.fretPos).toBeCloseTo(0.75, 2);
  });

  it('converges at the same wall-clock rate whatever the packet rate', () => {
    const slow = new LeadTracker({ tauMs: 90 });
    const fast = new LeadTracker({ tauMs: 90 });
    for (const ms of [60, 120, 240]) {
      const a = new LeadTracker({ tauMs: 90 });
      const b = new LeadTracker({ tauMs: 90 });
      drive(a, 1, 1, ms, 30);
      drive(b, 1, 1, ms, 110);
      expect(Math.abs(a.fretPos - b.fretPos)).toBeLessThan(0.05);
    }
    drive(slow, 1, 1, 500, 30);
    drive(fast, 1, 1, 500, 110);
    expect(slow.fret).toBe(12);
    expect(fast.fret).toBe(12);
  });

  it('does not flicker between neighbouring frets when the hand sits on a boundary', () => {
    const t = new LeadTracker({ maxFret: 12, tauMs: 40 });
    // park the smoothed value exactly between fret 5 and 6, then jitter ±0.3 of a fret
    drive(t, 5.5 / 6 - 1, 0, 800, 110);
    const settled = t.fret;
    let now = 2000;
    let changes = 0;
    for (let i = 0; i < 400; i++) {
      const jitter = Math.sin(i * 1.7) * 0.35; // ±0.35 frets
      t.setFretAxis((5.5 + jitter) / 6 - 1);
      now += 1000 / 110;
      t.update(now);
      if (t.fret !== settled) changes++;
    }
    expect(changes).toBe(0);
    // a decisive move does change the fret
    t.setFretAxis(8 / 6 - 1);
    for (let i = 0; i < 200; i++) {
      now += 1000 / 110;
      t.update(now);
    }
    expect(t.fret).toBe(8);
  });

  it('freezes around a strum so the stroke cannot lurch the fret hand', () => {
    const t = new LeadTracker({ maxFret: 12, tauMs: 90, freezeMs: 250 });
    let now = drive(t, 0, 0, 800, 110);
    const before = { fret: t.fret, pos: t.fretPos };
    expect(before.fret).toBe(6);
    t.strummed(now);
    expect(t.frozen(now + 100)).toBe(true);
    // a violent swing throws the fret axis to the far end of the neck for 200 ms
    for (let i = 0; i < 22; i++) {
      t.setFretAxis(1);
      now += 1000 / 110;
      t.update(now);
    }
    expect(t.fret).toBe(before.fret); // sounding note held through the stroke
    expect(Math.abs(t.fretPos - before.pos)).toBeLessThan(0.06);
    // once the freeze expires the hand tracks again
    now += 300;
    t.setFretAxis(0);
    for (let i = 0; i < 60; i++) {
      now += 1000 / 110;
      t.update(now);
    }
    expect(t.fret).toBe(6);
  });

  it('tracks wrap-safely for an upside-down board sitting near ±180', () => {
    const near = new LeadTracker({ strings: 6, tauMs: 40 });
    const zero = new LeadTracker({ strings: 6, tauMs: 40 });
    let n = 1000;
    for (let i = 0; i < 300; i++) {
      // same physical +19° roll, one board centred at 178° (so it reads -163°), one at 0°
      near.setStringAngle(-163, 38, 178);
      zero.setStringAngle(19, 38, 0);
      n += 1000 / 110;
      near.update(n);
      zero.update(n);
    }
    expect(near.string).toBe(zero.string);
    expect(near.stringPos).toBeCloseTo(zero.stringPos, 6);
    expect(near.string).toBe(3);
  });

  it('keyboard nudges move whole steps and clamp to the neck', () => {
    const t = new LeadTracker({ maxFret: 12, strings: 6, tauMs: 1 });
    t.settle(0);
    const start = t.fret;
    t.nudgeFret(1);
    t.update(50);
    expect(t.fret).toBe(start + 1);
    for (let i = 0; i < 40; i++) t.nudgeFret(1);
    t.update(200);
    expect(t.fret).toBe(12);
    for (let i = 0; i < 40; i++) t.nudgeFret(-1);
    t.update(400);
    expect(t.fret).toBe(0);
    for (let i = 0; i < 40; i++) t.nudgeString(1);
    t.update(600);
    expect(t.string).toBe(5);
    for (let i = 0; i < 40; i++) t.nudgeString(-1);
    t.update(800);
    expect(t.string).toBe(0);
  });

  it('exposes sane defaults', () => {
    expect(DEFAULT_LEAD_OPTIONS.maxFret).toBe(12);
    const t = new LeadTracker();
    expect(t.fretPos).toBeCloseTo(0.25, 6);
    expect(t.stringPos).toBeCloseTo(2.5, 6);
  });
});
