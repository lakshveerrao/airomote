import { AudioEngine, VoicePool, clamp01, decayEnvelope, noiseBuffer, velocityToGain, type Voice } from './engine';

export type DrumId = 'kick' | 'snare' | 'hihat' | 'tom1' | 'tom2' | 'floor' | 'crash' | 'ride';
export const DRUM_IDS: DrumId[] = ['kick', 'snare', 'hihat', 'tom1', 'tom2', 'floor', 'crash', 'ride'];

export const DRUM_LABELS: Record<DrumId, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hi-hat',
  tom1: 'Tom 1',
  tom2: 'Tom 2',
  floor: 'Floor tom',
  crash: 'Crash',
  ride: 'Ride',
};

/**
 * Fully synthesised drum kit (no samples → offline, license-free, zero load time).
 * Every hit creates fresh nodes; nothing playing is ever modified, so rapid re-triggers
 * are glitch-free. Velocity shapes gain, brightness and decay.
 */
export class DrumKit {
  private readonly pool: VoicePool;
  /** Per-drum output gains so the mix can be balanced. */
  private readonly trim: Record<DrumId, number> = {
    kick: 1.0,
    snare: 0.9,
    hihat: 0.55,
    tom1: 0.85,
    tom2: 0.85,
    floor: 0.9,
    crash: 0.7,
    ride: 0.6,
  };
  hitCount = 0;

  constructor(
    private readonly engine: AudioEngine,
    maxVoices = 24,
  ) {
    this.pool = new VoicePool(() => engine.context, maxVoices);
  }

  get activeVoices(): number {
    return this.pool.size;
  }

  play(drum: DrumId, velocity: number, when?: number): void {
    if (!this.engine.ensureRunning()) return;
    const ctx = this.engine.context;
    const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
    const v = clamp01(velocity);
    const g = velocityToGain(v) * this.trim[drum];
    this.hitCount++;
    switch (drum) {
      case 'kick':
        this.kick(ctx, t, v, g);
        break;
      case 'snare':
        this.snare(ctx, t, v, g);
        break;
      case 'hihat':
        this.hihat(ctx, t, v, g);
        break;
      case 'tom1':
        this.tom(ctx, t, v, g, 220, 0.42, 'tom1');
        break;
      case 'tom2':
        this.tom(ctx, t, v, g, 160, 0.5, 'tom2');
        break;
      case 'floor':
        this.tom(ctx, t, v, g, 105, 0.62, 'floor');
        break;
      case 'crash':
        this.cymbal(ctx, t, v, g, 'crash');
        break;
      case 'ride':
        this.cymbal(ctx, t, v, g, 'ride');
        break;
    }
  }

  /** Choke a ringing drum/cymbal (hi-hat by default). */
  choke(drum: DrumId = 'hihat'): void {
    if (!this.engine.ready) return;
    this.pool.releaseAll(0.04, drum);
  }

  silence(): void {
    if (!this.engine.ready) return;
    this.pool.releaseAll(0.05);
  }

  // ---------- voices ----------

