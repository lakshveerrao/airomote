/**
 * AudioEngine — one AudioContext for the whole app, unlocked on a user gesture,
 * with master volume and a soft limiter. Instruments hang off `engine.output`.
 * The context factory is injectable so the engine (and instruments) run under vitest
 * with a fake AudioContext.
 */
export type ContextFactory = () => AudioContext;

export interface AudioEngineOptions {
  createContext?: ContextFactory;
  volume?: number;
}

/** Perceptual velocity → gain curve. Monotonic, 0.15 at v=0, 1 at v=1. */
export function velocityToGain(v: number): number {
  const x = Math.max(0, Math.min(1, v));
  return 0.15 + 0.85 * Math.pow(x, 1.6);
}

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private volume: number;
  private muted = false;
  private readonly createContext: ContextFactory;

  constructor(opts: AudioEngineOptions = {}) {
    this.volume = clamp01(opts.volume ?? 0.8);
    this.createContext =
      opts.createContext ??
      (() => new AudioContext({ latencyHint: 'interactive' }));
  }

  /** Create/resume the context. Call from a user gesture (click on Start). Safe to call often. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      this.ctx = this.createContext();
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 12;
      this.limiter.ratio.value = 8;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.12;
      this.master = this.ctx.createGain();
      this.applyVolume();
      this.master.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* will retry on next trigger */
      }
    }
  }

  /** Called by instruments before scheduling; resumes a suspended context without awaiting. */
  ensureRunning(): boolean {
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return true;
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  get context(): AudioContext {
    if (!this.ctx) throw new Error('AudioEngine not unlocked — call unlock() from a user gesture');
    return this.ctx;
  }

  get output(): AudioNode {
    if (!this.master) throw new Error('AudioEngine not unlocked');
    return this.master;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    this.applyVolume();
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return;
    const target = this.muted ? 0 : this.volume;
    const p = this.master.gain;
    p.cancelScheduledValues(this.ctx.currentTime);
    p.setTargetAtTime(target, this.ctx.currentTime, 0.015);
  }

  async dispose(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
    this.limiter = null;
  }
}

/**
 * Tracks live voices per instrument and steals the oldest when the polyphony limit is
 * exceeded. A voice is anything with a gain node we can fade out and a stop callback.
 */
export interface Voice {
  gain: GainNode;
  startedAt: number;
  stop: (at: number) => void;
  /** Optional tag (e.g. drum id or string index) for targeted choke/mute. */
  tag?: string;
}

export class VoicePool {
  private voices: Voice[] = [];

  constructor(
    private readonly ctx: () => AudioContext,
    public readonly maxVoices: number,
  ) {}

  get size(): number {
    return this.voices.length;
  }

  add(voice: Voice): void {
    this.voices.push(voice);
    while (this.voices.length > this.maxVoices) {
      const oldest = this.voices.shift()!;
      this.release(oldest, 0.012);
    }
  }

  /** Remove bookkeeping when a voice ends naturally. */
  remove(voice: Voice): void {
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Fast fade + stop for all voices (or those with a tag). */
  releaseAll(releaseSeconds = 0.03, tag?: string): void {
    const keep: Voice[] = [];
    for (const v of this.voices) {
      if (tag === undefined || v.tag === tag) this.release(v, releaseSeconds);
      else keep.push(v);
    }
    this.voices = keep;
  }

  private release(v: Voice, seconds: number): void {
    const now = this.ctx().currentTime;
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.exponentialRampToValueAtTime(0.0001, now + seconds);
    v.stop(now + seconds + 0.005);
  }
}

/** Convenience: exponential decay envelope on a gain param starting at `peak`. */
export function decayEnvelope(gain: AudioParam, when: number, peak: number, seconds: number, attack = 0.001): void {
  gain.cancelScheduledValues(when);
  gain.setValueAtTime(0.0001, when);
  gain.linearRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
  gain.exponentialRampToValueAtTime(0.0001, when + attack + seconds);
}

/** White noise buffer (cached per context). */
const noiseCache = new WeakMap<AudioContext, AudioBuffer>();
export function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (b) return b;
  const len = Math.floor(ctx.sampleRate * seconds);
  b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  noiseCache.set(ctx, b);
  return b;
}
