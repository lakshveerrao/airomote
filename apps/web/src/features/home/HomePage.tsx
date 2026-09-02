import { Link } from 'react-router-dom';
import type { ControllerId } from '@aero/motion-core';
import { activityRegistry } from '@/core/runtime';
import { categoryMeta } from '@/activities';
import { useSettings } from '@/store/settings';
import { useControllerSlots } from '@/store/controllers';
import { Button, Icon, StatusDot } from '@/ui';
import './home.css';

const CATS = ['games', 'music', 'workout'] as const;
const CatIcon = { games: Icon.Games, music: Icon.Music, workout: Icon.Workout };

function slotLabel(slot: ReturnType<typeof useControllerSlots>[1]): { text: string; state: 'on' | 'off' | 'busy' | 'error' } {
  if (slot.transportState === 'error') return { text: 'Problem', state: 'error' };
  if (slot.transportState === 'connecting') return { text: 'Connecting…', state: 'busy' };
  if (slot.transportState === 'reconnecting') return { text: 'Reconnecting…', state: 'busy' };
  if (slot.transportState !== 'connected') return { text: 'Not connected', state: 'off' };
  if (slot.calibration === 'hold-still') return { text: 'Hold still', state: 'busy' };
  if (slot.calibration === 'calibrating') return { text: 'Calibrating', state: 'busy' };
  return { text: 'Connected', state: 'on' };
}

export default function HomePage() {
  const lastId = useSettings((s) => s.lastActivityId);
  const names = useSettings((s) => s.controllerNames);
  const slots = useControllerSlots();
  const last = lastId ? activityRegistry.get(lastId) : undefined;
  const anyConnected = ([1, 2] as ControllerId[]).some((id) => slots[id].transportState === 'connected');

  return (
    <div className="page home">
      <div className="home__hero enter">
        <h1>What do you want to do?</h1>
        <p>Pick up your controllers. Play, jam, or train.</p>
      </div>

      <div className="cat-grid">
        {CATS.map((c, i) => {
          const meta = categoryMeta[c];
          const I = CatIcon[c];
          const n = activityRegistry.byCategory(c).filter((d) => d.status === 'available').length;
          return (
            <Link key={c} to={meta.path} className={`cat-card enter enter-${i + 1}`} style={{ '--cat': meta.accent } as React.CSSProperties}>
              <span className="cat-card__orb" />
              <span className="cat-card__icon">
                <I size={26} />
              </span>
              <div>
                <div className="cat-card__title">{meta.label}</div>
                <div className="cat-card__blurb">{meta.blurb}</div>
                <div className="cat-card__count">
                  {n} ready to play <Icon.Chevron size={16} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="home__lower">
        {last && last.status === 'available' ? (
          <Link to={`${categoryMeta[last.category].path}/${last.id}`} className="continue-card enter enter-3" style={{ '--cc': last.accent } as React.CSSProperties}>
            <div>
              <div className="continue-card__eyebrow">Continue</div>
              <div className="continue-card__title">{last.name}</div>
              <div className="dim" style={{ marginTop: 4, fontSize: 14 }}>
                {last.tagline}
              </div>
            </div>
            <span className="continue-card__play">
              <Icon.Play size={22} />
            </span>
          </Link>
        ) : (
          <div className="continue-card enter enter-3" style={{ cursor: 'default' }}>
            <div>
              <div className="continue-card__eyebrow">Getting started</div>
              <div className="continue-card__title">Try Motion Kart first</div>
              <div className="dim" style={{ marginTop: 4, fontSize: 14 }}>
                Tilt one controller to steer. Two minutes to learn.
              </div>
            </div>
            <Link to="/games/motion-kart" className="btn btn--primary">
              <Icon.Play size={16} /> Play
            </Link>
          </div>
        )}

        <div className="status-strip enter enter-4">
          <div className="status-strip__items">
            {([1, 2] as ControllerId[]).map((id) => {
              const s = slots[id];
              const l = slotLabel(s);
              return (
                <div key={id} className="status-strip__item">
                  <StatusDot state={l.state} />
                  <span>{names[id]}</span>
                  <span className="state">{l.text}</span>
                  {s.transportState === 'connected' && s.battery != null && (
                    <span className="bat">
                      <Icon.Battery size={16} level={s.battery} /> {s.battery}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {anyConnected ? (
            <Link to="/settings" className="btn btn--ghost btn--sm">
              Manage
            </Link>
          ) : (
            <Link to="/setup" className="btn btn--sm">
              <Icon.Controller size={16} /> Set up controllers
            </Link>
          )}
        </div>
      </div>
      <Button style={{ display: 'none' }} aria-hidden />
    </div>
  );
}
