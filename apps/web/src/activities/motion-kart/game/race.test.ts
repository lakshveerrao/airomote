import { describe, expect, it } from 'vitest';
import { TrackModel } from './track';
import { Kart } from './kart';
import { Race, formatRaceTime, ordinal } from './race';

const idle = { steer: 0, throttle: 0, brake: 0, boost: false };

describe('TrackModel', () => {
  const track = new TrackModel();
  it('is a closed loop re-parameterised by arc length', () => {
    expect(track.length).toBeGreaterThan(400);
    const a = track.pointAt(0);
    const b = track.pointAt(track.length);
    expect(a.x).toBeCloseTo(b.x, 3);
    expect(a.z).toBeCloseTo(b.z, 3);
    const p = track.pointAt(100);
    const q = track.pointAt(101);
    expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeCloseTo(1, 1);
  });
  it('finds the nearest centre-line point with signed lateral offset', () => {
    const s = 250;
    const left = track.offsetPoint(s, 3);
    const r = track.nearest(left.x, left.z);
    expect(r.s).toBeCloseTo(s, 0);
    expect(r.lateral).toBeCloseTo(3, 1);
    const right = track.offsetPoint(s, -2);
    expect(track.nearest(right.x, right.z, s + 5).lateral).toBeCloseTo(-2, 1);
  });
});

describe('Kart physics', () => {
  const track = new TrackModel();
  it('heading change per second scales with speed for the same steering', () => {
    const slow = new Kart();
    const fast = new Kart();
    slow.placeOnTrack(track, 20, 0);
    fast.placeOnTrack(track, 20, 0);
    slow.speed = 5;
    fast.speed = 25;
    const h0 = slow.heading;
    for (let i = 0; i < 30; i++) {
      slow.step({ steer: 1, throttle: 0, brake: 0, boost: false }, 1 / 60, track);
      fast.step({ steer: 1, throttle: 0, brake: 0, boost: false }, 1 / 60, track);
    }
    const dSlow = Math.abs(slow.heading - h0);
    const dFast = Math.abs(fast.heading - h0);
    expect(dFast).toBeGreaterThan(dSlow * 2);
    expect(dFast).toBeGreaterThan(0.1);
  });
  it('does not turn while standing still', () => {
    const k = new Kart();
    k.placeOnTrack(track, 20, 0);
    const h0 = k.heading;
    for (let i = 0; i < 30; i++) k.step({ steer: 1, throttle: 0, brake: 0, boost: false }, 1 / 60, track);
    expect(k.heading).toBeCloseTo(h0, 5);
  });
  it('accelerates under throttle and slows under brake', () => {
    const k = new Kart();
    k.placeOnTrack(track, 0, 0);
    for (let i = 0; i < 120; i++) k.step({ steer: 0, throttle: 1, brake: 0, boost: false }, 1 / 60, track);
    expect(k.speed).toBeGreaterThan(15);
    const v = k.speed;
    for (let i = 0; i < 30; i++) k.step({ steer: 0, throttle: 0, brake: 1, boost: false }, 1 / 60, track);
    expect(k.speed).toBeLessThan(v * 0.5);
  });
  it('clamps the kart inside the walls when driven off the road', () => {
    const k = new Kart();
    k.placeOnTrack(track, 60, 0);
    k.speed = 20;
    // point sharply left and drive
    k.heading += Math.PI / 2.2;
    for (let i = 0; i < 240; i++) k.step({ steer: 0, throttle: 1, brake: 0, boost: false }, 1 / 60, track);
    const near = track.nearest(k.x, k.z, k.trackS);
    expect(Math.abs(near.lateral)).toBeLessThanOrEqual(track.wallDistance + 0.05);
    expect(k.offRoad || Math.abs(near.lateral) <= track.halfWidth).toBe(true);
  });
  it('off-road is slower than asphalt', () => {
    const road = new Kart();
    const grass = new Kart();
    road.placeOnTrack(track, 0, 0);
    grass.placeOnTrack(track, 0, track.halfWidth + 2);
    for (let i = 0; i < 240; i++) {
      road.step({ steer: 0, throttle: 1, brake: 0, boost: false }, 1 / 60, track);
      grass.step({ steer: 0, throttle: 1, brake: 0, boost: false }, 1 / 60, track);
    }
    expect(grass.speed).toBeLessThan(road.speed * 0.85);
  });
  it('boost raises the speed cap and then enforces a cooldown', () => {
    const k = new Kart();
    k.placeOnTrack(track, 0, 0);
    k.step({ steer: 0, throttle: 1, brake: 0, boost: true }, 1 / 60, track);
    expect(k.boosting).toBe(true);
    expect(k.currentMaxSpeed).toBeGreaterThan(k.params.maxSpeed);
    // run out the boost
    for (let i = 0; i < 60 * 2; i++) k.step({ steer: 0, throttle: 1, brake: 0, boost: false }, 1 / 60, track);
    expect(k.boosting).toBe(false);
    expect(k.boostReady).toBe(false);
    k.step({ steer: 0, throttle: 1, brake: 0, boost: true }, 1 / 60, track);
    expect(k.boosting).toBe(false); // still cooling down
    for (let i = 0; i < 60 * 5; i++) k.step({ steer: 0, throttle: 1, brake: 0, boost: false }, 1 / 60, track);
    expect(k.boostReady).toBe(true);
    k.step({ steer: 0, throttle: 1, brake: 0, boost: true }, 1 / 60, track);
    expect(k.boosting).toBe(true);
  });
});

