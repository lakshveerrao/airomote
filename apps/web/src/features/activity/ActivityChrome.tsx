import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityDefinition, ActionEvent } from '@aero/activity-engine';
import type { ControllerId } from '@aero/motion-core';
import { Button, Icon, Overlay, Segmented, StatusDot } from '@/ui';
import { useControllerSlots } from '@/store/controllers';
import { useSettings } from '@/store/settings';
import { useActions, type UseActivitySessionResult } from '@/core/session';
import { controllerManager } from '@/core/runtime';
import { categoryMeta } from '@/activities';
import { ControllerGate } from '@/features/setup/ControllerGate';
import './activity.css';

/**
 * Shared frame for every full-screen activity:
 *   intro (setup steps + controller check) → running ⇄ paused → finished
 * The activity renders its 3D stage as children and its own HUD content via slots.
 */
export type ActivityPhase = 'intro' | 'running' | 'paused' | 'finished';

export function useActivityFlow(def: ActivityDefinition, session: UseActivitySessionResult) {
  const [phase, setPhase] = useState<ActivityPhase>('intro');
  const start = useCallback(() => {
    session.session.recentre();
    setPhase('running');
  }, [session]);
  const pause = useCallback(() => setPhase((p) => (p === 'running' ? 'paused' : p)), []);
  const resume = useCallback(() => setPhase((p) => (p === 'paused' ? 'running' : p)), []);
  const finish = useCallback(() => setPhase('finished'), []);
  const restart = useCallback(() => setPhase('intro'), []);
  const togglePause = useCallback(() => setPhase((p) => (p === 'running' ? 'paused' : p === 'paused' ? 'running' : p)), []);
  useActions((e: ActionEvent) => {
    if (e.action === 'PAUSE' && e.phase === 'trigger') togglePause();
  });
  // Auto-pause when a required controller drops mid-session.
  const slots = useControllerSlots();
  useEffect(() => {
    if (phase !== 'running') return;
    const required = def.roles.filter((r) => r.required).map((r) => session.roles[r.id]);
    const anyMotion = required.some((id) => id !== null);
    if (anyMotion && required.some((id) => id !== null && slots[id!].transportState !== 'connected')) pause();
  }, [slots, phase, def, session.roles, pause]);
  return { phase, start, pause, resume, finish, restart, togglePause, setPhase };
}

