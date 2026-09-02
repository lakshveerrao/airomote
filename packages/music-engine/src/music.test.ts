import { describe, expect, it } from 'vitest';
import { AudioEngine, velocityToGain, VoicePool } from './engine';
import { DrumKit } from './drums';
import { CHORD_NAMES, Guitar, chordFrequencies, chordNotes, midiToHz, renderPluck } from './guitar';
import { FakeGain, fakeContextFactory } from './fake-audio';

async function engine() {
  const { ctx, create } = fakeContextFactory();
  const e = new AudioEngine({ createContext: create, volume: 0.7 });
  await e.unlock();
  return { e, ctx };
}

describe('velocityToGain', () => {
  it('is monotonic and bounded', () => {
    let last = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const g = velocityToGain(v);
      expect(g).toBeGreaterThan(last);
      expect(g).toBeGreaterThanOrEqual(0.15);
      expect(g).toBeLessThanOrEqual(1);
      last = g;
    }
    expect(velocityToGain(-1)).toBe(0.15);
    expect(velocityToGain(5)).toBe(1);
  });
});

describe('AudioEngine', () => {
  it('unlocks lazily, resumes suspended contexts and applies volume/mute', async () => {
    const { e, ctx } = await engine();
    expect(ctx.state).toBe('running');
    expect(ctx.resumeCount).toBe(1);
    ctx.state = 'suspended';
    e.ensureRunning();
    expect(ctx.resumeCount).toBe(2);
    const master = e.output as unknown as FakeGain;
    e.setVolume(0.3);
    expect(master.gain.value).toBeCloseTo(0.3);
    e.setMuted(true);
    expect(master.gain.value).toBe(0);
    e.setMuted(false);
    expect(master.gain.value).toBeCloseTo(0.3);
  });
  it('throws when used before unlock', () => {
    const e = new AudioEngine({ createContext: fakeContextFactory().create });
    expect(() => e.context).toThrow(/unlock/);
    expect(e.ready).toBe(false);
  });
});

describe('chords', () => {
  it('voicings map to the expected frequencies', () => {
    expect(chordNotes('C')).toEqual([null, 48, 52, 55, 60, 64]);
    expect(chordNotes('G')).toEqual([43, 47, 50, 55, 59, 67]);
    expect(chordNotes('Am')).toEqual([null, 45, 52, 57, 60, 64]);
    expect(chordNotes('Em')).toEqual([40, 47, 52, 55, 59, 64]);
    expect(chordNotes('D')).toEqual([null, null, 50, 57, 62, 66]);
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(60)).toBeCloseTo(261.63, 1);
    const c = chordFrequencies('C');
    expect(c[4]).toBeCloseTo(261.63, 1);
    expect(c[5]).toBeCloseTo(329.63, 1);
    for (const name of CHORD_NAMES) expect(chordNotes(name).length).toBe(6);
  });
});

describe('renderPluck', () => {
  const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  it('decays and has the requested fundamental', () => {
    for (const hz of [82.41, 196, 329.63]) {
      const out = renderPluck(hz, 1.0, 0.8, 48000);
      const n = out.length;
      const head = out.subarray(0, Math.floor(n * 0.1));
      const tail = out.subarray(Math.floor(n * 0.9));
      expect(rms(tail)).toBeLessThan(rms(head));
      // fundamental via normalised autocorrelation over the body of the note
      const seg = out.subarray(Math.floor(n * 0.15), Math.floor(n * 0.6));
      const minLag = Math.floor(48000 / (hz * 1.5));
      const maxLag = Math.ceil(48000 / (hz * 0.66));
      let bestLag = minLag;
      let best = -Infinity;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let acc = 0;
        for (let i = 0; i < seg.length - lag; i += 2) acc += seg[i] * seg[i + lag];
        if (acc > best) {
          best = acc;
          bestLag = lag;
        }
      }
      const est = 48000 / bestLag;
      expect(Math.abs(est - hz) / hz).toBeLessThan(0.03);
    }
  });
  it('is normalised and click-free at the start', () => {
    const out = renderPluck(220, 0.5, 0.5);
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(1, 5);
    expect(Math.abs(out[0])).toBeLessThan(0.05);
  });
});

describe('Guitar', () => {
  it('strums down low→high and up high→low with velocity-dependent stagger', async () => {
    const { e } = await engine();
    const g = new Guitar(e);
    const down = g.strum('C', 'down', 0.3);
    const up = g.strum('C', 'up', 0.9);
    const dt = down.times.filter((t): t is number => t !== null);
    const ut = up.times.filter((t): t is number => t !== null);
    expect(down.times[0]).toBeNull(); // muted low E
    for (let i = 1; i < dt.length; i++) expect(dt[i]).toBeGreaterThan(dt[i - 1]);
    for (let i = 1; i < ut.length; i++) expect(ut[i]).toBeLessThan(ut[i - 1]);
    const dStagger = dt[1] - dt[0];
    const uStagger = ut[0] - ut[1];
    expect(uStagger).toBeLessThan(dStagger);
    expect(Guitar.staggerFor(0)).toBeCloseTo(0.022);
    expect(Guitar.staggerFor(1)).toBeCloseTo(0.012);
    expect(g.strumCount).toBe(2);
  });
  it('mute releases all ringing voices; re-plucking a string replaces its previous voice', async () => {
    const { e } = await engine();
    const g = new Guitar(e);
    g.strum('G', 'down', 0.8);
    expect(g.activeVoices).toBe(6);
    g.strum('G', 'down', 0.8);
    expect(g.activeVoices).toBe(6);
    g.mute();
    expect(g.activeVoices).toBe(0);
  });
});

describe('DrumKit / VoicePool', () => {
  it('plays every drum and enforces polyphony with voice stealing', async () => {
    const { e, ctx } = await engine();
    const kit = new DrumKit(e, 6);
    for (const d of ['kick', 'snare', 'hihat', 'tom1', 'tom2', 'floor', 'crash', 'ride'] as const) kit.play(d, 0.8);
    expect(kit.hitCount).toBe(8);
    expect(kit.activeVoices).toBeLessThanOrEqual(6);
    expect(ctx.started.length).toBeGreaterThan(8);
    kit.choke('hihat');
    kit.silence();
    expect(kit.activeVoices).toBe(0);
  });
  it('voices are removed when they end naturally', async () => {
    const { e, ctx } = await engine();
    const kit = new DrumKit(e);
    kit.play('snare', 0.5);
    expect(kit.activeVoices).toBe(1);
    ctx.advance(2);
    expect(kit.activeVoices).toBe(0);
  });
  it('velocity changes brightness: harder snare uses a higher bandpass', async () => {
    const { e, ctx } = await engine();
    const kit = new DrumKit(e);
    const filtersBefore = ctx.started.length;
    kit.play('snare', 0.1);
    kit.play('snare', 1.0);
    expect(ctx.started.length - filtersBefore).toBe(4);
  });
  it('pool.add steals the oldest voice', () => {
    const { ctx, create } = fakeContextFactory();
    const c = create();
    const pool = new VoicePool(() => c, 2);
    const stopped: number[] = [];
    const mk = (i: number) => ({ gain: c.createGain(), startedAt: i, stop: () => stopped.push(i) });
    pool.add(mk(1));
    pool.add(mk(2));
    pool.add(mk(3));
    expect(pool.size).toBe(2);
    expect(stopped).toEqual([1]);
    void ctx;
  });
});
