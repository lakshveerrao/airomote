/**
 * Subtle synthesized engine hum: two detuned oscillators through a low-pass, pitch and
 * brightness follow speed; a short noise burst on boost. Created on the Start click.
 */
export class EngineSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private volume = 0.5;
  private muted = false;

  start(volume: number, muted: boolean): void {
    if (this.ctx) {
      this.setVolume(volume, muted);
      void this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const master = ctx.createGain();
      master.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      filter.Q.value = 2;
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 55;
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 55.7;
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      osc1.connect(filter);
      osc2.connect(g2).connect(filter);
      filter.connect(master).connect(ctx.destination);
      osc1.start();
      osc2.start();
      this.ctx = ctx;
      this.master = master;
      this.osc1 = osc1;
      this.osc2 = osc2;
      this.filter = filter;
      this.setVolume(volume, muted);
    } catch {
      this.ctx = null;
    }
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
  }

  /** speed in m/s, called every frame. */
  update(speed: number, boosting: boolean, throttle: number, running: boolean): void {
    if (!this.ctx || !this.master || !this.osc1 || !this.osc2 || !this.filter) return;
    const t = this.ctx.currentTime;
    const sp = Math.abs(speed);
    const rpm = 0.25 + Math.min(sp / 40, 1) * 0.75 + throttle * 0.08;
    const base = 48 + rpm * 110 + (boosting ? 30 : 0);
    this.osc1.frequency.setTargetAtTime(base, t, 0.05);
    this.osc2.frequency.setTargetAtTime(base * 1.011, t, 0.05);
    this.filter.frequency.setTargetAtTime(280 + rpm * 900 + (boosting ? 600 : 0), t, 0.06);
    const target = !running || this.muted ? 0 : this.volume * 0.11 * (0.55 + rpm * 0.45);
    this.master.gain.setTargetAtTime(target, t, 0.08);
  }

  boostBurst(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = this.muted ? 0 : this.volume * 0.25;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
    src.onended = () => {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    };
  }

  suspend(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  dispose(): void {
    try {
      this.osc1?.stop();
      this.osc2?.stop();
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
    this.osc1 = null;
    this.osc2 = null;
    this.filter = null;
  }
}
