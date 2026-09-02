import { useState } from 'react';
import type { ActivityDefinition } from '@aero/activity-engine';
import type { ControllerId } from '@aero/motion-core';
import { Button, Icon, StatusDot } from '@/ui';
import { controllerManager } from '@/core/runtime';
import { transportSupport } from '@/core/transport/types';
import { useControllerSlots } from '@/store/controllers';
import { useSettings } from '@/store/settings';
import type { UseActivitySessionResult } from '@/core/session';

/**
 * Shows, per activity role, which controller is assigned and its live state, with inline
 * connect buttons for slots that are still empty. Used inside activity intros and the home screen.
 */
export function ControllerGate({ def, session }: { def: ActivityDefinition; session: UseActivitySessionResult }) {
  const slots = useControllerSlots();
  const names = useSettings((s) => s.controllerNames);
  const developerMode = useSettings((s) => s.developerMode);
  const [busy, setBusy] = useState<ControllerId | null>(null);
  const support = transportSupport();

  const freeSlot = (): ControllerId | null => (slots[1].transportState !== 'connected' ? 1 : slots[2].transportState !== 'connected' ? 2 : null);

  const connect = async (kind: 'bluetooth' | 'serial' | 'simulator') => {
    const id = freeSlot();
    if (!id) return;
    setBusy(id);
    try {
      await controllerManager.connect(id, kind);
    } catch {
      /* error shown in slot state */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="gate">
      {def.roles.map((role) => {
        const id = session.roles[role.id];
        const slot = id ? slots[id] : null;
        const on = slot?.transportState === 'connected';
        const calibrating = slot && (slot.calibration === 'hold-still' || slot.calibration === 'calibrating');
        return (
          <div key={role.id} className="gate__row">
            <div className="row" style={{ gap: 10 }}>
              <StatusDot state={on ? (calibrating ? 'busy' : 'on') : 'off'} />
              <div>
                <div className="gate__role">
                  {role.label}
                  {!role.required && <span className="faint"> · optional</span>}
                </div>
                <div className="gate__hint">
                  {on
                    ? `${names[id!]}${calibrating ? ' · calibrating' : ''}`
                    : id
                      ? `${names[id]} · ${slot?.transportState === 'connecting' ? 'connecting…' : 'not connected'}`
                      : role.description}
                </div>
              </div>
            </div>
            {!on && (
              <div className="row" style={{ gap: 6 }}>
                {support.bluetooth.supported && (
                  <Button size="sm" onClick={() => connect('bluetooth')} disabled={busy !== null || !freeSlot()}>
                    <Icon.Bluetooth size={16} /> Connect
                  </Button>
                )}
                {support.serial.supported && (
                  <Button size="sm" variant="ghost" onClick={() => connect('serial')} disabled={busy !== null || !freeSlot()} title="Connect over USB">
                    <Icon.Usb size={16} />
                  </Button>
                )}
                {developerMode && (
                  <Button size="sm" variant="ghost" onClick={() => connect('simulator')} disabled={busy !== null || !freeSlot()} title="Simulated controller">
                    Simulate
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