describe('Race checkpoints and laps', () => {
  function raceAtGo() {
    const race = new Race(new TrackModel(), { aiCount: 0, countdownSeconds: 0.1 });
    race.step(0.2, idle); // countdown → racing
    expect(race.phase).toBe('racing');
    return race;
  }
  /** Teleport the player `dist` metres along the track in 5 m steps, updating progress like the loop does. */
  function drive(race: Race, from: number, dist: number, dtPerStep = 0.2) {
    let s = from;
    let travelled = 0;
    while (travelled < dist) {
      const step = Math.min(5, dist - travelled);
      s = race.track.wrap(s + step);
      travelled += step;
      race.time += dtPerStep;
      race.updateProgress(race.playerProgress, s, dtPerStep);
    }
  }

  it('counts a lap only after all sectors are passed in order', () => {
    const race = raceAtGo();
    const p = race.playerProgress;
    const start = p.lastS;
    drive(race, start, race.track.length + 12); // grid is 10 m before the line
    expect(p.lap).toBe(1);
    expect(p.lapTimes.length).toBe(1);
    expect(p.bestLap).toBeGreaterThan(0);
    expect(p.nextCheckpoint).toBe(1);
  });

  it('does not count a lap when a sector is skipped (cutting back to the finish line)', () => {
    const race = raceAtGo();
    const p = race.playerProgress;
    // pass checkpoints 1..3 legitimately
    drive(race, p.lastS, race.track.forward(p.lastS, race.checkpointS[3] + 2));
    expect(p.nextCheckpoint).toBe(4);
    // teleport to just before the finish line and cross it (skipping 4..7)
    const beforeFinish = race.track.wrap(-3);
    race.updateProgress(p, beforeFinish, 0.1);
    race.updateProgress(p, 3, 0.1);
    expect(p.lap).toBe(0);
    expect(p.nextCheckpoint).toBe(4); // still waiting for the skipped sector
  });

  it('driving backwards flags wrong way and never advances checkpoints', () => {
    const race = raceAtGo();
    const p = race.playerProgress;
    let s = p.lastS;
    for (let i = 0; i < 30; i++) {
      s = race.track.wrap(s - 2);
      race.updateProgress(p, s, 0.1);
    }
    expect(race.wrongWay).toBe(true);
    expect(p.nextCheckpoint).toBe(1);
    expect(p.lap).toBe(0);
  });

  it('finishes after the configured laps and reports position', () => {
    const race = new Race(new TrackModel(), { aiCount: 3, countdownSeconds: 0.1, laps: 1 });
    race.step(0.2, idle);
    const p = race.playerProgress;
    drive(race, p.lastS, race.track.length + 12, 0.05);
    // the finish is detected in step(); run one physics step
    race.step(1 / 60, idle);
    expect(race.phase).toBe('finished');
    expect(p.finished).toBe(true);
    expect(race.finalPosition).toBeGreaterThanOrEqual(1);
    expect(race.finalPosition).toBeLessThanOrEqual(4);
  });

  it('countdown holds the kart still, then GO', () => {
    const race = new Race(new TrackModel(), { aiCount: 1, countdownSeconds: 3 });
    expect(race.countdownValue).toBe(3);
    for (let i = 0; i < 66; i++) race.step(1 / 60, { steer: 0, throttle: 1, brake: 0, boost: false });
    expect(race.phase).toBe('countdown');
    expect(race.player.speed).toBeLessThan(0.1);
    expect(race.countdownValue).toBe(2);
    for (let i = 0; i < 140; i++) race.step(1 / 60, { steer: 0, throttle: 1, brake: 0, boost: false });
    expect(race.phase).toBe('racing');
    expect(race.player.speed).toBeGreaterThan(1);
    expect(race.ai[0].kart.speed).toBeGreaterThan(1);
  });

  it('AI karts stay on the track and progress through laps', () => {
    const race = new Race(new TrackModel(), { aiCount: 3, countdownSeconds: 0.1 });
    for (let i = 0; i < 60 * 40; i++) race.step(1 / 60, idle);
    for (const a of race.ai) {
      const n = race.track.nearest(a.kart.x, a.kart.z, a.s);
      expect(Math.abs(n.lateral)).toBeLessThan(race.track.halfWidth);
      expect(a.progress.lap).toBeGreaterThanOrEqual(1);
    }
    expect(race.position).toBe(4);
  });

  it('formats times and ordinals', () => {
    expect(formatRaceTime(65.237)).toBe('1:05.24');
    expect(formatRaceTime(-1)).toBe('0:00.00');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
  });
});
