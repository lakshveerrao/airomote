import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityComponentProps } from '@/activities';
import { useActivitySession } from '@/core/session';
import { useSettings } from '@/store/settings';
import { Button } from '@/ui';
import { ActivityChrome, PresetPicker, useActivityFlow } from '@/features/activity/ActivityChrome';
import { Race, formatRaceTime, ordinal } from './game/race';
import { TrackModel } from './game/track';
import type { KartInput } from './game/kart';
import { KartScene, type SceneDriver } from './scene/KartScene';
import { KART_THEMES, loadKartTheme, saveKartTheme, type KartThemeId } from './scene/themes';
import { EngineSound } from './scene/EngineSound';
import './kart.css';

interface HudState {
  position: number;
  lap: number;
  laps: number;
  countdown: number | null; // 3,2,1,0(GO) or null
  wrongWay: boolean;
  boostReady: boolean;
  boosting: boolean;
  boostCooldown: number; // 0..1 fraction remaining
  bestLap: number | null;
  lapFlash: { n: number; time: number; key: number } | null;
  raceFinished: boolean;
}

const initialHud = (laps: number): HudState => ({
  position: 1,
  lap: 1,
  laps,
  countdown: null,
  wrongWay: false,
  boostReady: true,
  boosting: false,
  boostCooldown: 0,
  bestLap: null,
  lapFlash: null,
  raceFinished: false,
});

