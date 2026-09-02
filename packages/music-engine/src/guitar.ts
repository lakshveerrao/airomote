import { AudioEngine, VoicePool, clamp01, velocityToGain, type Voice } from './engine';

export type ChordName = 'C' | 'G' | 'Am' | 'F' | 'Em' | 'D';
export const CHORD_NAMES: ChordName[] = ['C', 'G', 'Am', 'F', 'Em', 'D'];
export type StrumDirection = 'down' | 'up';

/** Standard tuning, low → high, MIDI numbers. */
export const OPEN_STRINGS_MIDI = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

/** Fret per string (low E first); null = not played. */
export const CHORD_VOICINGS: Record<ChordName, Array<number | null>> = {
  C: [null, 3, 2, 0, 1, 0],
  G: [3, 2, 0, 0, 0, 3],
  Am: [null, 0, 2, 2, 1, 0],
  F: [1, 3, 3, 2, 1, 1],
  Em: [0, 2, 2, 0, 0, 0],
  D: [null, null, 0, 2, 3, 2],
};

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** MIDI note per string for a chord (null = muted string). */
export function chordNotes(chord: ChordName): Array<number | null> {
  return CHORD_VOICINGS[chord].map((fret, i) => (fret === null ? null : OPEN_STRINGS_MIDI[i] + fret));
}

export function chordFrequencies(chord: ChordName): Array<number | null> {
  return chordNotes(chord).map((n) => (n === null ? null : midiToHz(n)));
}

/**
 * Karplus–Strong plucked string rendered offline into a Float32Array.
 * brightness 0..1 controls the initial excitation filtering (low = mellow / palm-muted).
 */
export function renderPluck(freqHz: number, seconds: number, brightness: number, sampleRate = 48000): Float32Array {
  // The 3-point loop filter adds one sample of delay → effective period n + 1.
  const n = Math.max(2, Math.round(sampleRate / freqHz) - 1);
  const len = Math.floor(seconds * sampleRate);
  const out = new Float32Array(len);
  const ring = new Float32Array(n);
  let s = 12345 + Math.round(freqHz);
  const b = clamp01(brightness);
  // excitation: noise, one-pole low-passed by (1-b), then DC removed
  let prev = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const white = (s / 4294967296) * 2 - 1;
    prev = prev + (0.25 + 0.75 * b) * (white - prev);
    ring[i] = prev;
    mean += prev;
  }
  mean /= n;
  for (let i = 0; i < n; i++) ring[i] -= mean;
  // string loss: lower strings ring longer; brightness sustains slightly longer
  const decay = Math.min(0.9996, 0.995 + 0.0045 * (1 - Math.min(1, freqHz / 700)) + 0.0004 * b);
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    const nxt = ring[(idx + 1) % n];
    const nxt2 = ring[(idx + 2) % n];
    out[i] = cur;
    ring[idx] = decay * ((cur + nxt + nxt2) / 3);
    idx = (idx + 1) % n;
  }
  // fade-in 2 ms to remove click, then normalise peak
  const fade = Math.min(len, Math.floor(sampleRate * 0.002));
  for (let i = 0; i < fade; i++) out[i] *= i / fade;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < len; i++) out[i] /= peak;
  return out;
}

export interface StrumEvent {
  chord: ChordName;
  direction: StrumDirection;
  velocity: number;
  /** Per-string scheduled start times (ctx time), low string first. null = muted. */
  times: Array<number | null>;
}

/**
 * Guitar: pre-rendered Karplus–Strong strings (2 brightness levels × every needed note),
 * strums as staggered string plucks, mute = fast release of ringing voices.
 */
export class Guitar {
  private readonly pool: VoicePool;
  private readonly buffers = new Map<string, AudioBuffer>();
  private prepared = false;
  lastStrum: StrumEvent | null = null;
  strumCount = 0;

  constructor(
    private readonly engine: AudioEngine,
    maxVoices = 18,
  ) {
    this.pool = new VoicePool(() => engine.context, maxVoices);
  }

  get activeVoices(): number {
    return this.pool.size;
  }

  /** Render every note used by the chord set (call once after engine.unlock()). */
  prepare(): void {
    if (this.prepared) return;
    const ctx = this.engine.context;
    const notes = new Set<number>();
    for (const c of CHORD_NAMES) for (const n of chordNotes(c)) if (n !== null) notes.add(n);
    for (const midi of notes) {
      for (const bright of [0, 1]) {
        const hz = midiToHz(midi);
        const secs = bright ? 2.6 : 1.2;
        const data = renderPluck(hz, secs, bright ? 0.85 : 0.25, ctx.sampleRate);
        const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        buf.getChannelData(0).set(data);
        this.buffers.set(`${midi}:${bright}`, buf);
      }
    }
    this.prepared = true;
  }

  /** Stagger between strings in seconds for a given velocity. */
  static staggerFor(velocity: number): number {
    return 0.022 - 0.01 * clamp01(velocity);
  }

  strum(chord: ChordName, direction: StrumDirection, velocity: number, when?: number): StrumEvent {
    const v = clamp01(velocity);
    if (!this.engine.ensureRunning()) {
      return { chord, direction, velocity: v, times: chordNotes(chord).map(() => null) };
    }
    this.prepare();
    const ctx = this.engine.context;
    const t0 = Math.max(when ?? ctx.currentTime, ctx.currentTime) + 0.002;
    const stagger = Guitar.staggerFor(v);
    const notes = chordNotes(chord);
    const order = notes.map((_, i) => i);
    if (direction === 'up') order.reverse();
    const times: Array<number | null> = notes.map(() => null);
    const palm = v < 0.12;
    let k = 0;
    for (const i of order) {
      const midi = notes[i];
      if (midi === null) continue;
      const t = t0 + k * stagger;
      k++;
      times[i] = t;
      this.pluck(ctx, midi, t, v, palm, i);
    }
    const ev: StrumEvent = { chord, direction, velocity: v, times };
    this.lastStrum = ev;
    this.strumCount++;
    return ev;
  }

  /** Damp all ringing strings quickly (left-hand mute). */
  mute(): void {
    if (!this.engine.ready) return;
    this.pool.releaseAll(0.035);
  }

  private pluck(ctx: AudioContext, midi: number, t: number, v: number, palm: boolean, stringIndex: number): void {
    const bright = v > 0.45 && !palm ? 1 : 0;
    const buf = this.buffers.get(`${midi}:${bright}`);
    if (!buf) return;
    // one string can only ring once — re-plucking the same string damps the previous note
    this.pool.releaseAll(0.01, `s${stringIndex}`);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = palm ? 900 : 1800 + 5200 * v;
    tone.Q.value = 0.4;
    const g = ctx.createGain();
    const peak = velocityToGain(v) * (palm ? 0.5 : 0.75) * (stringIndex < 2 ? 0.9 : 1);
    g.gain.setValueAtTime(peak, t);
    const dur = palm ? 0.22 : buf.duration;
    if (palm) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(tone).connect(g).connect(this.engine.output);
    src.start(t);
    src.stop(t + dur + 0.02);
    const voice: Voice = {
      gain: g,
      startedAt: t,
      tag: `s${stringIndex}`,
      stop: (at) => {
        try {
          src.stop(at);
        } catch {
          /* ignore */
        }
      },
    };
    src.onended = () => {
      this.pool.remove(voice);
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    };
    this.pool.add(voice);
  }
}
