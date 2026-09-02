import { MotionEngine, PacketSynth, gravityFromOrientation, type ControllerMotionState, type SynthFrame } from '@aero/motion-core';

/** Realistic synthetic streams for exercise detector tests (shared with the simulator model shape). */
export function stream(frames: SynthFrame[], rateHz = 100): ControllerMotionState[] {
  const engine = new MotionEngine();
  const synth = new PacketSynth({ controllerId: 1, rateHz, noiseAccelG: 0.012, noiseGyroDps: 0.8 });
  const out: ControllerMotionState[] = [];
  for (const f of frames) {
    const s = engine.ingest(synth.next(f));
    if (s) out.push(s);
  }
  return out;
}

/** Frames holding still. */
export function still(seconds: number, pitch = 0, roll = 0, rateHz = 100): SynthFrame[] {
  return Array.from({ length: Math.round(seconds * rateHz) }, () => ({ pitch, roll }));
}

/**
 * A squat expressed as a world-vertical acceleration profile (g, + up) plus a forward lean.
 * Segments: [durationS, accelG][]
 */
export function verticalProfile(segments: Array<[number, number]>, pitchLean = -12, rateHz = 100, basePitch = 0): SynthFrame[] {
  const frames: SynthFrame[] = [];
  const total = segments.reduce((a, [d]) => a + d, 0);
  let t = 0;
  for (const [dur, a] of segments) {
    const n = Math.round(dur * rateHz);
    for (let i = 0; i < n; i++) {
      const phase = t / total; // 0..1
      const lean = basePitch + pitchLean * Math.sin(Math.PI * phase);
      const g = gravityFromOrientation({ pitch: lean, roll: 0, yaw: 0 });
      frames.push({ pitch: lean, roll: 0, linear: { x: g.x * a, y: g.y * a, z: g.z * a } });
      t += 1 / rateHz;
    }
  }
  return frames;
}

export function squat(amplitude = 0.25, holdBottomS = 0.2): SynthFrame[] {
  return verticalProfile([
    [0.35, -amplitude],
    [0.35, +amplitude],
    [holdBottomS, 0],
    [0.35, +amplitude],
    [0.35, -amplitude],
  ]);
}

export function noiseFrames(seconds: number, amplitudeG = 0.3, rateHz = 100): SynthFrame[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  return Array.from({ length: Math.round(seconds * rateHz) }, () => ({
    pitch: rnd() * 6,
    roll: rnd() * 6,
    linear: { x: rnd() * 2 * amplitudeG, y: rnd() * 2 * amplitudeG, z: rnd() * 2 * amplitudeG },
  }));
}

/** Arm angle sweep 0 → peak → 0 over the given seconds (half-cosine in and out). */
export function armSweep(peakDeg: number, seconds: number, rateHz = 100): SynthFrame[] {
  const n = Math.round(seconds * rateHz);
  return Array.from({ length: n }, (_, i) => {
    const f = (i + 1) / n;
    const pitch = peakDeg * (0.5 - 0.5 * Math.cos(2 * Math.PI * f));
    return { pitch, roll: 0 };
  });
}

export function rampTo(peakDeg: number, seconds: number, rateHz = 100): SynthFrame[] {
  const n = Math.round(seconds * rateHz);
  return Array.from({ length: n }, (_, i) => ({ pitch: (peakDeg * (i + 1)) / n, roll: 0 }));
}
