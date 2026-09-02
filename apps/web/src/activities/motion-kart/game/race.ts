import { Kart, type KartInput } from './kart';
import { TrackModel } from './track';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface Progress {
  lap: number; // completed laps
  nextCheckpoint: number; // index expected next (0 = finish line)
  lapStart: number;
  lapTimes: number[];
  bestLap: number | null;
  finished: boolean;
  finishTime: number | null;
  wrongWayTime: number;
  /** monotonically increasing progress for ranking (metres) */
  score: number;
  lastS: number;
}

export interface AiKart {
  kart: Kart;
  s: number;
  lateral: number;
  targetLateral: number;
  baseSpeed: number;
  speed: number;
  phase: number;
  progress: Progress;
}

export interface RaceOptions {
  laps?: number;
  checkpoints?: number;
  aiCount?: number;
  countdownSeconds?: number;
  playerColor?: string;
  seed?: number;
}

const AI_COLORS = ['#6ea8ff', '#3ddc97', '#ffc857'];

function newProgress(): Progress {
  return { lap: 0, nextCheckpoint: 1, lapStart: 0, lapTimes: [], bestLap: null, finished: false, finishTime: null, wrongWayTime: 0, score: 0, lastS: 0 };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Race orchestration: countdown → racing → finished. Lap/checkpoint logic is order-enforced:
 * a lap only counts when the finish line is crossed after every sector checkpoint, in order.
 */
export class Race {
  readonly track: TrackModel;
  readonly player: Kart;
  readonly ai: AiKart[] = [];
  readonly playerProgress: Progress = newProgress();
  readonly laps: number;
  readonly checkpointCount: number;
  readonly checkpointS: number[];
  phase: RacePhase = 'countdown';
  /** Seconds since GO (negative during countdown). */
  time: number;
  private readonly countdownSeconds: number;
  /** Distance behind the finish line where the grid starts. */
  readonly gridStart: number;
  finalPosition = 0;
  private readonly random: () => number;

  constructor(track: TrackModel = new TrackModel(), opts: RaceOptions = {}) {
    this.track = track;
    this.laps = opts.laps ?? 3;
    this.checkpointCount = opts.checkpoints ?? 8;
    this.countdownSeconds = opts.countdownSeconds ?? 3.6;
    this.time = -this.countdownSeconds;
    this.random = rng(opts.seed ?? 7);
    this.checkpointS = Array.from({ length: this.checkpointCount }, (_, i) => (i * track.length) / this.checkpointCount);
    this.gridStart = track.wrap(-10);
    this.player = new Kart(undefined, opts.playerColor ?? '#ff7a45');
    const aiCount = opts.aiCount ?? 3;
    // grid: player front-right, AI staggered behind
    this.player.placeOnTrack(track, this.gridStart, -1.6);
    for (let i = 0; i < aiCount; i++) {
      const kart = new Kart(undefined, AI_COLORS[i % AI_COLORS.length]);
      const s = track.wrap(this.gridStart - 4 * (i + 1));
      const lateral = i % 2 === 0 ? 1.6 : -1.6;
      kart.placeOnTrack(track, s, lateral);
      this.ai.push({
        kart,
        s,
        lateral,
        targetLateral: lateral,
        baseSpeed: 24 + i * 1.6 + this.random() * 2,
        speed: 0,
        phase: this.random() * Math.PI * 2,
        progress: newProgress(),
      });
      this.ai[i].progress.lastS = s;
    }
    this.playerProgress.lastS = this.player.trackS;
  }

  get countdownValue(): number {
    // 3, 2, 1 then 0 = GO
    return Math.max(0, Math.ceil(-this.time));
  }

  get showGo(): boolean {
    return this.time >= 0 && this.time < 1;
  }

  get currentLapTime(): number {
    if (this.phase === 'countdown') return 0;
    const p = this.playerProgress;
    if (p.finished) return p.lapTimes[p.lapTimes.length - 1] ?? 0;
    return this.time - p.lapStart;
  }

  get totalTime(): number {
    const p = this.playerProgress;
    return p.finished && p.finishTime !== null ? p.finishTime : Math.max(0, this.time);
  }

  get wrongWay(): boolean {
    return this.playerProgress.wrongWayTime > 0.9;
  }

  /** 1-based race position of the player. */
  get position(): number {
    if (this.phase === 'finished') return this.finalPosition;
    let pos = 1;
    for (const a of this.ai) if (this.rankScore(a.progress) > this.rankScore(this.playerProgress)) pos++;
    return pos;
  }

  private rankScore(p: Progress): number {
    if (p.finished && p.finishTime !== null) return 1e9 - p.finishTime;
    return p.score;
  }

  step(dt: number, input: KartInput): void {
    if (this.phase === 'finished') {
      // let the field keep rolling for the podium camera
      for (const a of this.ai) this.stepAi(a, dt);
      return;
    }
    this.time += dt;
    if (this.phase === 'countdown') {
      if (this.time >= 0) {
        this.phase = 'racing';
        this.playerProgress.lapStart = 0;
        for (const a of this.ai) a.progress.lapStart = 0;
      } else {
        // steering wheel can move, kart stays put
        this.player.step({ steer: input.steer, throttle: 0, brake: 0, boost: false }, dt, this.track);
        return;
      }
    }
    this.player.step(input, dt, this.track);
    this.updateProgress(this.playerProgress, this.player.trackS, dt);
    for (const a of this.ai) this.stepAi(a, dt);
    if (this.playerProgress.finished && this.phase === 'racing') {
      this.phase = 'finished';
      this.finalPosition = 1 + this.ai.filter((a) => a.progress.finished && a.progress.finishTime! < this.playerProgress.finishTime!).length;
    }
  }

  private stepAi(a: AiKart, dt: number): void {
    const t = this.track;
    // rubber band: slow down when far ahead of the player, speed up when behind
    const diff = a.progress.score - this.playerProgress.score;
    const band = Math.max(-0.16, Math.min(0.16, -diff / 250));
    const target = a.progress.finished ? a.baseSpeed * 0.6 : a.baseSpeed * (1 + band);
    a.speed += (target - a.speed) * Math.min(1, dt * 1.2);
    // corner slowdown: curvature from heading change ahead
    const h0 = t.headingAt(a.s);
    const h1 = t.headingAt(a.s + 12);
    const curve = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)));
    const v = a.speed * (1 - Math.min(0.45, curve * 0.9));
    a.s = t.wrap(a.s + v * dt);
    a.phase += dt * 0.4;
    a.targetLateral = Math.sin(a.phase) * 1.8 + (a.lateral > 0 ? 0.6 : -0.6);
    a.lateral += (a.targetLateral - a.lateral) * Math.min(1, dt * 0.8);
    const p = t.offsetPoint(a.s, a.lateral);
    const k = a.kart;
    const prevX = k.x;
    const prevZ = k.z;
    k.x = p.x;
    k.z = p.z;
    k.heading = t.headingAt(a.s + 1.5) + Math.atan2(a.targetLateral - a.lateral, 6) * 0.3;
    k.speed = Math.hypot(k.x - prevX, k.z - prevZ) / Math.max(dt, 1e-4);
    k.wheelSpin += (v / 0.32) * dt;
    k.trackS = a.s;
    k.lateral = a.lateral;
    this.updateProgress(a.progress, a.s, dt);
  }

  /** Checkpoint / lap logic shared by player and AI. */
  updateProgress(p: Progress, s: number, dt: number): void {
    if (p.finished) return;
    const t = this.track;
    const moved = t.forward(p.lastS, s); // 0..L
    const movedBack = moved > t.length / 2;
    const delta = movedBack ? moved - t.length : moved;
    if (delta < -0.05) p.wrongWayTime += dt;
    else if (delta > 0.05) p.wrongWayTime = Math.max(0, p.wrongWayTime - dt * 2);
    // progress score (never decreases past a checkpoint; sector-relative)
    const fromGrid = t.forward(this.gridStart, s);
    p.score = p.lap * t.length + fromGrid;
    if (!movedBack && delta > 0) {
      const cp = this.checkpointS[p.nextCheckpoint];
      const toCp = t.forward(p.lastS, cp);
      if (toCp <= moved) {
        // crossed the expected checkpoint
        if (p.nextCheckpoint === 0) {
          const lapTime = this.time - p.lapStart;
          p.lapTimes.push(lapTime);
          p.bestLap = p.bestLap === null ? lapTime : Math.min(p.bestLap, lapTime);
          p.lap++;
          p.lapStart = this.time;
          if (p.lap >= this.laps) {
            p.finished = true;
            p.finishTime = this.time;
          }
        }
        p.nextCheckpoint = (p.nextCheckpoint + 1) % this.checkpointCount;
      }
    }
    p.lastS = s;
  }

  /** Distance (m) to the next checkpoint for HUD/arches. */
  distanceToNextCheckpoint(): number {
    return this.track.forward(this.player.trackS, this.checkpointS[this.playerProgress.nextCheckpoint]);
  }
}

export function formatRaceTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
