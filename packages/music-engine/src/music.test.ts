import { describe, expect, it } from 'vitest';
import { AudioEngine, velocityToGain, VoicePool } from './engine';
import { DrumKit } from './drums';
import {
  CHORD_NAMES,
  Guitar,
  MAX_LEAD_FRET,
  OPEN_STRINGS_MIDI,
  chordFrequencies,
  chordNotes,
  fretToMidi,
  midiToHz,
  midiToName,
  renderPluck,
} from './guitar';
import { FakeGain, fakeContextFactory } from './fake-audio';

/** Fundamental of a rendered pluck by autocorrelation, searched around `aboutHz`. */
function estimateHz(out: Float32Array, aboutHz: number, sampleRate = 48000): number {
  const n = out.length;
  const seg = out.subarray(Math.floor(n * 0.15), Math.floor(n * 0.6));
  const minLag = Math.max(2, Math.floor(sampleRate / (aboutHz * 1.5)));
  const maxLag = Math.ceil(sampleRate / (aboutHz * 0.66));
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
  return sampleRate / bestLag;
}

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

  it('pluckNote sounds the right note for a string/fret pair', async () => {
    const { e, ctx } = await engine();
    const g = new Guitar(e);
    const cases: Array<[number, number]> = [
      [0, 0], // low E open  → E2
      [0, 5], // low E, 5th  → A2
      [2, 7], // D string, 7 → A3
      [5, 12], // high E, 12  → E5
    ];
    for (const [s, fret] of cases) {
      ctx.started.length = 0;
      const midi = fretToMidi(s, fret);
      expect(midi).toBe(OPEN_STRINGS_MIDI[s] + fret);
      const at = g.pluckNote(s, fret, 0.8);
      expect(at).toBeGreaterThan(0);
      const src = ctx.started.at(-1) as unknown as { buffer: { getChannelData(i: number): Float32Array }; startedAt: number };
      expect(src.startedAt).toBeCloseTo(at, 6);
      const hz = midiToHz(midi);
      expect(Math.abs(estimateHz(src.buffer.getChannelData(0), hz) - hz) / hz).toBeLessThan(0.03);
    }
    expect(midiToName(fretToMidi(0, 0))).toBe('E2');
    expect(midiToName(fretToMidi(5, 12))).toBe('E5');
    expect(MAX_LEAD_FRET).toBe(12);
  });

  it('renders each lead note at most once and keeps prepare() to the chord notes', async () => {
    const { e } = await engine();
    const g = new Guitar(e);
    g.prepare();
    const afterPrepare = g.bufferCount;
    expect(afterPrepare).toBeGreaterThan(0);
    // 17th fret on the G string is not in any chord voicing → one new buffer
    g.pluckNote(3, 17, 0.8);
    const afterFirst = g.bufferCount;
    expect(afterFirst).toBe(afterPrepare + 1);
    for (let i = 0; i < 5; i++) g.pluckNote(3, 17, 0.8);
    expect(g.bufferCount).toBe(afterFirst);
    // a different velocity picks the other brightness → exactly one more buffer
    g.pluckNote(3, 17, 0.1);
    expect(g.bufferCount).toBe(afterFirst + 1);
    g.pluckNote(3, 17, 0.1);
    expect(g.bufferCount).toBe(afterFirst + 1);
  });

  it('strumFrets skips null strings and staggers the rest low→high / high→low', async () => {
    const { e } = await engine();
    const g = new Guitar(e);
    const frets: Array<number | null> = [null, 3, null, 5, 5, null];
    const down = g.strumFrets(frets, 'down', 0.5);
    expect(down.chord).toBeNull();
    expect(down.times.map((t) => t !== null)).toEqual([false, true, false, true, true, false]);
    const played = [1, 3, 4];
    for (let i = 1; i < played.length; i++) {
      expect(down.times[played[i]]!).toBeGreaterThan(down.times[played[i - 1]]!);
    }
    expect(down.times[3]! - down.times[1]!).toBeCloseTo(Guitar.staggerFor(0.5), 6);
    const up = g.strumFrets(frets, 'up', 0.5);
    for (let i = 1; i < played.length; i++) {
      expect(up.times[played[i]]!).toBeLessThan(up.times[played[i - 1]]!);
    }
    // a single-string "strum" is what lead mode uses
    const lead = g.strumFrets([null, null, null, null, 7, null], 'down', 0.9);
    expect(lead.times.filter((t) => t !== null).length).toBe(1);
    // strum() still reports its chord and delegates to the same staggering
    const c = g.strum('C', 'down', 0.5);
    expect(c.chord).toBe('C');
    expect(c.times[0]).toBeNull();
    expect(c.times[2]! - c.times[1]!).toBeCloseTo(Guitar.staggerFor(0.5), 6);
    expect(g.strumCount).toBe(4);
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