export default function MotionKart({ definition }: ActivityComponentProps) {
  const session = useActivitySession(definition);
  const flow = useActivityFlow(definition, session);
  const volume = useSettings((s) => s.volume);
  const muted = useSettings((s) => s.muted);

  const track = useMemo(() => new TrackModel(), []);
  const raceRef = useRef<Race>(new Race(track, { playerColor: definition.accent }));
  const engine = useRef<EngineSound | null>(null);
  const runningRef = useRef(false);
  const showcaseRef = useRef(true);
  const startedRef = useRef(false);
  const lastLapCount = useRef(0);
  const finishTimer = useRef<number | null>(null);
  const [hud, setHud] = useState<HudState>(() => initialHud(raceRef.current.laps));
  const speedEl = useRef<HTMLDivElement>(null);
  const timeEl = useRef<HTMLDivElement>(null);
  const steerEl = useRef<HTMLDivElement>(null);
  const arcEl = useRef<SVGPathElement>(null);
  const linesEl = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<{ total: number; best: number | null; position: number; laps: number[] } | null>(null);
  const [themeId, setThemeId] = useState<KartThemeId>(() => loadKartTheme());
  const pickTheme = useCallback((id: KartThemeId) => {
    setThemeId(id);
    saveKartTheme(id);
  }, []);

  runningRef.current = flow.phase === 'running';
  showcaseRef.current = !startedRef.current && flow.phase === 'intro';

  const newRace = useCallback(() => {
    raceRef.current = new Race(track, { playerColor: definition.accent });
    lastLapCount.current = 0;
    setHud(initialHud(raceRef.current.laps));
    setSummary(null);
  }, [track, definition.accent]);

  // Start: fresh race, unlock audio (user gesture).
  useEffect(() => {
    if (flow.phase === 'running' && !startedRef.current) {
      startedRef.current = true;
      newRace();
      if (!engine.current) engine.current = new EngineSound();
      engine.current.start(volume, muted);
    }
    if (flow.phase === 'intro') startedRef.current = false;
    if (flow.phase !== 'running') engine.current?.suspend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.phase]);
  useEffect(() => engine.current?.setVolume(volume, muted), [volume, muted]);
  useEffect(
    () => () => {
      engine.current?.dispose();
      if (finishTimer.current) clearTimeout(finishTimer.current);
    },
    [],
  );

  // Input: universal actions only.
  const readInput = useCallback((): KartInput => {
    const a = session.session.actions;
    const axis = a.value('CONTINUOUS_X');
    const held = a.value('TURN_RIGHT') - a.value('TURN_LEFT');
    const steer = Math.abs(axis) > Math.abs(held) ? axis : held;
    const y = a.value('CONTINUOUS_Y');
    const throttle = Math.max(y > 0 ? y : 0, a.value('ACCELERATE'));
    const brake = Math.max(y < 0 ? -y : 0, a.value('BRAKE'));
    const boost = a.consume('BOOST').count > 0;
    return { steer, throttle, brake, boost };
  }, [session]);

  const hudTick = useRef(0);
  const onFrame = useCallback(
    (race: Race, dt: number) => {
      const k = race.player;
      // per-frame DOM updates (no React)
      const kmh = Math.round(Math.abs(k.speed) * 3.6);
      if (speedEl.current) speedEl.current.textContent = String(kmh);
      if (timeEl.current) timeEl.current.textContent = formatRaceTime(race.currentLapTime);
      if (steerEl.current) steerEl.current.style.transform = `translateX(${-8 + k.steer * 72}px)`;
      if (arcEl.current) {
        const f = Math.min(1, Math.abs(k.speed) / (k.params.maxSpeed * k.params.boostMultiplier));
        arcEl.current.style.strokeDasharray = `${f * 251} 251`;
      }
      if (linesEl.current) linesEl.current.classList.toggle('kart-speedlines--on', k.boosting);
      engine.current?.update(k.speed, k.boosting, readInputThrottle(session.session.actions), runningRef.current);
      // coarse React state ~12 Hz
      hudTick.current += dt;
      if (hudTick.current < 1 / 12) return;
      hudTick.current = 0;
      const p = race.playerProgress;
      const countdown = race.phase === 'countdown' ? race.countdownValue : race.showGo ? 0 : null;
      let lapFlash: HudState['lapFlash'] = null;
      if (p.lap > lastLapCount.current) {
        lastLapCount.current = p.lap;
        lapFlash = { n: p.lap, time: p.lapTimes[p.lapTimes.length - 1], key: Date.now() };
      }
      setHud((h) => {
        const next: HudState = {
          position: race.position,
          lap: Math.min(p.lap + 1, race.laps),
          laps: race.laps,
          countdown,
          wrongWay: race.wrongWay,
          boostReady: k.boostReady,
          boosting: k.boosting,
          boostCooldown: k.boostCooldown > 0 ? k.boostCooldown / k.params.boostCooldown : 0,
          bestLap: p.bestLap,
          lapFlash: lapFlash ?? (h.lapFlash && Date.now() - h.lapFlash.key < 2300 ? h.lapFlash : null),
          raceFinished: race.phase === 'finished',
        };
        const same =
          next.position === h.position &&
          next.lap === h.lap &&
          next.countdown === h.countdown &&
          next.wrongWay === h.wrongWay &&
          next.boostReady === h.boostReady &&
          next.boosting === h.boosting &&
          Math.abs(next.boostCooldown - h.boostCooldown) < 0.02 &&
          next.bestLap === h.bestLap &&
          next.lapFlash === h.lapFlash &&
          next.raceFinished === h.raceFinished;
        return same ? h : next;
      });
      if (race.phase === 'finished' && finishTimer.current === null && flow.phase === 'running') {
        setSummary({ total: race.totalTime, best: p.bestLap, position: race.finalPosition, laps: p.lapTimes });
        finishTimer.current = window.setTimeout(() => {
          finishTimer.current = null;
          flow.finish();
        }, 1800);
      }
    },
    [session, flow],
  );

  // Boost sound hook: watch for boosting edge.
  const wasBoosting = useRef(false);
  useEffect(() => {
    if (hud.boosting && !wasBoosting.current) engine.current?.boostBurst();
    wasBoosting.current = hud.boosting;
  }, [hud.boosting]);

  const driver = useMemo<SceneDriver>(
    () => ({
      race: () => raceRef.current,
      running: () => runningRef.current,
      showcase: () => showcaseRef.current,
      input: readInput,
      onFrame,
    }),
    [readInput, onFrame],
  );

  return (
    <ActivityChrome
      def={definition}
      session={session}
      flow={flow}
      onRestart={() => {
        newRace();
        startedRef.current = false;
      }}
      intro={
        <>
          <div className="kart-tracks" style={{ '--accent': definition.accent } as React.CSSProperties}>
            <div className="hud-label">Track</div>
            <div className="kart-tracks__row" role="radiogroup" aria-label="Track">
              {KART_THEMES.map((t) => (
                <button key={t.id} role="radio" aria-checked={t.id === themeId} className={`kart-track-card ${t.id === themeId ? 'kart-track-card--on' : ''}`} onClick={() => pickTheme(t.id)}>
                  <span className="kart-track-card__swatch" style={{ background: t.swatch }} />
                  <span className="kart-track-card__name">{t.name}</span>
                  <span className="kart-track-card__sub">{t.subtitle}</span>
                </button>
              ))}
            </div>
          </div>
          <PresetPicker def={definition} session={session} />
          <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
            <Button size="sm" variant="ghost" onClick={() => session.session.recentre()}>
              Re-centre steering
            </Button>
          </div>
        </>
      }
      hudTop={
        <>
          <div className="kart-hud-pill">
            <span className="lbl">Lap</span>
            <span className="val">
              {hud.lap}
              <span className="dim">/{hud.laps}</span>
            </span>
          </div>
          <div className={`kart-boost ${hud.boosting ? 'kart-boost--active' : hud.boostReady ? 'kart-boost--ready' : ''}`}>
            {hud.boosting ? 'Boost' : hud.boostReady ? 'Boost ready' : 'Boost'}
            {!hud.boostReady && !hud.boosting && (
              <span className="kart-boost__bar">
                <i style={{ transform: `scaleX(${1 - hud.boostCooldown})` }} />
              </span>
            )}
          </div>
        </>
      }
      hudBottom={
        <>
          <div>
            <div className="kart-position">
              {hud.position}
              <sup>{ordinal(hud.position).slice(-2)}</sup>
            </div>
            <div className="kart-speedo" style={{ marginTop: 10 }}>
              <svg viewBox="0 0 200 128">
                <path d="M20 110 A 80 80 0 0 1 180 110" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="8" strokeLinecap="round" />
                <path
                  ref={arcEl}
                  d="M20 110 A 80 80 0 0 1 180 110"
                  fill="none"
                  stroke={definition.accent}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray="0 251"
                  style={{ transition: 'stroke-dasharray 0.08s linear', filter: `drop-shadow(0 0 8px ${definition.accent})` }}
                />
              </svg>
              <div className="kart-speedo__value" ref={speedEl}>
                0
              </div>
              <div className="kart-speedo__unit">km/h</div>
            </div>
            <div className="kart-steer" title="Steering">
              <div className="kart-steer__knob" ref={steerEl} />
            </div>
          </div>
          <div className="kart-times">
            <div className="row-t">
              <span className="lbl">Lap time</span>
              <span className="cur" ref={timeEl}>
                0:00.00
              </span>
            </div>
            <div className="row-t">
              <span className="lbl">Best</span>
              <span className="best">{hud.bestLap === null ? '—' : formatRaceTime(hud.bestLap)}</span>
            </div>
          </div>
        </>
      }
      summary={
        summary && (
          <>
            <div className="kart-summary">
              <div className="kart-summary__cell">
                <div className="lbl">Position</div>
                <div className="val">{ordinal(summary.position)}</div>
              </div>
              <div className="kart-summary__cell">
                <div className="lbl">Total</div>
                <div className="val">{formatRaceTime(summary.total)}</div>
              </div>
              <div className="kart-summary__cell">
                <div className="lbl">Best lap</div>
                <div className="val">{summary.best === null ? '—' : formatRaceTime(summary.best)}</div>
              </div>
            </div>
            <div className="kart-laps">
              {summary.laps.map((t, i) => (
                <span key={i}>
                  Lap {i + 1} <b>{formatRaceTime(t)}</b>
                </span>
              ))}
            </div>
          </>
        )
      }
    >
      <KartScene key={themeId} driver={driver} accent={definition.accent} themeId={themeId} />
      <div className="kart-speedlines" ref={linesEl} />
      {flow.phase === 'running' && (
        <div className="kart-center">
          {hud.countdown !== null && (
            <div key={hud.countdown} className={`kart-countdown ${hud.countdown === 0 ? 'kart-countdown--go' : ''}`}>
              {hud.countdown === 0 ? 'GO' : hud.countdown}
            </div>
          )}
          {hud.wrongWay && hud.countdown === null && <div className="kart-wrongway">Wrong way</div>}
          {hud.raceFinished && (
            <div className="kart-countdown kart-countdown--go" style={{ fontSize: 'clamp(60px, 10vw, 120px)', animationDuration: '2s' }}>
              Finish
            </div>
          )}
        </div>
      )}
      {flow.phase === 'running' && hud.lapFlash && (
        <div key={hud.lapFlash.key} className="kart-lapflash">
          Lap {hud.lapFlash.n} · {formatRaceTime(hud.lapFlash.time)}
          <small>{hud.lapFlash.n >= hud.laps ? 'Final lap complete' : hud.lapFlash.n === hud.laps - 1 ? 'Final lap' : 'Keep going'}</small>
        </div>
      )}
    </ActivityChrome>
  );
}

function readInputThrottle(a: { value: (k: 'CONTINUOUS_Y' | 'ACCELERATE') => number }): number {
  return Math.max(a.value('CONTINUOUS_Y'), a.value('ACCELERATE'), 0);
}