export function ActivityChrome({
  def,
  session,
  flow,
  children,
  hudTop,
  hudBottom,
  intro,
  summary,
  onRestart,
  allowKeyboardOnly = true,
}: {
  def: ActivityDefinition;
  session: UseActivitySessionResult;
  flow: ReturnType<typeof useActivityFlow>;
  /** The stage (Canvas) — always mounted so it keeps rendering behind overlays. */
  children: ReactNode;
  hudTop?: ReactNode;
  hudBottom?: ReactNode;
  /** Extra intro content (preset picker etc.). */
  intro?: ReactNode;
  /** Finished-state content. */
  summary?: ReactNode;
  onRestart?: () => void;
  /** Let the user start with keyboard/gamepad only (no controller). */
  allowKeyboardOnly?: boolean;
}) {
  const navigate = useNavigate();
  const meta = categoryMeta[def.category];
  const { phase } = flow;
  const settings = useSettings();
  const backTo = meta.path;
  const [introStep, setIntroStep] = useState(0);
  const steps = def.setupSteps;

  useEffect(() => {
    if (phase === 'intro') setIntroStep(0);
  }, [phase]);

  const canStart = session.ready || (allowKeyboardOnly && settings.keyboardFallback && session.connected.length === 0);

  return (
    <div className="activity" style={{ '--activity-accent': def.accent } as React.CSSProperties}>
      <div className="activity-stage">{children}</div>

      <div className="hud">
        <div className="hud-top">
          <div className="row" style={{ gap: 10 }}>
            <button className="hud-btn" onClick={() => navigate(backTo)} aria-label={`Back to ${meta.label}`}>
              <Icon.Back size={20} />
            </button>
            <div className="hud-title">
              <span className="hud-title__eyebrow" style={{ color: def.accent }}>
                {meta.label}
              </span>
              <span className="hud-title__name">{def.name}</span>
            </div>
            <RoleStatus def={def} roles={session.roles} />
          </div>
          <div className="row" style={{ gap: 10 }}>
            {hudTop}
            {phase === 'running' && (
              <button className="hud-btn" onClick={flow.pause} aria-label="Pause">
                <Icon.Pause size={20} />
              </button>
            )}
          </div>
        </div>
        <div className="hud-bottom">{phase === 'running' && hudBottom}</div>
      </div>

      {phase === 'intro' && (
        <Overlay>
          <div className="intro">
            <div className="intro__eyebrow" style={{ color: def.accent }}>
              {meta.label}
            </div>
            <h2 className="intro__title">{def.name}</h2>
            <p className="intro__desc dim">{def.description}</p>
            {steps.length > 0 && (
              <div className="intro__steps">
                <div className="intro__step-illustration">
                  <StepIllustration kind={steps[introStep]?.illustration} accent={def.accent} />
                </div>
                <div className="intro__step-copy">
                  <div className="intro__step-count">
                    Step {introStep + 1} of {steps.length}
                  </div>
                  <h3>{steps[introStep]?.title}</h3>
                  <p className="dim">{steps[introStep]?.body}</p>
                </div>
                <div className="intro__dots">
                  {steps.map((_, i) => (
                    <button key={i} className={`intro__dot ${i === introStep ? 'intro__dot--on' : ''}`} onClick={() => setIntroStep(i)} aria-label={`Step ${i + 1}`} />
                  ))}
                </div>
              </div>
            )}
            {intro}
            <ControllerGate def={def} session={session} />
            <div className="intro__actions">
              {introStep < steps.length - 1 ? (
                <>
                  <Button variant="ghost" onClick={() => setIntroStep(steps.length - 1)}>
                    Skip
                  </Button>
                  <Button variant="primary" size="lg" onClick={() => setIntroStep((s) => s + 1)}>
                    Next <Icon.Chevron size={18} />
                  </Button>
                </>
              ) : (
                <Button variant="accent" accent={def.accent} size="lg" onClick={flow.start} disabled={!canStart}>
                  <Icon.Play size={18} /> Start
                </Button>
              )}
            </div>
            {!session.ready && allowKeyboardOnly && settings.keyboardFallback && session.connected.length === 0 && (
              <p className="faint" style={{ marginTop: 14, fontSize: 13 }}>
                No controller connected — you can start with the keyboard for testing.
              </p>
            )}
          </div>
        </Overlay>
      )}

      {phase === 'paused' && (
        <Overlay onEscape={flow.resume}>
          <div className="intro__eyebrow" style={{ color: def.accent }}>
            Paused
          </div>
          <h2 style={{ marginBottom: 24 }}>{def.name}</h2>
          <div className="stack" style={{ alignItems: 'stretch', gap: 10 }}>
            <Button variant="primary" size="lg" onClick={flow.resume}>
              <Icon.Play size={18} /> Resume
            </Button>
            <Button
              onClick={() => {
                onRestart?.();
                flow.restart();
              }}
            >
              <Icon.Restart size={18} /> Restart
            </Button>
            <Button variant="ghost" onClick={() => session.session.recentre()}>
              Re-centre controllers
            </Button>
            <Button variant="ghost" onClick={() => navigate(backTo)}>
              Exit to {meta.label}
            </Button>
          </div>
        </Overlay>
      )}

      {phase === 'finished' && (
        <Overlay>
          <div className="intro__eyebrow" style={{ color: def.accent }}>
            Finished
          </div>
          <h2 style={{ marginBottom: 20 }}>{def.name}</h2>
          {summary}
          <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 24 }}>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                onRestart?.();
                flow.restart();
              }}
            >
              <Icon.Restart size={18} /> Again
            </Button>
            <Button size="lg" onClick={() => navigate(backTo)}>
              Done
            </Button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function RoleStatus({ def, roles }: { def: ActivityDefinition; roles: Record<string, ControllerId | null> }) {
  const slots = useControllerSlots();
  const names = useSettings((s) => s.controllerNames);
  const items = useMemo(() => def.roles.map((r) => ({ role: r, id: roles[r.id] })), [def, roles]);
  return (
    <div className="hud-roles">
      {items.map(({ role, id }) => {
        const slot = id ? slots[id] : null;
        const on = slot?.transportState === 'connected';
        return (
          <span key={role.id} className="hud-role" title={id ? `${names[id]} → ${role.label}` : `${role.label}: no controller`}>
            <StatusDot state={on ? 'on' : 'off'} />
            <span>{role.label}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Minimal line illustrations for setup steps (no external assets). */
export function StepIllustration({ kind, accent }: { kind?: string; accent: string }) {
  const stroke = accent;
  const common = { fill: 'none', stroke, strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'hold-flat':
      return (
        <svg viewBox="0 0 200 120" width="200" height="120">
          <rect x="40" y="48" width="120" height="24" rx="12" {...common} />
          <path d="M30 60c-10 0-16 6-16 14M170 60c10 0 16 6 16 14" {...common} opacity={0.5} />
          <path d="M100 30v-10M92 26l8-8 8 8" {...common} opacity={0.6} />
        </svg>
      );
    case 'hold-upright':
      return (
        <svg viewBox="0 0 200 120" width="200" height="120">
          <rect x="88" y="14" width="24" height="92" rx="12" {...common} />
          <circle cx="100" cy="30" r="3" fill={stroke} />
          <path d="M70 70c-12 6-16 20-10 34M130 70c12 6 16 20 10 34" {...common} opacity={0.5} />
        </svg>
      );
    case 'two-hands':
      return (
        <svg viewBox="0 0 200 120" width="200" height="120">
          <rect x="30" y="20" width="20" height="80" rx="10" transform="rotate(-20 40 60)" {...common} />
          <rect x="150" y="20" width="20" height="80" rx="10" transform="rotate(20 160 60)" {...common} />
          <path d="M60 104h80" {...common} opacity={0.35} />
        </svg>
      );
    case 'chest':
      return (
        <svg viewBox="0 0 200 120" width="200" height="120">
          <circle cx="100" cy="22" r="12" {...common} />
          <path d="M70 110V64c0-16 12-28 30-28s30 12 30 28v46" {...common} />
          <rect x="90" y="48" width="20" height="40" rx="10" {...common} strokeWidth={4} />
        </svg>
      );
    case 'strap-arm':
      return (
        <svg viewBox="0 0 200 120" width="200" height="120">
          <circle cx="60" cy="22" r="12" {...common} />
          <path d="M40 110V64c0-14 8-24 20-28M80 40c10 4 16 12 20 22l18 40" {...common} />
          <rect x="88" y="52" width="16" height="34" rx="8" transform="rotate(-25 96 69)" {...common} strokeWidth={4} />
        </svg>
      );
    case 'pocket':
      return (
        <svg viewBox="0 0 200 120" width="200" height="120">
          <path d="M60 20h80l-8 90H68z" {...common} />
          <rect x="90" y="40" width="20" height="46" rx="10" {...common} strokeWidth={4} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 200 120" width="200" height="120">
          <rect x="88" y="14" width="24" height="92" rx="12" {...common} />
          <path d="M60 60c-14-10-14-30 0-40M140 60c14-10 14-30 0-40" {...common} opacity={0.5} />
        </svg>
      );
  }
}

/** Preset + sensitivity picker for intro overlays. */
export function PresetPicker({ def, session }: { def: ActivityDefinition; session: UseActivitySessionResult }) {
  if (def.presets.length <= 1) return null;
  return (
    <div className="preset-picker">
      <div className="preset-picker__label">Controls</div>
      <div className="preset-picker__list">
        {def.presets.map((p) => (
          <button key={p.id} className={`preset ${p.id === session.preset.id ? 'preset--on' : ''}`} onClick={() => session.setPreset(p.id)}>
            <span className="preset__name">{p.name}</span>
            <span className="preset__desc">{p.description}</span>
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
        <span className="preset-picker__label">Sensitivity</span>
        <Segmented
          value={session.sensitivity}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High' },
          ]}
          onChange={session.setSensitivity}
        />
      </div>
    </div>
  );
}

export { controllerManager };
