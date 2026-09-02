import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHORD_NAMES, CHORD_VOICINGS, Guitar as GuitarInstrument, type ChordName, type StrumDirection } from '@aero/music-engine';
import type { ActivityComponentProps } from '@/activities';
import { useActivitySession, useActions } from '@/core/session';
import { ActivityChrome, useActivityFlow } from '@/features/activity/ActivityChrome';
import { audioEngine, useAudioUnlock } from '@/features/music/audio';
import { Kbd } from '@/ui';
import { GuitarScene, createGuitarSceneApi } from './GuitarScene';
import './guitar.css';

const isChord = (z: unknown): z is ChordName => typeof z === 'string' && (CHORD_NAMES as string[]).includes(z);

const GESTURES: Array<{ chord: ChordName; hint: string; angle: number; r: number }> = [
  { chord: 'C', hint: 'tilt left', angle: 180, r: 1 },
  { chord: 'G', hint: 'tilt right', angle: 0, r: 1 },
  { chord: 'Am', hint: 'tip forward', angle: 90, r: 1 },
  { chord: 'F', hint: 'tip back', angle: 270, r: 1 },
  { chord: 'Em', hint: 'turn left', angle: 135, r: 1.55 },
  { chord: 'D', hint: 'turn right', angle: 45, r: 1.55 },
];

function ChordDiagram({ chord, accent }: { chord: ChordName; accent: string }) {
  const v = CHORD_VOICINGS[chord];
  const w = 120;
  const h = 132;
  const left = 18;
  const top = 26;
  const gapX = (w - left * 2) / 5;
  const gapY = (h - top - 12) / 4;
  return (
    <svg className="chord-diagram" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-label={`${chord} chord diagram`}>
      <rect x={left - 2} y={top - 4} width={w - left * 2 + 4} height={5} rx={2} fill="rgba(255,255,255,0.85)" />
      {Array.from({ length: 5 }).map((_, i) => (
        <line key={`f${i}`} x1={left} x2={w - left} y1={top + i * gapY} y2={top + i * gapY} stroke="rgba(255,255,255,0.28)" strokeWidth={1.2} />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <line key={`s${i}`} x1={left + i * gapX} x2={left + i * gapX} y1={top} y2={top + 4 * gapY} stroke="rgba(255,255,255,0.5)" strokeWidth={1.2 + (5 - i) * 0.25} />
      ))}
      {v.map((fret, i) => {
        const x = left + i * gapX;
        if (fret === null) return <text key={i} x={x} y={top - 10} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.45)">×</text>;
        if (fret === 0) return <circle key={i} cx={x} cy={top - 13} r={4} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={1.4} />;
        return <circle key={i} cx={x} cy={top + (fret - 0.5) * gapY} r={6.5} fill={accent} />;
      })}
    </svg>
  );
}

