import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ControllerId } from '@aero/motion-core';
import { controllerManager, motionEngine } from '@/core/runtime';
import { transportSupport, type TransportKind } from '@/core/transport/types';
import { useControllerSlots } from '@/store/controllers';
import { useSettings } from '@/store/settings';
import { Button, Icon, StatusDot, Spinner } from '@/ui';
import { ControllerScene, CONTROLLER_COLORS } from './ControllerScene';
import './setup.css';

type Step = 'welcome' | 'on1' | 'connect1' | 'on2' | 'connect2' | 'calibrate' | 'track' | 'done';
const ORDER: Step[] = ['welcome', 'on1', 'connect1', 'on2', 'connect2', 'calibrate', 'track', 'done'];

function ControllerIllo({ id, on }: { id: ControllerId; on: boolean }) {
  return (
    <div className={`ctrl-illo ${on ? '' : 'ctrl-illo--off'}`} style={{ '--illo': CONTROLLER_COLORS[id] } as React.CSSProperties}>
    </div>
  );
}

function stateWord(slot: ReturnType<typeof useControllerSlots>[1]): { text: string; dot: 'on' | 'off' | 'busy' | 'error'; ok: boolean } {
  if (slot.transportState === 'error') return { text: 'Problem', dot: 'error', ok: false };
  if (slot.transportState === 'connecting') return { text: 'Connecting…', dot: 'busy', ok: false };
  if (slot.transportState === 'reconnecting') return { text: 'Reconnecting…', dot: 'busy', ok: false };
  if (slot.transportState !== 'connected') return { text: 'Not connected', dot: 'off', ok: false };
  if (slot.calibration === 'hold-still') return { text: 'Hold still', dot: 'busy', ok: false };
  if (slot.calibration === 'calibrating') return { text: 'Calibrating…', dot: 'busy', ok: false };
  if (slot.calibration === 'failed') return { text: 'Try again', dot: 'error', ok: false };
  if (slot.calibration === 'ready') return { text: 'Ready', dot: 'on', ok: true };
  return { text: 'Connecting…', dot: 'busy', ok: false };
}

