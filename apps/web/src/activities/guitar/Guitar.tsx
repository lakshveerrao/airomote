import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHORD_NAMES,
  CHORD_VOICINGS,
  Guitar as GuitarInstrument,
  fretToMidi,
  midiToName,
  type ChordName,
  type StrumDirection,
} from '@aero/music-engine';
import type { ActivityComponentProps } from '@/activities';
import { useActivitySession, useActions } from '@/core/session';
import { ActivityChrome, useActivityFlow } from '@/features/activity/ActivityChrome';
import { audioEngine, useAudioUnlock } from '@/features/music/audio';
import { Kbd } from '@/ui';
import { GuitarScene } from './GuitarScene';
import { createGuitarSceneApi, type GuitarSceneApi } from './sceneApi';
import { LeadTracker } from './leadTracker';
import { NECK_MAX_FRET, STRUM_FREEZE_MS, TRACK_HYSTERESIS, TRACK_TAU_MS } from './definition';
import { GUITAR_MODELS, loadGuitarModel, saveGuitarModel, type GuitarModelId } from './guitars';
import './guitar.css';

const isChord = (z: unknown): z is ChordName => typeof z === 'string' && (CHORD_NAMES as string[]).includes(z);

const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];

/** Keyboard nudges auto-repeat: first repeat after this long, then every REPEAT_MS. */
const REPEAT_DELAY_MS = 300;
const REPEAT_MS = 110;

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

/**
 * Live neck for lead mode: six strings across, frets down, a dot on the tracked note and a
 * ghost dot showing where the (unlatched) hand actually is.
 */
