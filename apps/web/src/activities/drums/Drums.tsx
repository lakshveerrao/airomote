import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionEvent } from '@aero/activity-engine';
import { DRUM_LABELS, DrumKit, type DrumId } from '@aero/music-engine';
import type { ActivityComponentProps } from '@/activities';
import { useActivitySession, useActions } from '@/core/session';
import { ActivityChrome, useActivityFlow } from '@/features/activity/ActivityChrome';
import { audioEngine, useAudioUnlock } from '@/features/music/audio';
import { Kbd } from '@/ui';
import { DrumScene, STICK_COLORS, createDrumSceneApi, type StickRole } from './DrumScene';
import './drums.css';

const ROLES: StickRole[] = ['stick1', 'stick2'];
const isDrum = (z: unknown): z is DrumId => typeof z === 'string' && z in DRUM_LABELS;

interface StickHud {
  target: DrumId | null;
  lastHit: DrumId | null;
  velocity: number;
  hits: number;
  flashAt: number;
}

export default function Drums({ definition }: ActivityComponentProps) {
  const session = useActivitySession(definition);
  const flow = useActivityFlow(definition, session);
  useAudioUnlock();
  const kit = useMemo(() => new DrumKit(audioEngine), []);
  const api = useRef(createDrumSceneApi());
  const running = flow.phase === 'running';

  const [hud, setHud] = useState<Record<StickRole, StickHud>>({
    stick1: { target: 'snare', lastHit: null, velocity: 0, hits: 0, flashAt: 0 },
    stick2: { target: 'tom1', lastHit: null, velocity: 0, hits: 0, flashAt: 0 },
  });
  const hitTimes = useRef<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const totalHits = hud.stick1.hits + hud.stick2.hits;

  // unlock audio as soon as we start (Start click is a user gesture)
  useEffect(() => {
    if (running) void audioEngine.unlock();
  }, [running]);

  const roleOf = useCallback(
    (e: ActionEvent): StickRole => {
      if (e.role === 'stick1' || e.role === 'stick2') return e.role;
      if (e.controllerId) {
        const r = ROLES.find((role) => session.roles[role] === e.controllerId);
        if (r) return r;
      }
      return 'stick1';
    },
    [session.roles],
  );

  const hit = useCallback(
    (drum: DrumId, intensity: number, role: StickRole) => {
      kit.play(drum, intensity);
      api.current.hits.push({ drum, intensity, role, t: performance.now() });
      api.current.stickDip[role] = 0.5 + intensity * 0.6;
      const now = performance.now();
      hitTimes.current.push(now);
      if (hitTimes.current.length > 8) hitTimes.current.shift();
      if (hitTimes.current.length >= 4) {
        const ts = hitTimes.current;
        const avg = (ts[ts.length - 1] - ts[0]) / (ts.length - 1);
        if (avg > 0) setBpm(Math.round(60000 / avg));
      }
      setHud((h) => ({ ...h, [role]: { ...h[role], lastHit: drum, velocity: intensity, hits: h[role].hits + 1, flashAt: now } }));
    },
    [kit],
  );

  useActions((e) => {
    if (!running) return;
    switch (e.action) {
      case 'SELECT_ZONE': {
        const zone = e.meta?.zone;
        if (!isDrum(zone) || e.phase === 'end') return;
        const role = roleOf(e);
        api.current.target[role] = zone;
        setHud((h) => (h[role].target === zone ? h : { ...h, [role]: { ...h[role], target: zone } }));
        return;
      }
      case 'STRIKE': {
        if (e.phase !== 'trigger') return;
        const role = roleOf(e);
        const drum = api.current.target[role] ?? 'snare';
        hit(drum, e.intensity, role);
        return;
      }
      case 'PUNCH':
        if (e.phase === 'trigger') hit('kick', Math.max(0.5, e.intensity), roleOf(e));
        return;
      default:
        return;
    }
  });

  // reset per session
  useEffect(() => {
    if (flow.phase === 'intro') {
      hitTimes.current = [];
      setBpm(null);
      setHud({
        stick1: { target: 'snare', lastHit: null, velocity: 0, hits: 0, flashAt: 0 },
        stick2: { target: 'tom1', lastHit: null, velocity: 0, hits: 0, flashAt: 0 },
      });
      api.current.target = { stick1: 'snare', stick2: 'tom1' };
    }
  }, [flow.phase]);

  const sticks = { stick1: session.roles.stick1 ?? null, stick2: session.roles.stick2 ?? null };
  const stick2Active = sticks.stick2 !== null || true; // keyboard can drive stick 2 too

  return (
    <ActivityChrome
      def={definition}
      session={session}
      flow={flow}
      intro={
        <p className="drums-hint faint">
          Testing without controllers: <Kbd>1</Kbd>–<Kbd>7</Kbd> aim · <Kbd>Space</Kbd> hit · <Kbd>K</Kbd> kick · <Kbd>J</Kbd>/<Kbd>L</Kbd>/<Kbd>I</Kbd> +{' '}
          <Kbd>Enter</Kbd> for stick 2
        </p>
      }
      hudTop={
        <div className="drums-stats glass">
          <div>
            <div className="hud-label">Hits</div>
            <div className="drums-stat tabular">{totalHits}</div>
          </div>
          <div>
            <div className="hud-label">Tempo</div>
            <div className="drums-stat tabular">{bpm ?? '–'}</div>
          </div>
        </div>
      }
      hudBottom={
        <div className="drums-sticks">
          {ROLES.map((role) => {
            const h = hud[role];
            const flash = performance.now() - h.flashAt < 160;
            const hidden = role === 'stick2' && !stick2Active;
            if (hidden) return null;
            return (
              <div key={role} className={`stick-card glass ${flash ? 'stick-card--flash' : ''}`} style={{ '--stick': STICK_COLORS[role] } as React.CSSProperties}>
                <div className="stick-card__head">
                  <span className="stick-card__dot" />
                  <span className="stick-card__name">{role === 'stick1' ? 'Stick 1' : 'Stick 2'}</span>
                  <span className="stick-card__hits tabular">{h.hits}</span>
                </div>
                <div className="stick-card__target">{h.target ? DRUM_LABELS[h.target] : '—'}</div>
                <div className="stick-card__sub">
                  {h.lastHit ? `Last hit ${DRUM_LABELS[h.lastHit]}` : 'Aiming'}
                </div>
                <div className="stick-card__meter">
                  <div className="stick-card__meter-fill" style={{ width: `${Math.round(h.velocity * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      }
    >
      <DrumScene api={api} sticks={sticks} />
    </ActivityChrome>
  );
}