export default function SetupPage() {
  const navigate = useNavigate();
  const settings = useSettings();
  const slots = useControllerSlots();
  const [step, setStep] = useState<Step>('welcome');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const support = useMemo(() => transportSupport(), []);
  const idx = ORDER.indexOf(step);
  const go = useCallback((s: Step) => {
    setError(null);
    setStep(s);
  }, []);
  const next = () => go(ORDER[Math.min(ORDER.length - 1, idx + 1)]);
  const back = () => go(ORDER[Math.max(0, idx - 1)]);

  const connected = ([1, 2] as ControllerId[]).filter((id) => slots[id].transportState === 'connected');
  const noRadio = !support.bluetooth.supported && !support.serial.supported;
  const showSim = settings.developerMode || noRadio;

  const connect = async (id: ControllerId, kind: TransportKind) => {
    setBusy(true);
    setError(null);
    try {
      await controllerManager.connect(id, kind);
    } catch (e) {
      const msg = (e as Error).message ?? 'Could not connect';
      if (!/cancel/i.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  };

  // Auto-advance after a successful connection on connect steps.
  // Depend on booleans, not the slots object: slot snapshots republish ~2 Hz and would reset the timer.
  const targetConnected =
    step === 'connect1' ? slots[1].transportState === 'connected' : step === 'connect2' ? slots[2].transportState === 'connected' : false;
  useEffect(() => {
    if (!targetConnected) return;
    const t = window.setTimeout(() => go(step === 'connect1' ? 'on2' : 'calibrate'), 700);
    return () => clearTimeout(t);
  }, [step, targetConnected, go]);

  // Calibration: advance once every connected controller is ready.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (step !== 'calibrate') return;
    setSlow(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(slowTimer);
  }, [step]);
  const allReady = connected.length > 0 && connected.every((id) => slots[id].calibration === 'ready');
  useEffect(() => {
    if (step !== 'calibrate' || !allReady) return;
    const t = window.setTimeout(() => go('track'), 900);
    return () => clearTimeout(t);
  }, [step, allReady, go]);

  // Tracking confirmation: each connected controller must move (>60 dps) briefly.
  const moved = useRef<Record<ControllerId, number>>({ 1: 0, 2: 0 });
  const [confirmed, setConfirmed] = useState<Record<ControllerId, boolean>>({ 1: false, 2: false });
  useEffect(() => {
    if (step !== 'track') return;
    moved.current = { 1: 0, 2: 0 };
    setConfirmed({ 1: false, 2: false });
    return motionEngine.on('state', (s) => {
      if (s.angularSpeed > 60) {
        moved.current[s.controllerId] += s.dt;
        if (moved.current[s.controllerId] > 0.25) setConfirmed((c) => (c[s.controllerId] ? c : { ...c, [s.controllerId]: true }));
      }
    });
  }, [step]);
  const allConfirmed = connected.length > 0 && connected.every((id) => confirmed[id]);

  const finish = () => {
    for (const id of [1, 2] as ControllerId[]) {
      const s = slots[id];
      if (s.transportState === 'connected' && (s.transportKind === 'bluetooth' || s.transportKind === 'serial')) {
        settings.rememberDevice(id, { kind: s.transportKind, id: s.transportId, name: s.transportName });
      }
    }
    settings.setSetupComplete(true);
    navigate('/', { replace: true });
  };

  const skipAll = () => {
    settings.setSetupComplete(true);
    navigate('/', { replace: true });
  };

  const connectButtons = (id: ControllerId) => (
    <>
      {support.bluetooth.supported && (
        <Button variant="primary" size="lg" onClick={() => connect(id, 'bluetooth')} disabled={busy}>
          {busy ? <Spinner /> : <Icon.Bluetooth />} Connect with Bluetooth
        </Button>
      )}
      {support.serial.supported && (
        <Button size="lg" onClick={() => connect(id, 'serial')} disabled={busy}>
          <Icon.Usb /> Connect with USB
        </Button>
      )}
      {showSim && (
        <Button size="lg" variant={noRadio ? 'primary' : 'ghost'} onClick={() => connect(id, 'simulator')} disabled={busy}>
          Use a simulated controller
        </Button>
      )}
    </>
  );

  return (
    <div className="setup">
      <div className="setup__top">
        <div className="setup__brand">
          <span className="setup__brand-mark" /> AiroMote
        </div>
        <div className="setup__dots" aria-label={`Step ${idx + 1} of ${ORDER.length}`}>
          {ORDER.map((s, i) => (
            <span key={s} className={`setup__dot ${i < idx ? 'setup__dot--done' : ''} ${i === idx ? 'setup__dot--on' : ''}`} />
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={skipAll}>
          Skip setup
        </Button>
      </div>

      <div className={`setup__body ${step === 'track' ? 'setup__body--wide' : ''}`}>
        {step === 'welcome' && (
          <div className="setup__step" key="welcome">
            <div className="setup__eyebrow">Welcome</div>
            <h1 className="setup__title">Two controllers.<br />Games, music, workouts.</h1>
            <p className="setup__lead">Let’s pair your controllers. It takes about a minute, and they calibrate themselves.</p>
            <div className="setup__visual">
              <div className="row" style={{ gap: 36 }}>
                <ControllerIllo id={1} on />
                <ControllerIllo id={2} on />
              </div>
            </div>
            <div className="setup__actions">
              <Button variant="primary" size="lg" onClick={next}>
                Get started <Icon.Chevron size={18} />
              </Button>
            </div>
          </div>
        )}

        {(step === 'on1' || step === 'on2') && (
          <div className="setup__step" key={step}>
            <div className="setup__eyebrow">Step {idx} of 6</div>
            <h1 className="setup__title">Turn on Controller {step === 'on1' ? 1 : 2}</h1>
            <p className="setup__lead">Hold the power button until the light pulses. Then place it on a flat surface.</p>
            <div className="setup__visual">
              <ControllerIllo id={step === 'on1' ? 1 : 2} on />
            </div>
            <div className="setup__actions">
              <Button variant="primary" size="lg" onClick={next}>
                It’s on <Icon.Chevron size={18} />
              </Button>
              {step === 'on2' && (
                <Button variant="ghost" size="lg" onClick={() => go('calibrate')}>
                  Skip — I only have one controller
                </Button>
              )}
            </div>
          </div>
        )}

        {(step === 'connect1' || step === 'connect2') && (
          <div className="setup__step" key={step}>
            <div className="setup__eyebrow">Step {idx} of 6</div>
            <h1 className="setup__title">Connect Controller {step === 'connect1' ? 1 : 2}</h1>
            <p className="setup__lead">
              {support.bluetooth.supported
                ? 'Choose the controller named “Aero-…” in the list that appears.'
                : support.serial.supported
                  ? 'Plug the controller in with a USB cable and pick it from the list.'
                  : 'This browser can’t talk to controllers directly. Use Chrome or Edge, or continue with a simulated controller.'}
            </p>
            <div className="setup__visual">
              <ControllerIllo id={step === 'connect1' ? 1 : 2} on={slots[step === 'connect1' ? 1 : 2].transportState === 'connected'} />
            </div>
            <div className="chips">
              {(() => {
                const id: ControllerId = step === 'connect1' ? 1 : 2;
                const w = stateWord(slots[id]);
                return (
                  <span className={`chip ${w.ok ? 'chip--ok' : ''}`}>
                    <StatusDot state={w.dot} /> {settings.controllerNames[id]} <span className="chip__state">{slots[id].transportState === 'connected' ? 'Connected' : w.text}</span>
                  </span>
                );
              })()}
            </div>
            <div className="setup__actions">{slots[step === 'connect1' ? 1 : 2].transportState !== 'connected' && connectButtons(step === 'connect1' ? 1 : 2)}</div>
            {error && (
              <div className="setup__error">
                <Icon.Warn size={16} /> {error}
              </div>
            )}
            {step === 'connect2' && slots[2].transportState !== 'connected' && (
              <div className="setup__actions" style={{ marginTop: 14 }}>
                <Button variant="ghost" onClick={() => go('calibrate')}>
                  Skip — I only have one controller
                </Button>
              </div>
            )}
            {!support.bluetooth.supported && support.serial.supported && <p className="setup__note">{support.bluetooth.reason}</p>}
          </div>
        )}

        {step === 'calibrate' && (
          <div className="setup__step" key="calibrate">
            <div className="setup__eyebrow">Step 5 of 6</div>
            <h1 className="setup__title">Hold still</h1>
            <p className="setup__lead">Rest the controllers on a table, or hold them steady. They’ll calibrate on their own in a few seconds.</p>
            <div className="setup__visual">
              <div className="row" style={{ gap: 36 }}>
                {connected.map((id) => (
                  <ControllerIllo key={id} id={id} on={slots[id].calibration === 'ready'} />
                ))}
                {connected.length === 0 && <ControllerIllo id={1} on={false} />}
              </div>
            </div>
            <div className="chips">
              {connected.map((id) => {
                const w = stateWord(slots[id]);
                return (
                  <span key={id} className={`chip ${w.ok ? 'chip--ok' : ''}`}>
                    <StatusDot state={w.dot} /> {settings.controllerNames[id]} <span className="chip__state">{w.text}</span>
                  </span>
                );
              })}
            </div>
            {connected.length === 0 && (
              <div className="setup__actions">
                <p className="dim">No controller connected.</p>
                <Button onClick={() => go('connect1')}>Connect a controller</Button>
              </div>
            )}
            {connected.length > 0 && (
              <div className="setup__actions">
                {slow && (
                  <Button variant="ghost" onClick={() => connected.forEach((id) => controllerManager.recalibrate(id).catch(() => undefined))}>
                    <Icon.Restart size={18} /> Retry calibration
                  </Button>
                )}
                {slow && (
                  <Button variant="ghost" onClick={() => go('track')}>
                    Continue anyway
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'track' && (
          <div className="setup__step setup__step--wide" key="track">
            <div className="setup__eyebrow">Step 6 of 6</div>
            <h1 className="setup__title">Move them around</h1>
            <p className="setup__lead">The controllers on screen should follow yours exactly.</p>
            <div className="scene-wrap">
              <ControllerScene ids={connected.length ? connected : [1]} height="clamp(260px, 42vh, 460px)" />
            </div>
            <div className="setup__actions">
              <span className={`tracking-confirm ${allConfirmed ? 'tracking-confirm--ok' : ''}`}>
                <span className="tracking-confirm__check">{allConfirmed ? <Icon.Check size={14} /> : <Spinner />}</span>
                {allConfirmed ? 'Tracking confirmed' : connected.length === 0 ? 'No controller connected' : 'Waiting for movement…'}
              </span>
              <Button variant="primary" size="lg" onClick={next} disabled={connected.length > 0 && !allConfirmed}>
                Continue <Icon.Chevron size={18} />
              </Button>
              {!allConfirmed && (
                <Button variant="ghost" size="lg" onClick={next}>
                  Skip
                </Button>
              )}
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="setup__step" key="done">
            <div className="done-mark">
              <Icon.Check size={44} />
            </div>
            <h1 className="setup__title">You’re ready</h1>
            <p className="setup__lead">
              {connected.length === 2
                ? 'Both controllers are connected and calibrated.'
                : connected.length === 1
                  ? 'One controller is connected and calibrated. You can add the second any time in Settings.'
                  : 'You can connect controllers any time from Settings.'}
            </p>
            <div className="setup__actions">
              <Button variant="primary" size="lg" onClick={finish}>
                Start <Icon.Chevron size={18} />
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="setup__bottom">
        {idx > 0 && step !== 'done' ? (
          <Button variant="ghost" onClick={back}>
            <Icon.Back size={18} /> Back
          </Button>
        ) : (
          <span />
        )}
        <span className="faint" style={{ fontSize: 13 }}>
          {connected.length ? `${connected.length} controller${connected.length > 1 ? 's' : ''} connected` : ''}
        </span>
      </div>
    </div>
  );
}
