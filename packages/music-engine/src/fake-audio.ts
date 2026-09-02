/**
 * Minimal fake AudioContext for tests. Records node graph and scheduled starts/stops,
 * implements AudioParam automation as no-ops that remember the last value.
 */
export class FakeParam {
  value: number;
  calls: Array<[string, number, number?]> = [];
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v: number, t: number) {
    this.calls.push(['set', v, t]);
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(['lin', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.calls.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.calls.push(['target', v, t]);
    this.value = v;
    void tc;
    return this;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(['cancel', t]);
    return this;
  }
}

export class FakeNode {
  connections: FakeNode[] = [];
  constructor(public readonly ctx: FakeAudioContext, public readonly kind: string) {}
  connect(n: FakeNode) {
    this.connections.push(n);
    return n;
  }
  disconnect() {
    this.connections = [];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}
export class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
}
export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}
export class FakeSource extends FakeNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(t = this.ctx.currentTime) {
    this.startedAt = t;
    this.ctx.started.push(this);
  }
  stop(t = this.ctx.currentTime) {
    this.stoppedAt = t;
  }
}
export class FakeOscillator extends FakeSource {
  type = 'sine';
  frequency = new FakeParam(440);
}
export class FakeBuffer {
  private data: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(i: number) {
    return this.data[i];
  }
}
export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new FakeNode(this, 'destination');
  started: FakeSource[] = [];
  resumeCount = 0;
  createGain() {
    return new FakeGain(this, 'gain');
  }
  createBiquadFilter() {
    return new FakeFilter(this, 'filter');
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this, 'compressor');
  }
  createOscillator() {
    return new FakeOscillator(this, 'osc');
  }
  createBufferSource() {
    return new FakeBufferSource(this, 'bufsrc');
  }
  createBuffer(ch: number, len: number, sr: number) {
    return new FakeBuffer(ch, len, sr);
  }
  async resume() {
    this.resumeCount++;
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
  /** Simulate the passage of time and fire onended for sources whose stop time passed. */
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const s of this.started) {
      if (s.stoppedAt !== null && s.stoppedAt <= this.currentTime && s.onended) {
        const cb = s.onended;
        s.onended = null;
        cb();
      }
    }
  }
}

export const fakeContextFactory = (): { ctx: FakeAudioContext; create: () => AudioContext } => {
  const ctx = new FakeAudioContext();
  return { ctx, create: () => ctx as unknown as AudioContext };
};