function NeckDiagram({ lead, fretPos, stringPos, accent }: { lead: { string: number; fret: number }; fretPos: number; stringPos: number; accent: string }) {
  const w = 208;
  const h = 132;
  const left = 16;
  const top = 20;
  const gapX = (w - left * 2) / 5;
  const span = h - top - 12;
  const y = (fret: number) => top + (Math.max(0, fret) / NECK_MAX_FRET) * span;
  const ghostX = left + Math.max(0, Math.min(5, stringPos)) * gapX;
  const ghostY = top + Math.max(0, Math.min(1, fretPos)) * span;
  return (
    <svg className="chord-diagram" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-label={`String ${STRING_LABELS[lead.string]}, fret ${lead.fret}`}>
      <rect x={left - 2} y={top - 4} width={w - left * 2 + 4} height={5} rx={2} fill="rgba(255,255,255,0.85)" />
      {[0, 3, 5, 7, 9, 12].map((f) => (
        <line key={`f${f}`} x1={left} x2={w - left} y1={y(f)} y2={y(f)} stroke="rgba(255,255,255,0.22)" strokeWidth={1.1} />
      ))}
      {[3, 5, 7, 9].map((f) => (
        <circle key={`m${f}`} cx={w / 2} cy={y(f) - span / (NECK_MAX_FRET * 2)} r={2.2} fill="rgba(255,255,255,0.22)" />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <line key={`s${i}`} x1={left + i * gapX} x2={left + i * gapX} y1={top} y2={top + span} stroke={i === lead.string ? accent : 'rgba(255,255,255,0.45)'} strokeWidth={1.2 + (5 - i) * 0.25} />
      ))}
      <circle cx={ghostX} cy={ghostY} r={7} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.2} />
      <circle cx={left + lead.string * gapX} cy={y(lead.fret)} r={6.5} fill={lead.fret === 0 ? 'none' : accent} stroke={accent} strokeWidth={1.6} />
      {STRING_LABELS.map((s, i) => (
        <text key={s + i} x={left + i * gapX} y={h - 2} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.45)">
          {s}
        </text>
      ))}
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
  const api = useRef<GuitarSceneApi>(createGuitarSceneApi());
  const running = flow.phase === 'running';
  const lead = session.preset.id === 'natural';
  const tracker = useRef<LeadTracker>(
    new LeadTracker({ maxFret: NECK_MAX_FRET, strings: 6, tauMs: TRACK_TAU_MS, hysteresis: TRACK_HYSTERESIS, freezeMs: STRUM_FREEZE_MS }),
  );
  /** Held keyboard nudges: step per axis plus when the next auto-repeat is due. */
  const repeat = useRef({ fret: 0, string: 0, fretAt: 0, stringAt: 0 });

  const [chord, setChord] = useState<ChordName>('C');
  const [chordKey, setChordKey] = useState(0);
  const [note, setNote] = useState({ string: 2, fret: 3 });
  const [last, setLast] = useState<{ dir: StrumDirection; v: number; at: number } | null>(null);
  const [count, setCount] = useState(0);
  const [muted, setMuted] = useState(0);
  const [model, setModel] = useState<GuitarModelId>(() => loadGuitarModel());
  const pickModel = useCallback((id: GuitarModelId) => {
    setModel(id);
    saveGuitarModel(id);
  }, []);

  useEffect(() => {
    if (running) {
      void audioEngine.unlock().then(() => {
        if (audioEngine.ready) guitar.prepare();
      });
    }
  }, [running, guitar]);

  // Mode switch: settle the tracker and tell the scene which language it is speaking.
  useEffect(() => {
    tracker.current.settle(performance.now());
    api.current.mode = lead ? 'lead' : 'chords';
    api.current.lead = lead ? { string: tracker.current.string, fret: tracker.current.fret } : null;
  }, [lead]);

  /**
   * Render-loop tick. All fret smoothing happens here on wall-clock time, so a controller
   * sending 110 packets/s and one sending 30/s converge identically — the action events only
   * move the target.
   */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const t = tracker.current;
      const r = repeat.current;
      if (r.fret && now >= r.fretAt) {
        t.nudgeFret(r.fret);
        r.fretAt = now + REPEAT_MS;
      }
      if (r.string && now >= r.stringAt) {
        t.nudgeString(r.string);
        r.stringAt = now + REPEAT_MS;
      }
      t.update(now);
      const a = api.current;
      a.fretPos = t.fretPos;
      a.stringPos = t.stringPos;
      if (a.mode === 'lead') {
        a.lead = { string: t.string, fret: t.fret };
        setNote((prev) => (prev.string === t.string && prev.fret === t.fret ? prev : { string: t.string, fret: t.fret }));
      } else {
        a.lead = null;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const selectChord = useCallback((c: ChordName) => {
    api.current.chord = c;
    setChord((prev) => {
      if (prev !== c) setChordKey((k) => k + 1);
      return c;
    });
  }, []);

  useActions((e) => {
    const t = tracker.current;
    switch (e.action) {
      case 'FRET_POSITION':
      case 'STRING_SELECT': {
        if (e.role && e.role !== 'fret') return;
        const isFret = e.action === 'FRET_POSITION';
        const step = Number(e.meta?.step ?? 0);
        if (step) {
          // keyboard: hold to slide, release to stop
          const r = repeat.current;
          const now = performance.now();
          if (e.phase === 'end') {
            if (isFret) r.fret = 0;
            else r.string = 0;
            return;
          }
          if (e.phase !== 'start') return;
          if (isFret) {
            t.nudgeFret(step);
            r.fret = step;
            r.fretAt = now + REPEAT_DELAY_MS;
          } else {
            t.nudgeString(step);
            r.string = step;
            r.stringAt = now + REPEAT_DELAY_MS;
          }
          return;
        }
        // motion: a continuous −1..1 axis relative to the calibrated neutral
        const v = e.phase === 'end' ? 0 : e.value;
        if (isFret) t.setFretAxis(v);
        else t.setStringAxis(v);
        return;
      }
      case 'SELECT_ZONE': {
        if (e.phase === 'end') return;
        if (e.role && e.role !== 'fret') return;
        const z = e.meta?.zone;
        if (isChord(z)) selectChord(z);
        return;
      }
      case 'STRUM_DOWN':
      case 'STRUM_UP': {
        if (!running) return;
        if (e.phase !== 'trigger') return;
        if (e.role && e.role !== 'strum') return;
        const dir: StrumDirection = e.action === 'STRUM_DOWN' ? 'down' : 'up';
        const v = Math.max(0.05, e.intensity);
        const now = performance.now();
        let times: Array<number | null>;
        if (api.current.mode === 'lead') {
          // sound exactly the tracked note: a "strum" of one non-null string
          const frets: Array<number | null> = [null, null, null, null, null, null];
          frets[t.string] = t.fret;
          times = guitar.strumFrets(frets, dir, v).times;
        } else {
          times = guitar.strum(api.current.chord, dir, v).times;
        }
        // the stroke moves the whole body — freeze the fret hand so the note does not lurch
        t.strummed(now);
        api.current.strums.push({ direction: dir, velocity: v, times, at: now, consumed: false });
        if (api.current.strums.length > 12) api.current.strums.splice(0, api.current.strums.length - 12);
        setLast({ dir, v, at: now });
        setCount((c) => c + 1);
        return;
      }
      case 'MUTE':
        if (!running) return;
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
  const noteName = midiToName(fretToMidi(note.string, note.fret));

  return (
    <ActivityChrome
      def={definition}
      session={session}
      flow={flow}
      intro={
        <div className="guitar-intro">
          <div className="guitar-picker" style={{ '--accent': definition.accent } as React.CSSProperties}>
            <div className="hud-label">Playing style</div>
            <div className="mode-row" role="radiogroup" aria-label="Playing style">
              {definition.presets.map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={p.id === session.preset.id}
                  className={`mode-card ${p.id === session.preset.id ? 'mode-card--on' : ''}`}
                  onClick={() => session.setPreset(p.id)}
                >
                  <span className="mode-card__name">{p.name}</span>
                  <span className="mode-card__sub">{p.id === 'natural' ? 'Slide the neck, play single notes' : 'Six chords from six tilts'}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="guitar-picker" style={{ '--accent': definition.accent } as React.CSSProperties}>
            <div className="hud-label">Your guitar</div>
            <div className="guitar-picker__row" role="radiogroup" aria-label="Guitar">
              {GUITAR_MODELS.map((m) => (
                <button key={m.id} role="radio" aria-checked={m.id === model} className={`guitar-card ${m.id === model ? 'guitar-card--on' : ''}`} onClick={() => pickModel(m.id)}>
                  <span className="guitar-card__swatch" style={{ background: m.swatch }} />
                  <span className="guitar-card__name">{m.name}</span>
                  <span className="guitar-card__sub">{m.subtitle}</span>
                </button>
              ))}
            </div>
          </div>
          {lead ? (
            <p className="faint" style={{ fontSize: 13, marginTop: 10, textAlign: 'center' }}>
              Fret hand: tip forward toward the nut, back up the neck; roll your wrist to change string. Strum hand sounds the note.
            </p>
          ) : (
            <GestureCompass current={chord} accent={definition.accent} />
          )}
          <p className="faint" style={{ fontSize: 13, marginTop: 10 }}>
            Testing:{' '}
            {lead ? (
              <>
                <Kbd>A</Kbd>/<Kbd>D</Kbd> (or <Kbd>←</Kbd>/<Kbd>→</Kbd>) slide the neck · <Kbd>W</Kbd>/<Kbd>S</Kbd> change string
              </>
            ) : (
              <>
                <Kbd>1</Kbd>–<Kbd>6</Kbd> chords
              </>
            )}{' '}
            · <Kbd>Q</Kbd>/<Kbd>↓</Kbd> strum down · <Kbd>E</Kbd>/<Kbd>↑</Kbd> strum up · <Kbd>M</Kbd> mute
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
          {lead ? (
            <div className="chord-panel glass" style={{ '--accent': definition.accent } as React.CSSProperties}>
              <div className="chord-panel__label hud-label">Note</div>
              <div className="chord-panel__name">{noteName}</div>
              <div className="lead-readout">
                <span className="lead-readout__item">
                  <span className="hud-label">String</span>
                  <b className="tabular">{STRING_LABELS[note.string]}</b>
                </span>
                <span className="lead-readout__item">
                  <span className="hud-label">Fret</span>
                  <b className="tabular">{note.fret === 0 ? 'open' : note.fret}</b>
                </span>
              </div>
            </div>
          ) : (
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
          )}
          <div className="strum-panel glass" style={{ '--accent': definition.accent } as React.CSSProperties}>
            {lead ? (
              <NeckDiagram lead={note} fretPos={api.current.fretPos} stringPos={api.current.stringPos} accent={definition.accent} />
            ) : (
              <ChordDiagram chord={chord} accent={definition.accent} />
            )}
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
      <GuitarScene api={api} strumController={session.roles.strum ?? null} fretController={session.roles.fret ?? null} model={model} />
    </ActivityChrome>
  );
}