  private voice(ctx: AudioContext, gain: GainNode, tag: DrumId, startedAt: number, nodes: AudioScheduledSourceNode[], endAt: number): void {
    gain.connect(this.engine.output);
    const voice: Voice = {
      gain,
      startedAt,
      tag,
      stop: (at) => {
        for (const n of nodes) {
          try {
            n.stop(at);
          } catch {
            /* already stopped */
          }
        }
      },
    };
    for (const n of nodes) n.stop(endAt);
    nodes[0].onended = () => {
      this.pool.remove(voice);
      try {
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
    this.pool.add(voice);
  }

  private kick(ctx: AudioContext, t: number, v: number, g: number): void {
    const out = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150 + 40 * v, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const body = ctx.createGain();
    decayEnvelope(body.gain, t, 1, 0.38 + 0.12 * v, 0.002);
    osc.connect(body).connect(out);
    // click transient
    const click = ctx.createBufferSource();
    click.buffer = noiseBuffer(ctx);
    const clickHp = ctx.createBiquadFilter();
    clickHp.type = 'highpass';
    clickHp.frequency.value = 1500;
    const clickG = ctx.createGain();
    decayEnvelope(clickG.gain, t, 0.35 + 0.4 * v, 0.02, 0.0005);
    click.connect(clickHp).connect(clickG).connect(out);
    out.gain.value = g;
    osc.start(t);
    click.start(t);
    this.voice(ctx, out, 'kick', t, [osc, click], t + 0.6);
  }

  private snare(ctx: AudioContext, t: number, v: number, g: number): void {
    const out = ctx.createGain();
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(240, t);
    body.frequency.exponentialRampToValueAtTime(180, t + 0.03);
    const bodyG = ctx.createGain();
    decayEnvelope(bodyG.gain, t, 0.7, 0.12, 0.001);
    body.connect(bodyG).connect(out);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200 + 2400 * v;
    bp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const noiseG = ctx.createGain();
    decayEnvelope(noiseG.gain, t, 0.9, 0.16 + 0.1 * v, 0.001);
    noise.connect(bp).connect(hp).connect(noiseG).connect(out);
    out.gain.value = g;
    body.start(t);
    noise.start(t);
    this.voice(ctx, out, 'snare', t, [body, noise], t + 0.4);
  }

  private hihat(ctx: AudioContext, t: number, v: number, g: number): void {
    const out = ctx.createGain();
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 9000 + 2000 * v;
    bp.Q.value = 0.6;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const env = ctx.createGain();
    decayEnvelope(env.gain, t, 0.5, 0.06 + 0.1 * v, 0.0005);
    const oscs: OscillatorNode[] = [];
    for (const r of ratios) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 40 * r * 1.5;
      o.connect(bp);
      o.start(t);
      oscs.push(o);
    }
    bp.connect(hp).connect(env).connect(out);
    out.gain.value = g;
    this.voice(ctx, out, 'hihat', t, oscs, t + 0.3);
  }

  private tom(ctx: AudioContext, t: number, v: number, g: number, hz: number, decay: number, tag: DrumId): void {
    const out = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz * 1.35, t);
    osc.frequency.exponentialRampToValueAtTime(hz, t + 0.06);
    const oscG = ctx.createGain();
    decayEnvelope(oscG.gain, t, 0.9, decay + 0.1 * v, 0.001);
    const harm = ctx.createOscillator();
    harm.type = 'triangle';
    harm.frequency.setValueAtTime(hz * 2.1, t);
    harm.frequency.exponentialRampToValueAtTime(hz * 1.5, t + 0.05);
    const harmG = ctx.createGain();
    decayEnvelope(harmG.gain, t, 0.25 + 0.2 * v, 0.1, 0.001);
    const stick = ctx.createBufferSource();
    stick.buffer = noiseBuffer(ctx);
    const stickF = ctx.createBiquadFilter();
    stickF.type = 'bandpass';
    stickF.frequency.value = 2500;
    const stickG = ctx.createGain();
    decayEnvelope(stickG.gain, t, 0.2 + 0.25 * v, 0.015, 0.0005);
    osc.connect(oscG).connect(out);
    harm.connect(harmG).connect(out);
    stick.connect(stickF).connect(stickG).connect(out);
    out.gain.value = g;
    osc.start(t);
    harm.start(t);
    stick.start(t);
    this.voice(ctx, out, tag, t, [osc, harm, stick], t + decay + 0.4);
  }

  private cymbal(ctx: AudioContext, t: number, v: number, g: number, kind: 'crash' | 'ride'): void {
    const out = ctx.createGain();
    const len = kind === 'crash' ? 1.5 + 1.0 * v : 0.9 + 0.7 * v;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = kind === 'crash' ? 3200 : 4500;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = kind === 'crash' ? 6500 + 2500 * v : 8000;
    bp.Q.value = kind === 'crash' ? 0.35 : 0.8;
    const noiseG = ctx.createGain();
    decayEnvelope(noiseG.gain, t, kind === 'crash' ? 0.9 : 0.45, len, 0.002);
    noise.connect(hp).connect(bp).connect(noiseG).connect(out);
    // shimmer / ping partials
    const partials = kind === 'crash' ? [3170, 4790, 6120] : [3000, 4520, 5260];
    const oscs: AudioScheduledSourceNode[] = [noise];
    for (const [i, f] of partials.entries()) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (1 + (i - 1) * 0.002);
      const og = ctx.createGain();
      decayEnvelope(og.gain, t, (kind === 'ride' ? 0.35 : 0.12) / (i + 1), kind === 'ride' ? 0.6 + 0.4 * v : len * 0.7, 0.001);
      o.connect(og).connect(out);
      o.start(t);
      oscs.push(o);
    }
    out.gain.value = g;
    noise.start(t);
    this.voice(ctx, out, kind, t, oscs, t + len + 0.3);
  }
}