function GestureCompass({ current, accent }: { current: ChordName; accent: string }) {
  return (
    <div className="compass">
      <div className="compass__center">
        <span className="compass__ctrl" />
      </div>
      {GESTURES.map((g) => {
        const rad = (g.angle * Math.PI) / 180;
        const x = 50 + Math.cos(rad) * 34 * g.r;
        const y = 50 - Math.sin(rad) * 30 * g.r;
        const on = g.chord === current;
        return (
          <div key={g.chord} className={`compass__item ${on ? 'compass__item--on' : ''}`} style={{ left: `${x}%`, top: `${y}%`, '--accent': accent } as React.CSSProperties}>
            <span className="compass__chord">{g.chord}</span>
            <span className="compass__hint">{g.hint}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Guitar({ definition }: ActivityComponentProps) {
  const session = useActivitySession(definition);
  const flow = useActivityFlow(definition, session);
  useAudioUnlock();
  const guitar = useMemo(() => new GuitarInstrument(audioEngine), []);
  const api = useRef(createGuitarSceneApi());
  const running = flow.phase === 'running';
  const [chord, setChord] = useState<ChordName>('C');
  const [chordKey, setChordKey] = useState(0);
  const [last, setLast] = useState<{ dir: StrumDirection; v: number; at: number } | null>(null);
  const [count, setCount] = useState(0);
  const [muted, setMuted] = useState(0);

  useEffect(() => {
    if (running) {
      void audioEngine.unlock().then(() => {
        if (audioEngine.ready) guitar.prepare();
      });
    }
  }, [running, guitar]);

  const selectChord = useCallback((c: ChordName) => {
    api.current.chord = c;
    setChord((prev) => {
      if (prev !== c) setChordKey((k) => k + 1);
      return c;
    });
  }, []);

  useActions((e) => {
    if (!running) return;
    switch (e.action) {
      case 'SELECT_ZONE': {
        if (e.phase === 'end') return;
        if (e.role && e.role !== 'fret') return;
        const z = e.meta?.zone;
        if (isChord(z)) selectChord(z);
        return;
      }
      case 'STRUM_DOWN':
      case 'STRUM_UP': {
        if (e.phase !== 'trigger') return;
        if (e.role && e.role !== 'strum') return;
        const dir: StrumDirection = e.action === 'STRUM_DOWN' ? 'down' : 'up';
        const v = Math.max(0.05, e.intensity);
        const ev = guitar.strum(api.current.chord, dir, v);
        api.current.strums.push({ direction: dir, velocity: v, times: ev.times, consumed: false });
        if (api.current.strums.length > 12) api.current.strums.splice(0, api.current.strums.length - 12);
        setLast({ dir, v, at: performance.now() });
        setCount((c) => c + 1);
        return;
      }
      case 'MUTE':
        if (e.phase === 'trigger') {
          guitar.mute();
          api.current.muteAt = performance.now();
          setMuted(performance.now());
        }
        return;
      default:
        return;
    }
  });

  useEffect(() => {
    if (flow.phase === 'intro') {
      setCount(0);
      setLast(null);
    }
  }, [flow.phase]);

  const strumFlash = last && performance.now() - last.at < 220;
  const muteFlash = performance.now() - muted < 300;

  return (
    <ActivityChrome
      def={definition}
      session={session}
      flow={flow}
      intro={
        <div className="guitar-intro">
          <GestureCompass current={chord} accent={definition.accent} />
          <p className="faint" style={{ fontSize: 13, marginTop: 10 }}>
            Testing: <Kbd>1</Kbd>–<Kbd>6</Kbd> chords · <Kbd>Q</Kbd>/<Kbd>↓</Kbd> strum down · <Kbd>E</Kbd>/<Kbd>↑</Kbd> strum up · <Kbd>M</Kbd> mute
          </p>
        </div>
      }
      hudTop={
        <div className="guitar-stats glass">
          <div className="hud-label">Strums</div>
          <div className="guitar-stat tabular">{count}</div>
        </div>
      }
      hudBottom={
        <>
          <div className="chord-panel glass" style={{ '--accent': definition.accent } as React.CSSProperties}>
            <div className="chord-panel__label hud-label">Chord</div>
            <div key={chordKey} className="chord-panel__name">
              {chord}
            </div>
            <div className="chord-panel__row">
              {CHORD_NAMES.map((c) => (
                <button key={c} className={`chord-chip ${c === chord ? 'chord-chip--on' : ''}`} onClick={() => selectChord(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="strum-panel glass" style={{ '--accent': definition.accent } as React.CSSProperties}>
            <ChordDiagram chord={chord} accent={definition.accent} />
            <div className="strum-panel__side">
              <div className={`strum-arrow ${strumFlash ? `strum-arrow--${last!.dir}` : ''} ${muteFlash ? 'strum-arrow--mute' : ''}`}>
                {muteFlash ? 'MUTE' : last ? (last.dir === 'down' ? '↓' : '↑') : '·'}
              </div>
              <div className="hud-label" style={{ marginTop: 6 }}>
                {last ? (last.dir === 'down' ? 'Down strum' : 'Up strum') : 'Swing to strum'}
              </div>
              <div className="strum-meter">
                <div className="strum-meter__fill" style={{ width: `${Math.round((last?.v ?? 0) * 100)}%` }} />
              </div>
            </div>
          </div>
        </>
      }
    >
      <GuitarScene api={api} strumController={session.roles.strum ?? null} />
    </ActivityChrome>
  );
}
