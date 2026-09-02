import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ControllerId } from '@aero/motion-core';
import { PROTOCOL_VERSION } from '@aero/protocol';
import { controllerManager, motionEngine } from '@/core/runtime';
import { transportSupport, type TransportKind } from '@/core/transport/types';
import { useControllerSlots } from '@/store/controllers';
import { useSettings } from '@/store/settings';
import { useHistory } from '@/store/history';
import { Button, Icon, Section, Segmented, SettingRow, StatusDot, Toggle } from '@/ui';
import { CONTROLLER_COLORS } from '@/features/setup/ControllerScene';
import './settings.css';

const APP_VERSION = '0.1.0';

function useInstallPrompt() {
  const [prompt, setPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  return prompt;
}

function ControllerCard({ id }: { id: ControllerId }) {
  const slot = useControllerSlots()[id];
  const settings = useSettings();
  const [name, setName] = useState(settings.controllerNames[id]);
  const [busy, setBusy] = useState(false);
  const support = useMemo(() => transportSupport(), []);
  useEffect(() => setName(settings.controllerNames[id]), [settings.controllerNames, id]);
  const connected = slot.transportState === 'connected';

  const commitName = () => {
    const n = name.trim() || `Controller ${id}`;
    settings.renameController(id, n);
    if (connected) controllerManager.setDeviceName(id, n).catch(() => undefined);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* slot.error carries the message */
    } finally {
      setBusy(false);
    }
  };
  const connect = (kind: TransportKind) => run(() => controllerManager.connect(id, kind));

  const stateText = !connected
    ? slot.transportState === 'connecting'
      ? 'Connecting…'
      : slot.transportState === 'reconnecting'
        ? 'Reconnecting…'
        : slot.error
          ? slot.error
          : 'Not connected'
    : slot.calibration === 'hold-still'
      ? 'Hold still'
      : slot.calibration === 'calibrating'
        ? 'Calibrating…'
        : slot.calibration === 'failed'
          ? 'Calibration failed'
          : 'Connected';
  const dot = slot.transportState === 'error' ? 'error' : connected ? (slot.calibration === 'ready' ? 'on' : 'busy') : slot.transportState === 'disconnected' ? 'off' : 'busy';

  return (
    <div className="ctrl-card" style={{ '--cc': CONTROLLER_COLORS[id] } as React.CSSProperties}>
      <div className="ctrl-card__head">
        <span className="ctrl-card__dot" />
        <input
          className="ctrl-card__name"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label={`Name for controller ${id}`}
        />
      </div>
      <div className="ctrl-card__state">
        <StatusDot state={dot} /> {stateText}
        {connected && slot.transportKind && (
          <span className="faint">
            · {slot.transportKind === 'bluetooth' ? 'Bluetooth' : slot.transportKind === 'serial' ? 'USB' : slot.transportKind === 'simulator' ? 'Simulated' : slot.transportKind}
          </span>
        )}
        {connected && slot.battery != null && (
          <span className="faint row" style={{ gap: 4 }}>
            · <Icon.Battery size={16} level={slot.battery} /> {slot.battery}%
          </span>
        )}
      </div>
      {connected && slot.info && (
        <div className="ctrl-card__meta">
          fw {slot.info.firmwareVersion} · {slot.info.uniqueId}
        </div>
      )}
      <div className="ctrl-card__actions">
        {!connected ? (
          <>
            {support.bluetooth.supported && (
              <Button size="sm" variant="primary" onClick={() => connect('bluetooth')} disabled={busy}>
                <Icon.Bluetooth size={16} /> Bluetooth
              </Button>
            )}
            {support.serial.supported && (
              <Button size="sm" onClick={() => connect('serial')} disabled={busy}>
                <Icon.Usb size={16} /> USB
              </Button>
            )}
            {settings.developerMode && (
              <Button size="sm" variant="ghost" onClick={() => connect('simulator')} disabled={busy}>
                Simulate
              </Button>
            )}
            {settings.rememberedDevices[id] && (
              <Button size="sm" variant="ghost" onClick={() => settings.rememberDevice(id, null)}>
                Forget
              </Button>
            )}
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => run(() => controllerManager.recalibrate(id))} disabled={busy}>
              <Icon.Restart size={16} /> Recalibrate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run(() => controllerManager.identify(id))} disabled={busy || slot.transportKind === 'serial'}>
              Identify
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run(() => controllerManager.disconnect(id))} disabled={busy}>
              Disconnect
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="btn--danger"
              onClick={() =>
                run(async () => {
                  await controllerManager.forget(id);
                  settings.rememberDevice(id, null);
                })
              }
              disabled={busy}
            >
              Forget
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const slots = useControllerSlots();
  const navigate = useNavigate();
  const install = useInstallPrompt();
  const [confirmReset, setConfirmReset] = useState(false);
  const anyConnected = slots[1].transportState === 'connected' || slots[2].transportState === 'connected';

  const swap = () => {
    controllerManager.swap();
    const n1 = settings.controllerNames[1];
    const n2 = settings.controllerNames[2];
    settings.renameController(1, n2);
    settings.renameController(2, n1);
  };

  return (
    <div className="page settings">
      <div className="page-head enter">
        <div>
          <div className="eyebrow">Settings</div>
          <h1>Controllers & preferences</h1>
        </div>
      </div>

      <div className="ctrl-cards enter enter-1">
        <ControllerCard id={1} />
        <ControllerCard id={2} />
      </div>
      <div className="ctrl-row-actions enter enter-1">
        <Button size="sm" onClick={swap} disabled={!anyConnected}>
          <Icon.Swap size={16} /> Swap 1 ↔ 2
        </Button>
        <Button
          size="sm"
          onClick={() => ([1, 2] as ControllerId[]).forEach((id) => slots[id].transportState === 'connected' && controllerManager.recalibrate(id).catch(() => undefined))}
          disabled={!anyConnected}
        >
          <Icon.Restart size={16} /> Recalibrate both
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate('/setup')}>
          Run setup again
        </Button>
      </div>

      <div className="enter enter-2">
        <Section title="Motion">
          <SettingRow label="Sensitivity" hint="How much movement it takes to trigger an action.">
            <Segmented
              value={settings.sensitivity}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'normal', label: 'Normal' },
                { value: 'high', label: 'High' },
              ]}
              onChange={(v) => {
                settings.setSensitivity(v);
                motionEngine.setSensitivity(v);
              }}
            />
          </SettingRow>
          <SettingRow label="Auto re-centre" hint="Quietly refine calibration whenever a controller is at rest.">
            <Toggle checked={settings.autoRecalibrate} onChange={settings.setAutoRecalibrate} label="Auto re-centre" />
          </SettingRow>
        </Section>

        <Section title="Sound">
          <SettingRow label="Volume">
            <input
              className="slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.volume}
              onChange={(e) => settings.setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </SettingRow>
          <SettingRow label="Mute">
            <Toggle checked={settings.muted} onChange={settings.setMuted} label="Mute" />
          </SettingRow>
        </Section>

        <Section title="Input">
          <SettingRow label="Keyboard fallback" hint="For testing and accessibility. Activities still only see motion actions.">
            <Toggle checked={settings.keyboardFallback} onChange={settings.setKeyboardFallback} label="Keyboard fallback" />
          </SettingRow>
          <SettingRow label="Gamepad fallback" hint="Use a connected gamepad as an optional input.">
            <Toggle checked={settings.gamepadFallback} onChange={settings.setGamepadFallback} label="Gamepad fallback" />
          </SettingRow>
        </Section>

        <Section title="Developer">
          <SettingRow label="Developer Mode" hint="Raw sensor data, simulator and factory tools.">
            <Toggle checked={settings.developerMode} onChange={settings.setDeveloperMode} label="Developer mode" />
          </SettingRow>
          {settings.developerMode && (
            <>
              <SettingRow label="Diagnostics & Simulator" hint="Live streams, gesture events, simulated controllers.">
                <Link to="/settings/developer" className="btn btn--sm">
                  Open <Icon.Chevron size={16} />
                </Link>
              </SettingRow>
              <SettingRow label="Factory Test" hint="PASS / FAIL checks for assembled units.">
                <Link to="/settings/factory" className="btn btn--sm">
                  Open <Icon.Chevron size={16} />
                </Link>
              </SettingRow>
            </>
          )}
        </Section>

        <Section title="About">
          <div className="about-line">
            <span>AiroMote</span>
            <span>v{APP_VERSION}</span>
          </div>
          <div className="about-line">
            <span>Motion protocol</span>
            <span>v{PROTOCOL_VERSION}</span>
          </div>
          <SettingRow label="Install as an app" hint={install ? 'Works offline and opens full-screen.' : 'Use your browser’s “Install app” option to add AiroMote to your device.'}>
            {install && (
              <Button size="sm" onClick={() => install.prompt()}>
                Install
              </Button>
            )}
          </SettingRow>
        </Section>

        <Section title="Reset">
          <SettingRow label="Reset all settings" hint="Clears names, preferences and workout history on this device.">
            {confirmReset ? (
              <div className="confirm-inline">
                <Button
                  size="sm"
                  className="btn--danger"
                  onClick={() => {
                    settings.resetAll();
                    useHistory.getState().clear();
                    setConfirmReset(false);
                    navigate('/setup');
                  }}
                >
                  Yes, reset
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="btn--danger" onClick={() => setConfirmReset(true)}>
                Reset
              </Button>
            )}
          </SettingRow>
        </Section>
      </div>
    </div>
  );
}
